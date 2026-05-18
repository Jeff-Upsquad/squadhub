import { Router, Request, Response } from 'express';
import { supabaseAdmin } from '../../supabase';
import { requireAuth } from '../../middleware/auth';
import { requireUserType } from '../../middleware/userType';
import { isWorkspaceAdmin } from '../../middleware/permissions';
import { PARTNER_USER_TYPES } from '@squadhub/shared';

const router = Router();
router.use(requireAuth);
router.use(requireUserType('internal', ...PARTNER_USER_TYPES, 'client', 'client_staff'));

// GET /pm/search?workspace_id=xxx&q=...&limit=25
// Workspace-wide task title search, scoped to lists the user can access.
router.get('/search', async (req: Request, res: Response) => {
  try {
    const workspaceId = req.query.workspace_id as string;
    const rawQuery = (req.query.q as string) || '';
    const q = rawQuery.trim();
    const limit = Math.min(parseInt((req.query.limit as string) || '25', 10) || 25, 50);

    if (!workspaceId) {
      res.status(400).json({ success: false, error: 'workspace_id is required' });
      return;
    }

    if (q.length < 1) {
      res.json({ success: true, data: { tasks: [] } });
      return;
    }

    const userId = req.userId!;

    // 1. All non-deleted spaces in this workspace
    const { data: workspaceSpaces } = await supabaseAdmin
      .from('spaces')
      .select('id, name, created_by')
      .eq('workspace_id', workspaceId)
      .is('deleted_at', null);

    const workspaceSpaceIds = (workspaceSpaces || []).map((s: any) => s.id);
    if (workspaceSpaceIds.length === 0) {
      res.json({ success: true, data: { tasks: [] } });
      return;
    }

    // 2. Resolve accessible list IDs in this workspace
    const admin = await isWorkspaceAdmin(userId);

    let accessibleListIds: string[] = [];

    if (admin) {
      // Admins see everything in the workspace
      const { data: allLists } = await supabaseAdmin
        .from('lists')
        .select('id')
        .in('space_id', workspaceSpaceIds)
        .is('deleted_at', null);
      accessibleListIds = (allLists || []).map((l: any) => l.id);
    } else {
      // Resolve via creator-of + resource_memberships at each level
      const [
        { data: spaceMems },
        { data: folderMems },
        { data: listMems },
      ] = await Promise.all([
        supabaseAdmin
          .from('resource_memberships')
          .select('resource_id')
          .eq('resource_type', 'space')
          .eq('user_id', userId),
        supabaseAdmin
          .from('resource_memberships')
          .select('resource_id')
          .eq('resource_type', 'folder')
          .eq('user_id', userId),
        supabaseAdmin
          .from('resource_memberships')
          .select('resource_id')
          .eq('resource_type', 'list')
          .eq('user_id', userId),
      ]);

      const accessibleSpaceIds = new Set<string>([
        ...(spaceMems || []).map((m: any) => m.resource_id),
        ...(workspaceSpaces || [])
          .filter((s: any) => s.created_by === userId)
          .map((s: any) => s.id),
      ]);

      // Lists in accessible spaces (space-level inheritance) — scoped to this workspace
      let listsViaSpace: { id: string; folder_id: string | null }[] = [];
      if (accessibleSpaceIds.size > 0) {
        const { data } = await supabaseAdmin
          .from('lists')
          .select('id, folder_id, space_id')
          .in('space_id', Array.from(accessibleSpaceIds))
          .is('deleted_at', null);
        listsViaSpace = (data || []) as any[];
      }

      // Folders the user has direct access to (creator or member), scoped to workspace
      const folderMemIds = (folderMems || []).map((m: any) => m.resource_id);
      let accessibleFolderIds = new Set<string>();
      if (folderMemIds.length > 0) {
        const { data: folderRows } = await supabaseAdmin
          .from('folders')
          .select('id, space_id')
          .in('id', folderMemIds)
          .is('deleted_at', null);
        for (const f of folderRows || []) {
          if (workspaceSpaceIds.includes((f as any).space_id)) {
            accessibleFolderIds.add((f as any).id);
          }
        }
      }
      // Plus folders the user created
      {
        const { data: createdFolders } = await supabaseAdmin
          .from('folders')
          .select('id, space_id')
          .eq('created_by', userId)
          .is('deleted_at', null);
        for (const f of createdFolders || []) {
          if (workspaceSpaceIds.includes((f as any).space_id)) {
            accessibleFolderIds.add((f as any).id);
          }
        }
      }

      // Lists in accessible folders
      let listsViaFolder: { id: string }[] = [];
      if (accessibleFolderIds.size > 0) {
        const { data } = await supabaseAdmin
          .from('lists')
          .select('id')
          .in('folder_id', Array.from(accessibleFolderIds))
          .is('deleted_at', null);
        listsViaFolder = (data || []) as any[];
      }

      // Lists with direct membership — scope to workspace
      const listMemIds = (listMems || []).map((m: any) => m.resource_id);
      let listsViaDirect: { id: string }[] = [];
      if (listMemIds.length > 0) {
        const { data } = await supabaseAdmin
          .from('lists')
          .select('id, space_id')
          .in('id', listMemIds)
          .is('deleted_at', null);
        listsViaDirect = ((data || []) as any[]).filter((l) =>
          workspaceSpaceIds.includes(l.space_id),
        );
      }

      // Lists the user created — scope to workspace
      const { data: createdLists } = await supabaseAdmin
        .from('lists')
        .select('id, space_id')
        .eq('created_by', userId)
        .is('deleted_at', null);
      const listsViaCreator = ((createdLists || []) as any[]).filter((l) =>
        workspaceSpaceIds.includes(l.space_id),
      );

      const idSet = new Set<string>();
      for (const l of listsViaSpace) idSet.add(l.id);
      for (const l of listsViaFolder) idSet.add(l.id);
      for (const l of listsViaDirect) idSet.add(l.id);
      for (const l of listsViaCreator) idSet.add(l.id);
      accessibleListIds = Array.from(idSet);
    }

    if (accessibleListIds.length === 0) {
      res.json({ success: true, data: { tasks: [] } });
      return;
    }

    // 3. Search task titles within accessible lists
    // Escape ILIKE wildcards in user input
    const safeQ = q.replace(/[\\%_]/g, (m) => `\\${m}`);

    const { data: matches, error } = await supabaseAdmin
      .from('tasks')
      .select('id, title, status, priority, due_date, list_id, parent_task_id, updated_at')
      .in('list_id', accessibleListIds)
      .is('parent_task_id', null)
      .ilike('title', `%${safeQ}%`)
      .order('updated_at', { ascending: false })
      .limit(limit);

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    // 4. Enrich with list/folder/space names for breadcrumbs
    const matchedListIds = Array.from(new Set((matches || []).map((t: any) => t.list_id)));
    let listInfoById: Record<
      string,
      { id: string; name: string; folder_id: string | null; space_id: string }
    > = {};
    if (matchedListIds.length > 0) {
      const { data: listInfos } = await supabaseAdmin
        .from('lists')
        .select('id, name, folder_id, space_id')
        .in('id', matchedListIds);
      for (const l of (listInfos || []) as any[]) {
        listInfoById[l.id] = l;
      }
    }

    const folderIdsNeeded = Array.from(
      new Set(
        Object.values(listInfoById)
          .map((l) => l.folder_id)
          .filter((id): id is string => !!id),
      ),
    );
    let folderNameById: Record<string, string> = {};
    if (folderIdsNeeded.length > 0) {
      const { data: folderInfos } = await supabaseAdmin
        .from('folders')
        .select('id, name')
        .in('id', folderIdsNeeded);
      for (const f of (folderInfos || []) as any[]) {
        folderNameById[f.id] = f.name;
      }
    }

    const spaceIdsNeeded = Array.from(
      new Set(Object.values(listInfoById).map((l) => l.space_id)),
    );
    let spaceNameById: Record<string, string> = {};
    if (spaceIdsNeeded.length > 0) {
      const { data: spaceInfos } = await supabaseAdmin
        .from('spaces')
        .select('id, name')
        .in('id', spaceIdsNeeded);
      for (const s of (spaceInfos || []) as any[]) {
        spaceNameById[s.id] = s.name;
      }
    }

    const enriched = (matches || []).map((t: any) => {
      const list = listInfoById[t.list_id];
      return {
        id: t.id,
        title: t.title,
        status: t.status,
        priority: t.priority,
        due_date: t.due_date,
        list_id: t.list_id,
        list_name: list?.name || null,
        folder_id: list?.folder_id || null,
        folder_name: list?.folder_id ? folderNameById[list.folder_id] || null : null,
        space_id: list?.space_id || null,
        space_name: list?.space_id ? spaceNameById[list.space_id] || null : null,
      };
    });

    res.json({ success: true, data: { tasks: enriched } });
  } catch (err) {
    console.error('GET /pm/search error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
