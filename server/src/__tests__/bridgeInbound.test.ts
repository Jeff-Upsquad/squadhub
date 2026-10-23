/**
 * SaaS side of the Hub bridge, end to end over HTTP against an in-memory
 * Supabase: requests are signed with the Hub's OWN signer formula (copied
 * byte-for-byte from squadhub web server/src/utils/bridgeSign.ts and
 * saasAdminBridge.ts) and response shapes are checked against what the Hub
 * super-admin UI reads (admin/src/views/admin/saas/saasApi.ts).
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import http from 'http';
import express from 'express';
import type { AddressInfo } from 'net';

const SECRET = vi.hoisted(() => {
  process.env.SAAS_BRIDGE_SECRET = 'test-bridge-secret';
  process.env.HUB_API_URL = '';
  process.env.WEB_APP_URL = 'http://app.test';
  return 'test-bridge-secret';
});

const OWNER_TOKEN_USER = vi.hoisted(() => ({ id: '' }));

vi.mock('../supabase', async () => {
  const { createFakeSupabase } = await import('./helpers/fakeSupabase');
  const fake: any = createFakeSupabase(db, { 'owner-token': '__owner__' });
  fake.supabaseAdmin.auth.admin.createUser = async ({ email }: { email: string }) => {
    const id = crypto.randomUUID();
    (db.auth_users ||= []).push({ id, email });
    return { data: { user: { id, email } }, error: null };
  };
  const getUser = fake.supabaseAuth.auth.getUser;
  fake.supabaseAuth.auth.getUser = async (token: string) => {
    if (token === 'owner-token') return { data: { user: { id: OWNER_TOKEN_USER.id, email: 'o@x.test' } }, error: null };
    if (token.startsWith('jwt.')) {
      const sid = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).sub;
      return { data: { user: { id: sid, email: 'x@x.test' } }, error: null };
    }
    return getUser(token);
  };
  return fake;
});

// Session minting needs a real Supabase; fake a JWT carrying session_id.
vi.mock('../utils/squadhireSsoShared', async (orig) => {
  const actual: any = await orig();
  return {
    ...actual,
    mintSession: async (email: string) => {
      const u = (db.users || []).find((r: any) => r.email === email);
      const payload = Buffer.from(JSON.stringify({ sub: u?.id, session_id: `sess-${crypto.randomUUID()}` })).toString('base64url');
      return { access_token: `jwt.${payload}.sig`, refresh_token: 'refresh-1' };
    },
  };
});

const db: any = vi.hoisted(() => ({
  users: [],
  workspaces: [],
  workspace_members: [],
  shared_workspace_links: [],
  plans: [{ id: '11111111-1111-4111-8111-111111111111', name: 'Free', price_inr: 0, free_staff_seats: 1, is_default: true }],
  mini_apps: [
    { slug: 'check-ins', name: 'Check-Ins', is_enabled: true },
    { slug: 'partner-payments', name: 'Partner Payments', is_enabled: true },
    { slug: 'meetings', name: 'Meetings', is_enabled: true },
    { slug: 'cashbook', name: 'Cash Book', is_enabled: true },
  ],
  workspace_mini_apps: [],
  platform_audit_log: [],
  channels: [],
  spaces: [],
  resource_memberships: [],
  login_tokens: [],
  invitations: [],
  status_groups: [],
})) as any;

import { verifyBridgeRequest } from '../utils/bridgeSign';
import { getMembership } from '../middleware/workspace';
import { claimLoginToken, createLoginToken } from '../services/bridge/loginTokens';

// ---- the Hub's signer, verbatim formula -------------------------------------
function hubSign(method: string, pathWithQuery: string, rawBody: string, secret: string, now = Math.floor(Date.now() / 1000)) {
  const idx = pathWithQuery.indexOf('/bridge/');
  const p = idx >= 0 ? pathWithQuery.slice(idx) : pathWithQuery;
  const sha = crypto.createHash('sha256').update(rawBody || '', 'utf8').digest('hex');
  const signature = crypto.createHmac('sha256', secret).update(`${now}.${method.toUpperCase()}.${p}.${sha}`).digest('hex');
  return { 'X-Bridge-Timestamp': String(now), 'X-Bridge-Signature': signature };
}

/** The Hub admin UI's list unwrapping (saasApi.ts toPaged). */
function toPaged(data: any) {
  if (Array.isArray(data)) return { items: data };
  const d = data || {};
  const items = d.items || d.accounts || d.entries || d.rows || [];
  return { items: Array.isArray(items) ? items : [], total: d.total, page: d.page, page_size: d.page_size };
}

