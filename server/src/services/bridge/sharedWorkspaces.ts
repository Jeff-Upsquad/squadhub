/**
 * Shared workspaces (one per Hub card): hosted by the business account, the
 * card's talent works inside the card category's space only, and the card's
 * account managers (Upsquad staff) join as staff admins.
 *
 *   ensure          POST /bridge/v1/shared-workspaces/ensure
 *   removeMember    POST /bridge/v1/shared-workspaces/:id/members/remove
 *   setLifecycle    POST /bridge/v1/shared-workspaces/:id/pause|resume|close
 *
 * Membership model (see middleware/workspace.ts):
 *   - business owner  → owner of the shared workspace (direct)
 *   - talent          → `guest` member + `member` access on the category space
 *                       only; their talent account is linked (participant_role
 *                       'talent') so time totals can be mapped to the card
 *   - account manager → `admin` member with is_upsquad_staff = true
 * Removing a talent deletes their direct membership, their resource
 * memberships in the workspace AND closes their account's link, so the
 * shared-link path in getMembership can't re-admit them.
 */
import { SERVICE_TYPE_TO_SLUG } from '@squadhub/shared';
import { supabaseAdmin } from '../../supabase';
import { addWorkspaceMember, audit, createAccount } from '../../utils/accounts';
import { BridgeError, isUuid } from './errors';
import { findUserByHubUserId, linkOrCreateStaffUser, StaffNotActiveError } from './users';

const CATEGORY_LABELS: Record<string, string> = {
  designer: 'Designer',
  video_editor: 'Video Editor',
  designer_video_editor: 'Designer + Video Editor',
  accountant: 'Accountant',
  ads_specialist: 'Ads Specialist',
  creative_director: 'Creative Director',
  copy_content_writer: 'Copy & Content Writer',
  social_media_manager: 'Social Media Manager',
  videographer_photographer: 'Videographer & Photographer',
  ai_video_image_creator: 'AI Video & Image Creator',
};

/** "designer" / "Designers" / "video_editor" → "Designer" / "Video Editor". */
export function categorySpaceName(category: string | null | undefined): string {
  const raw = String(category || '').trim();
  if (!raw) return 'Work';
  const slug = (SERVICE_TYPE_TO_SLUG as Record<string, string>)[raw] || raw.toLowerCase().replace(/[\s-]+/g, '_');
  if (CATEGORY_LABELS[slug]) return CATEGORY_LABELS[slug];
  return slug
    .split('_')
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
}

export interface EnsureSharedBody {
  business_saas_account_id?: string | null;
  hub_client_id?: string | null;
  hub_card_id: string;
  card_category?: string | null;
  hub_partner_user_id?: string | null;
  account_manager_hub_user_ids?: string[];
  supersedes_hub_card_id?: string | null;
}

export interface EnsureSharedResult {
  shared_workspace_id: string;
  created: boolean;
  space_id: string;
  space_name: string;
  talent_added: boolean;
  talent_pending_reason: string | null;
  staff_added: string[];
  staff_pending: string[];
}

async function resolveHost(body: EnsureSharedBody): Promise<{ id: string; name: string; owner_user_id: string }> {
  let q = supabaseAdmin.from('workspaces').select('id, name, owner_user_id, kind').eq('kind', 'business');
  if (body.business_saas_account_id) q = q.eq('id', body.business_saas_account_id);
  else if (body.hub_client_id) q = q.eq('hub_client_id', body.hub_client_id);
  else throw new BridgeError(400, 'business_saas_account_id or hub_client_id is required');
  const { data } = await q.maybeSingle();
  if (!data) throw new BridgeError(404, 'Business account not found — call POST /bridge/v1/accounts first');
  if (!data.owner_user_id) throw new BridgeError(409, 'Business account has no owner');
  return data as any;
}

/** The shared workspace currently linked to a Hub card (via its host link). */
export async function sharedWorkspaceForCard(hubCardId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('shared_workspace_links')
    .select('shared_workspace_id')
    .eq('hub_card_id', hubCardId)
    .eq('participant_role', 'host')
    .limit(1);
  return ((data as any[]) || [])[0]?.shared_workspace_id ?? null;
}

