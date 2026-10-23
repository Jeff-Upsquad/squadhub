/**
 * Super-admin (`/bridge/v1/admin/*`), called by the Hub's "SaaS Accounts"
 * section (server/src/routes/saas-accounts-admin.ts → admin/src/views/admin/saas
 * in the Hub repo). Response shapes follow what that UI reads (saasApi.ts):
 *
 *   list    { items: SaasAccount[], total, page, page_size }
 *   detail  SaasAccount with owner, members[], shared_workspaces[],
 *           seats_used/seat_limit, plan{id,name}, plan_id, plan_name, mini_apps[]
 *   audit   { items: [{ id, action, created_at, actor{hub_user_id,email,name},
 *             actor_email, target, reason, details }], total, page, page_size }
 *
 * Every mutating call writes platform_audit_log with the X-Bridge-Actor.
 */
import { supabaseAdmin } from '../../supabase';
import { BLOCKED_MINI_APPS, audit } from '../../utils/accounts';
import { getSeatInfo } from '../../utils/seats';
import { BridgeError, isUuid } from './errors';
import { createLoginToken } from './loginTokens';
import { getUserById } from './users';

export const ADMIN_PAGE_SIZE = 25;

export interface BridgeActor {
  hub_user_id?: string | null;
  email?: string | null;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

/** Audit a super-admin action; actor email/reason/target ride in details. */
export async function auditAdmin(
  action: string,
  actor: BridgeActor | null | undefined,
  workspaceId: string | null,
  details: Record<string, unknown> = {},
): Promise<void> {
  await audit(action, {
    workspaceId,
    actorHubUserId: isUuid(actor?.hub_user_id) ? actor!.hub_user_id : null,
    details: { actor_email: actor?.email ?? null, actor_hub_user_id: actor?.hub_user_id ?? null, ...details },
  });
}

function pageOf(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

function userShape(u: any, extra: Record<string, unknown> = {}) {
  if (!u) return null;
  return {
    id: u.id,
    name: u.display_name ?? null,
    email: u.email ?? null,
    hub_user_id: u.hub_user_id ?? null,
    ...extra,
  };
}

async function usersById(ids: string[]): Promise<Map<string, any>> {
  const out = new Map<string, any>();
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return out;
  const { data } = await supabaseAdmin.from('users').select('id, email, display_name, hub_user_id, user_type, status').in('id', unique);
  for (const u of (data || []) as any[]) out.set(u.id, u);
  return out;
}

async function plansById(): Promise<Map<string, any>> {
  const { data } = await supabaseAdmin.from('plans').select('id, name, price_inr, free_staff_seats, is_default');
  return new Map(((data || []) as any[]).map((p) => [p.id, p]));
}

function baseAccount(ws: any, owner: any, plan: any, seats: { used: number; limit: number | null }) {
  return {
    id: ws.id,
    name: ws.name,
    kind: ws.kind,
    status: ws.status,
    suspended_reason: ws.suspended_reason ?? null,
    plan: plan ? { id: plan.id, name: plan.name } : null,
    plan_id: plan?.id ?? null,
    plan_name: plan?.name ?? null,
    seats_used: seats.used,
    seat_limit: seats.limit,
    owner: userShape(owner, { is_owner: true }),
    hub_client_id: ws.hub_client_id ?? null,
    hub_partner_user_id: ws.hub_partner_user_id ?? null,
    squadhire_business_id: ws.squadhire_business_id ?? null,
    squadhire_talent_id: ws.squadhire_talent_id ?? null,
    host_workspace_id: ws.host_workspace_id ?? null,
    engagement_status: ws.engagement_status ?? null,
    created_at: ws.created_at ?? null,
  };
}

const WS_COLUMNS =
  'id, name, kind, status, suspended_reason, owner_user_id, plan_id, hub_client_id, hub_partner_user_id, squadhire_business_id, squadhire_talent_id, host_workspace_id, engagement_status, created_at';

export async function listAccounts(query: { q?: string; kind?: string; status?: string; page?: unknown }): Promise<Paged<any>> {
  const page = pageOf(query.page);
  const from = (page - 1) * ADMIN_PAGE_SIZE;
  let q = supabaseAdmin.from('workspaces').select(WS_COLUMNS, { count: 'exact' });
  if (query.kind && ['business', 'talent', 'shared', 'internal_staff'].includes(query.kind)) q = q.eq('kind', query.kind);
  if (query.status && ['active', 'suspended'].includes(query.status)) q = q.eq('status', query.status);
  const term = (query.q || '').trim().replace(/[%,()\\]/g, ' ').trim();
  if (term) {
    // Name, or owner email/name.
    const { data: owners } = await supabaseAdmin
      .from('users')
      .select('id')
      .or(`email.ilike.%${term}%,display_name.ilike.%${term}%`)
      .limit(200);
    const ownerIds = ((owners || []) as any[]).map((u) => u.id);
    const ors = [`name.ilike.%${term}%`];
    if (isUuid(term)) ors.push(`id.eq.${term}`, `hub_client_id.eq.${term}`, `hub_partner_user_id.eq.${term}`);
    if (ownerIds.length) ors.push(`owner_user_id.in.(${ownerIds.join(',')})`);
    q = q.or(ors.join(','));
  }
  const { data, count, error } = await q.order('created_at', { ascending: false }).range(from, from + ADMIN_PAGE_SIZE - 1);
  if (error) throw new Error(error.message);
  const rows = (data || []) as any[];
  const [owners, plans] = await Promise.all([usersById(rows.map((r) => r.owner_user_id)), plansById()]);
  const defaultPlan = [...plans.values()].find((p) => p.is_default) ?? null;
  const items = await Promise.all(
    rows.map(async (ws) => {
      const seats = await getSeatInfo(ws.id);
      const plan = ws.plan_id ? plans.get(ws.plan_id) : ws.kind === 'business' || ws.kind === 'talent' ? defaultPlan : null;
      return baseAccount(ws, owners.get(ws.owner_user_id), plan, seats);
    }),
  );
  return { items, total: count ?? items.length, page, page_size: ADMIN_PAGE_SIZE };
}

async function loadAccount(id: string): Promise<any> {
  if (!isUuid(id)) throw new BridgeError(404, 'Account not found');
  const { data } = await supabaseAdmin.from('workspaces').select(WS_COLUMNS).eq('id', id).maybeSingle();
  if (!data) throw new BridgeError(404, 'Account not found');
  return data;
}

export async function accountDetail(id: string): Promise<any> {
  const ws = await loadAccount(id);
  const [seats, plans] = await Promise.all([getSeatInfo(ws.id), plansById()]);
  const { data: memberRows } = await supabaseAdmin
    .from('workspace_members')
    .select('user_id, role, is_upsquad_staff')
    .eq('workspace_id', ws.id);
  const members = (memberRows || []) as any[];
  const users = await usersById([...members.map((m) => m.user_id), ws.owner_user_id]);

  // Shared workspaces: those this account hosts or participates in — or, for a
  // shared workspace itself, its participant accounts.
  const { data: links } = await supabaseAdmin
    .from('shared_workspace_links')
    .select('shared_workspace_id, participant_workspace_id, participant_role, hub_card_id, card_category, status')
    .or(ws.kind === 'shared' ? `shared_workspace_id.eq.${ws.id}` : `participant_workspace_id.eq.${ws.id}`);
  const linkRows = (links || []) as any[];
  const otherIds = [
    ...new Set(linkRows.map((l) => (ws.kind === 'shared' ? l.participant_workspace_id : l.shared_workspace_id))),
  ];
  const { data: others } = otherIds.length
    ? await supabaseAdmin.from('workspaces').select('id, name, kind, status, engagement_status').in('id', otherIds)
    : { data: [] as any[] };
  const otherById = new Map(((others || []) as any[]).map((w) => [w.id, w]));
  const counts = new Map<string, number>();
  if (otherIds.length && ws.kind !== 'shared') {
    const { data: m } = await supabaseAdmin.from('workspace_members').select('workspace_id').in('workspace_id', otherIds);
    for (const r of (m || []) as any[]) counts.set(r.workspace_id, (counts.get(r.workspace_id) || 0) + 1);
  }
  const seen = new Set<string>();
  const sharedWorkspaces = linkRows
    .map((l) => {
      const otherId = ws.kind === 'shared' ? l.participant_workspace_id : l.shared_workspace_id;
      if (seen.has(otherId)) return null;
      seen.add(otherId);
      const o = otherById.get(otherId);
      return {
        id: otherId,
        name: o?.name ?? null,
        kind: o?.kind ?? null,
        card_category: l.card_category ?? null,
        hub_card_id: l.hub_card_id ?? null,
        participant_role: l.participant_role,
        status: ws.kind === 'shared' ? l.status : o?.engagement_status ?? l.status,
        member_count: ws.kind === 'shared' ? null : counts.get(otherId) ?? null,
      };
    })
    .filter(Boolean);

  const { data: apps } = await supabaseAdmin
    .from('workspace_mini_apps')
    .select('slug, enabled')
    .eq('workspace_id', ws.id);
  const catalog = await miniAppCatalog();
  const nameBySlug = new Map(catalog.items.map((a) => [a.slug, a.name]));
  const miniApps = ((apps || []) as any[])
    .filter((a) => !BLOCKED_MINI_APPS.has(a.slug))
    .map((a) => ({ slug: a.slug, enabled: !!a.enabled, name: nameBySlug.get(a.slug) ?? a.slug }));

  const plan = ws.plan_id ? plans.get(ws.plan_id) : seats.plan;
  return {
    ...baseAccount(ws, users.get(ws.owner_user_id), plan, seats),
    members: members.map((m) =>
      userShape(users.get(m.user_id) ?? { id: m.user_id }, {
        role: m.role,
        is_owner: m.user_id === ws.owner_user_id || m.role === 'owner',
        is_staff: !!m.is_upsquad_staff,
        joined_at: null,
      }),
    ),
    shared_workspaces: sharedWorkspaces,
    mini_apps: miniApps,
  };
}

export async function suspendAccount(id: string, reason: string | undefined, actor: BridgeActor | null) {
  const ws = await loadAccount(id);
  await supabaseAdmin
    .from('workspaces')
    .update({ status: 'suspended', suspended_reason: reason || null, suspended_at: new Date().toISOString() })
    .eq('id', ws.id);
  await auditAdmin('admin.account.suspended', actor, ws.id, { reason: reason || null, target: ws.name });
  return accountDetail(ws.id);
}

export async function reactivateAccount(id: string, actor: BridgeActor | null) {
  const ws = await loadAccount(id);
  await supabaseAdmin
    .from('workspaces')
    .update({ status: 'active', suspended_reason: null, suspended_at: null })
    .eq('id', ws.id);
  await auditAdmin('admin.account.reactivated', actor, ws.id, { target: ws.name });
  return accountDetail(ws.id);
}

export async function changeOwner(id: string, userId: string, actor: BridgeActor | null) {
  const ws = await loadAccount(id);
  if (!isUuid(userId)) throw new BridgeError(400, 'user_id must be a uuid');
  const { data: member } = await supabaseAdmin
    .from('workspace_members')
    .select('id, role')
    .eq('workspace_id', ws.id)
    .eq('user_id', userId)
    .maybeSingle();
  if (!member) throw new BridgeError(400, 'The new owner must already be a member of the account');
  const previous = ws.owner_user_id as string | null;
  if (previous && previous !== userId) {
    await supabaseAdmin.from('workspace_members').update({ role: 'admin' }).eq('workspace_id', ws.id).eq('user_id', previous);
  }
  await supabaseAdmin.from('workspace_members').update({ role: 'owner' }).eq('workspace_id', ws.id).eq('user_id', userId);
  await supabaseAdmin.from('workspaces').update({ owner_user_id: userId }).eq('id', ws.id);
  await auditAdmin('admin.account.owner_changed', actor, ws.id, { from_user_id: previous, to_user_id: userId, target: userId });
  return accountDetail(ws.id);
}

export async function removeMember(id: string, userId: string, actor: BridgeActor | null) {
  const ws = await loadAccount(id);
  if (!isUuid(userId)) throw new BridgeError(404, 'Member not found');
  if (userId === ws.owner_user_id) throw new BridgeError(409, 'Change the owner before removing them');
  const { data: member } = await supabaseAdmin
    .from('workspace_members')
    .select('id')
    .eq('workspace_id', ws.id)
    .eq('user_id', userId)
    .maybeSingle();
  if (!member) throw new BridgeError(404, 'Member not found');
  await supabaseAdmin.from('resource_memberships').delete().eq('workspace_id', ws.id).eq('user_id', userId);
  await supabaseAdmin.from('workspace_members').delete().eq('workspace_id', ws.id).eq('user_id', userId);
  await auditAdmin('admin.account.member_removed', actor, ws.id, { user_id: userId, target: userId });
  return accountDetail(ws.id);
}

// ------------------------------------------------------------------ plans
export interface PlanInput {
  id?: string;
  name?: string;
  price_inr?: number;
  free_staff_seats?: number;
  is_default?: boolean;
}

function validatePlan(p: PlanInput, partial: boolean): void {
  if (!partial || p.name !== undefined) {
    if (typeof p.name !== 'string' || !p.name.trim() || p.name.length > 80) throw new BridgeError(400, 'Name is required');
  }
  if (!partial || p.price_inr !== undefined) {
    if (typeof p.price_inr !== 'number' || !Number.isFinite(p.price_inr) || p.price_inr < 0) throw new BridgeError(400, 'Price cannot be negative');
  }
  if (!partial || p.free_staff_seats !== undefined) {
    if (!Number.isInteger(p.free_staff_seats) || (p.free_staff_seats as number) < 0) {
      throw new BridgeError(400, 'Free staff seats must be a whole number ≥ 0');
    }
  }
}

function planShape(p: any) {
  return { id: p.id, name: p.name, price_inr: Number(p.price_inr), free_staff_seats: Number(p.free_staff_seats), is_default: !!p.is_default };
}

export async function listPlans(): Promise<Paged<any>> {
  const { data } = await supabaseAdmin.from('plans').select('id, name, price_inr, free_staff_seats, is_default, created_at').order('price_inr', { ascending: true });
  const items = ((data || []) as any[]).map(planShape);
  return { items, total: items.length, page: 1, page_size: items.length };
}

async function clearDefault(exceptId?: string): Promise<void> {
  let q = supabaseAdmin.from('plans').update({ is_default: false }).eq('is_default', true);
  if (exceptId) q = q.neq('id', exceptId);
  await q;
}

export async function createPlan(input: PlanInput, actor: BridgeActor | null) {
  validatePlan(input, false);
  if (input.is_default) await clearDefault();
  const { data, error } = await supabaseAdmin
    .from('plans')
    .insert({
      name: input.name!.trim(),
      price_inr: Math.round(input.price_inr!),
      free_staff_seats: input.free_staff_seats!,
      is_default: !!input.is_default,
    })
    .select('id, name, price_inr, free_staff_seats, is_default')
    .single();
  if (error) throw new BridgeError(error.code === '23505' ? 409 : 500, error.code === '23505' ? 'A plan with that name exists' : error.message);
  await auditAdmin('admin.plan.created', actor, null, { plan_id: (data as any).id, target: input.name, plan: planShape(data) });
  return planShape(data);
}

export async function updatePlan(input: PlanInput, actor: BridgeActor | null) {
  if (!isUuid(input.id)) throw new BridgeError(400, 'id is required');
  validatePlan(input, true);
  const { data: existing } = await supabaseAdmin.from('plans').select('id, is_default').eq('id', input.id).maybeSingle();
  if (!existing) throw new BridgeError(404, 'Plan not found');
  // There is always exactly one default: un-defaulting happens only by making
  // another plan the default (is_default:false on the default plan is ignored).
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.name !== undefined) patch.name = input.name.trim();
  if (input.price_inr !== undefined) patch.price_inr = Math.round(input.price_inr);
  if (input.free_staff_seats !== undefined) patch.free_staff_seats = input.free_staff_seats;
  if (input.is_default) {
    await clearDefault(input.id);
    patch.is_default = true;
  }
  const { data, error } = await supabaseAdmin
    .from('plans')
    .update(patch)
    .eq('id', input.id)
    .select('id, name, price_inr, free_staff_seats, is_default')
    .single();
  if (error) throw new BridgeError(error.code === '23505' ? 409 : 500, error.code === '23505' ? 'A plan with that name exists' : error.message);
  await auditAdmin('admin.plan.updated', actor, null, { plan_id: input.id, target: (data as any).name, changes: patch });
  return planShape(data);
}

export async function assignPlan(id: string, planId: string, actor: BridgeActor | null) {
  const ws = await loadAccount(id);
  if (ws.kind !== 'business' && ws.kind !== 'talent') throw new BridgeError(400, 'Only business and talent accounts have plans');
  if (!isUuid(planId)) throw new BridgeError(400, 'plan_id must be a uuid');
  const { data: plan } = await supabaseAdmin.from('plans').select('id, name').eq('id', planId).maybeSingle();
  if (!plan) throw new BridgeError(404, 'Plan not found');
  await supabaseAdmin.from('workspaces').update({ plan_id: planId }).eq('id', ws.id);
  await auditAdmin('admin.account.plan_assigned', actor, ws.id, { from_plan_id: ws.plan_id ?? null, plan_id: planId, target: (plan as any).name });
  return accountDetail(ws.id);
}

// ------------------------------------------------------------------ mini apps
export async function miniAppCatalog(): Promise<Paged<{ slug: string; name: string; description: string | null; icon: string | null }>> {
  const { data } = await supabaseAdmin.from('mini_apps').select('slug, name, description, icon, is_enabled').eq('is_enabled', true).order('name');
  const items = ((data || []) as any[])
    .filter((a) => !BLOCKED_MINI_APPS.has(a.slug))
    .map((a) => ({ slug: a.slug, name: a.name, description: a.description ?? null, icon: a.icon ?? null }));
  return { items, total: items.length, page: 1, page_size: items.length };
}

export async function toggleMiniApp(id: string, slug: string, enabled: boolean, actor: BridgeActor | null) {
  const ws = await loadAccount(id);
  if (BLOCKED_MINI_APPS.has(slug)) throw new BridgeError(400, 'This mini app is not available on Squad Hub SaaS');
  const catalog = await miniAppCatalog();
  if (!catalog.items.some((a) => a.slug === slug)) throw new BridgeError(404, 'Unknown mini app');
  const { data: existing } = await supabaseAdmin
    .from('workspace_mini_apps')
    .select('slug')
    .eq('workspace_id', ws.id)
    .eq('slug', slug)
    .maybeSingle();
  const now = new Date().toISOString();
  if (existing) {
    await supabaseAdmin.from('workspace_mini_apps').update({ enabled, updated_at: now }).eq('workspace_id', ws.id).eq('slug', slug);
  } else {
    await supabaseAdmin.from('workspace_mini_apps').insert({ workspace_id: ws.id, slug, enabled, updated_at: now });
  }
  await auditAdmin(enabled ? 'admin.mini_app.enabled' : 'admin.mini_app.disabled', actor, ws.id, { slug, target: slug });
  return accountDetail(ws.id);
}

// ------------------------------------------------------------------ impersonate
export async function impersonate(userId: string, reason: string, actor: BridgeActor | null) {
  if (!isUuid(userId)) throw new BridgeError(404, 'User not found');
  const why = String(reason || '').trim();
  if (why.length < 5) throw new BridgeError(400, 'A reason (at least 5 characters) is required');
  const user = await getUserById(userId);
  if (!user) throw new BridgeError(404, 'User not found');
  if (user.user_type === 'internal') throw new BridgeError(403, 'Upsquad staff accounts cannot be impersonated');

  // Land on the user's own (non-suspended) account.
  const { data: memberships } = await supabaseAdmin
    .from('workspace_members')
    .select('workspace_id, role, workspaces!inner(kind, status)')
    .eq('user_id', userId);
  const usable = ((memberships || []) as any[]).filter((m) => m.workspaces?.status !== 'suspended');
  if (!usable.length) throw new BridgeError(409, 'This user has no active account to log in to');
  const landing =
    usable.find((m) => m.role === 'owner' && m.workspaces?.kind !== 'shared') ?? usable.find((m) => m.workspaces?.kind !== 'shared') ?? usable[0];

  const link = await createLoginToken({
    userId,
    purpose: 'impersonate',
    workspaceId: landing.workspace_id,
    actorHubUserId: isUuid(actor?.hub_user_id) ? actor!.hub_user_id : null,
    actorEmail: actor?.email ?? null,
    reason: why,
  });
  await auditAdmin('admin.impersonate', actor, landing.workspace_id, {
    user_id: userId,
    target: user.email,
    reason: why,
    expires_at: link.expires_at,
  });
  return { url: link.url, login_url: link.url, expires_at: link.expires_at };
}

// ------------------------------------------------------------------ audit
export async function listAudit(query: { account_id?: string; page?: unknown }): Promise<Paged<any>> {
  const page = pageOf(query.page);
  const from = (page - 1) * 50;
  let q = supabaseAdmin
    .from('platform_audit_log')
    .select('id, action, workspace_id, actor_user_id, actor_hub_user_id, details, created_at', { count: 'exact' });
  if (query.account_id) {
    if (!isUuid(query.account_id)) return { items: [], total: 0, page, page_size: 50 };
    q = q.eq('workspace_id', query.account_id);
  }
  const { data, count, error } = await q.order('created_at', { ascending: false }).range(from, from + 49);
  if (error) throw new Error(error.message);
  const rows = (data || []) as any[];
  const users = await usersById(rows.map((r) => r.actor_user_id).filter(Boolean));
  const items = rows.map((r) => {
    const d = (r.details || {}) as Record<string, any>;
    const u = r.actor_user_id ? users.get(r.actor_user_id) : null;
    const actorEmail = d.actor_email ?? u?.email ?? null;
    return {
      id: String(r.id),
      action: r.action,
      created_at: r.created_at,
      account_id: r.workspace_id ?? null,
      actor:
        r.actor_hub_user_id || actorEmail || u
          ? { hub_user_id: r.actor_hub_user_id ?? d.actor_hub_user_id ?? null, email: actorEmail, name: u?.display_name ?? null }
          : null,
      actor_email: actorEmail,
      target: d.target != null ? String(d.target) : null,
      reason: d.reason ?? null,
      details: d,
    };
  });
  return { items, total: count ?? items.length, page, page_size: 50 };
}

// ------------------------------------------------------------------ check-ins
export async function listCheckins(query: { from?: string; to?: string; hub_partner_user_id?: string }): Promise<Paged<any>> {
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  let accounts: any[] = [];
  let q = supabaseAdmin.from('workspaces').select('id, owner_user_id, hub_partner_user_id').eq('kind', 'talent');
  if (query.hub_partner_user_id) {
    if (!isUuid(query.hub_partner_user_id)) return { items: [], total: 0, page: 1, page_size: 0 };
    q = q.eq('hub_partner_user_id', query.hub_partner_user_id);
  } else {
    q = q.not('hub_partner_user_id', 'is', null);
  }
  const { data } = await q;
  accounts = ((data || []) as any[]).filter((a) => a.owner_user_id);
  if (!accounts.length) return { items: [], total: 0, page: 1, page_size: 0 };

  const ownerToAccount = new Map(accounts.map((a) => [a.owner_user_id, a]));
  let cq = supabaseAdmin
    .from('checkins')
    .select('id, user_id, date, status, submitted_at, completed_items, created_at, workspace_id')
    .in('workspace_id', accounts.map((a) => a.id))
    .in('user_id', [...ownerToAccount.keys()]);
  if (query.from && dateRe.test(query.from)) cq = cq.gte('date', query.from);
  if (query.to && dateRe.test(query.to)) cq = cq.lte('date', query.to);
  const { data: rows } = await cq.order('date', { ascending: false }).limit(1000);
  const users = await usersById([...ownerToAccount.keys()]);
  const items = ((rows || []) as any[]).map((c) => {
    const acct = ownerToAccount.get(c.user_id);
    const done = Array.isArray(c.completed_items) ? c.completed_items : [];
    return {
      id: c.id,
      date: c.date,
      created_at: c.created_at,
      submitted_at: c.submitted_at ?? null,
      hub_partner_user_id: acct?.hub_partner_user_id ?? null,
      saas_account_id: acct?.id ?? null,
      user_name: users.get(c.user_id)?.display_name ?? null,
      status: c.status,
      mood: null,
      note: done.length ? `${done.length} item${done.length === 1 ? '' : 's'} completed` : null,
      completed_items: done,
    };
  });
  return { items, total: items.length, page: 1, page_size: items.length };
}
