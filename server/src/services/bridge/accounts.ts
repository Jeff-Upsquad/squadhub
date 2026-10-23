/**
 * POST /bridge/v1/accounts — create/ensure a business or talent account for a
 * Hub client / partner. Idempotent on the Hub (and SquadHire) ids: a second
 * call for the same id returns the same account with `created: false` and
 * creates nothing new.
 */
import { supabaseAdmin } from '../../supabase';
import {
  BLOCKED_MINI_APPS,
  DEFAULT_MINI_APPS,
  audit,
  ensureAccount,
  findAccountByExternalId,
  addWorkspaceMember,
} from '../../utils/accounts';
import { findOrCreateUser, getUserById, linkHubUserId } from './users';
import { BridgeError } from './errors';

export interface EnsureAccountBody {
  kind: 'business' | 'talent';
  owner: { email: string; name: string; phone?: string | null };
  /** Not in the contract: the Hub only sends the owner's name; accepted when present. */
  name?: string | null;
  hub_client_id?: string | null;
  hub_partner_user_id?: string | null;
  squadhire_business_id?: string | null;
  squadhire_talent_id?: string | null;
  role_slug?: string | null;
}

export interface EnsureAccountResult {
  saas_account_id: string;
  owner_user_id: string;
  created: boolean;
}

/** Talent accounts always carry check-ins + partner-payments; Cashbook never. */
export async function ensureDefaultMiniApps(workspaceId: string, kind: 'business' | 'talent'): Promise<void> {
  const slugs = DEFAULT_MINI_APPS[kind].filter((s) => !BLOCKED_MINI_APPS.has(s));
  if (!slugs.length) return;
  await supabaseAdmin
    .from('workspace_mini_apps')
    .upsert(
      slugs.map((slug) => ({ workspace_id: workspaceId, slug, enabled: true })),
      { onConflict: 'workspace_id,slug', ignoreDuplicates: true },
    );
}

export async function ensureBridgeAccount(
  body: EnsureAccountBody,
  actorHubUserId: string | null = null,
): Promise<EnsureAccountResult> {
  if (body.kind === 'business' && !body.hub_client_id && !body.squadhire_business_id) {
    throw new BridgeError(400, 'A business account needs hub_client_id or squadhire_business_id');
  }
  if (body.kind === 'talent' && !body.hub_partner_user_id && !body.squadhire_talent_id) {
    throw new BridgeError(400, 'A talent account needs hub_partner_user_id or squadhire_talent_id');
  }
  const ids = {
    hub_client_id: body.kind === 'business' ? body.hub_client_id ?? null : null,
    hub_partner_user_id: body.kind === 'talent' ? body.hub_partner_user_id ?? null : null,
    squadhire_business_id: body.kind === 'business' ? body.squadhire_business_id ?? null : null,
    squadhire_talent_id: body.kind === 'talent' ? body.squadhire_talent_id ?? null : null,
  };

  // Fast idempotent path: the account already exists — never create a user.
  const existing = await findAccountByExternalId(body.kind, ids);
  if (existing?.owner_user_id) {
    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(ids)) if (v) patch[k] = v;
    await supabaseAdmin.from('workspaces').update(patch).eq('id', existing.id);
    if (body.kind === 'talent') {
      await ensureDefaultMiniApps(existing.id, 'talent');
      const owner = await getUserById(existing.owner_user_id);
      if (owner) await linkHubUserId(owner, body.hub_partner_user_id);
    }
    return { saas_account_id: existing.id, owner_user_id: existing.owner_user_id, created: false };
  }

  const { user } = await findOrCreateUser({
    email: body.owner.email,
    name: body.owner.name,
    phone: body.owner.phone,
    userType: body.kind === 'talent' ? 'partner' : 'client',
    hubUserId: body.kind === 'talent' ? body.hub_partner_user_id : null,
  });

  const accountName = (body.name || body.owner.name || body.owner.email.split('@')[0]).trim();
  const ensured = await ensureAccount({ kind: body.kind, name: accountName, ownerUserId: user.id, ...ids });
  // ensureAccount adopts an unlinked account the owner already had; make sure
  // the owner row and the talent defaults are in place either way.
  await addWorkspaceMember(ensured.id, user.id, 'owner');
  if (body.kind === 'talent') await ensureDefaultMiniApps(ensured.id, 'talent');

  await audit('bridge.account.ensured', {
    workspaceId: ensured.id,
    actorUserId: null,
    actorHubUserId: actorHubUserId,
    details: { kind: body.kind, created: ensured.created, ...ids, role_slug: body.role_slug ?? null },
  });
  return { saas_account_id: ensured.id, owner_user_id: user.id, created: ensured.created };
}