async function upsertLink(row: {
  shared_workspace_id: string;
  participant_workspace_id: string;
  participant_role: 'host' | 'talent' | 'staff';
  hub_card_id: string;
  card_category: string | null;
  status?: 'active' | 'paused' | 'closed';
}): Promise<void> {
  const { data: existing } = await supabaseAdmin
    .from('shared_workspace_links')
    .select('id')
    .eq('shared_workspace_id', row.shared_workspace_id)
    .eq('participant_workspace_id', row.participant_workspace_id)
    .maybeSingle();
  const patch = {
    participant_role: row.participant_role,
    hub_card_id: row.hub_card_id,
    card_category: row.card_category,
    status: row.status ?? 'active',
    updated_at: new Date().toISOString(),
  };
  if (existing) {
    await supabaseAdmin.from('shared_workspace_links').update(patch).eq('id', (existing as any).id);
  } else {
    await supabaseAdmin.from('shared_workspace_links').insert({
      shared_workspace_id: row.shared_workspace_id,
      participant_workspace_id: row.participant_workspace_id,
      ...patch,
    });
  }
}

async function ensureCategorySpace(
  workspaceId: string,
  name: string,
  ownerUserId: string,
): Promise<string> {
  const { data: found } = await supabaseAdmin
    .from('spaces')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('name', name)
    .is('deleted_at', null)
    .limit(1);
  const existingId = ((found as any[]) || [])[0]?.id as string | undefined;
  if (existingId) return existingId;

  const { data: inserted, error } = await supabaseAdmin
    .from('spaces')
    .insert({
      workspace_id: workspaceId,
      name,
      color: '#7c3aed',
      icon: 'folder',
      is_private: true,
      created_by: ownerUserId,
      position: 0,
      description: `${name} work for this engagement`,
    })
    .select('id')
    .single();
  if (error || !inserted) throw new Error(`Could not create the ${name} space: ${error?.message}`);
  const spaceId = (inserted as any).id as string;
  await grantSpace(workspaceId, spaceId, ownerUserId, 'manager');

  // Same board defaults a space created in the app gets (best effort).
  try {
    const { upsertAssignment } = await import('../../utils/statusGroups');
    const { data: def } = await supabaseAdmin
      .from('status_groups')
      .select('id')
      .eq('is_default', true)
      .eq('is_enabled', true)
      .limit(1)
      .maybeSingle();
    if ((def as any)?.id) await upsertAssignment((def as any).id, 'space', spaceId, ownerUserId);
  } catch (e) {
    console.error('[bridge] category space status-group apply failed:', e);
  }
  return spaceId;
}

async function grantSpace(
  workspaceId: string,
  spaceId: string,
  userId: string,
  level: 'member' | 'manager',
): Promise<void> {
  const { data: existing } = await supabaseAdmin
    .from('resource_memberships')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('resource_type', 'space')
    .eq('resource_id', spaceId)
    .eq('user_id', userId)
    .maybeSingle();
  if (existing) return;
  await supabaseAdmin.from('resource_memberships').insert({
    workspace_id: workspaceId,
    resource_type: 'space',
    resource_id: spaceId,
    user_id: userId,
    access_level: level,
  });
}

/** The talent account (and its owner) for a Hub partner user id. */
async function talentFor(hubPartnerUserId: string): Promise<{ accountId: string | null; userId: string | null }> {
  const { data: acct } = await supabaseAdmin
    .from('workspaces')
    .select('id, owner_user_id')
    .eq('kind', 'talent')
    .eq('hub_partner_user_id', hubPartnerUserId)
    .maybeSingle();
  if (acct?.owner_user_id) return { accountId: acct.id as string, userId: acct.owner_user_id as string };
  const user = await findUserByHubUserId(hubPartnerUserId);
  return { accountId: (acct?.id as string) ?? null, userId: user?.id ?? null };
}

