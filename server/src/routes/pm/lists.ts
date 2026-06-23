import { Router, Request, Response } from 'express';
import { z } from 'zod';
import type { User } from '@squadhub/shared';
import { supabaseAdmin } from '../../supabase';
import { requireAuth } from '../../middleware/auth';
import { requireUserType } from '../../middleware/userType';
import { requirePermission, checkResourceAccess, meetsAccessLevel, isWorkspaceAdmin, isResourceLocked } from '../../middleware/permissions';
import { PARTNER_USER_TYPES } from '@squadhub/shared';

const router = Router();
router.use(requireAuth);
router.use(requireUserType('internal', ...PARTNER_USER_TYPES, 'client', 'client_staff'));

const createSchema = z.object({
  space_id: z.string().uuid(),
  folder_id: z.string().uuid().optional(),
  name: z.string().min(1).max(100),
  default_view: z.enum(['list', 'board', 'whiteboard']).optional(),
  profile_id: z.string().uuid().optional(),
});

// GET /pm/lists?space_id=xxx or ?folder_id=xxx
router.get('/lists', async (req: Request, res: Response) => {
  try {
    const spaceId = req.query.space_id as string;
    const folderId = req.query.folder_id as string;

    // Check access on parent space or folder
    if (folderId) {
      const userLevel = await checkResourceAccess(req.userId!, 'folder', folderId);
      if (!userLevel) {
        res.status(403).json({ success: false, error: 'You do not have access to this folder' });
        return;
      }
    } else if (spaceId) {
      const userLevel = await checkResourceAccess(req.userId!, 'space', spaceId);
      if (!userLevel) {
        res.status(403).json({ success: false, error: 'You do not have access to this space' });
        return;
      }
    } else {
      res.status(400).json({ success: false, error: 'space_id or folder_id is required' });
      return;
    }

    const admin = await isWorkspaceAdmin(req.userId!);
    let query = supabaseAdmin.from('lists').select('*').is('deleted_at', null).order('position');
    if (!admin) query = query.eq('status', 'active');

    if (folderId) {
      query = query.eq('folder_id', folderId);
    } else if (spaceId) {
      query = query.eq('space_id', spaceId);
    }

    const { data, error } = await query;

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.json({ success: true, data });
  } catch (err) {
    console.error('Get lists error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /pm/lists/:id
router.get('/lists/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    // Check access on the list (inherits from space/folder)
    const userLevel = await checkResourceAccess(req.userId!, 'list', id);
    if (!userLevel) {
      res.status(403).json({ success: false, error: 'You do not have access to this list' });
      return;
    }

    const { data: list, error } = await supabaseAdmin
      .from('lists')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !list) {
      res.status(404).json({ success: false, error: 'List not found' });
      return;
    }

    // Get task count and space statuses in parallel
    const [{ count }, { data: spaceStatuses }] = await Promise.all([
      supabaseAdmin
        .from('tasks')
        .select('*', { count: 'exact', head: true })
        .eq('list_id', id)
        .is('parent_task_id', null)
        .is('recurrence', null),
      supabaseAdmin
        .from('space_statuses')
        .select('*')
        .eq('space_id', list.space_id)
        .order('position'),
    ]);

    res.json({ success: true, data: { ...list, task_count: count || 0, my_access_level: userLevel, space_statuses: spaceStatuses || [] } });
  } catch (err) {
    console.error('Get list error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /pm/lists/:id/assignable-users — viewer+ members of the list, its parent
// folder, or its parent space. Same semantics as the task-scoped variant, but
// addressable by list id so the task-creation slide can populate its assignee
// picker before a task exists.
router.get('/lists/:id/assignable-users', async (req: Request, res: Response) => {
  try {
    const listId = req.params.id as string;

    const userLevel = await checkResourceAccess(req.userId!, 'list', listId);
    if (!userLevel) {
      res.status(403).json({ success: false, error: 'You do not have access to this list' });
      return;
    }

    const resourceFilters: Array<{ type: string; id: string }> = [
      { type: 'list', id: listId },
    ];

    const { data: list } = await supabaseAdmin
      .from('lists')
      .select('folder_id, space_id')
      .eq('id', listId)
      .single();
    if ((list as any)?.folder_id) {
      resourceFilters.push({ type: 'folder', id: (list as any).folder_id });
    }
    if ((list as any)?.space_id) {
      resourceFilters.push({ type: 'space', id: (list as any).space_id });
    }

    const orClauses = resourceFilters
      .map(f => `and(resource_type.eq.${f.type},resource_id.eq.${f.id})`)
      .join(',');

    const { data: memberships, error } = await supabaseAdmin
      .from('resource_memberships')
      .select('user_id, users!resource_memberships_user_id_fkey(id, display_name, email, avatar_url, user_type, is_admin, status, created_at)')
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
    console.error('Get list assignable users error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /pm/lists — requires can_create_lists + member access on parent space
router.post('/lists', requirePermission('can_create_lists'), async (req: Request, res: Response) => {
  try {
    const body = createSchema.parse(req.body);

    // Check member+ access on parent space
    const spaceAccess = await checkResourceAccess(req.userId!, 'space', body.space_id);
    if (!spaceAccess || !meetsAccessLevel(spaceAccess, 'member')) {
      res.status(403).json({ success: false, error: 'Member access on the space is required to create lists' });
      return;
    }

    // Lock check on parent space/folder
    const adminUser = await isWorkspaceAdmin(req.userId!);
    if (!adminUser) {
      const parentType = body.folder_id ? 'folder' : 'space';
      const parentId = body.folder_id || body.space_id;
      if (await isResourceLocked(parentType, parentId)) {
        res.status(403).json({ success: false, error: `This ${parentType} is locked` });
        return;
      }
    }

    // If profile_id is provided, fetch the profile template
    let profile: any = null;
    if (body.profile_id) {
      const { data: profileData } = await supabaseAdmin
        .from('custom_profiles')
        .select('*')
        .eq('id', body.profile_id)
        .eq('target_type', 'list')
        .eq('is_enabled', true)
        .single();

      if (!profileData) {
        res.status(400).json({ success: false, error: 'Invalid or disabled profile' });
        return;
      }
      profile = profileData;
    }

    const { count } = await supabaseAdmin
      .from('lists')
      .select('*', { count: 'exact', head: true })
      .eq('space_id', body.space_id)
      .is('deleted_at', null);

    const insertPayload: Record<string, unknown> = {
        space_id: body.space_id,
        folder_id: body.folder_id || null,
        name: body.name,
        is_private: true,
        created_by: req.userId!,
        position: count || 0,
      };

    // Apply profile template defaults, then allow explicit overrides
    if (profile) {
      insertPayload.profile_id = profile.id;
      insertPayload.profile_version = profile.version;
      const template = profile.template as any;
      if (template?.default_view) {
        insertPayload.default_view = template.default_view;
      }
    }
    if (body.default_view) {
      insertPayload.default_view = body.default_view;
    }

    const { data, error } = await supabaseAdmin
      .from('lists')
      .insert(insertPayload)
      .select()
      .single();

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    await supabaseAdmin.from('resource_memberships').insert({
      resource_type: 'list',
      resource_id: data.id,
      user_id: req.userId!,
      access_level: 'manager',
    });

    res.status(201).json({ success: true, data });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Create list error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PUT /pm/lists/:id — requires manager access
router.put('/lists/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    const userLevel = await checkResourceAccess(req.userId!, 'list', id);
    if (!userLevel || !meetsAccessLevel(userLevel, 'manager')) {
      res.status(403).json({ success: false, error: 'Manager access required to update lists' });
      return;
    }

    const adminUser = await isWorkspaceAdmin(req.userId!);
    if (!adminUser && await isResourceLocked('list', id)) {
      res.status(403).json({ success: false, error: 'This list is locked' });
      return;
    }

    const updates: Record<string, unknown> = {};
    if (req.body.name) updates.name = req.body.name;
    if (req.body.default_view) updates.default_view = req.body.default_view;
    if (req.body.folder_id !== undefined) updates.folder_id = req.body.folder_id;
    if (req.body.space_id !== undefined) updates.space_id = req.body.space_id;
    if (typeof req.body.group_tasks === 'boolean') updates.group_tasks = req.body.group_tasks;

    // Validate destination when moving (space_id or folder_id changed)
    if ('space_id' in updates || 'folder_id' in updates) {
      const { data: currentList } = await supabaseAdmin
        .from('lists')
        .select('space_id, folder_id')
        .eq('id', id)
        .single();
      if (!currentList) {
        res.status(404).json({ success: false, error: 'List not found' });
        return;
      }

      const resolvedSpaceId = (updates.space_id as string | undefined) ?? currentList.space_id;
      const resolvedFolderId = ('folder_id' in updates
        ? (updates.folder_id as string | null | undefined)
        : currentList.folder_id) ?? null;

      // Destination space must exist and be accessible at member+
      if (updates.space_id && updates.space_id !== currentList.space_id) {
        const { data: destSpace } = await supabaseAdmin
          .from('spaces')
          .select('id, deleted_at')
          .eq('id', resolvedSpaceId)
          .single();
        if (!destSpace || destSpace.deleted_at) {
          res.status(400).json({ success: false, error: 'Destination space does not exist' });
          return;
        }
        const destAccess = await checkResourceAccess(req.userId!, 'space', resolvedSpaceId);
        if (!destAccess || !meetsAccessLevel(destAccess, 'member')) {
          res.status(403).json({ success: false, error: 'Member access required on destination space' });
          return;
        }
        if (!adminUser && await isResourceLocked('space', resolvedSpaceId)) {
          res.status(403).json({ success: false, error: 'Destination space is locked' });
          return;
        }
      }

      // Destination folder (if provided) must exist, not be soft-deleted, and live in the resolved space
      if (resolvedFolderId) {
        const { data: destFolder } = await supabaseAdmin
          .from('folders')
          .select('id, space_id, deleted_at')
          .eq('id', resolvedFolderId)
          .single();
        if (!destFolder || destFolder.deleted_at) {
          res.status(400).json({ success: false, error: 'Destination folder does not exist' });
          return;
        }
        if (destFolder.space_id !== resolvedSpaceId) {
          res.status(400).json({ success: false, error: 'Destination folder is not in the destination space' });
          return;
        }
      }
    }

    const { data, error } = await supabaseAdmin
      .from('lists')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.json({ success: true, data });
  } catch (err) {
    console.error('Update list error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /pm/lists/:id — soft-delete, requires manager access
router.delete('/lists/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    const userLevel = await checkResourceAccess(req.userId!, 'list', id);
    if (!userLevel || !meetsAccessLevel(userLevel, 'manager')) {
      res.status(403).json({ success: false, error: 'Manager access required to delete lists' });
      return;
    }

    const adminUser = await isWorkspaceAdmin(req.userId!);
    if (!adminUser && await isResourceLocked('list', id)) {
      res.status(403).json({ success: false, error: 'This list is locked' });
      return;
    }

    const { error } = await supabaseAdmin
      .from('lists')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id);

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.json({ success: true, message: 'List moved to trash' });
  } catch (err) {
    console.error('Delete list error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
