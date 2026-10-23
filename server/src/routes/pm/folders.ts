import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../../supabase';
import { requireAuth } from '../../middleware/auth';
import { requireUserType } from '../../middleware/userType';
import { workspaceIdOf } from '../../middleware/workspace';
import { requirePermission, checkResourceAccess, meetsAccessLevel, isWorkspaceAdmin, isResourceLocked, getPrimaryRolePermissions } from '../../middleware/permissions';
import { PARTNER_USER_TYPES } from '@squadhub/shared';
import type { User } from '@squadhub/shared';
import { aggregateFolderTimeSummary } from '../../services/folderShareMetrics';

const router = Router();

router.use(requireAuth);
router.use(requireUserType('internal', ...PARTNER_USER_TYPES, 'client', 'client_staff'));

const createSchema = z.object({
  space_id: z.string().uuid(),
  name: z.string().min(1).max(100),
  parent_folder_id: z.string().uuid().optional(),
  folder_type: z.enum(['folder', 'client']).optional(),
  status_group_id: z.string().uuid().optional(),
  task_type_group_id: z.string().uuid().optional(),
  default_task_type_id: z.string().uuid().nullable().optional(),
});

// GET /pm/folders?space_id=xxx
router.get('/folders', async (req: Request, res: Response) => {
  try {
    const spaceId = req.query.space_id as string;
    if (!spaceId) {
      res.status(400).json({ success: false, error: 'space_id is required' });
      return;
    }

    // Check user has at least viewer access to the parent space
    const userLevel = await checkResourceAccess(req.userId!, 'space', spaceId);
    if (!userLevel) {
      res.status(403).json({ success: false, error: 'You do not have access to this space' });
      return;
    }

    // Non-admins only see active folders. Admin = owner/admin of the SPACE's workspace.
    const spaceWs = await workspaceIdOf('space', spaceId);
    const admin = await isWorkspaceAdmin(req.userId!, spaceWs);
    let query = supabaseAdmin
      .from('folders')
      .select('*, lists(*)')
      .eq('workspace_id', spaceWs)
      .eq('space_id', spaceId)
      .is('deleted_at', null)
      .order('position');

    if (!admin) query = query.eq('status', 'active');

    const { data, error } = await query;

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.json({ success: true, data });
  } catch (err) {
    console.error('Get folders error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /pm/folders/:id — requires viewer access on folder
router.get('/folders/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    const userLevel = await checkResourceAccess(req.userId!, 'folder', id);
    if (!userLevel) {
      res.status(403).json({ success: false, error: 'You do not have access to this folder' });
      return;
    }

    const folderWs = await workspaceIdOf('folder', id);
    const { data: folder, error } = await supabaseAdmin
      .from('folders')
      .select('*, lists(*)')
      .eq('workspace_id', folderWs)
      .eq('id', id)
      .is('deleted_at', null)
      .single();

    if (error || !folder) {
      res.status(404).json({ success: false, error: 'Folder not found' });
      return;
    }

    // Filter out soft-deleted lists
    const lists = (folder.lists || []).filter((l: any) => !l.deleted_at);

    // Child folders ("spaces" within a client folder). Access does NOT cascade
    // from a parent folder, so we return only the sub-folders the caller can
    // actually reach (via their own membership / space access). This lets the
    // mobile Home render a shared client folder as a section listing its spaces.
    const { data: childRows } = await supabaseAdmin
      .from('folders')
      .select('id, name, position, status, space_id')
      .eq('workspace_id', folderWs)
      .eq('parent_folder_id', id)
      .is('deleted_at', null)
      .eq('status', 'active')
      .order('position');
    const subfolders: any[] = [];
    for (const c of childRows || []) {
      const lvl = await checkResourceAccess(req.userId!, 'folder', c.id);
      if (lvl) subfolders.push({ ...c, my_access_level: lvl });
    }

    res.json({
      success: true,
      data: {
        ...folder,
        lists: lists.sort((a: any, b: any) => (a.position || 0) - (b.position || 0)),
        subfolders,
        my_access_level: userLevel,
      },
    });
  } catch (err) {
    console.error('Get folder error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /pm/folders — requires can_create_folders + member access on space
router.post('/folders', requirePermission('can_create_folders'), async (req: Request, res: Response) => {
  try {
    const body = createSchema.parse(req.body);

    // Check member+ access on parent space
    const spaceAccess = await checkResourceAccess(req.userId!, 'space', body.space_id);
    if (!spaceAccess || !meetsAccessLevel(spaceAccess, 'member')) {
      res.status(403).json({ success: false, error: 'Member access on the space is required to create folders' });
      return;
    }

    // Lock check on parent space: only owners/admins of ITS workspace bypass.
    const spaceWs = await workspaceIdOf('space', body.space_id);
    const adminUser = await isWorkspaceAdmin(req.userId!, spaceWs);
    if (!adminUser && await isResourceLocked('space', body.space_id)) {
      res.status(403).json({ success: false, error: 'This space is locked' });
      return;
    }

    // A parent folder must live in the same space (and so the same workspace).
    if (body.parent_folder_id) {
      const { data: parent } = await supabaseAdmin
        .from('folders')
        .select('id')
        .eq('workspace_id', spaceWs)
        .eq('space_id', body.space_id)
        .eq('id', body.parent_folder_id)
        .maybeSingle();
      if (!parent) {
        res.status(400).json({ success: false, error: 'Parent folder not found in this space' });
        return;
      }
    }

    const { count } = await supabaseAdmin
      .from('folders')
      .select('*', { count: 'exact', head: true })
      .eq('workspace_id', spaceWs)
      .eq('space_id', body.space_id);

    const insertPayload: Record<string, unknown> = {
      space_id: body.space_id,
      name: body.name,
      is_private: true,
      created_by: req.userId!,
      position: count || 0,
    };

    if (body.default_task_type_id !== undefined) {
      insertPayload.default_task_type_id = body.default_task_type_id || null;
    }

    if (body.parent_folder_id) {
      insertPayload.parent_folder_id = body.parent_folder_id;
    }

    if (body.folder_type) {
      insertPayload.folder_type = body.folder_type;
    }

    const { data, error } = await supabaseAdmin
      .from('folders')
      .insert(insertPayload)
      .select()
      .single();

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    await supabaseAdmin.from('resource_memberships').insert({
      resource_type: 'folder',
      resource_id: data.id,
      user_id: req.userId!,
      access_level: 'manager',
    });

    // Status-group inheritance for templated spaces (designer / editor / …):
    // explicit body.status_group_id wins, else the group applied to the
    // space template in admin ("future spaces get it automatically").
    // The folder-level assignment is always recorded; when the parent
    // area still carries the untouched 3-row seed, the area board is
    // synced too so the new space works end-to-end today.
    try {
      const { upsertAssignment, getAssignmentFor, spaceHasSeedStatuses, syncSpaceToGroup } =
        await import('../../utils/statusGroups');
      let inheritedGroupId: string | null = body.status_group_id || null;
      if (inheritedGroupId) {
        await upsertAssignment(inheritedGroupId, 'folder', data.id, req.userId!);
        const spaceAssign = await getAssignmentFor('space', body.space_id);
        if (!spaceAssign && (await spaceHasSeedStatuses(body.space_id))) {
          await syncSpaceToGroup(body.space_id, inheritedGroupId);
          await upsertAssignment(inheritedGroupId, 'space', body.space_id, req.userId!);
        }
      }
    } catch (e) {
      console.error('[pm/folders] status-group inheritance error:', e);
    }

    try {
      const { upsertAssignment: upsertTaskTypeAssignment } =
        await import('../../utils/taskTypeGroups');
      let inheritedTTGroupId: string | null = body.task_type_group_id || null;
      if (inheritedTTGroupId) {
        await upsertTaskTypeAssignment(inheritedTTGroupId, 'folder', data.id, req.userId!);
      }
    } catch (e) {
      console.error('[pm/folders] task-type-group inheritance error:', e);
    }

    res.status(201).json({ success: true, data });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Create folder error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PUT /pm/folders/:id — requires manager access on folder
// GET /pm/folders/:id/assignable-users — viewer+ members of the folder or its
// parent space. Powers the auto-assign picker in folder settings.
router.get('/folders/:id/assignable-users', async (req: Request, res: Response) => {
  try {
    const folderId = req.params.id as string;

    const userLevel = await checkResourceAccess(req.userId!, 'folder', folderId);
    if (!userLevel) {
      res.status(403).json({ success: false, error: 'You do not have access to this folder' });
      return;
    }

    const folderWs = await workspaceIdOf('folder', folderId);
    const resourceFilters: Array<{ type: string; id: string }> = [
      { type: 'folder', id: folderId },
    ];

    const { data: folder } = await supabaseAdmin
      .from('folders')
      .select('space_id')
      .eq('workspace_id', folderWs)
      .eq('id', folderId)
      .single();
    if ((folder as any)?.space_id) {
      resourceFilters.push({ type: 'space', id: (folder as any).space_id });
    }

    const orClauses = resourceFilters
      .map(f => `and(resource_type.eq.${f.type},resource_id.eq.${f.id})`)
      .join(',');

    const { data: memberships, error } = await supabaseAdmin
      .from('resource_memberships')
      .select('user_id, users!resource_memberships_user_id_fkey(id, display_name, email, avatar_url, user_type, is_admin, status, created_at)')
      .eq('workspace_id', folderWs)
      .or(orClauses);

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    const seen = new Set<string>();
    const users: User[] = [];
    for (const m of (memberships || []) as any[]) {
      if (!m.users || seen.has(m.user_id)) continue;
      if (m.users.status && m.users.status !== 'active') continue;
      seen.add(m.user_id);
      users.push(m.users as User);
    }

    users.sort((a, b) => (a.display_name || a.email).localeCompare(b.display_name || b.email));

    res.json({ success: true, data: users });
  } catch (err) {
    console.error('Get folder assignable users error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.put('/folders/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    const userLevel = await checkResourceAccess(req.userId!, 'folder', id);
    if (!userLevel || !meetsAccessLevel(userLevel, 'manager')) {
      res.status(403).json({ success: false, error: 'Manager access required to update folders' });
      return;
    }

    const folderWs = await workspaceIdOf('folder', id);
    const adminUser = await isWorkspaceAdmin(req.userId!, folderWs);
    if (!adminUser && await isResourceLocked('folder', id)) {
      res.status(403).json({ success: false, error: 'This folder is locked' });
      return;
    }

    const updates: Record<string, unknown> = {};
    if (req.body.name !== undefined) updates.name = req.body.name;
    if (req.body.space_id !== undefined) updates.space_id = req.body.space_id;
    if (typeof req.body.group_tasks === 'boolean') updates.group_tasks = req.body.group_tasks;
    if (Array.isArray(req.body.auto_assignee_ids)) updates.auto_assignee_ids = req.body.auto_assignee_ids;
    if (req.body.default_task_type_id !== undefined) updates.default_task_type_id = req.body.default_task_type_id || null;

    // If moving to a new space, validate destination access + lock, then
    // cascade the space_id change to this folder's child lists so the
    // invariant "list.space_id == folder.space_id" holds.
    let newSpaceId: string | null = null;
    let oldSpaceId: string | null = null;
    if (updates.space_id) {
      const { data: currentFolder } = await supabaseAdmin
        .from('folders')
        .select('space_id')
        .eq('workspace_id', folderWs)
        .eq('id', id)
        .single();
      if (!currentFolder) {
        res.status(404).json({ success: false, error: 'Folder not found' });
        return;
      }
      oldSpaceId = currentFolder.space_id;
      if (updates.space_id !== oldSpaceId) {
        newSpaceId = updates.space_id as string;
        const { data: destSpace } = await supabaseAdmin
          .from('spaces')
          .select('id, deleted_at')
          .eq('workspace_id', folderWs)
          .eq('id', newSpaceId)
          .single();
        if (!destSpace || destSpace.deleted_at) {
          // (scoped to the folder's workspace: folders never move across workspaces)
          res.status(400).json({ success: false, error: 'Destination space does not exist' });
          return;
        }
        const destAccess = await checkResourceAccess(req.userId!, 'space', newSpaceId);
        if (!destAccess || !meetsAccessLevel(destAccess, 'member')) {
          res.status(403).json({ success: false, error: 'Member access required on destination space' });
          return;
        }
        if (!adminUser && await isResourceLocked('space', newSpaceId)) {
          res.status(403).json({ success: false, error: 'Destination space is locked' });
          return;
        }
      }
    }

    const { data, error } = await supabaseAdmin
      .from('folders')
      .update(updates)
      .eq('workspace_id', folderWs)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    // Cascade: move child lists with the folder so their space_id matches.
    if (newSpaceId && oldSpaceId && newSpaceId !== oldSpaceId) {
      const { error: cascadeErr } = await supabaseAdmin
        .from('lists')
        .update({ space_id: newSpaceId })
        .eq('workspace_id', folderWs)
        .eq('folder_id', id)
        .is('deleted_at', null);
      if (cascadeErr) {
        // Roll back the folder move to keep the invariant.
        await supabaseAdmin.from('folders').update({ space_id: oldSpaceId }).eq('workspace_id', folderWs).eq('id', id);
        console.error('[pm/folders] cascade list move failed, rolled back:', cascadeErr);
        res.status(500).json({ success: false, error: 'Failed to move child lists; folder move rolled back' });
        return;
      }
    }

    res.json({ success: true, data });
  } catch (err) {
    console.error('Update folder error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /pm/folders/:id — soft-delete, requires manager access
router.delete('/folders/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    const userLevel = await checkResourceAccess(req.userId!, 'folder', id);
    if (!userLevel || !meetsAccessLevel(userLevel, 'manager')) {
      res.status(403).json({ success: false, error: 'Manager access required to delete folders' });
      return;
    }

    const folderWs = await workspaceIdOf('folder', id);
    const adminUser = await isWorkspaceAdmin(req.userId!, folderWs);
    if (!adminUser && await isResourceLocked('folder', id)) {
      res.status(403).json({ success: false, error: 'This folder is locked' });
      return;
    }

    const now = new Date().toISOString();

    // Soft-delete the folder
    const { error } = await supabaseAdmin
      .from('folders')
      .update({ deleted_at: now })
      .eq('workspace_id', folderWs)
      .eq('id', id);

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    // Also soft-delete child lists
    await supabaseAdmin.from('lists').update({ deleted_at: now }).eq('workspace_id', folderWs).eq('folder_id', id).is('deleted_at', null);

    res.json({ success: true, message: 'Folder moved to trash' });
  } catch (err) {
    console.error('Delete folder error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /pm/folders/:id/time-summary?from=YYYY-MM-DD&to=YYYY-MM-DD
// Aggregates task_time_entries across all users for tasks inside this folder.
// Returns one row per date that has logged time. Used by the space dashboard.
router.get('/folders/:id/time-summary', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const from = String(req.query.from || '').trim();
    const to = String(req.query.to || '').trim();

    if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      res.status(400).json({ success: false, error: 'from and to query params (YYYY-MM-DD) are required' });
      return;
    }

    const userLevel = await checkResourceAccess(req.userId!, 'folder', id);
    if (!userLevel) {
      res.status(403).json({ success: false, error: 'You do not have access to this folder' });
      return;
    }

    // Aggregation (lists → tasks → task_time_entries, IST-bucketed).
    const actual = await aggregateFolderTimeSummary(id, from, to);
    const data = actual
      .map((r) => ({ date: r.date, total_work_seconds: r.total_work_seconds, elapsed_seconds: 0 }))
      .sort((a, b) => (a.date < b.date ? -1 : 1));
    res.json({ success: true, data });
  } catch (err) {
    console.error('Get folder time summary error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
