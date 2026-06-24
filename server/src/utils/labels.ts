import { supabaseAdmin } from '../supabase';
import { getUserRoleIds } from './roles';

/** Platform admin flag (users.is_admin) — the bypass used across label gating. */
export async function isPlatformAdmin(userId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('users')
    .select('is_admin')
    .eq('id', userId)
    .maybeSingle();
  return !!(data as any)?.is_admin;
}

/** Resolve the workspace a task belongs to via list → space. */
export async function getWorkspaceIdForTask(taskId: string): Promise<string | null> {
  const { data: task } = await supabaseAdmin
    .from('tasks')
    .select('list_id')
    .eq('id', taskId)
    .maybeSingle();
  if (!task?.list_id) return null;
  const { data: list } = await supabaseAdmin
    .from('lists')
    .select('space_id')
    .eq('id', task.list_id as string)
    .maybeSingle();
  if (!list?.space_id) return null;
  const { data: space } = await supabaseAdmin
    .from('spaces')
    .select('workspace_id')
    .eq('id', list.space_id as string)
    .maybeSingle();
  return (space as any)?.workspace_id ?? null;
}

/**
 * Resolve the workspace an admin operates on: their first membership, else the
 * oldest workspace (platform admins may not be workspace_members themselves).
 * Mirrors the resolution used in client-spaces-admin.ts.
 */
export async function getAdminWorkspaceId(userId: string): Promise<string | null> {
  const { data: wm } = await supabaseAdmin
    .from('workspace_members')
    .select('workspace_id')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (wm?.workspace_id) return wm.workspace_id as string;
  const { data: ws } = await supabaseAdmin
    .from('workspaces')
    .select('id')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  return (ws as any)?.id ?? null;
}

/**
 * IDs of label groups visible to a user in a workspace.
 * Admin → every group. Otherwise: the default "General" group(s) plus any group
 * granted to one of the user's roles or to the user directly.
 */
export async function visibleGroupIds(
  userId: string,
  workspaceId: string,
  opts?: { isAdmin?: boolean },
): Promise<string[]> {
  const { data: groups } = await supabaseAdmin
    .from('label_groups')
    .select('id, is_default')
    .eq('workspace_id', workspaceId);
  const all = groups || [];
  const isAdmin = opts?.isAdmin ?? (await isPlatformAdmin(userId));
  if (isAdmin) return all.map((g: any) => g.id);

  const visible = new Set<string>();
  for (const g of all) if ((g as any).is_default) visible.add((g as any).id);

  const allIds = all.map((g: any) => g.id);
  if (allIds.length) {
    const { data: ua } = await supabaseAdmin
      .from('label_group_user_access')
      .select('group_id')
      .eq('user_id', userId)
      .in('group_id', allIds);
    (ua || []).forEach((r: any) => visible.add(r.group_id));

    const roleIds = await getUserRoleIds(userId);
    if (roleIds.length) {
      const { data: ra } = await supabaseAdmin
        .from('label_group_role_access')
        .select('group_id')
        .in('role_id', roleIds)
        .in('group_id', allIds);
      (ra || []).forEach((r: any) => visible.add(r.group_id));
    }
  }
  return Array.from(visible);
}

/** Whether the user may create labels: admin, or granted by role/user. */
export async function canCreateLabels(
  userId: string,
  workspaceId: string,
  opts?: { isAdmin?: boolean },
): Promise<boolean> {
  const isAdmin = opts?.isAdmin ?? (await isPlatformAdmin(userId));
  if (isAdmin) return true;

  const { data: ua } = await supabaseAdmin
    .from('label_create_user_access')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .maybeSingle();
  if (ua) return true;

  const roleIds = await getUserRoleIds(userId);
  if (roleIds.length) {
    const { data: ra } = await supabaseAdmin
      .from('label_create_role_access')
      .select('id')
      .eq('workspace_id', workspaceId)
      .in('role_id', roleIds)
      .limit(1);
    if (ra && ra.length) return true;
  }
  return false;
}

/** The workspace's default ("General") label group id. */
export async function getDefaultGroupId(workspaceId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('label_groups')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('is_default', true)
    .maybeSingle();
  return (data as any)?.id ?? null;
}
