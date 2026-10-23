/**
 * SaaS accounts (tenancy core).
 *
 * In Squad Hub SaaS a `workspaces` row IS the account. Every business, every
 * talent, every shared (business ⇄ talent) workspace and the Upsquad staff
 * workspace is one row, distinguished by `kind`:
 *
 *   business        a SquadHire business (hub_client_id / squadhire_business_id)
 *   talent          a SquadHire talent  (hub_partner_user_id / squadhire_talent_id)
 *   shared          a Slack-Connect style space for one engagement; hosted by a
 *                   business account (host_workspace_id), participants are linked
 *                   through shared_workspace_links
 *   internal_staff  Upsquad staff working inside the SaaS
 *
 * Membership lives in workspace_members (role owner/admin/member/guest,
 * is_upsquad_staff). Every collaboration row carries workspace_id; see
 * middleware/workspace.ts for how a request resolves its active workspace.
 *
 * All helpers here are idempotent: the Hub bridge (POST /bridge/v1/accounts)
 * and the SquadHire SSO flows can both call ensureAccount() for the same
 * external id without creating duplicates.
 */

import { supabaseAdmin } from '../supabase';

export type AccountKind = 'business' | 'talent' | 'shared' | 'internal_staff';
export type WorkspaceRole = 'owner' | 'admin' | 'member' | 'guest';

/** Mini apps switched on for a brand-new account of each kind. */
export const DEFAULT_MINI_APPS: Record<AccountKind, string[]> = {
  business: [],
  talent: ['check-ins', 'partner-payments'],
  shared: [],
  internal_staff: [],
};

/** Mini apps that are never offered in the SaaS, whatever a row says. */
export const BLOCKED_MINI_APPS = new Set(['cash-book', 'cashbook']);

export interface AccountExternalIds {
  hub_client_id?: string | null;
  hub_partner_user_id?: string | null;
  squadhire_business_id?: string | null;
  squadhire_talent_id?: string | null;
}

export interface CreateAccountInput extends AccountExternalIds {
  kind: AccountKind;
  name: string;
  ownerUserId: string;
  hostWorkspaceId?: string | null;
}

const EXTERNAL_ID_KEYS = [
  'hub_client_id',
  'hub_partner_user_id',
  'squadhire_business_id',
  'squadhire_talent_id',
] as const;

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 40) || 'workspace'
  );
}

