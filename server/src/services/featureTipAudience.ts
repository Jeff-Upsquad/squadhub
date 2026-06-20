// Audience resolution for Feature Tips.
//
// A tip's `audience` is a filter (see FeatureTipAudience). An empty filter ({})
// means ALL active users. Otherwise filters are OR-unioned: a user is in the
// audience if they match ANY specified key (user_type / workspace role / custom
// role / department / explicit user id). Only `status='active'` users count.
//
// Two entry points:
//   resolveAudience(audience)            -> all matching user ids (admin roster)
//   getUserAudienceContext + matchesAudience(ctx, audience)
//                                        -> cheap per-user check (client /pending)
import { supabaseAdmin } from '../supabase';
import type { FeatureTipAudience, UserType } from '@squadhub/shared';

export function isEmptyAudience(a: FeatureTipAudience | null | undefined): boolean {
  if (!a) return true;
  return !(
    a.user_types?.length ||
    a.workspace_roles?.length ||
    a.role_ids?.length ||
    a.department_ids?.length ||
    a.user_ids?.length
  );
}

/** All active user ids matching the audience (used for the admin roster denominator). */
export async function resolveAudience(
  audience: FeatureTipAudience | null | undefined,
): Promise<string[]> {
  const { data: activeUsers, error } = await supabaseAdmin
    .from('users')
    .select('id, user_type')
    .eq('status', 'active');
  if (error || !activeUsers) return [];
  const activeIds = new Set<string>(activeUsers.map((u: any) => u.id));

  if (isEmptyAudience(audience)) return [...activeIds];
  const a = audience!;
  const matched = new Set<string>();

  // explicit user ids
  for (const id of a.user_ids ?? []) if (activeIds.has(id)) matched.add(id);

  // user types
  if (a.user_types?.length) {
    for (const u of activeUsers as any[]) {
      if (a.user_types.includes(u.user_type)) matched.add(u.id);
    }
  }

  // workspace roles (super_admin | admin | member | guest)
  if (a.workspace_roles?.length) {
    const { data } = await supabaseAdmin
      .from('workspace_members')
      .select('user_id')
      .in('role', a.workspace_roles);
    for (const m of (data ?? []) as any[]) if (activeIds.has(m.user_id)) matched.add(m.user_id);
  }

  // custom role ids — primary (workspace_members.role_id) + secondary
  if (a.role_ids?.length) {
    const { data: prim } = await supabaseAdmin
      .from('workspace_members')
      .select('user_id')
      .in('role_id', a.role_ids);
    for (const m of (prim ?? []) as any[]) if (activeIds.has(m.user_id)) matched.add(m.user_id);

    const { data: sec } = await supabaseAdmin
      .from('workspace_member_secondary_roles')
      .select('workspace_member_id')
      .in('role_id', a.role_ids);
    const memberIds = (sec ?? []).map((r: any) => r.workspace_member_id).filter(Boolean);
    if (memberIds.length) {
      const { data: members } = await supabaseAdmin
        .from('workspace_members')
        .select('user_id')
        .in('id', memberIds);
      for (const m of (members ?? []) as any[]) if (activeIds.has(m.user_id)) matched.add(m.user_id);
    }
  }

  // departments
  if (a.department_ids?.length) {
    const { data } = await supabaseAdmin
      .from('department_members')
      .select('user_id')
      .in('department_id', a.department_ids);
    for (const m of (data ?? []) as any[]) if (activeIds.has(m.user_id)) matched.add(m.user_id);
  }

  return [...matched];
}

export interface UserAudienceContext {
  userId: string;
  userType: UserType | null;
  active: boolean;
  workspaceRoles: string[]; // role enum values
  roleIds: string[]; // primary + secondary custom role ids
  departmentIds: string[];
}

/** One round-trip bundle of a single user's audience attributes. */
export async function getUserAudienceContext(userId: string): Promise<UserAudienceContext> {
  const { data: user } = await supabaseAdmin
    .from('users')
    .select('user_type, status')
    .eq('id', userId)
    .single();

  const { data: members } = await supabaseAdmin
    .from('workspace_members')
    .select('id, role, role_id')
    .eq('user_id', userId);

  const workspaceRoles = [...new Set((members ?? []).map((m: any) => m.role).filter(Boolean))];
  const roleIds = new Set<string>();
  for (const m of (members ?? []) as any[]) if (m.role_id) roleIds.add(m.role_id);

  const memberIds = (members ?? []).map((m: any) => m.id);
  if (memberIds.length) {
    const { data: sec } = await supabaseAdmin
      .from('workspace_member_secondary_roles')
      .select('role_id')
      .in('workspace_member_id', memberIds);
    for (const s of (sec ?? []) as any[]) if (s.role_id) roleIds.add(s.role_id);
  }

  const { data: depts } = await supabaseAdmin
    .from('department_members')
    .select('department_id')
    .eq('user_id', userId);

  return {
    userId,
    userType: (user?.user_type as UserType) ?? null,
    active: user?.status === 'active',
    workspaceRoles,
    roleIds: [...roleIds],
    departmentIds: (depts ?? []).map((d: any) => d.department_id),
  };
}

/** Pure check of a pre-fetched user context against a tip's audience. */
export function matchesAudience(
  ctx: UserAudienceContext,
  audience: FeatureTipAudience | null | undefined,
): boolean {
  if (!ctx.active) return false;
  if (isEmptyAudience(audience)) return true;
  const a = audience!;
  if (ctx.userId && a.user_ids?.includes(ctx.userId)) return true;
  if (a.user_types?.length && ctx.userType && a.user_types.includes(ctx.userType)) return true;
  if (a.workspace_roles?.length && ctx.workspaceRoles.some((r) => (a.workspace_roles as string[]).includes(r)))
    return true;
  if (a.role_ids?.length && ctx.roleIds.some((r) => a.role_ids!.includes(r))) return true;
  if (a.department_ids?.length && ctx.departmentIds.some((d) => a.department_ids!.includes(d)))
    return true;
  return false;
}
