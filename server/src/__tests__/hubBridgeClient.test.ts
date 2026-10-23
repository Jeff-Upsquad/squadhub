/**
 * Outbound SaaS → Hub client: signs exactly like the Hub verifier expects,
 * degrades to HubUnavailableError ("temporarily unavailable"), and the
 * time-totals mapping (shared workspace → hub card, talent → hub partner).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import crypto from 'crypto';

vi.hoisted(() => {
  process.env.SAAS_BRIDGE_SECRET = 'out-secret';
  process.env.HUB_API_URL = 'https://hub.test/api';
});

vi.mock('../supabase', async () => {
  const { createFakeSupabase } = await import('./helpers/fakeSupabase');
  return createFakeSupabase(db, {});
});

const db: any = vi.hoisted(() => ({
  shared_workspace_links: [
    { shared_workspace_id: 'sw1', participant_workspace_id: 'ta1', participant_role: 'talent', hub_card_id: 'card-1' },
    { shared_workspace_id: 'sw1', participant_workspace_id: 'biz', participant_role: 'host', hub_card_id: 'card-1' },
  ],
  workspaces: [{ id: 'ta1', owner_user_id: 'u-tal', hub_partner_user_id: 'hub-partner-1' }],
  task_time_entries: [
    // 2026-10-20 IST = 2026-10-19T18:30Z .. 2026-10-20T18:30Z
    { workspace_id: 'sw1', user_id: 'u-tal', started_at: '2026-10-19T19:00:00.000Z', duration_seconds: 3600 },
    { workspace_id: 'sw1', user_id: 'u-tal', started_at: '2026-10-20T10:00:00.000Z', duration_seconds: 1800 },
    { workspace_id: 'sw1', user_id: 'u-tal', started_at: '2026-10-20T19:00:00.000Z', duration_seconds: 999 }, // next IST day
    { workspace_id: 'other', user_id: 'u-tal', started_at: '2026-10-20T10:00:00.000Z', duration_seconds: 999 },
  ],
}));

import { hub, HubUnavailableError, HubRequestError } from '../utils/hubBridgeClient';
import { computeTimeTotals } from '../services/bridge/timeTotals';

/** The Hub's verifier (squadhub web utils/bridgeSign.ts), verbatim formula. */
function hubVerify(method: string, url: string, body: string, headers: Record<string, string>, secret: string): boolean {
  const u = new URL(url);
  let p = `${u.pathname}${u.search}`;
  p = p.slice(p.indexOf('/bridge/'));
  const ts = headers['X-Bridge-Timestamp'];
  const sha = crypto.createHash('sha256').update(body || '', 'utf8').digest('hex');
  const expected = crypto.createHmac('sha256', secret).update(`${ts}.${method}.${p}.${sha}`).digest('hex');
  return expected === headers['X-Bridge-Signature'] && Math.abs(Date.now() / 1000 - Number(ts)) <= 300;
}

afterEach(() => vi.unstubAllGlobals());

describe('hubBridgeClient', () => {
  it('signs GET with query and POST with body so the Hub verifier accepts them', async () => {
    const calls: any[] = [];
    vi.stubGlobal('fetch', async (url: string, init: any) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ success: true, data: { ok: 1 } }), { status: 200 });
    });
    await hub.talentPayouts('p1', '2026-10');
    await hub.timeTotals({ date: '2026-10-20', entries: [{ hub_card_id: 'c', hub_partner_user_id: 'p', minutes: 5 }] });
    expect(calls[0].url).toBe('https://hub.test/api/bridge/v1/talent/p1/payouts?month=2026-10');
    for (const c of calls) {
      expect(hubVerify(c.init.method, c.url, c.init.body || '', c.init.headers, 'out-secret')).toBe(true);
    }
  });

  it('maps network errors, 5xx and 401 to HubUnavailableError and passes 4xx through', async () => {
    vi.stubGlobal('fetch', async () => { throw new TypeError('fetch failed'); });
    await expect(hub.talentAssignments('p1')).rejects.toBeInstanceOf(HubUnavailableError);
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ success: false, error: 'boom' }), { status: 500 }));
    await expect(hub.talentAssignments('p1')).rejects.toBeInstanceOf(HubUnavailableError);
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ success: false, error: 'Bridge auth failed' }), { status: 401 }));
    await expect(hub.talentAssignments('p1')).rejects.toBeInstanceOf(HubUnavailableError);
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ success: false, error: 'User not found' }), { status: 404 }));
    await expect(hub.talentAssignments('p1')).rejects.toBeInstanceOf(HubRequestError);
  });
});

describe('time totals', () => {
  it('sums the talent’s minutes in the card’s shared workspace for the IST date', async () => {
    expect(await computeTimeTotals('2026-10-20')).toEqual([
      { hub_card_id: 'card-1', hub_partner_user_id: 'hub-partner-1', minutes: 90 },
    ]);
  });
});
