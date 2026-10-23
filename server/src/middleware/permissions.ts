import { Request, Response, NextFunction } from 'express';
import { supabaseAdmin } from '../supabase';
import type { RolePermissions, AccessLevel } from '@squadhub/shared';
import { currentWorkspaceId, getMembership, workspaceIdOf } from './workspace';

// All permission keys default to false (explicit-allow only)
const ALL_FALSE_PERMISSIONS: RolePermissions = {
  can_create_channels: false,
  can_create_lists: false,
  can_create_folders: false,
  can_create_spaces: false,
  can_archive_lists: false,
  can_archive_spaces: false,
  can_archive_folders: false,
  can_delete_messages: false,
  can_edit_messages: false,
  can_send_dms: false,
  can_manage_channels: false,
  can_manage_members: false,
  can_manage_tasks: false,
  can_manage_roles: false,
  can_view_admin_panel: false,
  can_manage_workspace: false,
  can_edit_time_logs: false,
  time_edit_window_hours: 0,
  can_edit_elapsed_time: false,
};

// Boolean keys only — excludes numeric fields like time_edit_window_hours.
const BOOLEAN_PERMISSION_KEYS = Object.entries(ALL_FALSE_PERMISSIONS)
  .filter(([, v]) => typeof v === 'boolean')
  .map(([k]) => k);

const ALL_TRUE_PERMISSIONS: RolePermissions = {
  ...Object.fromEntries(BOOLEAN_PERMISSION_KEYS.map((k) => [k, true])),
  time_edit_window_hours: 0, // unlimited
} as unknown as RolePermissions;

// Access level hierarchy (higher index = more permission)
const ACCESS_LEVELS: AccessLevel[] = ['viewer', 'commenter', 'member', 'manager'];

export function accessLevelRank(level: AccessLevel): number {
  return ACCESS_LEVELS.indexOf(level);
}

export function meetsAccessLevel(userLevel: AccessLevel, requiredLevel: AccessLevel): boolean {
  return accessLevelRank(userLevel) >= accessLevelRank(requiredLevel);
}

/**
 * Fetch effective permissions for a user based on their workspace role + custom roles.
 * Explicit-allow only: any missing key defaults to false.
 * Admins/super_admins get all-true.
 *
 * Multi-role: a user has one primary role (`workspace_members.role_id`) and zero or
 * more secondary roles (`workspace_member_secondary_roles`). The effective permissions
 * are the UNION across primary + all secondaries. Default-role fallback applies only
 * when the primary is null (secondaries never trigger fallback).
 */
export async function getUserPermissions(userId: string, workspaceId?: string | null): Promise<{
  permissions: RolePermissions;
  workspaceRole: string;
}> {
  // SaaS: permissions are per workspace (account). Default to the request's
  // active workspace; with none, the user has no workspace-level permissions.
  const wsId = workspaceId || currentWorkspaceId();
  if (!wsId) return { permissions: ALL_FALSE_PERMISSIONS, workspaceRole: 'guest' };

  const { data: membership } = await supabaseAdmin
    .from('workspace_members')
    .select('id, role, role_id, roles(permissions)')
    .eq('workspace_id', wsId)
    .eq('user_id', userId)
    .maybeSingle();

  if (!membership) {
    // Shared-workspace access through a linked participant account.
    const shared = await getMembership(userId, wsId);
    if (!shared) return { permissions: ALL_FALSE_PERMISSIONS, workspaceRole: 'guest' };
    return { permissions: { ...ALL_FALSE_PERMISSIONS, can_send_dms: true, can_create_lists: true, can_manage_tasks: true }, workspaceRole: 'member' };
  }

  const workspaceRole = membership.role as string;

  if (workspaceRole === 'owner' || workspaceRole === 'admin' || workspaceRole === 'super_admin') {
    return { permissions: ALL_TRUE_PERMISSIONS, workspaceRole };
  }

  const permSets: Record<string, boolean>[] = [];

  let primaryPerms = (membership as any).roles?.permissions as Record<string, boolean> | undefined;
  if (!primaryPerms) {
    const { data: defaultRole } = await supabaseAdmin
      .from('roles')
      .select('permissions')
      .eq('is_default', true)
      .single();
    primaryPerms = defaultRole?.permissions as Record<string, boolean> | undefined;
  }
  if (primaryPerms) permSets.push(primaryPerms);

  const { data: secondaryRows } = await supabaseAdmin
    .from('workspace_member_secondary_roles')
    .select('roles(permissions)')
    .eq('workspace_member_id', (membership as any).id);

  for (const row of (secondaryRows || []) as any[]) {
    const perms = row.roles?.permissions as Record<string, boolean> | undefined;
    if (perms) permSets.push(perms);
  }

  const effective: RolePermissions = { ...ALL_FALSE_PERMISSIONS };
  for (const perms of permSets) {
    for (const key of BOOLEAN_PERMISSION_KEYS) {
      if (perms[key] === true) (effective as any)[key] = true;
    }
  }

  return { permissions: effective, workspaceRole };
}