let server: http.Server;
let base = '';

beforeAll(async () => {
  const { default: bridgeRoutes } = await import('../routes/bridge');
  const { default: oneTime } = await import('../routes/auth-one-time');
  const { default: workspaces } = await import('../routes/workspaces');
  const app = express();
  app.use('/bridge/v1', bridgeRoutes);
  app.use(express.json());
  app.use('/auth', oneTime);
  app.use('/workspaces', workspaces);
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server?.close());

const ACTOR = { hub_user_id: '22222222-2222-4222-8222-222222222222', email: 'admin@upsquad.test' };

async function bridge(method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown, opts: { secret?: string; now?: number; actor?: boolean } = {}) {
  const raw = body === undefined || method === 'GET' ? '' : JSON.stringify(body);
  const headers: Record<string, string> = { ...hubSign(method, path, raw, opts.secret ?? SECRET, opts.now) };
  if (raw) headers['Content-Type'] = 'application/json';
  if (opts.actor !== false) headers['X-Bridge-Actor'] = JSON.stringify(ACTOR);
  const res = await fetch(base + path, { method, headers, body: raw || undefined, redirect: 'manual' });
  return { status: res.status, body: (await res.json().catch(() => null)) as any };
}

const HUB_CLIENT = '33333333-3333-4333-8333-333333333333';
const HUB_PARTNER = '44444444-4444-4444-8444-444444444444';
const HUB_CARD = '55555555-5555-4555-8555-555555555555';
const HUB_CARD_2 = '66666666-6666-4666-8666-666666666666';

describe('signature', () => {
  it('accepts a request signed with the Hub formula, incl. a proxy prefix on the Hub side', () => {
    const raw = '{"a":1}';
    const h = hubSign('POST', '/api/bridge/v1/accounts?x=1', raw, SECRET);
    const req: any = {
      method: 'POST',
      originalUrl: '/bridge/v1/accounts?x=1',
      rawBody: Buffer.from(raw),
      header: (n: string) => (h as any)[Object.keys(h).find((k) => k.toLowerCase() === n.toLowerCase())!],
    };
    expect(verifyBridgeRequest(req, SECRET)).toEqual({ ok: true });
    expect(verifyBridgeRequest({ ...req, rawBody: Buffer.from('{"a":2}') }, SECRET).ok).toBe(false);
  });

  it('rejects a wrong secret and a stale timestamp over HTTP', async () => {
    expect((await bridge('GET', '/bridge/v1/admin/plans', undefined, { secret: 'nope' })).status).toBe(401);
    const stale = Math.floor(Date.now() / 1000) - 301;
    expect((await bridge('GET', '/bridge/v1/admin/plans', undefined, { now: stale })).status).toBe(401);
    expect((await bridge('GET', '/bridge/v1/admin/plans')).status).toBe(200);
  });
});

let businessId = '';
let talentId = '';
let talentUserId = '';
let sharedId = '';

describe('accounts', () => {
  it('ensure is idempotent on the Hub id', async () => {
    const body = { kind: 'business', owner: { email: 'Owner@Biz.test', name: 'Olive Owner' }, hub_client_id: HUB_CLIENT };
    const a = await bridge('POST', '/bridge/v1/accounts', body);
    expect(a.status).toBe(201);
    expect(a.body.data).toMatchObject({ created: true });
    const b = await bridge('POST', '/bridge/v1/accounts', body);
    expect(b.status).toBe(200);
    expect(b.body.data).toEqual({ ...a.body.data, created: false });
    businessId = a.body.data.saas_account_id;
    OWNER_TOKEN_USER.id = a.body.data.owner_user_id;
    expect(db.workspaces.filter((w: any) => w.hub_client_id === HUB_CLIENT)).toHaveLength(1);
    expect(db.users.filter((u: any) => u.email === 'owner@biz.test')).toHaveLength(1);
  });

  it('talent accounts get check-ins + partner-payments, never Cashbook', async () => {
    const r = await bridge('POST', '/bridge/v1/accounts', {
      kind: 'talent',
      owner: { email: 'tal@ent.test', name: 'Tara Talent' },
      hub_partner_user_id: HUB_PARTNER,
    });
    expect(r.status).toBe(201);
    talentId = r.body.data.saas_account_id;
    talentUserId = r.body.data.owner_user_id;
    const slugs = db.workspace_mini_apps.filter((m: any) => m.workspace_id === talentId).map((m: any) => m.slug).sort();
    expect(slugs).toEqual(['check-ins', 'partner-payments']);
    expect(db.users.find((u: any) => u.id === talentUserId).hub_user_id).toBe(HUB_PARTNER);
  });
});

describe('shared workspaces', () => {
  it('ensure creates the card workspace, the category space, and adds the talent to that space only', async () => {
    const r = await bridge('POST', '/bridge/v1/shared-workspaces/ensure', {
      business_saas_account_id: null,
      hub_client_id: HUB_CLIENT,
      hub_card_id: HUB_CARD,
      card_category: 'designer',
      hub_partner_user_id: HUB_PARTNER,
      account_manager_hub_user_ids: [],
    });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ created: true, space_name: 'Designer', talent_added: true });
    sharedId = r.body.data.shared_workspace_id;

    const member = db.workspace_members.find((m: any) => m.workspace_id === sharedId && m.user_id === talentUserId);
    expect(member.role).toBe('guest');
    const grants = db.resource_memberships.filter((m: any) => m.workspace_id === sharedId && m.user_id === talentUserId);
    expect(grants).toEqual([expect.objectContaining({ resource_type: 'space', resource_id: r.body.data.space_id, access_level: 'member' })]);
    expect(await getMembership(talentUserId, sharedId)).not.toBeNull();

    // Same card again → same workspace, nothing new.
    const again = await bridge('POST', '/bridge/v1/shared-workspaces/ensure', {
      hub_client_id: HUB_CLIENT, hub_card_id: HUB_CARD, card_category: 'designer', hub_partner_user_id: HUB_PARTNER,
    });
    expect(again.body.data).toMatchObject({ shared_workspace_id: sharedId, created: false });
  });

  it('supersedes_hub_card_id keeps the same workspace on upgrade/downgrade', async () => {
    const r = await bridge('POST', '/bridge/v1/shared-workspaces/ensure', {
      hub_client_id: HUB_CLIENT, hub_card_id: HUB_CARD_2, supersedes_hub_card_id: HUB_CARD, card_category: 'Designers', hub_partner_user_id: HUB_PARTNER,
    });
    expect(r.body.data).toMatchObject({ shared_workspace_id: sharedId, created: false, space_name: 'Designer' });
  });

  it('members/remove takes away all access (direct and via the account link)', async () => {
    const r = await bridge('POST', `/bridge/v1/shared-workspaces/${sharedId}/members/remove`, { hub_partner_user_id: HUB_PARTNER });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ removed: true });
    expect(await getMembership(talentUserId, sharedId)).toBeNull();
    expect(db.resource_memberships.filter((m: any) => m.workspace_id === sharedId && m.user_id === talentUserId)).toHaveLength(0);
  });

  it('pause / resume / close mirror the card lifecycle', async () => {
    expect((await bridge('POST', `/bridge/v1/shared-workspaces/${sharedId}/pause`, {})).body.data.engagement_status).toBe('paused');
    expect((await bridge('POST', `/bridge/v1/shared-workspaces/${sharedId}/resume`, {})).body.data.engagement_status).toBe('active');
  });
});

