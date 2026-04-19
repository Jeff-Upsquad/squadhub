import { Router, Request, Response } from 'express';
import { supabaseAdmin } from '../../supabase';
import { requireAuth } from '../../middleware/auth';
import { requireUserType } from '../../middleware/userType';

const router = Router();
router.use(requireAuth);
router.use(requireUserType('internal', 'partner', 'client', 'client_staff'));

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

export default router;
