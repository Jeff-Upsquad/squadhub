import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../../supabase';
import { requireAuth } from '../../middleware/auth';

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

// GET /pm/spaces?workspace_id=xxx
router.get('/spaces', async (req: Request, res: Response) => {
  try {
    const workspaceId = req.query.workspace_id as string;
    if (!workspaceId) {
      res.status(400).json({ success: false, error: 'workspace_id is required' });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('spaces')
      .select('*, space_statuses(*)')
      .eq('workspace_id', workspaceId)
      .order('position');

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.json({ success: true, data });
  } catch (err) {
    console.error('Get spaces error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /pm/spaces/:id — full space with statuses, folders, lists
router.get('/spaces/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    const { data: space, error } = await supabaseAdmin
      .from('spaces')
      .select('*, space_statuses(*)')
      .eq('id', id)
      .single();

    if (error || !space) {
      res.status(404).json({ success: false, error: 'Space not found' });
      return;
    }

    // Fetch folders with their lists
    const { data: folders } = await supabaseAdmin
      .from('folders')
      .select('*, lists(*)')
      .eq('space_id', id)
      .order('position');

    // Fetch lists directly in space (no folder)
    const { data: rootLists } = await supabaseAdmin
      .from('lists')
      .select('*')
      .eq('space_id', id)
      .is('folder_id', null)
      .order('position');

    res.json({
      success: true,
      data: {
        ...space,
        folders: folders || [],
        lists: rootLists || [],
      },
    });
  } catch (err) {
    console.error('Get space error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /pm/spaces
router.post('/spaces', async (req: Request, res: Response) => {
  try {
    const body = createSchema.parse(req.body);

    // Get the next position
    const { count } = await supabaseAdmin
      .from('spaces')
      .select('*', { count: 'exact', head: true })
      .eq('workspace_id', body.workspace_id);

    const { data, error } = await supabaseAdmin
      .from('spaces')
      .insert({
        workspace_id: body.workspace_id,
        name: body.name,
        color: body.color || '#7c3aed',
        icon: body.icon || 'folder',
        description: body.description || null,
        created_by: req.userId!,
        position: count || 0,
      })
      .select('*, space_statuses(*)')
      .single();

    if (error) {
      res.status(500).json({ success: false, error: error.message });
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

// PUT /pm/spaces/:id
router.put('/spaces/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
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

// DELETE /pm/spaces/:id
router.delete('/spaces/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const { error } = await supabaseAdmin.from('spaces').delete().eq('id', id);

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.json({ success: true, message: 'Space deleted' });
  } catch (err) {
    console.error('Delete space error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
