import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../../supabase';
import { requireAuth } from '../../middleware/auth';

const router = Router();
router.use(requireAuth);

const createSchema = z.object({
  space_id: z.string().uuid(),
  name: z.string().min(1).max(100),
});

// GET /pm/folders?space_id=xxx
router.get('/folders', async (req: Request, res: Response) => {
  try {
    const spaceId = req.query.space_id as string;
    if (!spaceId) {
      res.status(400).json({ success: false, error: 'space_id is required' });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('folders')
      .select('*, lists(*)')
      .eq('space_id', spaceId)
      .order('position');

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

// POST /pm/folders
router.post('/folders', async (req: Request, res: Response) => {
  try {
    const body = createSchema.parse(req.body);

    const { count } = await supabaseAdmin
      .from('folders')
      .select('*', { count: 'exact', head: true })
      .eq('space_id', body.space_id);

    const { data, error } = await supabaseAdmin
      .from('folders')
      .insert({
        space_id: body.space_id,
        name: body.name,
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
    console.error('Create folder error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PUT /pm/folders/:id
router.put('/folders/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const { data, error } = await supabaseAdmin
      .from('folders')
      .update({ name: req.body.name })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.json({ success: true, data });
  } catch (err) {
    console.error('Update folder error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /pm/folders/:id
router.delete('/folders/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    // Move lists to space root before deleting folder
    const { data: folder } = await supabaseAdmin
      .from('folders')
      .select('space_id')
      .eq('id', id)
      .single();

    if (folder) {
      await supabaseAdmin
        .from('lists')
        .update({ folder_id: null })
        .eq('folder_id', id);
    }

    const { error } = await supabaseAdmin.from('folders').delete().eq('id', id);

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.json({ success: true, message: 'Folder deleted' });
  } catch (err) {
    console.error('Delete folder error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
