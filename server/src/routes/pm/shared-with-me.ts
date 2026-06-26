import { Router, Request, Response } from 'express';
import { supabaseAdmin } from '../../supabase';
import { requireAuth } from '../../middleware/auth';
import { requireUserType } from '../../middleware/userType';
import { PARTNER_USER_TYPES } from '@squadhub/shared';

const router = Router();
router.use(requireAuth);
router.use(requireUserType('internal', ...PARTNER_USER_TYPES, 'client', 'client_staff'));

// GET /pm/shared-with-me?workspace_id=xxx
// Returns lists and folders the user has direct membership on
// but whose parent space is NOT in their accessible space set.
router.get('/shared-with-me', async (req: Request, res: Response) => {
  try {
    const workspaceId = req.query.workspace_id as string;
    if (!workspaceId) {
      res.status(400).json({ success: false, error: 'workspace_id is required' });
      return;
    }

    const userId = req.userId!;

    // 1. Get all space IDs in this workspace (for scoping lists/folders)
    //    and the subset the user can access (membership + created)
    const [{ data: allWorkspaceSpaces }, { data: spaceMemberships }] = await Promise.all([
      supabaseAdmin
        .from('spaces')
        .select('id, created_by')
        .eq('workspace_id', workspaceId)
        .is('deleted_at', null),
      supabaseAdmin
        .from('resource_memberships')
        .select('resource_id')
        .eq('resource_type', 'space')
        .eq('user_id', userId),
    ]);

    const workspaceSpaceIds = new Set((allWorkspaceSpaces || []).map((s: any) => s.id));
    const accessibleSpaceIds = new Set([
      ...(spaceMemberships || []).map((m: any) => m.resource_id),
      ...(allWorkspaceSpaces || []).filter((s: any) => s.created_by === userId).map((s: any) => s.id),
    ]);

    // 2. Get direct list memberships for this user
    const { data: listMemberships } = await supabaseAdmin
      .from('resource_memberships')
      .select('id, resource_id, access_level, invited_by, created_at')
      .eq('resource_type', 'list')
      .eq('user_id', userId);

    // 3. Get direct folder memberships for this user
    const { data: folderMemberships } = await supabaseAdmin
      .from('resource_memberships')
      .select('id, resource_id, access_level, invited_by, created_at')
      .eq('resource_type', 'folder')
      .eq('user_id', userId);

    const items: any[] = [];

    // 4. Enrich lists — only include those in this workspace whose parent space is NOT accessible
    if (listMemberships && listMemberships.length > 0) {
      const listIds = listMemberships.map((m: any) => m.resource_id);
      const { data: lists } = await supabaseAdmin
        .from('lists')
        .select('id, name, space_id, folder_id')
        .in('id', listIds)
        .eq('status', 'active')
        .is('deleted_at', null);

      for (const list of lists || []) {
        if (workspaceSpaceIds.has(list.space_id) && !accessibleSpaceIds.has(list.space_id)) {
          const membership = listMemberships.find((m: any) => m.resource_id === list.id)!;
          items.push({
            id: membership.id,
            resource_type: 'list' as const,
            resource_id: list.id,
            resource_name: list.name,
            access_level: membership.access_level,
            space_id: list.space_id,
            folder_id: list.folder_id,
            invited_by: membership.invited_by,
            created_at: membership.created_at,
          });
        }
      }
    }

    // 5. Enrich folders — only include those in this workspace whose parent space is NOT accessible
    if (folderMemberships && folderMemberships.length > 0) {
      const folderIds = folderMemberships.map((m: any) => m.resource_id);
      const { data: folders } = await supabaseAdmin
        .from('folders')
        .select('id, name, space_id')
        .in('id', folderIds)
        .eq('status', 'active')
        .is('deleted_at', null);

      for (const folder of folders || []) {
        if (workspaceSpaceIds.has(folder.space_id) && !accessibleSpaceIds.has(folder.space_id)) {
          const membership = folderMemberships.find((m: any) => m.resource_id === folder.id)!;
          items.push({
            id: membership.id,
            resource_type: 'folder' as const,
            resource_id: folder.id,
            resource_name: folder.name,
            access_level: membership.access_level,
            space_id: folder.space_id,
            folder_id: null,
            invited_by: membership.invited_by,
            created_at: membership.created_at,
          });
        }
      }
    }

    // Sort by most recently shared first
    items.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    res.json({ success: true, data: items });
  } catch (err) {
    console.error('GET /pm/shared-with-me error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /pm/shared-tree?workspace_id=xxx
// Enriched, navigable version of shared-with-me for partner-tier users: the
// folders/lists shared with them (whose parent area isn't shared) returned as
// ready-to-render roots for the AREAS section. Client folders carry the child
// design/video spaces the user was individually granted; regular shared folders
// (and orphan shared design spaces) carry their accessible lists.
router.get('/shared-tree', async (req: Request, res: Response) => {
  try {
    const workspaceId = req.query.workspace_id as string;
    if (!workspaceId) {
      res.status(400).json({ success: false, error: 'workspace_id is required' });
      return;
    }

    const userId = req.userId!;

    // 1. Workspace spaces + the subset the user can access (membership or created).
    const [{ data: allWorkspaceSpaces }, { data: spaceMemberships }] = await Promise.all([
      supabaseAdmin
        .from('spaces')
        .select('id, created_by')
        .eq('workspace_id', workspaceId)
        .is('deleted_at', null),
      supabaseAdmin
        .from('resource_memberships')
        .select('resource_id')
        .eq('resource_type', 'space')
        .eq('user_id', userId),
    ]);

    const workspaceSpaceIds = new Set((allWorkspaceSpaces || []).map((s: any) => s.id));
    const accessibleSpaceIds = new Set([
      ...(spaceMemberships || []).map((m: any) => m.resource_id),
      ...(allWorkspaceSpaces || []).filter((s: any) => s.created_by === userId).map((s: any) => s.id),
    ]);

    // 2. Direct folder + list memberships.
    const [{ data: folderMemberships }, { data: listMemberships }] = await Promise.all([
      supabaseAdmin
        .from('resource_memberships')
        .select('resource_id, access_level')
        .eq('resource_type', 'folder')
        .eq('user_id', userId),
      supabaseAdmin
        .from('resource_memberships')
        .select('resource_id, access_level')
        .eq('resource_type', 'list')
        .eq('user_id', userId),
    ]);

    const folderAccess = new Map((folderMemberships || []).map((m: any) => [m.resource_id, m.access_level]));
    const listAccess = new Map((listMemberships || []).map((m: any) => [m.resource_id, m.access_level]));

    // 3. Load the shared folder rows; keep only those whose parent area is NOT
    //    accessible (a folder under an area the user already has is reachable via
    //    the normal Areas tree, not here).
    const folderIds = [...folderAccess.keys()];
    let sharedFolders: any[] = [];
    if (folderIds.length > 0) {
      const { data: folders } = await supabaseAdmin
        .from('folders')
        .select('id, name, space_id, folder_type, parent_folder_id, client_space_template_id, is_locked, is_private, position, group_tasks, client_id')
        .in('id', folderIds)
        .eq('status', 'active')
        .is('deleted_at', null);
      sharedFolders = (folders || []).filter(
        (f: any) => workspaceSpaceIds.has(f.space_id) && !accessibleSpaceIds.has(f.space_id),
      );
    }
    const sharedFolderIds = new Set(sharedFolders.map((f: any) => f.id));

    // 4. Attach lists to the folders we'll surface (client folders hold no direct
    //    lists; regular folders + design spaces do). Lists inherit folder access.
    const listsByFolder: Record<string, any[]> = {};
    if (sharedFolders.length > 0) {
      const { data: folderLists } = await supabaseAdmin
        .from('lists')
        .select('id, name, space_id, folder_id, is_locked, is_private, position, group_tasks')
        .in('folder_id', sharedFolders.map((f: any) => f.id))
        .eq('status', 'active')
        .is('deleted_at', null)
        .order('position');
      for (const l of folderLists || []) {
        (listsByFolder[l.folder_id] ||= []).push(l);
      }
    }

    const withMeta = (f: any) => ({
      ...f,
      my_access_level: folderAccess.get(f.id),
      lists: listsByFolder[f.id] || [],
    });

    // 5. Partition shared folders into roots.
    const clientFolders = sharedFolders
      .filter((f: any) => f.folder_type === 'client')
      .sort((a: any, b: any) => a.position - b.position)
      .map((f: any) => ({
        ...withMeta(f),
        childSpaces: sharedFolders
          .filter((c: any) => c.parent_folder_id === f.id && !!c.client_space_template_id)
          .sort((a: any, b: any) => a.position - b.position)
          .map(withMeta),
      }));

    // Regular shared folders, plus orphan design spaces whose parent client
    // folder wasn't shared (FolderItem renders both; template folders open the
    // design dashboard directly).
    const folders = sharedFolders
      .filter((f: any) => {
        if (f.folder_type === 'client') return false;
        // child design space already grouped under a shared client folder
        if (f.parent_folder_id && sharedFolderIds.has(f.parent_folder_id)) return false;
        return true;
      })
      .sort((a: any, b: any) => a.position - b.position)
      .map(withMeta);

    // 6. Shared root lists: directly-granted lists whose parent area isn't
    //    accessible and whose folder isn't already shown above.
    const listIds = [...listAccess.keys()];
    let lists: any[] = [];
    if (listIds.length > 0) {
      const { data: rows } = await supabaseAdmin
        .from('lists')
        .select('id, name, space_id, folder_id, is_locked, is_private, position, group_tasks')
        .in('id', listIds)
        .eq('status', 'active')
        .is('deleted_at', null)
        .order('position');
      lists = (rows || [])
        .filter(
          (l: any) =>
            workspaceSpaceIds.has(l.space_id) &&
            !accessibleSpaceIds.has(l.space_id) &&
            !(l.folder_id && sharedFolderIds.has(l.folder_id)),
        )
        .map((l: any) => ({ ...l, my_access_level: listAccess.get(l.id) }));
    }

    res.json({ success: true, data: { clientFolders, folders, lists } });
  } catch (err) {
    console.error('GET /pm/shared-tree error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
