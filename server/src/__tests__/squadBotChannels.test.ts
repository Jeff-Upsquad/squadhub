import express from 'express';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), access: vi.fn(), paused: vi.fn(), jobs: vi.fn(), channel: vi.fn() }));
vi.mock('../supabase', () => ({ supabaseAdmin: { from: mocks.from, rpc: mocks.rpc } }));
vi.mock('../middleware/auth', () => ({ requireAuth: (req: any, _res: any, next: any) => { req.userId = 'person'; req.userType = req.header('x-user-type') || 'internal'; next(); } }));
vi.mock('../middleware/permissions', () => ({ checkResourceAccess: mocks.access, meetsAccessLevel: (a: string, b: string) => ['viewer','commenter','member','manager'].indexOf(a) >= ['viewer','commenter','member','manager'].indexOf(b) }));
vi.mock('../services/squadBots', () => ({ allPaused: mocks.paused, effectiveStatus: (b: any, p: boolean) => p ? 'off' : b.status }));
vi.mock('../services/squadBotJobs', async original => ({ ...await original<object>(), listJobs: mocks.jobs }));
vi.mock('../services/squadBotChannels', async original => ({ ...await original<object>(), botChannel: mocks.channel }));
import channelRouter from '../routes/squad-bot-channels';
import integrationRouter from '../routes/integrations/squad-bot-doubts';
import { decisionSchema, doubtSchema, eligibleBotChannelMember } from '../services/squadBotChannels';

