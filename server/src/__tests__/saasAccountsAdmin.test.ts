import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import crypto from 'node:crypto';
import type { Server } from 'node:http';

// Real routers + real requireAdmin; auth is stubbed from headers and the
// `users.is_admin` lookup is answered from an in-memory map.
const state = vi.hoisted(() => ({ admins: new Set<string>() }));

vi.mock('../middleware/auth', () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const id = req.headers['x-test-user'];
    if (!id) {
      res.status(401).json({ success: false, error: 'Not authenticated' });
      return;
    }
    req.userId = id;
    req.userEmail = `${id}@example.com`;
    req.userType = req.headers['x-test-type'] || 'internal';
    next();
  },
}));

vi.mock('../supabase', () => ({
  supabaseAdmin: {
    from: () => {
      let id: string | undefined;
      const q: any = {
        select: () => q,
        eq: (_k: string, v: string) => { id = v; return q; },
        single: async () => ({ data: { is_admin: state.admins.has(id as string) }, error: null }),
      };
      return q;
    },
  },
}));

import adminRouter from '../routes/saas-accounts-admin';
import staffRouter from '../routes/saas-staff';
import { signBridgeRequest } from '../utils/bridgeSign';

const SECRET = 'test-bridge-secret';
let server: Server;
let base = '';
const realFetch = globalThis.fetch;
const outbound: Array<{ url: string; init: RequestInit }> = [];

