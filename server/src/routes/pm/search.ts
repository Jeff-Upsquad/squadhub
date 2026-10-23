import { Router, Request, Response } from 'express';
import { supabaseAdmin } from '../../supabase';
import { requireAuth } from '../../middleware/auth';
import { requireUserType } from '../../middleware/userType';
import { PARTNER_USER_TYPES } from '@squadhub/shared';

const router = Router();
router.use(requireAuth);
router.use(requireUserType('internal', ...PARTNER_USER_TYPES, 'client', 'client_staff'));

function logStep(step: string, error: unknown) {
  if (error) console.error(`[pm/search] ${step}:`, error);
}

// Resolve workspace-scoped admin status (workspace_members can have multiple rows
// per user across workspaces, so we filter by workspace_id rather than using .single()).
async function isAdminInWorkspace(userId: string, workspaceId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('workspace_members')
    .select('role')
    .eq('user_id', userId)
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  logStep('isAdminInWorkspace', error);
  return data?.role === 'owner' || data?.role === 'admin' || data?.role === 'super_admin';
}

// GET /pm/search?workspace_id=xxx&q=...&limit=25
// Workspace-wide search: task titles, optional descriptions, and container
// names (spaces/folders/lists) for palette navigation — all scoped to what the
// user can access.
router.get('/search', async (req: Request, res: Response) => {
  try {
    // requireAuth already verified ?workspace_id / X-Workspace-Id membership
    // and bound it as the active workspace. Every query below filters by it, so
    // search can never return another workspace's spaces, folders, lists or tasks.
    const workspaceId = req.workspaceId as string;
    const rawQuery = (req.query.q as string) || '';
    const q = rawQuery.trim();
    const limit = Math.min(parseInt((req.query.limit as string) || '25', 10) || 25, 50);

    if (!workspaceId) {
      res.status(400).json({ success: false, error: 'workspace_id is required' });
      return;
    }

    if (q.length < 1) {
      res.json({ success: true, data: { tasks: [], descriptions: [], spaces: [], folders: [], lists: [] } });
      return;
    }

    const userId = req.userId!;
    const includeDescriptions = req.query.include_descriptions === 'true';

    // 1. All non-deleted spaces in this workspace
    const { data: workspaceSpaces, error: spacesErr } = await supabaseAdmin
      .from('spaces')
      .select('id, name, created_by, kind, status, position')
      .eq('workspace_id', workspaceId)
      .is('deleted_at', null);
    logStep('spaces', spacesErr);

    const workspaceSpaceIds = (workspaceSpaces || []).map((s: any) => s.id);
    if (workspaceSpaceIds.length === 0) {
      res.json({ success: true, data: { tasks: [], descriptions: [], spaces: [], folders: [], lists: [] } });
      return;
    }

    // 2. Resolve accessible list IDs in this workspace
    const admin = await isAdminInWorkspace(userId, workspaceId);

    let accessibleListIds: string[] = [];
    // Access sets shared by the task search below and the container-name search
    // (spaces/folders/lists) further down.
    const accessibleSpaceIds = new Set<string>();
    const accessibleFolderIds = new Set<string>();

    if (admin) {
      // Admins see everything in the workspace
      for (const id of workspaceSpaceIds) accessibleSpaceIds.add(id);
      const { data: allLists, error: allListsErr } = await supabaseAdmin
        .from('lists')
        .select('id')
        .eq('workspace_id', workspaceId)
        .in('space_id', workspaceSpaceIds)
        .is('deleted_at', null);
      logStep('admin allLists', allListsErr);
      accessibleListIds = (allLists || []).map((l: any) => l.id);
    } else {
      // Resolve via creator-of + resource_memberships at each level
      const [memSpaceRes, memFolderRes, memListRes] = await Promise.all([
        supabaseAdmin
          .from('resource_memberships') // tenant-scope: caller's own rows (user_id = caller)
          .select('resource_id')
          .eq('workspace_id', workspaceId)
          .eq('resource_type', 'space')
          .eq('user_id', userId),
        supabaseAdmin
          .from('resource_memberships') // tenant-scope: caller's own rows (user_id = caller)
          .select('resource_id')
          .eq('workspace_id', workspaceId)
          .eq('resource_type', 'folder')
          .eq('user_id', userId),
        supabaseAdmin
          .from('resource_memberships') // tenant-scope: caller's own rows (user_id = caller)
          .select('resource_id')
          .eq('workspace_id', workspaceId)
          .eq('resource_type', 'list')
          .eq('user_id', userId),
      ]);
      logStep('memSpace', memSpaceRes.error);
      logStep('memFolder', memFolderRes.error);
      logStep('memList', memListRes.error);

      for (const id of (memSpaceRes.data || []).map((m: any) => m.resource_id)) {
        accessibleSpaceIds.add(id);
      }
      for (const s of (workspaceSpaces || [])) {
        if (s.created_by === userId) accessibleSpaceIds.add(s.id);
      }

      // Lists in accessible spaces (space-level inheritance) — scoped to this workspace
      let listsViaSpace: any[] = [];
      if (accessibleSpaceIds.size > 0) {
        const r = await supabaseAdmin
          .from('lists')
          .select('id, folder_id, space_id')
          .eq('workspace_id', workspaceId)
          .in('space_id', Array.from(accessibleSpaceIds))
          .is('deleted_at', null);
        logStep('listsViaSpace', r.error);
        listsViaSpace = r.data || [];
      }

      // Folders the user has direct access to (creator or member), scoped to workspace
      const folderMemIds = (memFolderRes.data || []).map((m: any) => m.resource_id);
      if (folderMemIds.length > 0) {
        const r = await supabaseAdmin
          .from('folders')
          .select('id, space_id')
          .eq('workspace_id', workspaceId)
          .in('id', folderMemIds)
          .is('deleted_at', null);
        logStep('folderRows', r.error);
        for (const f of r.data || []) {
          if (workspaceSpaceIds.includes((f as any).space_id)) {
            accessibleFolderIds.add((f as any).id);
          }
        }
      }
      {
        const r = await supabaseAdmin
          .from('folders')
          .select('id, space_id')
          .eq('workspace_id', workspaceId)
          .eq('created_by', userId)
          .is('deleted_at', null);
        logStep('createdFolders', r.error);
        for (const f of r.data || []) {
          if (workspaceSpaceIds.includes((f as any).space_id)) {
            accessibleFolderIds.add((f as any).id);
          }
        }
      }

      // Lists in accessible folders
      let listsViaFolder: any[] = [];
      if (accessibleFolderIds.size > 0) {
        const r = await supabaseAdmin
          .from('lists')
          .select('id')
          .eq('workspace_id', workspaceId)
          .in('folder_id', Array.from(accessibleFolderIds))
          .is('deleted_at', null);
        logStep('listsViaFolder', r.error);
        listsViaFolder = r.data || [];
      }

      // Lists with direct membership — scope to workspace
      const listMemIds = (memListRes.data || []).map((m: any) => m.resource_id);
      let listsViaDirect: any[] = [];
      if (listMemIds.length > 0) {
        const r = await supabaseAdmin
          .from('lists')
          .select('id, space_id')
          .eq('workspace_id', workspaceId)
          .in('id', listMemIds)
          .is('deleted_at', null);
        logStep('listsViaDirect', r.error);
        listsViaDirect = (r.data || []).filter((l: any) =>
          workspaceSpaceIds.includes(l.space_id),
        );
      }

      // Lists the user created — scope to workspace
      const createdListsRes = await supabaseAdmin
        .from('lists')
        .select('id, space_id')
        .eq('workspace_id', workspaceId)
        .eq('created_by', userId)
        .is('deleted_at', null);
      logStep('createdLists', createdListsRes.error);
      const listsViaCreator = (createdListsRes.data || []).filter((l: any) =>
        workspaceSpaceIds.includes(l.space_id),
      );

      const idSet = new Set<string>();
      for (const l of listsViaSpace) idSet.add(l.id);
      for (const l of listsViaFolder) idSet.add(l.id);
      for (const l of listsViaDirect) idSet.add(l.id);
      for (const l of listsViaCreator) idSet.add(l.id);
      accessibleListIds = Array.from(idSet);
    }

    // 3. Container-name search (spaces / folders / lists) so the global palette
    // can jump to areas, folders and lists by name. Runs even when the user has
    // no accessible lists — a share-only partner can still find the folder that
    // was shared with them.
    const safeQ = q.replace(/[\\%_]/g, (m) => `\\${m}`);
    const workspaceSpaceNameById = new Map<string, string>((workspaceSpaces || []).map((s: any) => [s.id as string, s.name as string]));

    // Spaces mirror GET /pm/spaces listing rules: personal/workspace kinds are
    // hidden, and non-admins only see active spaces they're a member of or
    // created. Names are matched client-side of the query here (in JS) since
    // step 1 already fetched every space row in the workspace.
    const lowerQ = q.toLowerCase();
    const spaceMatches = (workspaceSpaces || [])
      .filter(
        (s: any) =>
          s.kind !== 'personal' &&
          s.kind !== 'workspace' &&
          (admin || (s.status === 'active' && accessibleSpaceIds.has(s.id))) &&
          String(s.name || '').toLowerCase().includes(lowerQ),
      )
      .sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0))
      .slice(0, limit)
      .map((s: any) => ({ id: s.id, name: s.name }));

    // Folders: name match within the workspace, then an access filter (folder
    // lives in an accessible space, or the folder itself is directly
    // accessible). The access filter runs after the query, so fetch with a wide
    // cap to keep the filter from eating the whole result set.
    const { data: folderRows, error: folderSearchErr } = await supabaseAdmin
      .from('folders')
      .select('id, name, space_id')
      .eq('workspace_id', workspaceId)
      .in('space_id', workspaceSpaceIds)
      .is('deleted_at', null)
      .ilike('name', `%${safeQ}%`)
      .order('position')
      .limit(200);
    logStep('container folders', folderSearchErr);
    const folderMatches = ((folderRows || []) as any[])
      .filter((f) => admin || accessibleSpaceIds.has(f.space_id) || accessibleFolderIds.has(f.id))
      .slice(0, limit)
      .map((f) => ({
        id: f.id,
        name: f.name,
        space_id: f.space_id,
        space_name: workspaceSpaceNameById.get(f.space_id) ?? null,
      }));

    // Lists: name match among the lists the user can already access.
    let listMatches: {
      id: string;
      name: string;
      folder_id: string | null;
      folder_name: string | null;
      space_id: string;
      space_name: string | null;
    }[] = [];
    if (accessibleListIds.length > 0) {
      const { data: listRows, error: listSearchErr } = await supabaseAdmin
        .from('lists')
        .select('id, name, folder_id, space_id')
        .eq('workspace_id', workspaceId)
        .in('id', accessibleListIds)
        .is('deleted_at', null)
        .ilike('name', `%${safeQ}%`)
        .order('position')
        .limit(limit);
      logStep('container lists', listSearchErr);
      const rows = (listRows || []) as any[];
      const folderIdsNeeded = Array.from(
        new Set(rows.map((l) => l.folder_id).filter((id): id is string => !!id)),
      );
      const folderNameById: Record<string, string> = {};
      if (folderIdsNeeded.length > 0) {
        const { data: folderInfos } = await supabaseAdmin
          .from('folders')
          .select('id, name')
          .eq('workspace_id', workspaceId)
          .in('id', folderIdsNeeded);
        for (const f of (folderInfos || []) as any[]) {
          folderNameById[f.id] = f.name;
        }
      }
      listMatches = rows.map((l) => ({
        id: l.id,
        name: l.name,
        folder_id: l.folder_id ?? null,
        folder_name: l.folder_id ? folderNameById[l.folder_id] ?? null : null,
        space_id: l.space_id,
        space_name: workspaceSpaceNameById.get(l.space_id) ?? null,
      }));
    }

    if (accessibleListIds.length === 0) {
      res.json({ success: true, data: { tasks: [], descriptions: [], spaces: spaceMatches, folders: folderMatches, lists: [] } });
      return;
    }

    // 4. Search each task field independently so title matches cannot crowd out
    // description matches. Both queries use the same accessible-list scope.
    // NOTE: prod tasks table has no updated_at column (see fix 775ca948), so
    // select + order by created_at only. Selecting a missing column makes
    // PostgREST return 500, which empties tasks/descriptions in the global
    // palette and leaves only the Messages section visible.
    const taskFields = 'id, title, description, status, priority, due_date, work_date, work_end_date:metadata->>work_end_date, start_date, assignee_ids, display_number, list_id, parent_task_id, created_at';
    const searchField = (field: 'title' | 'description') => {
      let query = supabaseAdmin
        .from('tasks')
        .select(taskFields)
        .eq('workspace_id', workspaceId)
        .in('list_id', accessibleListIds)
        .is('recurrence', null)
        .ilike(field, `%${safeQ}%`)
        // Newest first. created_at is guaranteed to exist; updated_at is not
        // present in prod, so it must not be used here.
        .order('created_at', { ascending: false })
        .limit(limit);
      // Preserve title-search behavior for existing callers. Description search
      // also finds subtasks, and selection opens their owning task details.
      if (field === 'title' && req.query.include_subtasks !== 'true') {
        query = query.is('parent_task_id', null);
      }
      return query;
    };
    const [titleResult, descriptionResult] = await Promise.all([
      searchField('title'),
      includeDescriptions ? searchField('description') : Promise.resolve({ data: [], error: null }),
    ]);
    const error = titleResult.error || descriptionResult.error;
    if (error) {
      console.error('[pm/search] tasks query error:', error);
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    const matches = titleResult.data || [];
    const descriptionMatches = descriptionResult.data || [];

    // 5. Enrich with list/folder/space names for breadcrumbs
    const matchedListIds = Array.from(new Set([...matches, ...descriptionMatches].map((t: any) => t.list_id)));
    let listInfoById: Record<
      string,
      { id: string; name: string; folder_id: string | null; space_id: string }
    > = {};
    if (matchedListIds.length > 0) {
      const { data: listInfos } = await supabaseAdmin
        .from('lists')
        .select('id, name, folder_id, space_id')
        .eq('workspace_id', workspaceId)
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
        .eq('workspace_id', workspaceId)
        .in('id', folderIdsNeeded);
      for (const f of (folderInfos || []) as any[]) {
        folderNameById[f.id] = f.name;
      }
    }

    const spaceIdsNeeded = Array.from(
      new Set(Object.values(listInfoById).map((l) => l.space_id)),
    );
    let spaceNameById: Record<string, string> = {};
    const spaceColorById: Record<string, string | null> = {};
    if (spaceIdsNeeded.length > 0) {
      const { data: spaceInfos } = await supabaseAdmin
        .from('spaces')
        .select('id, name, color')
        .eq('workspace_id', workspaceId)
        .in('id', spaceIdsNeeded);
      for (const s of (spaceInfos || []) as any[]) {
        spaceNameById[s.id] = s.name;
        spaceColorById[s.id] = s.color ?? null;
      }
    }

    // Resolve each task's status category by joining space_statuses (keyed by
    // space_id + status name), mirroring the lib/taskGrouping.ts isTaskCompleted
    // category check. Custom task types complete under a space-specific status
    // name (e.g. "Delivered", "RESOLVED") whose category is 'done'/'closed' even
    // though the name isn't literally that — the raw status string alone can't
    // tell those apart from open work.
    let statusCategoryByKey: Record<string, string> = {};
    if (spaceIdsNeeded.length > 0) {
      const { data: spaceStatuses } = await supabaseAdmin
        .from('space_statuses')
        .select('space_id, name, category')
        .eq('workspace_id', workspaceId)
        .in('space_id', spaceIdsNeeded);
      for (const s of (spaceStatuses || []) as any[]) {
        statusCategoryByKey[`${s.space_id}::${s.name}`] = s.category;
      }
    }

    const enrich = (t: any) => {
      const list = listInfoById[t.list_id];
      const spaceId = list?.space_id || null;
      const category =
        spaceId && t.status != null
          ? statusCategoryByKey[`${spaceId}::${t.status}`] ?? null
          : null;
      return {
        id: t.id,
        title: t.title,
        description: t.description ?? null,
        status: t.status,
        category,
        priority: t.priority,
        due_date: t.due_date,
        work_date: t.work_date ?? null,
        work_end_date: t.work_end_date ?? null,
        start_date: t.start_date ?? null,
        assignee_ids: t.assignee_ids || [],
        parent_task_id: t.parent_task_id ?? null,
        display_number: t.display_number ?? null,
        list_id: t.list_id,
        created_at: t.created_at ?? null,
        updated_at: t.updated_at ?? null,
        list_name: list?.name || null,
        folder_id: list?.folder_id || null,
        folder_name: list?.folder_id ? folderNameById[list.folder_id] || null : null,
        space_id: spaceId,
        space_name: spaceId ? spaceNameById[spaceId] || null : null,
        space_color: spaceId ? spaceColorById[spaceId] ?? null : null,
      };
    };

    res.json({
      success: true,
      data: {
        tasks: matches.map(enrich),
        descriptions: descriptionMatches.map(enrich),
        spaces: spaceMatches,
        folders: folderMatches,
        lists: listMatches,
      },
    });
  } catch (err) {
    console.error('GET /pm/search error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
