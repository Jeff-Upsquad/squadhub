import { supabaseAdmin } from '../supabase';
import {
  SKILL_CATALOG,
  getSkillDef,
  skillLevelRank,
  type SkillKey,
  type MySkills,
  type EditLoggedTimeLevel,
} from '@squadhub/shared';

/** The highest of `levels` for `key`, or null when none is a known level. */
export function highestSkillLevel(key: string, levels: (string | null | undefined)[]): string | null {
  let best: string | null = null;
  for (const level of levels) {
    if (skillLevelRank(key, level) > skillLevelRank(key, best)) best = level ?? null;
  }
  return best;
}

interface Principals {
  isAdmin: boolean;
  userType: string | null;
  roleIds: string[];
}

// Everything a grant can match a user by: the user row itself, their user
// type, and their roles (primary — or the default role when unset — plus any
// secondary roles, the same set getUserPermissions unions over).
async function loadPrincipals(userId: string): Promise<Principals> {
  const { data: user } = await supabaseAdmin
    .from('users')
    .select('is_admin, user_type')
    .eq('id', userId)
    .maybeSingle();

  const { data: membership } = await supabaseAdmin
    .from('workspace_members')
    .select('id, role, role_id')
    .eq('user_id', userId)
    .maybeSingle();

  const workspaceRole = (membership as any)?.role as string | undefined;
  const isAdmin = (user as any)?.is_admin === true
    || workspaceRole === 'admin'
    || workspaceRole === 'super_admin';

  const roleIds: string[] = [];
  if (membership) {
    let primaryRoleId = (membership as any).role_id as string | null;
    if (!primaryRoleId) {
      const { data: defaultRole } = await supabaseAdmin
        .from('roles').select('id').eq('is_default', true).maybeSingle();
      primaryRoleId = (defaultRole as any)?.id ?? null;
    }
    if (primaryRoleId) roleIds.push(primaryRoleId);

    const { data: secondary } = await supabaseAdmin
      .from('workspace_member_secondary_roles')
      .select('role_id')
      .eq('workspace_member_id', (membership as any).id);
    for (const row of (secondary || []) as any[]) {
      if (row.role_id && !roleIds.includes(row.role_id)) roleIds.push(row.role_id);
    }
  }

  return { isAdmin, userType: (user as any)?.user_type ?? null, roleIds };
}

/**
 * Effective level of every skill for a user. Admins hold the top level of
 * every skill; everyone else gets the highest grant matching them directly,
 * through a role, or through their user type.
 */
export async function getUserSkills(userId: string): Promise<MySkills> {
  const p = await loadPrincipals(userId);
  const out: MySkills = {};

  if (p.isAdmin) {
    for (const def of SKILL_CATALOG) out[def.key] = def.levels[def.levels.length - 1].value;
    return out;
  }

  const filters = [`and(principal_type.eq.user,principal_id.eq.${userId})`];
  if (p.userType) filters.push(`and(principal_type.eq.user_type,principal_id.eq.${p.userType})`);
  if (p.roleIds.length) filters.push(`and(principal_type.eq.role,principal_id.in.(${p.roleIds.join(',')}))`);

  const { data: grants } = await supabaseAdmin
    .from('skill_grants')
    .select('skill_key, level')
    .or(filters.join(','));

  for (const def of SKILL_CATALOG) {
    const levels = ((grants || []) as any[])
      .filter((g) => g.skill_key === def.key)
      .map((g) => g.level as string);
    out[def.key] = highestSkillLevel(def.key, levels);
  }
  return out;
}

export async function getUserSkillLevel(userId: string, key: SkillKey): Promise<string | null> {
  if (!getSkillDef(key)) return null;
  return (await getUserSkills(userId))[key] ?? null;
}

/**
 * Can someone holding `level` of edit_logged_time change an entry from
 * `oldSeconds` to `newSeconds`? Returns an error message, or null when allowed.
 *   - no skill → cannot change logged time at all (only add new time)
 *   - reduce   → may lower (or remove), never raise
 *   - full     → any change
 */
export function checkLoggedTimeChange(
  level: string | null,
  oldSeconds: number,
  newSeconds: number,
): string | null {
  const l = level as EditLoggedTimeLevel | null;
  if (l !== 'reduce' && l !== 'full') return 'You do not have the skill to edit logged time';
  if (l === 'reduce' && newSeconds > oldSeconds) {
    return 'You can only reduce logged time, not increase it';
  }
  return null;
}
