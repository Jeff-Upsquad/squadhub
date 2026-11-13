import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

const fromSpy = vi.fn();
vi.mock('../supabase', () => ({ supabaseAdmin: { from: (...a: any[]) => fromSpy(...a) }, supabaseAuth: {}, supabase: {} }));
vi.mock('../utils/activatedClientSpaces', () => ({ resolveClientIdForCard: vi.fn() }));
vi.mock('../utils/spaceTalentHandoff', () => ({ resolveRecipientUserId: vi.fn() }));

const cfg = vi.hoisted(() => ({
  config: { saasBridgeSecret: '', saasApiUrl: '', saasProvisioningEnabled: false } as Record<string, any>,
}));
vi.mock('../config', () => cfg);

import {
  extractSharedWorkspaceId,
  saasBridgeRequest,
  saasCardLifecycle,
  saasProvisionAssignment,
  saasProvisionBusinessForClient,
  saasUrl,
} from '../utils/saasBridgeClient';
import { verifyBridgeRequest } from '../utils/bridgeSign';
import { dedupeTimeTotals, timeTotalsSchema } from '../utils/saasTimeTotals';

describe('saasBridgeClient', () => {
  beforeEach(() => {
    cfg.config.saasBridgeSecret = '';
    cfg.config.saasApiUrl = '';
    cfg.config.saasProvisioningEnabled = false;
    fromSpy.mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('no-ops with a log line when the secret is unset', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const r = await saasBridgeRequest('POST', '/bridge/v1/accounts', { a: 1 });
    expect(r).toEqual({ ok: false, error: 'bridge_disabled', skipped: true });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it('sends a request the receiver can verify', async () => {
    cfg.config.saasBridgeSecret = 's3cret';
    cfg.config.saasApiUrl = 'https://app.example/api/';
    let captured: any = null;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: any) => {
        captured = { url, init };
        return { ok: true, status: 200, json: async () => ({ success: true, data: { saas_account_id: 'acc_1' } }) };
      }),
    );
    const r = await saasBridgeRequest('POST', '/bridge/v1/accounts', { kind: 'business' }, { actor: { hub_user_id: 'u1' } });
    expect(r).toEqual({ ok: true, data: { saas_account_id: 'acc_1' } });
    expect(captured.url).toBe('https://app.example/api/bridge/v1/accounts');
    expect(captured.init.headers['X-Bridge-Actor']).toBe('{"hub_user_id":"u1"}');
    // The SaaS (behind its /api prefix strip) sees /bridge/v1/accounts.
    const verified = verifyBridgeRequest(
      {
        method: 'POST',
        originalUrl: '/bridge/v1/accounts',
        rawBody: captured.init.body,
        headers: {
          'x-bridge-timestamp': captured.init.headers['X-Bridge-Timestamp'],
          'x-bridge-signature': captured.init.headers['X-Bridge-Signature'],
        },
      },
      's3cret',
    );
    expect(verified).toEqual({ ok: true });
  });

  it('reports SaaS errors without throwing', async () => {
    cfg.config.saasBridgeSecret = 's';
    cfg.config.saasApiUrl = 'https://app.example';
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 409, json: async () => ({ success: false, error: 'nope' }) })));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await saasBridgeRequest('GET', '/bridge/v1/x')).toEqual({ ok: false, error: 'nope', status: 409 });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    expect(await saasBridgeRequest('GET', '/bridge/v1/x')).toMatchObject({ ok: false, error: 'ECONNREFUSED' });
    err.mockRestore();
  });

  it('provisioning hooks touch nothing while SAAS_PROVISIONING_ENABLED is off', async () => {
    cfg.config.saasBridgeSecret = 's';
    cfg.config.saasApiUrl = 'https://app.example';
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    expect(await saasProvisionBusinessForClient('c1')).toBeNull();
    await saasProvisionAssignment({ cardId: 'k1', recipientType: 'partner', recipientId: 'p1' });
    await saasCardLifecycle('k1', 'pause');
    expect(fromSpy).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('builds URLs and extracts workspace ids tolerantly', () => {
    cfg.config.saasApiUrl = 'https://app.example/';
    expect(saasUrl('/bridge/v1/accounts')).toBe('https://app.example/bridge/v1/accounts');
    expect(extractSharedWorkspaceId({ shared_workspace_id: 'w1' })).toBe('w1');
    expect(extractSharedWorkspaceId({ shared_workspace: { id: 'w2' } })).toBe('w2');
    expect(extractSharedWorkspaceId({ id: 3 })).toBe('3');
    expect(extractSharedWorkspaceId(null)).toBeNull();
  });
});

describe('saasTimeTotals', () => {
  const card = '11111111-1111-4111-8111-111111111111';
  const partner = '22222222-2222-4222-8222-222222222222';
  it('validates the payload', () => {
    expect(timeTotalsSchema.safeParse({ date: '2026-10-23', entries: [{ hub_card_id: card, hub_partner_user_id: partner, minutes: 90 }] }).success).toBe(true);
    expect(timeTotalsSchema.safeParse({ date: '23-10-2026', entries: [] }).success).toBe(false);
    expect(timeTotalsSchema.safeParse({ date: '2026-10-23', entries: [{ hub_card_id: card, hub_partner_user_id: partner, minutes: -1 }] }).success).toBe(false);
    expect(timeTotalsSchema.safeParse({ date: '2026-10-23', entries: [{ hub_card_id: card, hub_partner_user_id: partner, minutes: 1441 }] }).success).toBe(false);
  });
  it('collapses duplicate (card, partner) pairs, last value wins', () => {
    const out = dedupeTimeTotals({
      date: '2026-10-23',
      entries: [
        { hub_card_id: card, hub_partner_user_id: partner, minutes: 30 },
        { hub_card_id: card, hub_partner_user_id: partner, minutes: 45 },
      ],
    });
    expect(out).toEqual([{ hub_card_id: card, hub_partner_user_id: partner, minutes: 45 }]);
  });
});