async function uniqueSlug(name: string): Promise<string> {
  const base = slugify(name);
  for (let i = 0; i < 20; i++) {
    const candidate = i === 0 ? base : `${base}-${Math.random().toString(36).slice(2, 6)}`;
    const { data } = await supabaseAdmin
      .from('workspaces')
      .select('id')
      .eq('slug', candidate) // tenant-scope: global slug uniqueness probe
      .maybeSingle();
    if (!data) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

async function defaultPlanId(): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('plans')
    .select('id')
    .eq('is_default', true)
    .limit(1)
    .maybeSingle();
  return (data?.id as string) ?? null;
}

/** Add (or upgrade to owner) a member. Never downgrades an existing role. */
export async function addWorkspaceMember(
  workspaceId: string,
  userId: string,
  role: WorkspaceRole = 'member',
  opts: { isUpsquadStaff?: boolean } = {},
): Promise<void> {
  const { data: existing } = await supabaseAdmin
    .from('workspace_members')
    .select('id, role')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .maybeSingle();
  if (existing) {
    if (existing.role !== 'owner' && role === 'owner') {
      await supabaseAdmin
        .from('workspace_members')
        .update({ role })
        .eq('id', existing.id)
        .eq('workspace_id', workspaceId);
    }
    return;
  }
  const { error } = await supabaseAdmin.from('workspace_members').insert({
    workspace_id: workspaceId,
    user_id: userId,
    role,
    is_upsquad_staff: opts.isUpsquadStaff ?? false,
  });
  if (error && (error as any).code !== '23505') {
    throw new Error(`Could not add workspace member: ${error.message}`);
  }
}

/** Enable the default mini apps for a freshly created account. */
async function seedMiniApps(workspaceId: string, kind: AccountKind): Promise<void> {
  const slugs = DEFAULT_MINI_APPS[kind].filter((s) => !BLOCKED_MINI_APPS.has(s));
  if (!slugs.length) return;
  await supabaseAdmin
    .from('workspace_mini_apps')
    .upsert(
      slugs.map((slug) => ({ workspace_id: workspaceId, slug, enabled: true })),
      { onConflict: 'workspace_id,slug', ignoreDuplicates: true },
    );
}

/** Every account starts with a #general channel the owner belongs to. */
async function seedGeneralChannel(workspaceId: string, ownerUserId: string): Promise<void> {
  // Public channel: every workspace member can see it; the owner (creator)
  // manages it. Channel membership lives in resource_memberships.
  await supabaseAdmin.from('channels').insert({
    workspace_id: workspaceId,
    name: 'general',
    description: 'Announcements and work-based matters',
    is_private: false,
    created_by: ownerUserId,
  });
}

export async function createAccount(input: CreateAccountInput): Promise<{ id: string }> {
  const { data, error } = await supabaseAdmin
    .from('workspaces')
    .insert({
      name: input.name.slice(0, 80),
      slug: await uniqueSlug(input.name),
      kind: input.kind,
      status: 'active',
      owner_user_id: input.ownerUserId,
      plan_id: input.kind === 'shared' ? null : await defaultPlanId(),
      hub_client_id: input.hub_client_id ?? null,
      hub_partner_user_id: input.hub_partner_user_id ?? null,
      squadhire_business_id: input.squadhire_business_id ?? null,
      squadhire_talent_id: input.squadhire_talent_id ?? null,
      host_workspace_id: input.hostWorkspaceId ?? null,
      created_by: input.ownerUserId,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`Could not create account: ${error?.message}`);

  const id = data.id as string;
  await addWorkspaceMember(id, input.ownerUserId, 'owner');
  await seedMiniApps(id, input.kind);
  await seedGeneralChannel(id, input.ownerUserId).catch((err) =>
    console.error('[accounts] general channel seed failed:', err),
  );
  await audit('account.created', {
    workspaceId: id,
    actorUserId: input.ownerUserId,
    details: { kind: input.kind },
  });
  return { id };
}

/** Find an account of `kind` by any of its external ids. */
export async function findAccountByExternalId(
  kind: AccountKind,
  ids: AccountExternalIds,
): Promise<{ id: string; owner_user_id: string | null } | null> {
  for (const key of EXTERNAL_ID_KEYS) {
    const value = ids[key];
    if (!value) continue;
    const { data } = await supabaseAdmin
      .from('workspaces')
      .select('id, owner_user_id')
      .eq('kind', kind)
      .eq(key, value) // tenant-scope: lookup by account external id
      .maybeSingle();
    if (data) return data as { id: string; owner_user_id: string | null };
  }
  return null;
}

/**
 * Idempotently ensure the account exists and that `ownerUserId` is its owner
 * (when newly created) or at least a member (when it already existed).
 * Missing external ids are back-filled on the existing row.
 */
export async function ensureAccount(
  input: CreateAccountInput,
): Promise<{ id: string; created: boolean }> {
  const existing = await findAccountByExternalId(input.kind, input);
  if (existing) {
    const patch: Record<string, unknown> = {};
    for (const key of EXTERNAL_ID_KEYS) if (input[key]) patch[key] = input[key];
    if (!existing.owner_user_id) patch.owner_user_id = input.ownerUserId;
    if (Object.keys(patch).length) {
      await supabaseAdmin.from('workspaces').update(patch).eq('id', existing.id);
    }
    const isOwner = !existing.owner_user_id || existing.owner_user_id === input.ownerUserId;
    await addWorkspaceMember(existing.id, input.ownerUserId, isOwner ? 'owner' : 'member');
    return { id: existing.id, created: false };
  }

  // A user who already owns an unlinked account of this kind (e.g. self-serve
  // signup first, SquadHire link later) gets that one adopted.
  if (input.kind !== 'shared') {
    const { data: owned } = await supabaseAdmin
      .from('workspaces')
      .select('id')
      .eq('kind', input.kind)
      .eq('owner_user_id', input.ownerUserId)
      .is('squadhire_business_id', null)
      .is('squadhire_talent_id', null)
      .is('hub_client_id', null)
      .is('hub_partner_user_id', null)
      .limit(1)
      .maybeSingle();
    if (owned?.id) {
      const patch: Record<string, unknown> = {};
      for (const key of EXTERNAL_ID_KEYS) if (input[key]) patch[key] = input[key];
      if (Object.keys(patch).length) {
        await supabaseAdmin.from('workspaces').update(patch).eq('id', owned.id);
      }
      return { id: owned.id as string, created: false };
    }
  }

  const created = await createAccount(input);
  return { id: created.id, created: true };
}

/** Append-only platform audit trail (super-admin actions, account lifecycle). */
export async function audit(
  action: string,
  opts: {
    workspaceId?: string | null;
    actorUserId?: string | null;
    actorHubUserId?: string | null;
    details?: Record<string, unknown>;
  },
): Promise<void> {
  const { error } = await supabaseAdmin.from('platform_audit_log').insert({
    action,
    workspace_id: opts.workspaceId ?? null,
    actor_user_id: opts.actorUserId ?? null,
    actor_hub_user_id: opts.actorHubUserId ?? null,
    details: opts.details ?? {},
  });
  if (error) console.error('[audit] insert failed:', error.message);
}