async function call(method: string, path: string, opts: { user?: string; type?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.user) headers['x-test-user'] = opts.user;
  if (opts.type) headers['x-test-type'] = opts.type;
  const r = await realFetch(base + path, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  return { status: r.status, body: (await r.json()) as any };
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/admin/saas', adminRouter);
  app.use('/saas', staffRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', () => resolve()); });
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

beforeEach(() => {
  state.admins = new Set(['admin-1']);
  outbound.length = 0;
  process.env.SAAS_API_URL = 'https://saas.test';
  process.env.SAAS_BRIDGE_SECRET = SECRET;
  // Only intercept calls to the fake SaaS; the test's own HTTP calls go through.
  globalThis.fetch = (async (input: any, init?: RequestInit) => {
    const url = String(input);
    if (!url.startsWith('https://saas.test')) return realFetch(input, init);
    outbound.push({ url, init: init || {} });
    if (url.includes('/admin/mini-apps')) {
      return new Response(
        JSON.stringify({ success: true, data: [{ slug: 'check-ins' }, { slug: 'cashbook' }, { slug: 'partner-payments' }] }),
        { status: 200 },
      );
    }
    return new Response(JSON.stringify({ success: true, data: { ok: true } }), { status: 200 });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.SAAS_API_URL;
  delete process.env.SAAS_BRIDGE_SECRET;
});

function header(init: RequestInit, name: string): string | undefined {
  return (init.headers as Record<string, string>)[name];
}

describe('signBridgeRequest (shared signer used by the proxy)', () => {
  it('matches the contract formula', () => {
    const body = '{"a":1}';
    const h = signBridgeRequest('post', '/bridge/v1/x?y=1', body, SECRET, 1700000000);
    const timestamp = h['X-Bridge-Timestamp'];
    const signature = h['X-Bridge-Signature'];
    const bodyHash = crypto.createHash('sha256').update(body).digest('hex');
    const expected = crypto
      .createHmac('sha256', SECRET)
      .update(`1700000000.POST./bridge/v1/x?y=1.${bodyHash}`)
      .digest('hex');
    expect(timestamp).toBe('1700000000');
    expect(signature).toBe(expected);
  });

  it('hashes an empty body as sha256("")', () => {
    const signature = signBridgeRequest('GET', '/p', '', SECRET, 1)['X-Bridge-Signature'];
    const empty = crypto.createHash('sha256').update('').digest('hex');
    expect(signature).toBe(crypto.createHmac('sha256', SECRET).update(`1.GET./p.${empty}`).digest('hex'));
  });
});

describe('/admin/saas proxy', () => {
  it('rejects unauthenticated callers', async () => {
    const r = await call('GET', '/admin/saas/accounts');
    expect(r.status).toBe(401);
    expect(outbound).toHaveLength(0);
  });

  it('rejects non-admins (is_admin=false) and non-internal users', async () => {
    expect((await call('GET', '/admin/saas/accounts', { user: 'staff-1' })).status).toBe(403);
    expect((await call('GET', '/admin/saas/accounts', { user: 'admin-1', type: 'partner' })).status).toBe(403);
    expect(outbound).toHaveLength(0);
  });

  it('returns 503 saas_not_connected when the bridge is unconfigured', async () => {
    delete process.env.SAAS_BRIDGE_SECRET;
    const r = await call('GET', '/admin/saas/accounts', { user: 'admin-1' });
    expect(r.status).toBe(503);
    expect(r.body).toMatchObject({ success: false, error: 'SaaS not connected', code: 'saas_not_connected' });
    expect(outbound).toHaveLength(0);

    const status = await call('GET', '/admin/saas/status', { user: 'admin-1' });
    expect(status.body.data.connected).toBe(false);
  });

  it('signs GETs (path + query) and forwards the acting admin', async () => {
    const r = await call('GET', '/admin/saas/accounts?q=acme&kind=talent&junk=x', { user: 'admin-1' });
    expect(r.status).toBe(200);
    expect(outbound).toHaveLength(1);
    const { url, init } = outbound[0];
    expect(url).toBe('https://saas.test/bridge/v1/admin/accounts?q=acme&kind=talent');
    const ts = header(init, 'X-Bridge-Timestamp')!;
    expect(Math.abs(Number(ts) - Date.now() / 1000)).toBeLessThan(5);
    const expected = signBridgeRequest('GET', '/bridge/v1/admin/accounts?q=acme&kind=talent', '', SECRET, Number(ts));
    expect(header(init, 'X-Bridge-Signature')).toBe(expected['X-Bridge-Signature']);
    expect(JSON.parse(header(init, 'X-Bridge-Actor')!)).toEqual({ hub_user_id: 'admin-1', email: 'admin-1@example.com' });
  });

  it('signs the exact JSON body sent on POSTs', async () => {
    const r = await call('POST', '/admin/saas/accounts/acc%201/plan', { user: 'admin-1', body: { plan_id: 'p1' } });
    expect(r.status).toBe(200);
    const { url, init } = outbound[0];
    expect(url).toBe('https://saas.test/bridge/v1/admin/accounts/acc%201/plan');
    const ts = Number(header(init, 'X-Bridge-Timestamp'));
    const expected = signBridgeRequest('POST', '/bridge/v1/admin/accounts/acc%201/plan', String(init.body), SECRET, ts);
    expect(init.body).toBe('{"plan_id":"p1"}');
    expect(header(init, 'X-Bridge-Signature')).toBe(expected['X-Bridge-Signature']);
  });

  it('signs from /bridge/ on when SAAS_API_URL carries a path prefix (contract v1.1)', async () => {
    process.env.SAAS_API_URL = 'https://saas.test/api/';
    const r = await call('GET', '/admin/saas/accounts/a1', { user: 'admin-1' });
    expect(r.status).toBe(200);
    const { url, init } = outbound[0];
    expect(url).toBe('https://saas.test/api/bridge/v1/admin/accounts/a1');
    const ts = Number(header(init, 'X-Bridge-Timestamp'));
    const bare = signBridgeRequest('GET', '/bridge/v1/admin/accounts/a1', '', SECRET, ts);
    expect(header(init, 'X-Bridge-Signature')).toBe(bare['X-Bridge-Signature']);
  });

  it('requires a reason to impersonate', async () => {
    const r = await call('POST', '/admin/saas/impersonate', { user: 'admin-1', body: { user_id: 'u1' } });
    expect(r.status).toBe(400);
    expect(outbound).toHaveLength(0);
    const ok = await call('POST', '/admin/saas/impersonate', { user: 'admin-1', body: { user_id: 'u1', reason: 'Debug billing issue' } });
    expect(ok.status).toBe(200);
    expect(JSON.parse(String(outbound[0].init.body))).toEqual({ user_id: 'u1', reason: 'Debug billing issue' });
  });

  it('never lists or toggles Cashbook', async () => {
    const r = await call('GET', '/admin/saas/mini-apps', { user: 'admin-1' });
    expect(r.body.data.map((a: any) => a.slug)).toEqual(['check-ins', 'partner-payments']);
    const t = await call('POST', '/admin/saas/accounts/a1/mini-apps', { user: 'admin-1', body: { slug: 'cashbook', enabled: true } });
    expect(t.status).toBe(400);
  });

  it('passes SaaS errors through with their status', async () => {
    globalThis.fetch = (async (input: any, init?: RequestInit) => {
      if (!String(input).startsWith('https://saas.test')) return realFetch(input, init);
      return new Response(JSON.stringify({ success: false, error: 'Account not found' }), { status: 404 });
    }) as typeof fetch;
    const r = await call('GET', '/admin/saas/accounts/nope', { user: 'admin-1' });
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ success: false, error: 'Account not found' });
  });
});

describe('/saas staff routes', () => {
  it('is internal-only', async () => {
    const r = await call('GET', '/saas/my-workspaces', { user: 'p1', type: 'partner' });
    expect(r.status).toBe(403);
  });

  it('503s when unconfigured', async () => {
    delete process.env.SAAS_API_URL;
    const r = await call('GET', '/saas/my-workspaces', { user: 'staff-1' });
    expect(r.status).toBe(503);
    expect(r.body.code).toBe('saas_not_connected');
  });

  it('proxies workspaces + sso for the calling user (not admin-gated)', async () => {
    expect((await call('GET', '/saas/my-workspaces', { user: 'staff-1' })).status).toBe(200);
    expect(outbound[0].url).toBe('https://saas.test/bridge/v1/staff/staff-1/workspaces');
    expect((await call('POST', '/saas/sso', { user: 'staff-1', body: { hub_user_id: 'someone-else' } })).status).toBe(200);
    expect(outbound[1].url).toBe('https://saas.test/bridge/v1/staff/sso');
    expect(JSON.parse(String(outbound[1].init.body))).toEqual({ hub_user_id: 'staff-1' });
    expect(header(outbound[1].init, 'X-Bridge-Signature')).toMatch(/^[0-9a-f]{64}$/);
  });
});