/**
 * Fetch permissions derived from the user's PRIMARY role only (no union with
 * secondary roles). Used for settings that must not be unlocked by a secondary
 * role — e.g. editing time logs.
 *
 * Admins/super_admins still get all-true, matching the broader bypass pattern.
 */
export async function getPrimaryRolePermissions(userId: string, workspaceId?: string | null): Promise<RolePermissions> {
  const wsId = workspaceId || currentWorkspaceId();
  if (!wsId) return { ...ALL_FALSE_PERMISSIONS };
  const { data: membership } = await supabaseAdmin
    .from('workspace_members')
    .select('role, role_id, roles(permissions)')
    .eq('workspace_id', wsId)
    .eq('user_id', userId)
    .maybeSingle();

  if (!membership) return { ...ALL_FALSE_PERMISSIONS };

  const workspaceRole = (membership as any).role as string;
  if (workspaceRole === 'owner' || workspaceRole === 'admin' || workspaceRole === 'super_admin') {
    return { ...ALL_TRUE_PERMISSIONS };
  }

  let primary = (membership as any).roles?.permissions as Record<string, unknown> | undefined;
  if (!primary) {
    const { data: defaultRole } = await supabaseAdmin
      .from('roles')
      .select('permissions')
      .eq('is_default', true)
      .single();
    primary = defaultRole?.permissions as Record<string, unknown> | undefined;
  }

  const out: RolePermissions = { ...ALL_FALSE_PERMISSIONS };
  if (primary) {
    for (const key of BOOLEAN_PERMISSION_KEYS) {
      if (primary[key] === true) (out as any)[key] = true;
    }
    if (typeof primary.time_edit_window_hours === 'number') {
      out.time_edit_window_hours = primary.time_edit_window_hours;
    }
  }
  return out;
}

/**
 * Middleware: require a specific workspace-level permission flag.
 * Returns 403 if the flag is not explicitly true.
 */
export function requirePermission(permissionKey: keyof RolePermissions) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.userId) {
      res.status(401).json({ success: false, error: 'Not authenticated' });
      return;
    }

    // The workspace the action targets: the one the body's container
    // (space/folder/list/channel) lives in — permissions are evaluated where the
    // write lands, never in whichever workspace happens to be active — else the
    // body's workspace_id (requireAuth already held it equal to the header),
    // else the active workspace.
    let wsId: string | null = null;
    const b = (req.body || {}) as Record<string, unknown>;
    if (typeof b.space_id === 'string') wsId = await workspaceIdOf('space', b.space_id);
    else if (typeof b.folder_id === 'string') wsId = await workspaceIdOf('folder', b.folder_id);
    else if (typeof b.list_id === 'string') wsId = await workspaceIdOf('list', b.list_id);
    else if (typeof b.channel_id === 'string') wsId = await workspaceIdOf('channel', b.channel_id);
    else if (typeof b.workspace_id === 'string') {
      wsId = (await getMembership(req.userId, b.workspace_id)) ? b.workspace_id : null;
    } else wsId = req.workspaceId ?? null;
    if (!wsId) {
      res.status(403).json({ success: false, error: `Permission denied: ${permissionKey} is required` });
      return;
    }
    const { permissions } = await getUserPermissions(req.userId, wsId);

    if (!permissions[permissionKey]) {
      res.status(403).json({
        success: false,
        error: `Permission denied: ${permissionKey} is required`,
      });
      return;
    }

    next();
  };
}

/**
 * Check if a user has access to a specific resource at the given minimum level.
 * Returns the user's access level or null if no access.
 * Admins/super_admins always get 'manager' access.
 */
