/**
 * Upsquad staff on the SaaS:
 *   POST /bridge/v1/staff/link                 ensure the staff user
 *   GET  /bridge/v1/staff/:hubUserId/workspaces shared workspaces + unread counts
 *   POST /bridge/v1/staff/sso                  one-time login URL ("Sign in with Squad Hub")
 */
import { supabaseAdmin } from '../../supabase';
import { audit } from '../../utils/accounts';
import { BridgeError, isUuid } from './errors';
import { createLoginToken } from './loginTokens';
import { findOrCreateUser, findUserByHubUserId, linkOrCreateStaffUser, StaffNotActiveError } from './users';
import type { BridgeActor } from './admin';

export async function linkStaff(body: { hub_user_id: string; email?: string; name?: string }) {
  if (!isUuid(body.hub_user_id)) throw new BridgeError(400, 'hub_user_id must be a uuid');
  const result = body.email
    ? await findOrCreateUser({ email: body.email, name: body.name, userType: 'internal', hubUserId: body.hub_user_id })
    : await linkOrCreateStaffUser(body.hub_user_id).catch((e) => {
        if (e instanceof StaffNotActiveError) throw new BridgeError(403, e.message);
        throw e;
      });
  if (result.created) await audit('bridge.staff.linked', { actorUserId: null, actorHubUserId: body.hub_user_id, details: { user_id: result.user.id } });
  return { user_id: result.user.id, created: result.created };
}

/** Unread top-level channel messages for `userId` in one workspace. */
async function unreadIn(workspaceId: string, userId: string, isAdmin: boolean): Promise<number> {
  const { data: channels } = await supabaseAdmin
    .from('channels')
    .select('id, is_private')
    .eq('workspace_id', workspaceId)
    .is('deleted_at', null);
  let ids = ((channels || []) as any[]).map((c) => c.id as string);
  if (!isAdmin) {
    const { data: rm } = await supabaseAdmin
      .from('resource_memberships')
      .select('resource_id')
      .eq('workspace_id', workspaceId)
      .eq('resource_type', 'channel')
      .eq('user_id', userId);
    const mine = new Set(((rm || []) as any[]).map((r) => r.resource_id));
    ids = ((channels || []) as any[]).filter((c) => !c.is_private || mine.has(c.id)).map((c) => c.id);
  }
  if (!ids.length) return 0;
  const { data: reads } = await supabaseAdmin
    .from('message_reads')
    .select('scope_id, last_read_at')
    .eq('user_id', userId)
    .eq('scope_type', 'channel')
    .in('scope_id', ids);
  const lastRead = new Map(((reads || []) as any[]).map((r) => [r.scope_id, r.last_read_at]));
  let total = 0;
  for (const id of ids) {
    let q = supabaseAdmin
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .eq('channel_id', id)
      .eq('is_deleted', false)
      .is('parent_message_id', null)
      .neq('sender_id', userId);
    const since = lastRead.get(id);
    if (since) q = q.gt('created_at', since);
    const { count } = await q;
    total += count || 0;
  }
  return total;
}

export async function staffWorkspaces(hubUserId: string) {
  if (!isUuid(hubUserId)) throw new BridgeError(400, 'hubUserId must be a uuid');
  const user = await findUserByHubUserId(hubUserId);
  if (!user) return { items: [], total: 0, page: 1, page_size: 0 };
  const { data: memberships } = await supabaseAdmin
    .from('workspace_members')
    .select('workspace_id, role, is_upsquad_staff')
    .eq('user_id', user.id);
  const wsIds = ((memberships || []) as any[]).map((m) => m.workspace_id);
  if (!wsIds.length) return { items: [], total: 0, page: 1, page_size: 0 };
  const { data: rows } = await supabaseAdmin
    .from('workspaces')
    .select('id, name, kind, status, host_workspace_id, engagement_status')
    .in('id', wsIds)
    .eq('kind', 'shared')
    .eq('status', 'active');
  const shared = (rows || []) as any[];
  const hostIds = [...new Set(shared.map((w) => w.host_workspace_id).filter(Boolean))];
  const { data: hosts } = hostIds.length
    ? await supabaseAdmin.from('workspaces').select('id, name').in('id', hostIds)
    : { data: [] as any[] };
  const hostName = new Map(((hosts || []) as any[]).map((h) => [h.id, h.name]));
  const { data: links } = shared.length
    ? await supabaseAdmin
        .from('shared_workspace_links')
        .select('shared_workspace_id, hub_card_id, card_category')
        .in('shared_workspace_id', shared.map((w) => w.id))
        .eq('participant_role', 'host')
    : { data: [] as any[] };
  const linkBy = new Map(((links || []) as any[]).map((l) => [l.shared_workspace_id, l]));
  const roleBy = new Map(((memberships || []) as any[]).map((m) => [m.workspace_id, m.role]));
  const items = await Promise.all(
    shared.map(async (w) => ({
      id: w.id,
      name: w.name,
      account_name: hostName.get(w.host_workspace_id) ?? null,
      engagement_status: w.engagement_status ?? 'active',
      hub_card_id: linkBy.get(w.id)?.hub_card_id ?? null,
      card_category: linkBy.get(w.id)?.card_category ?? null,
      unread_count: await unreadIn(w.id, user.id, ['owner', 'admin'].includes(roleBy.get(w.id))),
    })),
  );
  return { items, total: items.length, page: 1, page_size: items.length };
}

export async function staffSso(body: { hub_user_id: string; workspace_id?: string | null }, actor: BridgeActor | null) {
  if (!isUuid(body.hub_user_id)) throw new BridgeError(400, 'hub_user_id must be a uuid');
  // The actor is the same staff member (the Hub signs on their behalf): its
  // email is the fallback identity when the Hub staff lookup can't be reached.
  const fallback = actor?.hub_user_id === body.hub_user_id ? { email: actor?.email ?? null } : {};
  let user;
  try {
    ({ user } = await linkOrCreateStaffUser(body.hub_user_id, fallback));
  } catch (e) {
    if (e instanceof StaffNotActiveError) throw new BridgeError(403, e.message);
    throw e;
  }
  if (user.user_type !== 'internal') throw new BridgeError(403, 'This Squad Hub user is linked to a non-staff SaaS account');
  let landing: string | null = null;
  if (isUuid(body.workspace_id)) {
    const { data } = await supabaseAdmin
      .from('workspace_members')
      .select('workspace_id')
      .eq('workspace_id', body.workspace_id)
      .eq('user_id', user.id)
      .maybeSingle();
    if (!data) throw new BridgeError(403, 'You are not a member of that workspace');
    landing = body.workspace_id;
  }
  const link = await createLoginToken({
    userId: user.id,
    purpose: 'staff_sso',
    workspaceId: landing,
    actorHubUserId: body.hub_user_id,
    actorEmail: actor?.email ?? null,
  });
  await audit('bridge.staff.sso', { workspaceId: landing, actorUserId: user.id, actorHubUserId: body.hub_user_id, details: { expires_at: link.expires_at } });
  return { url: link.url, login_url: link.url, expires_at: link.expires_at, workspace_id: landing };
}