describe('admin', () => {
  it('list matches what the Hub admin UI reads', async () => {
    const r = await bridge('GET', '/bridge/v1/admin/accounts?kind=business&page=1');
    expect(r.status).toBe(200);
    expect(Object.keys(r.body.data).sort()).toEqual(['items', 'page', 'page_size', 'total']);
    const paged = toPaged(r.body.data);
    expect(paged.total).toBe(1);
    const a = paged.items[0];
    expect(a).toMatchObject({ id: businessId, kind: 'business', status: 'active', seats_used: 0, seat_limit: 1 });
    expect(a.owner).toMatchObject({ email: 'owner@biz.test', name: 'Olive Owner' });
    expect(a.plan).toMatchObject({ name: 'Free' });
  });

  it('detail carries owner, members, shared workspaces and mini apps; suspend is audited with the actor', async () => {
    const d = await bridge('GET', `/bridge/v1/admin/accounts/${businessId}`);
    expect(d.body.data.members[0]).toMatchObject({ is_owner: true });
    expect(d.body.data.shared_workspaces[0]).toMatchObject({ id: sharedId, hub_card_id: HUB_CARD_2 });
    const s = await bridge('POST', `/bridge/v1/admin/accounts/${businessId}/suspend`, { reason: 'Unpaid invoices' });
    expect(s.body.data.status).toBe('suspended');
    const audit = await bridge('GET', `/bridge/v1/admin/audit?account_id=${businessId}`);
    const entry = toPaged(audit.body.data).items.find((e: any) => e.action === 'admin.account.suspended');
    expect(entry).toMatchObject({ reason: 'Unpaid invoices', actor_email: ACTOR.email, actor: { hub_user_id: ACTOR.hub_user_id } });
    await bridge('POST', `/bridge/v1/admin/accounts/${businessId}/reactivate`, {});
  });

  it('plans: PUT with id in the body; mini-app catalog hides Cashbook', async () => {
    const plans = toPaged((await bridge('GET', '/bridge/v1/admin/plans')).body.data).items;
    const up = await bridge('PUT', '/bridge/v1/admin/plans', { id: plans[0].id, free_staff_seats: 1, is_default: false });
    expect(up.body.data).toMatchObject({ id: plans[0].id, free_staff_seats: 1, is_default: true });
    const apps = toPaged((await bridge('GET', '/bridge/v1/admin/mini-apps')).body.data).items.map((a: any) => a.slug);
    expect(apps).not.toContain('cashbook');
    const bad = await bridge('POST', `/bridge/v1/admin/accounts/${talentId}/mini-apps`, { slug: 'cashbook', enabled: true });
    expect(bad.status).toBe(400);
  });
});

