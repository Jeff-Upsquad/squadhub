import { supabaseAdmin } from '../supabase';

/**
 * Returns the user's effective role IDs for their workspace membership:
 * [primary, ...secondaries], filtering nulls and deduplicating.
 *
 * Each entry is a `roles.id`. Call sites use `.in('role_id', ids)` to gate
 * access/permissions across all of a user's roles (primary + secondary).
 * Returns [] if the user has no workspace membership.
 */
export async function getUserRoleIds(userId: string): Promise<string[]> {
  const { data: membership } = await supabaseAdmin
    .from('workspace_members')
    .select('id, role_id')
    .eq('user_id', userId)
    .maybeSingle();

  if (!membership) return [];

  const ids = new Set<string>();
  if (membership.role_id) ids.add(membership.role_id as string);

  const { data: secondaries } = await supabaseAdmin
    .from('workspace_member_secondary_roles')
    .select('role_id')
    .eq('workspace_member_id', membership.id);

  for (const row of secondaries || []) {
    if (row.role_id) ids.add(row.role_id as string);
  }

  return Array.from(ids);
}

/**
 * Returns user IDs whose primary or secondary role matches the given role_id.
 * Used by eligibility queries (e.g. "who are all the sales people?").
 */
export async function getUserIdsByRoleId(roleId: string): Promise<string[]> {
  const ids = new Set<string>();

  const { data: primary } = await supabaseAdmin
    .from('workspace_members')
    .select('user_id')
    .eq('role_id', roleId);

  for (const row of primary || []) {
    if (row.user_id) ids.add(row.user_id as string);
  }

  const { data: secondary } = await supabaseAdmin
    .from('workspace_member_secondary_roles')
    .select('workspace_members!inner(user_id)')
    .eq('role_id', roleId);

  for (const row of (secondary || []) as any[]) {
    const uid = row.workspace_members?.user_id;
    if (uid) ids.add(uid as string);
  }

  return Array.from(ids);
}