export async function checkResourceAccess(
  userId: string,
  resourceType: string,
  resourceId: string,
): Promise<AccessLevel | null> {
  // Tenant wall: the resource's workspace must be one the user can reach
  // (directly or through a shared-workspace link). Nothing below runs otherwise.
  const resourceWs = await workspaceIdOf(resourceType, resourceId);
  if (!resourceWs) return null;
  const membership = await getMembership(userId, resourceWs);
  if (!membership) return null;

  // Owners/admins of THAT workspace manage everything in it.
  if (membership.role === 'owner' || membership.role === 'admin') {
    return 'manager';
  }

  // Check if user is the resource creator (always has access)
  let creatorId: string | null = null;
  let publicChannel = false;
  if (resourceType === 'channel') {
    const { data } = await supabaseAdmin.from('channels').select('created_by, is_private').eq('id', resourceId).single();
    creatorId = data?.created_by;
    publicChannel = data?.is_private === false;
  } else if (resourceType === 'space') {
    const { data } = await supabaseAdmin.from('spaces').select('created_by').eq('id', resourceId).single();
    creatorId = data?.created_by;
  } else if (resourceType === 'folder') {
    const { data } = await supabaseAdmin.from('folders').select('created_by').eq('id', resourceId).single();
    creatorId = data?.created_by;
  } else if (resourceType === 'list') {
    const { data } = await supabaseAdmin.from('lists').select('created_by').eq('id', resourceId).single();
    creatorId = data?.created_by;
  }

  if (creatorId === userId) {
    return 'manager';
  }

  // Check direct membership
  const { data: rm } = await supabaseAdmin
    .from('resource_memberships')
    .select('access_level')
    .eq('resource_type', resourceType)
    .eq('resource_id', resourceId)
    .eq('user_id', userId)
    .single();

  if (rm) {
    return rm.access_level as AccessLevel;
  }

  // Public channels are open to every member of their workspace (not guests).
  if (publicChannel && membership.role !== 'guest') return 'member';

  // Inheritance: folder inherits from space, list inherits from folder then space
  if (resourceType === 'folder') {
    const { data: folder } = await supabaseAdmin.from('folders').select('space_id').eq('id', resourceId).single();
    if (folder) {
      return checkResourceAccess(userId, 'space', folder.space_id);
    }
  }

  if (resourceType === 'list') {
    const { data: list } = await supabaseAdmin.from('lists').select('space_id, folder_id').eq('id', resourceId).single();
    if (list) {
      if (list.folder_id) {
        const folderAccess = await checkResourceAccess(userId, 'folder', list.folder_id);
        if (folderAccess) return folderAccess;
      }
      return checkResourceAccess(userId, 'space', list.space_id);
    }
  }

  return null;
}

/**
 * Middleware: require minimum access level on a resource.
 * Expects resource ID from req.params.id or req.body fields.
 */
export function requireResourceAccess(resourceType: string, minLevel: AccessLevel) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.userId) {
      res.status(401).json({ success: false, error: 'Not authenticated' });
      return;
    }

    // Determine resource ID from params or body
    let resourceId = req.params.id;
    if (!resourceId) {
      if (resourceType === 'channel') resourceId = req.body.channel_id;
      else if (resourceType === 'space') resourceId = req.body.space_id;
      else if (resourceType === 'folder') resourceId = req.body.folder_id;
      else if (resourceType === 'list') resourceId = req.body.list_id;
    }

    if (!resourceId) {
      res.status(400).json({ success: false, error: `${resourceType}_id is required` });
      return;
    }

    const userLevel = await checkResourceAccess(req.userId!, resourceType, resourceId as string);

    if (!userLevel || !meetsAccessLevel(userLevel, minLevel)) {
      res.status(403).json({
        success: false,
        error: `Requires ${minLevel} access to this ${resourceType}`,
      });
      return;
    }

    // Attach access level to request for downstream use
    (req as any).resourceAccessLevel = userLevel;
    next();
  };
}

/**
 * Check if user is admin/super_admin (workspace-level)
 */