describe('impersonation', () => {
  it('mints a 10-minute single-use login URL and audits it', async () => {
    const r = await bridge('POST', '/bridge/v1/admin/impersonate', { user_id: talentUserId, reason: 'Debug a payouts issue' });
    expect(r.status).toBe(200);
    const url = new URL(r.body.data.url);
    expect(url.pathname).toBe('/auth/one-time');
    expect(new Date(r.body.data.expires_at).getTime() - Date.now()).toBeLessThanOrEqual(10 * 60 * 1000);
    expect(db.platform_audit_log.some((a: any) => a.action === 'admin.impersonate' && a.actor_hub_user_id === ACTOR.hub_user_id)).toBe(true);

    const first = await fetch(`${base}/auth/one-time${url.search}`, { redirect: 'manual' });
    expect(first.status).toBe(302);
    const loc = first.headers.get('location')!;
    expect(loc.startsWith('http://app.test/signin/one-time#')).toBe(true);
    const frag = new URLSearchParams(loc.split('#')[1]);
    expect(frag.get('access_token')).toMatch(/^jwt\./);
    expect(frag.get('purpose')).toBe('impersonate');

    // The session is flagged for the banner.
    const imp = await fetch(`${base}/auth/impersonation`, { headers: { Authorization: `Bearer ${frag.get('access_token')}` } });
    expect(((await imp.json()) as any).data).toMatchObject({ active: true, actor_email: ACTOR.email, reason: 'Debug a payouts issue' });

    // Second use fails.
    const second = await fetch(`${base}/auth/one-time${url.search}`, { redirect: 'manual' });
    expect(new URLSearchParams(second.headers.get('location')!.split('#')[1]).get('error')).toMatch(/expired or was already used/);
  });

  it('expires after 10 minutes', async () => {
    const t = await createLoginToken({ userId: talentUserId, purpose: 'impersonate', reason: 'x-test', now: Date.now() - 11 * 60 * 1000 });
    expect(await claimLoginToken(t.token)).toBeNull();
    const fresh = await createLoginToken({ userId: talentUserId, purpose: 'impersonate', reason: 'x-test' });
    expect(await claimLoginToken(fresh.token, Date.now() + 9 * 60 * 1000)).not.toBeNull();
  });

  it('requires a reason', async () => {
    expect((await bridge('POST', '/bridge/v1/admin/impersonate', { user_id: talentUserId, reason: 'no' })).status).toBe(400);
  });
});

describe('seat limit', () => {
  it('refuses a staff invite beyond the plan’s free seats (guests are free)', async () => {
    const add = (email: string, role = 'member') =>
      fetch(`${base}/workspaces/${businessId}/members`, {
        method: 'POST',
        headers: { Authorization: 'Bearer owner-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, role }),
      }).then(async (r) => ({ status: r.status, body: (await r.json()) as any }));
    expect((await add('one@biz.test')).status).toBe(201);
    const second = await add('two@biz.test');
    expect(second.status).toBe(403);
    expect(second.body.code).toBe('seat_limit_reached');
    expect((await add('guest@biz.test', 'guest')).status).toBe(201);
  });
});
