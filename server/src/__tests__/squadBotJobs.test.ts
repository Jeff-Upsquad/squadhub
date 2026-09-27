import { describe, expect, it, vi } from 'vitest';
vi.mock('../supabase', () => ({ supabaseAdmin: {} }));
import { activitySchema, jobBlockReason, jobSchema, periodBounds, safeActivityUrl, type Job } from '../services/squadBotJobs';
const job: Job = { id: 'j', bot_id: 'b', name: 'Candidate replies', kind: 'conversation', instructions: '', enabled: true, audience: 'candidates', person_ids: ['person-1'], pipeline_id: 'pipeline-1', stage_id: 'shortlisted' };
const target = { audience: 'candidates' as const, person_id: 'person-1', pipeline_id: 'pipeline-1', stage_id: 'shortlisted' };
describe('job scope enforcement', () => {
  it('requires all selected constraints, rejecting missing scope', () => {
    expect(jobBlockReason(job, 'live', target)).toBeNull();
    expect(jobBlockReason(job, 'live', {})).toMatch(/audience/);
    expect(jobBlockReason(job, 'live', { ...target, audience: 'customers' })).toMatch(/audience/);
    expect(jobBlockReason(job, 'live', { ...target, person_id: 'someone-else' })).toMatch(/person/);
    expect(jobBlockReason(job, 'live', { ...target, pipeline_id: undefined })).toMatch(/pipeline/);
    expect(jobBlockReason(job, 'live', { ...target, stage_id: 'hired' })).toMatch(/stage/);
  });
  it('bot off and job off override an otherwise valid target', () => {
    expect(jobBlockReason(job, 'off', target)).toMatch(/bot.*off/);
    expect(jobBlockReason({ ...job, enabled: false }, 'live', target)).toMatch(/job.*off/);
  });
  it('permits unconstrained jobs and preparation in practice or approval', () => {
    expect(jobBlockReason({ ...job, audience: 'any', person_ids: [], pipeline_id: null, stage_id: null }, 'live', {})).toBeNull();
    expect(jobBlockReason(job, 'practice', target)).toBeNull();
    expect(jobBlockReason(job, 'approval', target)).toBeNull();
  });
  it('requires pipeline when choosing a stage and defaults new jobs to off', () => {
    expect(jobSchema.safeParse({ name: 'Reply', kind: 'conversation', stage_id: 'stage' }).success).toBe(false);
    expect(jobSchema.parse({ name: 'Reply', kind: 'conversation' }).enabled).toBe(false);
  });
});
describe('calendar report boundaries', () => {
  it.each([
    ['daily', '2024-02-29', '2024-02-29', '2024-03-01'],
    ['weekly', '2026-09-27', '2026-09-21', '2026-09-28'],
    ['weekly', '2026-09-28', '2026-09-28', '2026-10-05'],
    ['monthly', '2026-12-31', '2026-12-01', '2027-01-01'],
    ['quarterly', '2026-12-31', '2026-10-01', '2027-01-01'],
    ['yearly', '2024-02-29', '2024-01-01', '2025-01-01'],
  ] as const)('%s containing %s', (period, date, start, end) => {
    expect(periodBounds(period, date)).toEqual({ start: `${start}T00:00:00.000Z`, end: `${end}T00:00:00.000Z` });
  });
  it('rejects normalized invalid dates', () => expect(() => periodBounds('daily', '2026-02-30')).toThrow());
});
describe('activity reports', () => {
  it.each(['javascript:alert(1)', '//evil.test', '/\\evil.test', 'https://user:password@example.com', 'data:text/html,test', '/\nevil.test'])('rejects unsafe links: %s', value => expect(safeActivityUrl(value)).toBe(false));
  it.each(['/admin/candidates/123', 'https://crm.example.com/pipeline/123?stage=2'])('accepts site and app links: %s', value => expect(safeActivityUrl(value)).toBe(true));
  it('requires a note and event ID for deduplication', () => {
    const data = { job_id: '11111111-1111-4111-8111-111111111111', event_id: 'event-1', outcome: 'completed', note: 'Replied to candidate' };
    expect(activitySchema.safeParse(data).success).toBe(true);
    expect(activitySchema.safeParse({ ...data, note: '' }).success).toBe(false);
    expect(activitySchema.safeParse({ ...data, event_id: '' }).success).toBe(false);
  });
});