export async function isWorkspaceAdmin(userId: string, workspaceId?: string | null): Promise<boolean> {
  // Owner/admin of the given workspace, defaulting to the request's active
  // workspace (X-Workspace-Id). Never true without a workspace.
  const wsId = workspaceId || currentWorkspaceId();
  if (!wsId) return false;
  const m = await getMembership(userId, wsId);
  return m?.role === 'owner' || m?.role === 'admin';
}

/**
 * Owner/admin of the workspace the RESOURCE lives in. Use this — never the
 * request's active workspace — for admin bypasses on a specific resource
 * (locks, delete-anyone's, manage): an admin of workspace A must not bypass
 * anything in workspace B just because A is the active workspace.
 */
export async function isAdminOfResource(userId: string, resourceType: string, resourceId: string): Promise<boolean> {
  const wsId = await workspaceIdOf(resourceType, resourceId);
  if (!wsId) return false;
  return isWorkspaceAdmin(userId, wsId);
}

/**
 * Check if a resource (space/folder/list) is locked.
 * Also checks parent resources: a list is locked if its folder or space is locked.
 */
export async function isResourceLocked(resourceType: string, resourceId: string): Promise<boolean> {
  if (resourceType === 'space') {
    const { data } = await supabaseAdmin.from('spaces').select('is_locked').eq('id', resourceId).single();
    return data?.is_locked === true;
  }

  if (resourceType === 'folder') {
    const { data } = await supabaseAdmin.from('folders').select('is_locked, space_id').eq('id', resourceId).single();
    if (!data) return false;
    if (data.is_locked) return true;
    return isResourceLocked('space', data.space_id);
  }

  if (resourceType === 'list') {
    const { data } = await supabaseAdmin.from('lists').select('is_locked, space_id, folder_id').eq('id', resourceId).single();
    if (!data) return false;
    if (data.is_locked) return true;
    if (data.folder_id) {
      const folderLocked = await isResourceLocked('folder', data.folder_id);
      if (folderLocked) return true;
    }
    return isResourceLocked('space', data.space_id);
  }

  return false;
}

/**
 * For a user with NO space-level access, compute which folders / lists *inside*
 * a given space they can reach via direct resource_memberships. Used to scope
 * the space-detail view and the partner shared-tree to only shared descendants
 * (e.g. a partner who was granted specific client folders / design spaces but
 * not the parent area). Membership inheritance flows folder→space and list→
 * folder→space, so when the space itself isn't accessible only *direct*
 * folder/list grants count — exactly the "only individually-shared" semantics.
 */
export async function getAccessibleDescendants(
  userId: string,
  spaceId: string,
): Promise<{ folderLevels: Map<string, AccessLevel>; listLevels: Map<string, AccessLevel> }> {
  const folderLevels = new Map<string, AccessLevel>();
  const listLevels = new Map<string, AccessLevel>();

  // Tenant wall: leftover resource_memberships grant nothing once the user can
  // no longer reach the space's workspace (e.g. removed from a shared workspace).
  const spaceWs = await workspaceIdOf('space', spaceId);
  if (!spaceWs || !(await getMembership(userId, spaceWs))) return { folderLevels, listLevels };

  const [{ data: folders }, { data: lists }] = await Promise.all([
    supabaseAdmin.from('folders').select('id').eq('workspace_id', spaceWs).eq('space_id', spaceId).is('deleted_at', null),
    supabaseAdmin.from('lists').select('id').eq('workspace_id', spaceWs).eq('space_id', spaceId).is('deleted_at', null),
  ]);

  const folderIds = (folders || []).map((f: any) => f.id);
  const listIds = (lists || []).map((l: any) => l.id);

  if (folderIds.length > 0) {
    const { data: fm } = await supabaseAdmin
      .from('resource_memberships')
      .select('resource_id, access_level')
      .eq('resource_type', 'folder')
      .eq('user_id', userId)
      .in('resource_id', folderIds);
    for (const m of fm || []) folderLevels.set(m.resource_id as string, m.access_level as AccessLevel);
  }

  if (listIds.length > 0) {
    const { data: lm } = await supabaseAdmin
      .from('resource_memberships')
      .select('resource_id, access_level')
      .eq('resource_type', 'list')
      .eq('user_id', userId)
      .in('resource_id', listIds);
    for (const m of lm || []) listLevels.set(m.resource_id as string, m.access_level as AccessLevel);
  }

  return { folderLevels, listLevels };
}
