import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express, { Router } from 'express';
import type { Server } from 'node:http';

// Signed "act-as" bridge passthrough: /bridge/v1/as/:hubUserId/<allowlisted>.
// Runs the REAL bridge signature check, the REAL requireAuth/requireUserType
// and the REAL Hub routers (off-days, lms, partner opportunities) against an
// in-memory supabase fake.

type Op = { table: string; filters: [string, unknown][] };

const db = vi.hoisted(() => ({
  ops: [] as Op[],
  users: {} as Record<string, any>,
  getUser: null as any,
}));

vi.mock('../supabase', () => {
  const from = (table: string) => {
    const rec: Op = { table, filters: [] };
    db.ops.push(rec);
    const result = () => {
      if (table === 'users') {
        const id = rec.filters.find(([k]) => k === 'id')?.[1] as string;
        return { data: db.users[id] ?? null, error: null };
      }
      if (table === 'off_day_requests') return { data: [{ id: 'od-1' }], error: null };
      return { data: [], error: null };
    };
    const q: any = {
      select: () => q, insert: () => q, update: () => q, delete: () => q,
      eq: (k: string, v: unknown) => { rec.filters.push([k, v]); return q; },
      in: () => q, is: () => q, not: () => q, or: () => q, ilike: () => q, gte: () => q, lte: () => q,
      order: () => q, limit: () => q, range: () => q, abortSignal: () => q,
      single: async () => result(),
      maybeSingle: async () => result(),
      then: (resolve: any, reject: any) => Promise.resolve(result()).then(resolve, reject),
    };
    return q;
  };
  return {
    supabaseAdmin: { from },
    supabaseAuth: { auth: { getUser: async (t: string) => db.getUser(t) } },
  };
});

import { bridgeJsonParser, createRequireBridge, signBridgeRequest } from '../utils/bridgeSign';
import { createActAsRouter, isActAsAllowed } from '../routes/bridge/actAs';
import actAsInnerRoutes from '../routes/bridge/actAsRoutes';
import offDaysRoutes from '../routes/off-days';
import { requireAuth } from '../middleware/auth';

const SECRET = 'act-as-test-secret';
const PARTNER = '11111111-1111-4111-8111-111111111111';
const CLIENT = '22222222-2222-4222-8222-222222222222';
const INTERNAL = '33333333-3333-4333-8333-333333333333';
const ADMIN_PARTNER = '44444444-4444-4444-8444-444444444444';
const SUSPENDED = '55555555-5555-4555-8555-555555555555';

let server: Server;
let base = '';
const seen: Array<{ path: string; userId?: string; userType?: string; userEmail?: string }> = [];

beforeAll(async () => {
  // Inner router = the real Hub routers + a probe on /lms/my-items that
  // records the identity the existing middleware chain resolved.
  const probe = Router();
  probe.get('/lms/my-items', requireAuth, (req, res) => {
    seen.push({ path: req.originalUrl, userId: req.userId, userType: req.userType, userEmail: req.userEmail });
    res.json({ success: true, data: [] });
  });
  const inner = Router();
  inner.use(probe);
  inner.use(actAsInnerRoutes);

  const bridge = Router();
  bridge.use(createRequireBridge(() => SECRET));
  bridge.use(createActAsRouter(inner));
  bridge.use((_req, res) => res.status(404).json({ success: false, error: 'Unknown bridge endpoint' }));

  const app = express();
  app.use('/bridge/v1', bridgeJsonParser, bridge);
  app.use(express.json());
  app.use('/off-days', offDaysRoutes);
  app.get('/lms/my-items', requireAuth, (req, res) => {
    seen.push({ path: req.originalUrl, userId: req.userId, userType: req.userType });
    res.json({ success: true });
  });
  await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', () => resolve()); });
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  db.ops = [];
  seen.length = 0;
  db.users = {
    [PARTNER]: { id: PARTNER, email: 'partner@example.invalid', user_type: 'partner', status: 'active', is_admin: false, display_name: 'P' },
    [CLIENT]: { id: CLIENT, email: 'client@example.invalid', user_type: 'client', status: 'active', is_admin: false, display_name: 'C' },
    [INTERNAL]: { id: INTERNAL, email: 'staff@example.invalid', user_type: 'internal', status: 'active', is_admin: false, display_name: 'S' },
    [ADMIN_PARTNER]: { id: ADMIN_PARTNER, email: 'a@example.invalid', user_type: 'partner', status: 'active', is_admin: true, display_name: 'A' },
    [SUSPENDED]: { id: SUSPENDED, email: 's@example.invalid', user_type: 'partner', status: 'suspended', is_admin: false, display_name: 'X' },
  };
  db.getUser = async () => ({ data: { user: null }, error: { message: 'invalid' } });
});

