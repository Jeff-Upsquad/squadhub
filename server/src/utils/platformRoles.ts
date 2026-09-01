import { supabaseAdmin } from '../supabase';
import type { UserType } from '@squadhub/shared';
import { getDefaultRoleIdForUserType } from './defaultRole';

type SystemRoleKey = 'admin' | 'manager' | 'member';

async function getSystemRoleId(key: SystemRoleKey): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from('roles')
    .select('id')
    .eq('system_key', key)
    .maybeSingle();
  if (error || !data?.id) {
    throw new Error(`The ${key} system role is not available. Run the role hierarchy migration first.`);
  }
  return data.id as string;
}

export async function getRoleSystemKey(roleId: string | null | undefined): Promise<string | null> {
  if (!roleId) return null;
  const { data, error } = await supabaseAdmin
    .from('roles')
    .select('system_key')
    .eq('id', roleId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.system_key as string | null | undefined) ?? null;
}

/**
 * Promote an Internal user to the protected Admin role without discarding the
 * role they already hold. The original primary is stored both as a secondary
 * (preserving effective access) and in an exact backup (for later demotion).
 */
export async function promotePlatformAdmin(userId: string): Promise<void> {
  const adminRoleId = await getSystemRoleId('admin');
  const { error: userError } = await supabaseAdmin
    .from('users')
    .update({ is_admin: true })
    .eq('id', userId);
  if (userError) throw new Error(userError.message);

  const { data: memberships, error } = await supabaseAdmin
    .from('workspace_members')
    .select('id, role, role_id')
    .eq('user_id', userId);
  if (error) throw new Error(error.message);

  if (!memberships?.length) {
    const { data: workspace, error: workspaceError } = await supabaseAdmin
      .from('workspaces')
      .select('id')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (workspaceError || !workspace) {
      throw new Error(workspaceError?.message || 'No workspace is available for the Admin role');
    }
    const { error: insertError } = await supabaseAdmin.from('workspace_members').insert({
      workspace_id: workspace.id,
      user_id: userId,
      role: 'admin',
      role_id: adminRoleId,
    });
    if (insertError) throw new Error(insertError.message);
    return;
  }

  for (const membership of memberships || []) {
    const { error: backupError } = await supabaseAdmin
      .from('platform_admin_role_backups')
      .upsert(
        {
          workspace_member_id: membership.id,
          user_id: userId,
          previous_workspace_role: membership.role,
          previous_role_id: membership.role_id,
        },
        { onConflict: 'workspace_member_id', ignoreDuplicates: true },
      );
    if (backupError) throw new Error(backupError.message);

    if (membership.role_id && membership.role_id !== adminRoleId) {
      const { error: secondaryError } = await supabaseAdmin
        .from('workspace_member_secondary_roles')
        .upsert(
          { workspace_member_id: membership.id, role_id: membership.role_id },
          { onConflict: 'workspace_member_id,role_id', ignoreDuplicates: true },
        );
      if (secondaryError) throw new Error(secondaryError.message);
    }

    const { error: memberError } = await supabaseAdmin
      .from('workspace_members')
      .update({ role: 'admin', role_id: adminRoleId })
      .eq('id', membership.id);
    if (memberError) throw new Error(memberError.message);
  }
}

/** Restore the precise workspace role held before promotion. New admins that
 * have no backup are demoted to Managers, the level immediately below Admin. */
export async function demotePlatformAdmin(userId: string): Promise<void> {
  const [adminRoleId, managerRoleId] = await Promise.all([
    getSystemRoleId('admin'),
    getSystemRoleId('manager'),
  ]);
  const { data: memberships, error } = await supabaseAdmin
    .from('workspace_members')
    .select('id')
    .eq('user_id', userId);
  if (error) throw new Error(error.message);

  for (const membership of memberships || []) {
    const { data: backup, error: backupError } = await supabaseAdmin
      .from('platform_admin_role_backups')
      .select('previous_workspace_role, previous_role_id')
      .eq('workspace_member_id', membership.id)
      .maybeSingle();
    if (backupError) throw new Error(backupError.message);

    // A backup row with a null role_id is still an exact backup. Only users
    // promoted before backups existed should fall back to Managers.
    const restoredRoleId = backup
      ? (backup.previous_role_id as string | null)
      : managerRoleId;
    const restoredWorkspaceRole = backup
      ? (backup.previous_workspace_role as string)
      : 'member';

    const { error: memberError } = await supabaseAdmin
      .from('workspace_members')
      .update({ role: restoredWorkspaceRole, role_id: restoredRoleId })
      .eq('id', membership.id);
    if (memberError) throw new Error(memberError.message);

    const secondaryRoleIds = [adminRoleId, restoredRoleId].filter(
      (roleId): roleId is string => Boolean(roleId),
    );
    const { error: secondaryError } = await supabaseAdmin
      .from('workspace_member_secondary_roles')
      .delete()
      .eq('workspace_member_id', membership.id)
      .in('role_id', secondaryRoleIds);
    if (secondaryError) throw new Error(secondaryError.message);
  }

  const { error: userError } = await supabaseAdmin
    .from('users')
    .update({ is_admin: false })
    .eq('id', userId);
  if (userError) throw new Error(userError.message);

  // Keep backups until the durable authorization flag is successfully
  // cleared. If that update fails, a retry can still restore the exact role.
  const { error: backupDeleteError } = await supabaseAdmin
    .from('platform_admin_role_backups')
    .delete()
    .eq('user_id', userId);
  if (backupDeleteError) throw new Error(backupDeleteError.message);
}

/** Remove Internal-only Admin/Managers roles when a user becomes external. */
export async function normalizeRolesForUserType(userId: string, userType: UserType): Promise<void> {
  if (userType === 'internal') return;

  const [adminRoleId, managerRoleId, fallbackRoleId] = await Promise.all([
    getSystemRoleId('admin'),
    getSystemRoleId('manager'),
    getDefaultRoleIdForUserType(userType),
  ]);
  if (!fallbackRoleId) throw new Error(`No default role is available for ${userType}`);

  const { data: memberships, error } = await supabaseAdmin
    .from('workspace_members')
    .select('id, role_id')
    .eq('user_id', userId);
  if (error) throw new Error(error.message);

  for (const membership of memberships || []) {
    if (membership.role_id === adminRoleId || membership.role_id === managerRoleId) {
      const { error: memberError } = await supabaseAdmin
        .from('workspace_members')
        .update({ role: 'member', role_id: fallbackRoleId })
        .eq('id', membership.id);
      if (memberError) throw new Error(memberError.message);
    }
    const { error: secondaryError } = await supabaseAdmin
      .from('workspace_member_secondary_roles')
      .delete()
      .eq('workspace_member_id', membership.id)
      .in('role_id', [adminRoleId, managerRoleId]);
    if (secondaryError) throw new Error(secondaryError.message);
  }
}