export async function ensureSharedWorkspace(
  body: EnsureSharedBody,
  actorHubUserId: string | null = null,
): Promise<EnsureSharedResult> {
  if (!isUuid(body.hub_card_id)) throw new BridgeError(400, 'hub_card_id must be a uuid');
  const host = await resolveHost(body);
  const spaceName = categorySpaceName(body.card_category);
  const category = body.card_category ?? null;

  // 1. Find the card's workspace — or move the superseded card's link onto it.
  let wsId = await sharedWorkspaceForCard(body.hub_card_id);
  let created = false;
  if (!wsId && body.supersedes_hub_card_id) {
    const prev = await sharedWorkspaceForCard(body.supersedes_hub_card_id);
    if (prev) {
      await supabaseAdmin
        .from('shared_workspace_links')
        .update({ hub_card_id: body.hub_card_id, card_category: category, updated_at: new Date().toISOString() })
        .eq('shared_workspace_id', prev)
        .eq('hub_card_id', body.supersedes_hub_card_id);
      wsId = prev;
    }
  }
  if (!wsId) {
    const { id } = await createAccount({
      kind: 'shared',
      name: `${host.name} · ${spaceName}`,
      ownerUserId: host.owner_user_id,
      hostWorkspaceId: host.id,
    });
    wsId = id;
    created = true;
  }
  await upsertLink({
    shared_workspace_id: wsId,
    participant_workspace_id: host.id,
    participant_role: 'host',
    hub_card_id: body.hub_card_id,
    card_category: category,
  });
  // (Re-)assignment re-opens a paused/closed engagement.
  await supabaseAdmin.from('workspaces').update({ engagement_status: 'active' }).eq('id', wsId).eq('kind', 'shared');

  // 2. The category's space (business owner manages it).
  const spaceId = await ensureCategorySpace(wsId, spaceName, host.owner_user_id);

  // 3. Talent → that space only.
  let talentAdded = false;
  let talentPending: string | null = null;
  if (body.hub_partner_user_id) {
    const talent = await talentFor(body.hub_partner_user_id);
    if (!talent.userId) {
      talentPending = 'No SaaS user for this partner yet — call POST /bridge/v1/accounts (kind=talent) first';
    } else {
      await addWorkspaceMember(wsId, talent.userId, 'guest');
      await grantSpace(wsId, spaceId, talent.userId, 'member');
      if (talent.accountId) {
        await upsertLink({
          shared_workspace_id: wsId,
          participant_workspace_id: talent.accountId,
          participant_role: 'talent',
          hub_card_id: body.hub_card_id,
          card_category: category,
        });
      }
      talentAdded = true;
    }
  } else {
    talentPending = 'No hub_partner_user_id on the request';
  }

  // 4. Account managers → staff admins.
  const staffAdded: string[] = [];
  const staffPending: string[] = [];
  for (const hubUserId of [...new Set(body.account_manager_hub_user_ids || [])]) {
    if (!isUuid(hubUserId)) continue;
    try {
      const { user } = await linkOrCreateStaffUser(hubUserId);
      await addWorkspaceMember(wsId, user.id, 'admin', { isUpsquadStaff: true });
      await supabaseAdmin
        .from('workspace_members')
        .update({ is_upsquad_staff: true })
        .eq('workspace_id', wsId)
        .eq('user_id', user.id);
      staffAdded.push(hubUserId);
    } catch (err) {
      if (!(err instanceof StaffNotActiveError)) console.error('[bridge] staff link failed:', (err as Error)?.message);
      staffPending.push(hubUserId);
    }
  }

  await audit('bridge.shared_workspace.ensured', {
    workspaceId: wsId,
    actorHubUserId,
    details: {
      hub_card_id: body.hub_card_id,
      supersedes_hub_card_id: body.supersedes_hub_card_id ?? null,
      host_account_id: host.id,
      created,
      space: spaceName,
      talent_added: talentAdded,
      staff_added: staffAdded,
      staff_pending: staffPending,
    },
  });

  return {
    shared_workspace_id: wsId,
    created,
    space_id: spaceId,
    space_name: spaceName,
    talent_added: talentAdded,
    talent_pending_reason: talentPending,
    staff_added: staffAdded,
    staff_pending: staffPending,
  };
}