async function signed(method: string, path: string, body?: unknown, extra: Record<string, string> = {}) {
  const raw = body === undefined ? '' : JSON.stringify(body);
  const headers: Record<string, string> = { ...signBridgeRequest(method, path, raw, SECRET), ...extra };
  if (raw) headers['Content-Type'] = 'application/json';
  const r = await fetch(base + path, { method, headers, body: raw || undefined });
  return { status: r.status, body: (await r.json()) as any };
}

describe('bridge act-as passthrough', () => {
  it('requires a valid bridge signature', async () => {
    const r = await fetch(`${base}/bridge/v1/as/${PARTNER}/off-days`);
    expect(r.status).toBe(401);
    const bad = await fetch(`${base}/bridge/v1/as/${PARTNER}/off-days`, {
      headers: signBridgeRequest('GET', `/bridge/v1/as/${CLIENT}/off-days`, '', SECRET),
    });
    expect(bad.status).toBe(401);
    expect(db.ops.filter((o) => o.table === 'off_day_requests')).toHaveLength(0);
  });

  it('signature covers the query string', async () => {
    const h = signBridgeRequest('GET', `/bridge/v1/as/${PARTNER}/off-days?status=pending`, '', SECRET);
    const r = await fetch(`${base}/bridge/v1/as/${PARTNER}/off-days?status=approved`, { headers: h });
    expect(r.status).toBe(401);
  });

  it('404s anything off the allowlist, before any user lookup', async () => {
    for (const p of [
      `/bridge/v1/as/${PARTNER}/admin/off-days`,
      `/bridge/v1/as/${PARTNER}/lms/search`,
      `/bridge/v1/as/${PARTNER}/pm/tasks`,
      `/bridge/v1/as/${PARTNER}/lms/collab/items/x/publish`,
      `/bridge/v1/as/${PARTNER}/partner/opportunities/abc/delete`,
    ]) {
      expect((await signed('GET', p)).status, p).toBe(404);
    }
    expect((await signed('POST', `/bridge/v1/as/${PARTNER}/lms/my-items`)).status).toBe(404);
    expect((await signed('GET', '/bridge/v1/as/not-a-uuid/off-days')).status).toBe(404);
    expect(db.ops.filter((o) => o.table === 'users')).toHaveLength(0);
  });

  it('rejects traversal and encoded slashes', () => {
    expect(isActAsAllowed('GET', '/lms/items/../../admin')).toBe(false);
    expect(isActAsAllowed('GET', '/lms/items/a%2F..%2Fadmin')).toBe(false);
    expect(isActAsAllowed('GET', '/lms/items/a%2fb')).toBe(false);
    expect(isActAsAllowed('GET', '/lms/items/a%5cb')).toBe(false);
    expect(isActAsAllowed('GET', '/lms//my-items')).toBe(false);
    expect(isActAsAllowed('GET', '/lms/items/abc-123')).toBe(true);
    expect(isActAsAllowed('GET', '/lms/my-items?limit=5')).toBe(true);
    expect(isActAsAllowed('DELETE', '/off-days/od-1')).toBe(true);
    expect(isActAsAllowed('POST', '/partner/opportunities/r1/accept')).toBe(true);
  });

  it('refuses internal, admin, suspended and unknown users with 403', async () => {
    for (const id of [INTERNAL, ADMIN_PARTNER, SUSPENDED, '66666666-6666-4666-8666-666666666666']) {
      const r = await signed('GET', `/bridge/v1/as/${id}/off-days`);
      expect(r.status, id).toBe(403);
    }
    expect(db.ops.filter((o) => o.table === 'off_day_requests')).toHaveLength(0);
  });

  it('runs the real off-days handler as that user', async () => {
    const r = await signed('GET', `/bridge/v1/as/${PARTNER}/off-days`);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ success: true, data: [{ id: 'od-1' }] });
    const q = db.ops.find((o) => o.table === 'off_day_requests');
    expect(q?.filters).toContainEqual(['user_id', PARTNER]);
  });

  it('resolves req.userId / userType / userEmail through requireAuth for LMS', async () => {
    const r = await signed('GET', `/bridge/v1/as/${CLIENT}/lms/my-items?limit=5`);
    expect(r.status).toBe(200);
    expect(seen).toEqual([{ path: `/bridge/v1/as/${CLIENT}/lms/my-items?limit=5`, userId: CLIENT, userType: 'client', userEmail: 'client@example.invalid' }]);
  });

  it('keeps partner-only gates: a client acting on /partner/opportunities gets 403', async () => {
    const r = await signed('GET', `/bridge/v1/as/${CLIENT}/partner/opportunities`);
    expect(r.status).toBe(403);
    expect(r.body.error).toMatch(/user type/i);
  });

  it('ignores a caller Authorization header and identity-looking headers/body', async () => {
    db.getUser = vi.fn(async () => ({ data: { user: { id: INTERNAL, email: 'staff@example.invalid' } }, error: null }));
    const r = await signed('GET', `/bridge/v1/as/${CLIENT}/lms/my-items`, undefined, {
      Authorization: 'Bearer staff-token',
      'X-Bridge-Acting-User': JSON.stringify({ userId: INTERNAL }),
      'X-User-Id': INTERNAL,
    });
    expect(r.status).toBe(200);
    expect(seen[0].userId).toBe(CLIENT);
    expect(db.getUser).not.toHaveBeenCalled();
  });

  it('marker cannot be spoofed on regular routes: no JWT → 401', async () => {
    const r = await fetch(`${base}/off-days`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Bridge-Acting-User': JSON.stringify({ userId: PARTNER, userType: 'partner' }),
        'X-Bridge-Actor': JSON.stringify({ hub_user_id: PARTNER }),
      },
      body: JSON.stringify({ bridgeActingUser: { userId: PARTNER }, request_type: 'full_day', date: '2026-12-01' }),
    });
    expect(r.status).toBe(401);
    expect(db.ops.filter((o) => o.table === 'off_day_requests')).toHaveLength(0);
  });

  it('regular /lms with a JWT is unchanged and does not inherit a prior act-as identity', async () => {
    await signed('GET', `/bridge/v1/as/${CLIENT}/lms/my-items`);
    db.users[INTERNAL] = { user_type: 'internal', status: 'active', display_name: 'S' };
    db.getUser = async () => ({ data: { user: { id: INTERNAL, email: 'staff@example.invalid' } }, error: null });
    const r = await fetch(`${base}/lms/my-items`, { headers: { Authorization: 'Bearer good' } });
    expect(r.status).toBe(200);
    expect(seen[1]).toMatchObject({ path: '/lms/my-items', userId: INTERNAL, userType: 'internal' });
    const noJwt = await fetch(`${base}/lms/my-items`);
    expect(noJwt.status).toBe(401);
  });

  it('writes one audit line per act-as call', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await signed('GET', `/bridge/v1/as/${PARTNER}/off-days?status=pending`);
    await signed('GET', `/bridge/v1/as/${INTERNAL}/off-days`);
    await new Promise((r) => setTimeout(r, 20));
    const lines = log.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith('[bridge-act-as]'));
    log.mockRestore();
    expect(lines).toEqual([
      `[bridge-act-as] hub_user=${PARTNER} method=GET path=/off-days status=200`,
      `[bridge-act-as] hub_user=${INTERNAL} method=GET path=/off-days status=403`,
    ]);
  });
});
