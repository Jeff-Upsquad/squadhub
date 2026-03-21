import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../../supabase';
import { requireAuth } from '../../middleware/auth';
import { requirePermission, isWorkspaceAdmin, checkResourceAccess, meetsAccessLevel } from '../../middleware/permissions';

const router = Router();

// All PM routes require auth
router.use(requireAuth);

const createSchema = z.object({
  workspace_id: z.string().uuid(),
  name: z.string().min(1).max(100),
  color: z.string().optional(),
  icon: z.string().optional(),
  description: z.string().optional(),
});

// GET /pm/spaces?workspace_id=xxx — list spaces the user has access to
router.get('/spaces', async (req: Request, res: Response) => {
  try {
    const workspaceId = req.query.workspace_id as string;
    if (!workspaceId) {
      res.status(400).json({ success: false, error: 'workspace_id is required' });
      return;
    }

    // Admins see all spaces
    const admin = await isWorkspaceAdmin(req.userId!);
    if (admin) {
      const { data, error } = await supabaseAdmin
        .from('spaces')
        .select('*, space_statuses(*)')
        .eq('workspace_id', workspaceId)
        .is('deleted_at', null)
        .order('position');

      if (error) {
        res.status(500).json({ success: false, error: error.message });
        return;
      }
      res.json({ success: true, data });
      return;
    }

    // Non-admins: only spaces they have membership for, or they created
    const { data: memberships } = await supabaseAdmin
      .from('resource_memberships')
      .select('resource_id, access_level')
      .eq('resource_type', 'space')
      .eq('user_id', req.userId!);

    const memberMap = new Map((memberships || []).map((m: any) => [m.resource_id, m.access_level]));

    const { data: createdSpaces } = await supabaseAdmin
      .from('spaces')
      .select('id')
      .eq('workspace_id', workspaceId)
      .is('deleted_at', null)
      .eq('created_by', req.userId!);

    const createdIds = (createdSpaces || []).map((s: any) => s.id);
    const allIds = [...new Set([...memberMap.keys(), ...createdIds])];

    if (allIds.length === 0) {
      res.json({ success: true, data: [] });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('spaces')
      .select('*, space_statuses(*)')
      .eq('workspace_id', workspaceId)
      .is('deleted_at', null)
      .in('id', allIds)
      .order('position');

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    // Attach access level
    const enriched = (data || []).map((space: any) => ({
      ...space,
      my_access_level: createdIds.includes(space.id) ? 'manager' : memberMap.get(space.id) || 'viewer',
    }));

    res.json({ success: true, data: enriched });
  } catch (err) {
    console.error('Get spaces error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /pm/spaces/:id — full space with statuses, folders, lists
router.get('/spaces/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    // Check access
    const userLevel = await checkResourceAccess(req.userId!, 'space', id);
    if (!userLevel) {
      res.status(403).json({ success: false, error: 'You do not have access to this space' });
      return;
    }

    const { data: space, error } = await supabaseAdmin
      .from('spaces')
      .select('*, space_statuses(*)')
      .eq('id', id)
      .single();

    if (error || !space) {
      res.status(404).json({ success: false, error: 'Space not found' });
      return;
    }

    // Fetch non-deleted folders
    const { data: folders } = await supabaseAdmin
      .from('folders')
      .select('*')
      .eq('space_id', id)
      .is('deleted_at', null)
      .order('position');

    // Fetch all non-deleted lists in this space
    const { data: allLists } = await supabaseAdmin
      .from('lists')
      .select('*')
      .eq('space_id', id)
      .is('deleted_at', null)
      .order('position');

    // Attach lists to their folders
    const foldersWithLists = (folders || []).map((f: any) => ({
      ...f,
      lists: (allLists || []).filter((l: any) => l.folder_id === f.id),
    }));

    // Root lists (no folder)
    const rootLists = (allLists || []).filter((l: any) => !l.folder_id);

    res.json({
      success: true,
      data: {
        ...space,
        my_access_level: userLevel,
        folders: foldersWithLists,
        lists: rootLists || [],
      },
    });
  } catch (err) {
    console.error('Get space error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /pm/spaces — requires can_create_spaces permission
router.post('/spaces', requirePermission('can_create_spaces'), async (req: Request, res: Response) => {
  try {
    const body = createSchema.parse(req.body);

    // Get the next position
    const { count } = await supabaseAdmin
      .from('spaces')
      .select('*', { count: 'exact', head: true })
      .eq('workspace_id', body.workspace_id);

    const { data: inserted, error: insertError } = await supabaseAdmin
      .from('spaces')
      .insert({
        workspace_id: body.workspace_id,
        name: body.name,
        color: body.color || '#7c3aed',
        icon: body.icon || 'folder',
        description: body.description || null,
        is_private: true,
        created_by: req.userId!,
        position: count || 0,
      })
      .select()
      .single();

    if (insertError) {
      console.error('Space insert error:', insertError);
      res.status(500).json({ success: false, error: insertError.message });
      return;
    }

    // Fetch the space with statuses separately (trigger-created rows
    // may not be visible in the same insert statement's RETURNING clause)
    const { data, error } = await supabaseAdmin
      .from('spaces')
      .select('*, space_statuses(*)')
      .eq('id', inserted.id)
      .single();

    if (error) {
      console.error('Space select error:', error);
      res.status(201).json({ success: true, data: inserted });
      return;
    }

    res.status(201).json({ success: true, data });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Create space error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PUT /pm/spaces/:id — requires manager access
router.put('/spaces/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    const userLevel = await checkResourceAccess(req.userId!, 'space', id);
    if (!userLevel || !meetsAccessLevel(userLevel, 'manager')) {
      res.status(403).json({ success: false, error: 'Manager access required to update spaces' });
      return;
    }

    const updates: Record<string, unknown> = {};
    if (req.body.name) updates.name = req.body.name;
    if (req.body.color) updates.color = req.body.color;
    if (req.body.icon) updates.icon = req.body.icon;
    if (req.body.description !== undefined) updates.description = req.body.description;

    const { data, error } = await supabaseAdmin
      .from('spaces')
      .update(updates)
      .eq('id', id)
      .select('*, space_statuses(*)')
      .single();

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.json({ success: true, data });
  } catch (err) {
    console.error('Update space error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /pm/spaces/:id — soft-delete, requires manager access
router.delete('/spaces/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    const userLevel = await checkResourceAccess(req.userId!, 'space', id);
    if (!userLevel || !meetsAccessLevel(userLevel, 'manager')) {
      res.status(403).json({ success: false, error: 'Manager access required to delete spaces' });
      return;
    }

    const now = new Date().toISOString();

    // Soft-delete the space
    const { error } = await supabaseAdmin
      .from('spaces')
      .update({ deleted_at: now })
      .eq('id', id);

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    // Also soft-delete child folders and lists
    await supabaseAdmin.from('folders').update({ deleted_at: now }).eq('space_id', id).is('deleted_at', null);
    await supabaseAdmin.from('lists').update({ deleted_at: now }).eq('space_id', id).is('deleted_at', null);

    res.json({ success: true, message: 'Space moved to trash' });
  } catch (err) {
    console.error('Delete space error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
