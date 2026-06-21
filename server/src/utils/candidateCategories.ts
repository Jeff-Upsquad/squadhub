import { supabaseAdmin } from '../supabase';
import { getUserRoleIds } from './roles';
import type { CandidatePermission, CandidateAccessMap } from '@squadhub/shared';

export const ALL_CANDIDATE_CATEGORIES = ['creative', 'accountant', 'sales'] as const;
export type CandidateCategory = (typeof ALL_CANDIDATE_CATEGORIES)[number];
export type { CandidatePermission, CandidateAccessMap };

const RANK: Record<CandidatePermission, number> = { view: 1, edit: 2, full: 3 };

/** True when `level` is present and meets or exceeds `min` (view < edit < full). */
export function meetsLevel(level: CandidatePermission | undefined, min: CandidatePermission): boolean {
  return !!level && RANK[level] >= RANK[min];
}

/** The higher of two tiers — used to merge a user's direct + role grants. */
function higher(a: CandidatePermission | undefined, b: CandidatePermission): CandidatePermission {
  return a && RANK[a] >= RANK[b] ? a : b;
}

/**
 * Candidate categories the user may access, each mapped to their permission tier.
 *
 *  - Everyone → the union of their direct grants and the grants on any of their
 *    roles, taking the HIGHEST tier per category.
 *  - Internal admins → 'full' on every category they have NOT been explicitly
 *    scoped on. An explicit grant CAPS the tier for that category, so an admin
 *    granted creative→view is read-only on creative but still full on the rest.
 *    (An admin with no grants at all keeps full access to everything.)
 *  - Non-admins with no grants → empty map (deny-by-default: no access until
 *    explicitly granted).
 *
 * Layers on top of the `candidates` mini-app grant (which gates the app itself);
 * this decides WHICH categories are visible and what may be done within each.
 */
export async function allowedCandidateCategories(
  userId: string,
  userType: string | undefined,
): Promise<CandidateAccessMap> {
  const map: CandidateAccessMap = {};
  const apply = (rows: { category: string; permission: CandidatePermission }[] | null) => {
    (rows || []).forEach((r) => {
      if ((ALL_CANDIDATE_CATEGORIES as readonly string[]).includes(r.category)) {
        map[r.category] = higher(map[r.category], r.permission);
      }
    });
  };

  // Direct user grants.
  const { data: userRows } = await supabaseAdmin
    .from('candidate_category_access')
    .select('category, permission')
    .eq('user_id', userId);
  apply(userRows as { category: string; permission: CandidatePermission }[] | null);

  // Role grants (union with direct, highest tier wins).
  const roleIds = await getUserRoleIds(userId);
  if (roleIds.length > 0) {
    const { data: roleRows } = await supabaseAdmin
      .from('candidate_category_access')
      .select('category, permission')
      .in('role_id', roleIds);
    apply(roleRows as { category: string; permission: CandidatePermission }[] | null);
  }

  // Internal admins default to 'full' on any category they have NOT been
  // explicitly scoped on; explicit grants above already capped the rest.
  if (!userType || userType === 'internal') {
    const { data: user } = await supabaseAdmin.from('users').select('is_admin').eq('id', userId).single();
    if (user?.is_admin) {
      for (const c of ALL_CANDIDATE_CATEGORIES) {
        if (!map[c]) map[c] = 'full';
      }
    }
  }

  return map;
}