async function loadShared(id: string): Promise<{ id: string; owner_user_id: string | null }> {
  if (!isUuid(id)) throw new BridgeError(404, 'Shared workspace not found');
  const { data } = await supabaseAdmin.from('workspaces').select('id, owner_user_id, kind').eq('id', id).maybeSingle();
  if (!data || data.kind !== 'shared') throw new BridgeError(404, 'Shared workspace not found');
  return data as any;
}

/** Remove one user from a shared workspace entirely (membership + resource access). */
async function dropUser(workspaceId: string, userId: string): Promise<void> {
  await supabaseAdmin.from('resource_memberships').delete().eq('workspace_id', workspaceId).eq('user_id', userId);
  await supabaseAdmin.from('workspace_members').delete().eq('workspace_id', workspaceId).eq('user_id', userId);
}

export async function removeSharedMember(
  sharedWorkspaceId: string,
  who: { hub_partner_user_id?: string | null; hub_user_id?: string | null },
  actorHubUserId: string | null = null,
): Promise<{ removed: boolean; user_id: string | null }> {
  const ws = await loadShared(sharedWorkspaceId);
  let userId: string | null = null;
  let talentAccountId: string | null = null;
  if (who.hub_partner_user_id) {
    const t = await talentFor(who.hub_partner_user_id);
    userId = t.userId;
    talentAccountId = t.accountId;
  } else if (who.hub_user_id) {
    userId = (await findUserByHubUserId(who.hub_user_id))?.id ?? null;
  } else {
    throw new BridgeError(400, 'hub_partner_user_id or hub_user_id is required');
  }
  if (!userId) return { removed: false, user_id: null };
  if (userId === ws.owner_user_id) throw new BridgeError(409, 'The business owner cannot be removed from their shared workspace');

  await dropUser(ws.id, userId);
  if (talentAccountId) {
    await supabaseAdmin
      .from('shared_workspace_links')
      .update({ status: 'closed', updated_at: new Date().toISOString() })
      .eq('shared_workspace_id', ws.id)
      .eq('participant_workspace_id', talentAccountId);
  }
  await audit('bridge.shared_workspace.member_removed', {
    workspaceId: ws.id,
    actorHubUserId,
    details: { user_id: userId, hub_partner_user_id: who.hub_partner_user_id ?? null, hub_user_id: who.hub_user_id ?? null },
  });
  return { removed: true, user_id: userId };
}

export async function setSharedLifecycle(
  sharedWorkspaceId: string,
  action: 'pause' | 'resume' | 'close',
  actorHubUserId: string | null = null,
): Promise<{ shared_workspace_id: string; engagement_status: string }> {
  const ws = await loadShared(sharedWorkspaceId);
  const engagement = action === 'pause' ? 'paused' : action === 'resume' ? 'active' : 'closed';
  const now = new Date().toISOString();
  await supabaseAdmin.from('workspaces').update({ engagement_status: engagement, updated_at: now }).eq('id', ws.id);

  // Talent links follow the card; the host link stays active on pause/resume.
  const { data: links } = await supabaseAdmin
    .from('shared_workspace_links')
    .select('id, participant_workspace_id, participant_role, status')
    .eq('shared_workspace_id', ws.id);
  for (const l of (links || []) as any[]) {
    if (l.participant_role === 'talent' && l.status === 'closed' && action !== 'close') continue; // removed talent stays out
    const status = l.participant_role === 'host' ? (action === 'close' ? 'closed' : 'active') : engagement;
    await supabaseAdmin.from('shared_workspace_links').update({ status, updated_at: now }).eq('id', l.id);
    // Closing the card ends the talent's access; the business keeps its workspace.
    if (action === 'close' && l.participant_role === 'talent') {
      const { data: acct } = await supabaseAdmin
        .from('workspaces')
        .select('owner_user_id')
        .eq('id', l.participant_workspace_id)
        .maybeSingle();
      if (acct?.owner_user_id && acct.owner_user_id !== ws.owner_user_id) await dropUser(ws.id, acct.owner_user_id as string);
    }
  }
  await audit(`bridge.shared_workspace.${action}`, { workspaceId: ws.id, actorHubUserId, details: {} });
  return { shared_workspace_id: ws.id, engagement_status: engagement };
}
