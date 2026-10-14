import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rows: [] as any[], rpc: vi.fn(), updates: [] as { patch: any; filters: [string, unknown][] }[] }));
vi.mock('../supabase', () => ({
  supabaseAdmin: {
    rpc: mocks.rpc,
    from: () => {
      const q: any = {
        select() { return q; }, is() { return q; }, lte() { return q; }, order() { return q; },
        async limit() { return { data: mocks.rows, error: null }; },
        update(patch: any) {
          const entry = { patch, filters: [] as [string, unknown][] };
          mocks.updates.push(entry);
          const u: any = { eq(col: string, v: unknown) { entry.filters.push([col, v]); return u; }, then: (r: any) => r({ error: null }) };
          return u;
        },
      };
      return q;
    },
  },
}));
import { processContentBriefCrmOutbox } from '../cron/content-brief-crm-cron';

const row = (id: string) => ({ card_id: id, payload: { p_phone_e164: '+919000000001', p_details: { requirement: 'x'.repeat(20_000) } }, attempts: 0, next_attempt_at: '2026-10-14T02:31:00.123456+00:00' });

beforeEach(() => { mocks.updates.length = 0; mocks.rpc.mockReset(); });

describe('content brief CRM outbox', () => {
  it('acknowledges by attempt marker, never by the (possibly huge) payload', async () => {
    mocks.rows = [row('a')];
    mocks.rpc.mockResolvedValue({ data: 'lead-1', error: null });
    await processContentBriefCrmOutbox();
    expect(mocks.updates[0].patch.delivered_at).toBeTruthy();
    expect(mocks.updates[0].filters.map(([c]) => c)).toEqual(['card_id', 'attempts', 'next_attempt_at']);
  });
  it('keeps delivering later rows when one row throws', async () => {
    mocks.rows = [row('a'), row('b')];
    mocks.rpc.mockRejectedValueOnce(new Error('network')).mockResolvedValue({ data: 'lead-2', error: null });
    await processContentBriefCrmOutbox();
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    expect(mocks.updates).toHaveLength(1);
  });
});
