import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../../supabase';
import { requireAuth } from '../../middleware/auth';
import { requirePermission, checkResourceAccess, meetsAccessLevel } from '../../middleware/permissions';

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

    // Check user has at least viewer access to the parent space
    const userLevel = await checkResourceAccess(req.userId!, 'space', spaceId);
    if (!userLevel) {
      res.status(403).json({ success: false, error: 'You do not have access to this space' });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('folders')
      .select('*, lists(*)')
      .eq('space_id', spaceId)
      .is('deleted_at', null)
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

    const { count } = await supabaseAdmin
      .from('folders')
      .select('*', { count: 'exact', head: true })
      .eq('space_id', body.space_id);

    const { data, error } = await supabaseAdmin
      .from('folders')
      .insert({
        space_id: body.space_id,
        name: body.name,
        is_private: true,
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

// PUT /pm/folders/:id — requires manager access on folder
router.put('/folders/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    const userLevel = await checkResourceAccess(req.userId!, 'folder', id);
    if (!userLevel || !meetsAccessLevel(userLevel, 'manager')) {
      res.status(403).json({ success: false, error: 'Manager access required to update folders' });
      return;
    }

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

// DELETE /pm/folders/:id — soft-delete, requires manager access
router.delete('/folders/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    const userLevel = await checkResourceAccess(req.userId!, 'folder', id);
    if (!userLevel || !meetsAccessLevel(userLevel, 'manager')) {
      res.status(403).json({ success: false, error: 'Manager access required to delete folders' });
      return;
    }

    const now = new Date().toISOString();

    // Soft-delete the folder
    const { error } = await supabaseAdmin
      .from('folders')
      .update({ deleted_at: now })
      .eq('id', id);

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    // Also soft-delete child lists
    await supabaseAdmin.from('lists').update({ deleted_at: now }).eq('folder_id', id).is('deleted_at', null);

    res.json({ success: true, message: 'Folder moved to trash' });
  } catch (err) {
    console.error('Delete folder error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
