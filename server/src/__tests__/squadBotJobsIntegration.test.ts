import express from 'express';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ findBot: vi.fn(), paused: vi.fn(), reply: vi.fn(), jobs: vi.fn(), insert: vi.fn() }));
vi.mock('../supabase', () => ({ supabaseAdmin: { from: () => ({ insert: mocks.insert }) } }));
vi.mock('../services/squadhireTraining', () => ({ loadPages: vi.fn() }));
vi.mock('../services/squadBots', () => ({
  findBotByApiKey: mocks.findBot, allPaused: mocks.paused, runBotReply: mocks.reply,
  effectiveStatus: (bot: { status: string }, paused: boolean) => paused ? 'off' : bot.status,
  listProviders: vi.fn(), resolveAi: vi.fn(),
}));
vi.mock('../services/squadBotJobs', async importOriginal => ({ ...await importOriginal<object>(), listJobs: mocks.jobs }));
import router from '../routes/integrations/squad-bots';
const jobId = '11111111-1111-4111-8111-111111111111';
const bot = { id: 'bot-1', status: 'live', instructions: 'Be helpful', public_name: 'Squad Bot' };
const job = { id: jobId, bot_id: bot.id, name: 'Candidate replies', kind: 'conversation', instructions: 'Ask about availability', enabled: true, audience: 'candidates', person_ids: [], pipeline_id: 'pipeline-1', stage_id: 'shortlist' };
const target = { audience: 'candidates', pipeline_id: 'pipeline-1', stage_id: 'shortlist' };
let server: Server;
let base: string;
beforeAll(async () => {
  const app = express(); app.use(express.json()); app.use(router);
  server = await new Promise<Server>(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));
beforeEach(() => {
  vi.clearAllMocks(); mocks.findBot.mockResolvedValue(bot); mocks.paused.mockResolvedValue(false);
  mocks.jobs.mockResolvedValue([job]); mocks.reply.mockResolvedValue({ text: 'Hello' }); mocks.insert.mockResolvedValue({ error: null });
});
async function post(path: string, body: unknown, auth = true) {
  return fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer sbk_test' } : {}) }, body: JSON.stringify(body) });
}
describe('job integration contract', () => {
  it('requires a bot key', async () => expect((await post('/activity', {}, false)).status).toBe(401));
  it('requires a job ID when jobs are configured', async () => {
    const res = await post('/reply', { messages: [{ role: 'user', content: 'Hi' }] });
    expect(res.status).toBe(400); expect(mocks.reply).not.toHaveBeenCalled();
  });
  it('rejects jobs owned by another bot', async () => {
    expect((await post('/jobs/other-bots-job/check', target)).status).toBe(404);
    expect((await post('/activity', { job_id: '22222222-2222-4222-8222-222222222222', event_id: 'e1', outcome: 'completed', note: 'Done' })).status).toBe(404);
    expect(mocks.insert).not.toHaveBeenCalled();
  });
  it('blocks replies outside the pipeline or while the job is off', async () => {
    const request = { messages: [{ role: 'user', content: 'Hi' }], job_id: jobId, target: { ...target, pipeline_id: 'wrong' } };
    expect((await post('/reply', request)).status).toBe(423);
    mocks.jobs.mockResolvedValue([{ ...job, enabled: false }]);
    expect((await post('/reply', { ...request, target })).status).toBe(423);
    expect(mocks.reply).not.toHaveBeenCalled();
  });
  it('applies job instructions to a scoped conversation', async () => {
    expect((await post('/reply', { messages: [{ role: 'user', content: 'Hi' }], job_id: jobId, target })).status).toBe(200);
    expect(mocks.reply.mock.calls[0][0].instructions).toContain(job.instructions);
  });
  it.each(['practice', 'approval', 'off'])('never authorizes side effects in %s', async status => {
    mocks.findBot.mockResolvedValue({ ...bot, status });
    const data = await (await post(`/jobs/${jobId}/check`, target)).json() as { data: { can_execute: boolean } };
    expect(data.data.can_execute).toBe(false);
  });
  it('respects emergency stop and permits live jobs', async () => {
    expect(((await (await post(`/jobs/${jobId}/check`, target)).json()) as { data: { can_execute: boolean } }).data.can_execute).toBe(true);
    mocks.paused.mockResolvedValue(true);
    expect(((await (await post(`/jobs/${jobId}/check`, target)).json()) as { data: { allowed: boolean } }).data.allowed).toBe(false);
  });
  it('attributes reports to the authenticated bot and snapshots the job name', async () => {
    const res = await post('/activity', { job_id: jobId, event_id: 'e1', outcome: 'completed', note: 'Replied to Jane', target_url: 'https://example.com/candidate/1', bot_id: 'other' });
    expect(res.status).toBe(200);
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({ bot_id: bot.id, job_name: job.name }));
  });
  it('accepts duplicate report retries without counting another action', async () => {
    mocks.insert.mockResolvedValue({ error: { code: '23505' } });
    const res = await post('/activity', { job_id: jobId, event_id: 'e1', outcome: 'completed', note: 'Done' });
    expect(((await res.json()) as { duplicate: boolean }).duplicate).toBe(true);
  });
});
