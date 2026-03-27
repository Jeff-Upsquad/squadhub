import { Request, Response, NextFunction } from 'express';
import { supabaseAdmin } from '../supabase';
import type { RolePermissions, AccessLevel } from '@squadhub/shared';

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
};

const ALL_TRUE_PERMISSIONS: RolePermissions = Object.fromEntries(
  Object.keys(ALL_FALSE_PERMISSIONS).map((k) => [k, true]),
) as unknown as RolePermissions;

// Access level hierarchy (higher index = more permission)
const ACCESS_LEVELS: AccessLevel[] = ['viewer', 'commenter', 'member', 'manager'];

export function accessLevelRank(level: AccessLevel): number {
  return ACCESS_LEVELS.indexOf(level);
}

export function meetsAccessLevel(userLevel: AccessLevel, requiredLevel: AccessLevel): boolean {
  return accessLevelRank(userLevel) >= accessLevelRank(requiredLevel);
}

/**
 * Fetch effective permissions for a user based on their workspace role + custom role.
 * Explicit-allow only: any missing key defaults to false.
 * Admins/super_admins get all-true.
 */
export async function getUserPermissions(userId: string): Promise<{
  permissions: RolePermissions;
  workspaceRole: string;
}> {
  // Get workspace membership and custom role
  const { data: membership } = await supabaseAdmin
    .from('workspace_members')
    .select('role, role_id, roles(permissions)')
    .eq('user_id', userId)
    .single();

  if (!membership) {
    return { permissions: ALL_FALSE_PERMISSIONS, workspaceRole: 'guest' };
  }

  const workspaceRole = membership.role as string;

  // Admins and super_admins bypass all permission checks
  if (workspaceRole === 'admin' || workspaceRole === 'super_admin') {
    return { permissions: ALL_TRUE_PERMISSIONS, workspaceRole };
  }

  // For members and guests: start from all-false, overlay only explicit true from custom role
  let customPerms = (membership as any).roles?.permissions as Record<string, boolean> | undefined;

  // Fallback: if no custom role linked, use the default role's permissions
  if (!customPerms) {
    const { data: defaultRole } = await supabaseAdmin
      .from('roles')
      .select('permissions')
      .eq('is_default', true)
      .single();
    customPerms = defaultRole?.permissions as Record<string, boolean> | undefined;
  }

  const effective: RolePermissions = { ...ALL_FALSE_PERMISSIONS };

  if (customPerms) {
    for (const key of Object.keys(ALL_FALSE_PERMISSIONS)) {
      if (customPerms[key] === true) {
        (effective as any)[key] = true;
      }
    }
  }

  return { permissions: effective, workspaceRole };
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

    const { permissions } = await getUserPermissions(req.userId);

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
  // Check if user is admin (bypass)
  const { data: membership } = await supabaseAdmin
    .from('workspace_members')
    .select('role')
    .eq('user_id', userId)
    .single();

  if (membership?.role === 'admin' || membership?.role === 'super_admin') {
    return 'manager';
  }

  // Check if user is the resource creator (always has access)
  let creatorId: string | null = null;
  if (resourceType === 'channel') {
    const { data } = await supabaseAdmin.from('channels').select('created_by').eq('id', resourceId).single();
    creatorId = data?.created_by;
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
export async function isWorkspaceAdmin(userId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('workspace_members')
    .select('role')
    .eq('user_id', userId)
    .single();
  return data?.role === 'admin' || data?.role === 'super_admin';
}