const botId = '31648ec9-a74d-4a45-9316-0be5e8f49cec', channelId = '2e4eeca9-c94a-4fe2-8619-7b5be614693f';
const doubtId = '11111111-1111-4111-8111-111111111111';
let server: Server, base: string;
const bot = { id: botId, status: 'live' };
const doubt = { id: doubtId, bot_id: botId, status: 'instructed', target: {}, job_id: null };
function result(data: unknown, error: unknown = null) {
  const q: any = { then: (ok: any, fail: any) => Promise.resolve({ data, error }).then(ok, fail) };
  for (const m of ['select','eq','is','order','range','update','insert','upsert','limit','maybeSingle','single','contains']) q[m] = vi.fn(() => q);
  mocks.from.mockReturnValueOnce(q); return q;
}
beforeAll(async () => {
  const app = express(); app.use(express.json()); app.use('/channels', channelRouter);
  app.use('/bot', (req: any, _res, next) => { req.squadBot = { ...bot, status: req.header('x-bot-status') || 'live' }; next(); }, integrationRouter);
  server = await new Promise<Server>(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));
beforeEach(() => {
  vi.resetAllMocks();
  const fallback: any = { then: (ok: any, fail: any) => Promise.resolve({ data: null, error: null }).then(ok, fail) };
  for (const m of ['select','eq','is','order','range','update','insert','upsert','limit','maybeSingle','single','contains']) fallback[m] = vi.fn(() => fallback);
  mocks.from.mockReturnValue(fallback);
  mocks.access.mockResolvedValue('member'); mocks.paused.mockResolvedValue(false); mocks.jobs.mockResolvedValue([]); mocks.channel.mockResolvedValue({ id: channelId });
});
const post = (path: string, body: unknown, headers = {}) => fetch(base + path, { method: 'POST', headers: { 'Content-Type':'application/json', ...headers }, body: JSON.stringify(body) });
const resolution = `/channels/${channelId}/doubts/${doubtId}/resolve`;
describe('bot questions and channel authority', () => {
  it.each(['javascript:alert(1)', '//evil.example/path', '/\\evil', 'https://user:password@example.com'])('rejects unsafe source %s', source_url => {
    expect(doubtSchema.safeParse({ event_id:'e', question:'Help?', source_url }).success).toBe(false);
  });
  it('requires actual guidance for the instruction path', () => expect(decisionSchema.safeParse({ mode:'instruct', instruction:'   ' }).success).toBe(false));
  it('blocks non-internal users before database access', async () => {
    expect((await post(resolution, { mode:'takeover' }, { 'x-user-type':'client' })).status).toBe(403);
    expect(mocks.from).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([null, 'viewer'])('blocks responses at access %s', async level => {
    mocks.access.mockResolvedValue(level);
    expect((await post(resolution, { mode:'instruct', instruction:'Send the reply' })).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('binds decisions to the channel bot and authenticated teammate', async () => {
    result({ id: channelId, squad_bot_id: botId }); mocks.rpc.mockResolvedValue({ data:{ status:'instructed' }, error:null });
    expect((await post(resolution, { mode:'instruct', instruction:'Send the reply', bot_id:'other', resolved_by:'other' })).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('resolve_squad_bot_doubt', expect.objectContaining({ p_bot_id:botId, p_user_id:'person', p_instruction:'Send the reply' }));
  });
  it('reports competing decisions as conflicts', async () => {
    result({ id:channelId, squad_bot_id:botId }); mocks.rpc.mockResolvedValue({ error:{ code:'P0001' } });
    expect((await post(resolution, { mode:'takeover' })).status).toBe(409);
  });
  it('rejects a foreign job when raising a question', async () => {
    const r = await post('/bot/doubts', { event_id:'1', question:'Help?', source_url:'https://example.com/thread/1', job_id:doubtId });
    expect(r.status).toBe(400); expect(mocks.from).not.toHaveBeenCalled();
  });
  it('preserves existing decisions on event retries and scopes to the authenticated bot', async () => {
    const insert = result(null); const select = result(doubt);
    expect((await post('/bot/doubts', { event_id:'1', question:'Help?', source_url:'/app?open_channel=1', bot_id:'other' })).status).toBe(200);
    expect(insert.upsert).toHaveBeenCalledWith(expect.objectContaining({ bot_id:botId }), { onConflict:'bot_id,event_id', ignoreDuplicates:true });
    expect(select.eq).toHaveBeenCalledWith('bot_id', botId);
  });
  it.each(['off','practice'])('does not execute in %s mode', async status => {
    result(doubt);
    expect((await post(`/bot/doubts/${doubtId}/claim`, {}, { 'x-bot-status':status })).status).toBe(423);
    expect(mocks.from).toHaveBeenCalledTimes(1);
  });
  it('respects emergency stop even after a person has instructed the bot', async () => {
    mocks.paused.mockResolvedValue(true); result(doubt);
    expect((await post(`/bot/doubts/${doubtId}/claim`, {})).status).toBe(423);
  });
  it('rechecks job scope before execution', async () => {
    result({ ...doubt, job_id:doubtId, target:{ person_id:'wrong' } });
    mocks.jobs.mockResolvedValue([{ id:doubtId, enabled:true, audience:'any', person_ids:['allowed'], pipeline_id:null, stage_id:null }]);
    expect((await post(`/bot/doubts/${doubtId}/claim`, {})).status).toBe(423);
    expect(mocks.from).toHaveBeenCalledTimes(1);
  });
  it('claims only an instructed action belonging to this bot', async () => {
    result(doubt); const claim = result({ ...doubt, status:'executing' });
    expect((await post(`/bot/doubts/${doubtId}/claim`, {}, { 'x-bot-status':'approval' })).status).toBe(200);
    expect(claim.eq).toHaveBeenCalledWith('status','instructed'); expect(claim.eq).toHaveBeenCalledWith('bot_id',botId);
    expect(claim.update).toHaveBeenCalledWith(expect.objectContaining({ status:'executing', execution_token:expect.any(String) }));
  });
  it('does not let a competing worker claim the same action', async () => {
    result(doubt); result(null);
    expect((await post(`/bot/doubts/${doubtId}/claim`, {})).status).toBe(409);
  });
  it('scopes completion to the bot, claim token, and executing state', async () => {
    const completion = result({ status:'completed' });
    expect((await post(`/bot/doubts/${doubtId}/outcome`, { execution_token:doubtId, status:'completed', note:'Sent' })).status).toBe(200);
    expect(completion.eq).toHaveBeenCalledWith('bot_id',botId); expect(completion.eq).toHaveBeenCalledWith('execution_token',doubtId); expect(completion.eq).toHaveBeenCalledWith('status','executing');
  });
  it.each([
    ['client', 'active', true, false], ['internal', 'suspended', true, false], ['internal', 'active', false, false], ['internal', 'active', true, true],
  ])('limits invitations: %s %s workspace membership %s', async (user_type, status, member, expected) => {
    result({ squad_bot_id:botId, workspace_id:'workspace' }); result({ user_type, status }); result(member ? { user_id:'person' } : null);
    expect(await eligibleBotChannelMember(channelId,'person')).toBe(expected);
  });
});
