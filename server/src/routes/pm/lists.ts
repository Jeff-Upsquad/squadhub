import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../../supabase';
import { requireAuth } from '../../middleware/auth';

const router = Router();
router.use(requireAuth);

const createSchema = z.object({
  space_id: z.string().uuid(),
  folder_id: z.string().uuid().optional(),
  name: z.string().min(1).max(100),
  default_view: z.enum(['list', 'board']).optional(),
});

// GET /pm/lists?space_id=xxx or ?folder_id=xxx
router.get('/lists', async (req: Request, res: Response) => {
  try {
    const spaceId = req.query.space_id as string;
    const folderId = req.query.folder_id as string;

    let query = supabaseAdmin.from('lists').select('*').order('position');

    if (folderId) {
      query = query.eq('folder_id', folderId);
    } else if (spaceId) {
      query = query.eq('space_id', spaceId);
    } else {
      res.status(400).json({ success: false, error: 'space_id or folder_id is required' });
      return;
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

    const { data: list, error } = await supabaseAdmin
      .from('lists')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !list) {
      res.status(404).json({ success: false, error: 'List not found' });
      return;
    }

    // Get task count
    const { count } = await supabaseAdmin
      .from('tasks')
      .select('*', { count: 'exact', head: true })
      .eq('list_id', id)
      .is('parent_task_id', null);

    res.json({ success: true, data: { ...list, task_count: count || 0 } });
  } catch (err) {
    console.error('Get list error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /pm/lists
router.post('/lists', async (req: Request, res: Response) => {
  try {
    const body = createSchema.parse(req.body);

    const { count } = await supabaseAdmin
      .from('lists')
      .select('*', { count: 'exact', head: true })
      .eq('space_id', body.space_id);

    const { data, error } = await supabaseAdmin
      .from('lists')
      .insert({
        space_id: body.space_id,
        folder_id: body.folder_id || null,
        name: body.name,
        default_view: body.default_view || 'list',
        created_by: req.userId!,
        position: count || 0,
      })
      .select()
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
    console.error('Create list error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PUT /pm/lists/:id
router.put('/lists/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const updates: Record<string, unknown> = {};
    if (req.body.name) updates.name = req.body.name;
    if (req.body.default_view) updates.default_view = req.body.default_view;
    if (req.body.folder_id !== undefined) updates.folder_id = req.body.folder_id;

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

// DELETE /pm/lists/:id
router.delete('/lists/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const { error } = await supabaseAdmin.from('lists').delete().eq('id', id);

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.json({ success: true, message: 'List deleted' });
  } catch (err) {
    console.error('Delete list error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
