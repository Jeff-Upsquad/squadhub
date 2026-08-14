import { supabaseAdmin } from '../supabase';
import { getUserRoleIds, getUserIdsByRoleId } from '../utils/roles';
import { userTypeShareKeyToUuid, userTypeShareUuidToKey } from '../utils/lmsShares';
import type { LmsAccessLevel, UserType } from '@squadhub/shared';

// Higher number = more capable. Effective access = the max grant a user has.
export const ACCESS_RANK: Record<LmsAccessLevel, number> = {
  viewer: 1,
  commenter: 2,
  contributor: 3,
  admin: 4,
};

/** True when `have` is at least `min` (e.g. meetsAccess('contributor','commenter')). */
export function meetsAccess(have: LmsAccessLevel | null, min: LmsAccessLevel): boolean {
  return !!have && ACCESS_RANK[have] >= ACCESS_RANK[min];
}

function maxAccess(a: LmsAccessLevel | null, b: LmsAccessLevel | null): LmsAccessLevel | null {
  if (!a) return b;
  if (!b) return a;
  return ACCESS_RANK[a] >= ACCESS_RANK[b] ? a : b;
}

/**
 * The requesting user's effective access on an LMS item, or null if none.
 *
 * Resolved as the highest of:
 *   - global admin (internal + is_admin)      -> 'admin'
 *   - item owner (lms_items.created_by)        -> 'admin'
 *   - direct user share                        -> its access_level
 *   - role share (primary + secondary roles)   -> its access_level
 *   - legacy assignment (lms_assignments)       -> 'viewer'
 *
 * Draft clones (origin_item_id set) are owned by the contributor, so they get
 * 'admin' on their own working copy via the ownership rule.
 */
export async function getItemAccess(itemId: string, userId: string): Promise<LmsAccessLevel | null> {
  const [{ data: profile }, { data: item }] = await Promise.all([
    supabaseAdmin.from('users').select('is_admin, user_type').eq('id', userId).maybeSingle(),
    supabaseAdmin.from('lms_items').select('created_by').eq('id', itemId).maybeSingle(),
  ]);

  if (!item) return null; // item doesn't exist

  // Global admin or owner short-circuits to the top level.
  if ((profile as any)?.is_admin && (profile as any)?.user_type === 'internal') return 'admin';
  if ((item as any).created_by === userId) return 'admin';

  let level: LmsAccessLevel | null = null;

  // Direct user share.
  const { data: userShare } = await supabaseAdmin
    .from('lms_item_shares')
    .select('access_level')
    .eq('item_id', itemId)
    .eq('principal_type', 'user')
    .eq('principal_id', userId)
    .maybeSingle();
  if (userShare) level = maxAccess(level, (userShare as any).access_level);

  // Role shares (union across the user's primary + secondary roles).
  const roleIds = await getUserRoleIds(userId);
  if (roleIds.length) {
    const { data: roleShares } = await supabaseAdmin
      .from('lms_item_shares')
      .select('access_level')
      .eq('item_id', itemId)
      .eq('principal_type', 'role')
      .in('principal_id', roleIds);
    for (const r of roleShares || []) level = maxAccess(level, (r as any).access_level);
  }

  // User-type shares — a grant to the requesting user's own user_type.
  if (profile && (profile as any).user_type) {
    const { data: typeShares } = await supabaseAdmin
      .from('lms_item_shares')
      .select('access_level')
      .eq('item_id', itemId)
      .eq('principal_type', 'user_type')
      .eq('principal_id', userTypeShareKeyToUuid((profile as any).user_type as UserType));
    for (const t of typeShares || []) level = maxAccess(level, (t as any).access_level);
  }

  // Legacy assignment keeps read access even without a share row.
  if (!level || ACCESS_RANK[level] < ACCESS_RANK.viewer) {
    const { data: assignment } = await supabaseAdmin
      .from('lms_assignments')
      .select('id')
      .eq('item_id', itemId)
      .eq('user_id', userId)
      .maybeSingle();
    if (assignment) level = maxAccess(level, 'viewer');
  }

  return level;
}

/** Internal users flagged is_admin — the global Resources admins. */
export async function getGlobalAdminUserIds(): Promise<string[]> {
  const { data } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('is_admin', true)
    .eq('user_type', 'internal');
  return (data || []).map((r: any) => r.id);
}

/**
 * Users who can APPROVE a submission for the given live item: global admins +
 * the item owner + everyone granted per-item 'admin' (users directly, roles
 * expanded to their members). De-duplicated. `ownerId` is the live item's
 * created_by (pass the ORIGIN item for a clone).
 */
export async function getItemApproverUserIds(itemId: string, ownerId: string | null): Promise<string[]> {
  const ids = new Set<string>(await getGlobalAdminUserIds());
  if (ownerId) ids.add(ownerId);

  const { data: adminShares } = await supabaseAdmin
    .from('lms_item_shares')
    .select('principal_type, principal_id')
    .eq('item_id', itemId)
    .eq('access_level', 'admin');

  // user_type admin grants → every member of that type (like the audience).
  const typeKeys: UserType[] = [];

  for (const s of adminShares || []) {
    if ((s as any).principal_type === 'user') {
      ids.add((s as any).principal_id);
    } else if ((s as any).principal_type === 'user_type') {
      const key = userTypeShareUuidToKey((s as any).principal_id);
      if (key) typeKeys.push(key);
    } else {
      const members = await getUserIdsByRoleId((s as any).principal_id);
      for (const m of members) ids.add(m);
    }
  }

  if (typeKeys.length) {
    const { data: typeUsers } = await supabaseAdmin
      .from('users').select('id').in('user_type', typeKeys).neq('status', 'banned').neq('status', 'suspended');
    for (const u of typeUsers || []) ids.add((u as any).id);
  }

  return Array.from(ids);
}
