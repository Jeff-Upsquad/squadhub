import { supabaseAdmin } from '../supabase';
import { getUserRoleIds } from './roles';

export const ALL_CANDIDATE_CATEGORIES = ['creative', 'accountant', 'sales'] as const;
export type CandidateCategory = (typeof ALL_CANDIDATE_CATEGORIES)[number];

/**
 * Categories the user may access in the Candidates mini app.
 *
 *  - Internal admins → all.
 *  - Users with NO grant rows (direct or via any of their roles) → all
 *    (unrestricted; keeps existing users working before anyone is scoped).
 *  - Otherwise → exactly the granted categories.
 *
 * Access layers on top of the `candidates` mini-app grant (which gates the app
 * itself); this only narrows WHICH categories are visible.
 */
export async function allowedCandidateCategories(
  userId: string,
  userType: string | undefined,
): Promise<CandidateCategory[]> {
  // Internal admins always see every category.
  if (!userType || userType === 'internal') {
    const { data: user } = await supabaseAdmin.from('users').select('is_admin').eq('id', userId).single();
    if (user?.is_admin) return [...ALL_CANDIDATE_CATEGORIES];
  }

  const cats = new Set<string>();

  const { data: userRows } = await supabaseAdmin
    .from('candidate_category_access')
    .select('category')
    .eq('user_id', userId);
  (userRows || []).forEach((r: { category: string }) => cats.add(r.category));

  const roleIds = await getUserRoleIds(userId);
  if (roleIds.length > 0) {
    const { data: roleRows } = await supabaseAdmin
      .from('candidate_category_access')
      .select('category')
      .in('role_id', roleIds);
    (roleRows || []).forEach((r: { category: string }) => cats.add(r.category));
  }

  // No explicit scoping → unrestricted.
  if (cats.size === 0) return [...ALL_CANDIDATE_CATEGORIES];
  return ALL_CANDIDATE_CATEGORIES.filter((c) => cats.has(c));
}

export function isCategoryRestricted(allowed: readonly string[]): boolean {
  return allowed.length < ALL_CANDIDATE_CATEGORIES.length;
}
