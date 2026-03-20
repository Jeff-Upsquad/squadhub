import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../supabase';
import { requireAuth } from '../middleware/auth';

const router = Router();

// All favorites routes require auth
router.use(requireAuth);

// GET /favorites?workspace_id=xxx
router.get('/', async (req: Request, res: Response) => {
  try {
    const workspaceId = req.query.workspace_id as string;
    if (!workspaceId) {
      res.status(400).json({ success: false, error: 'workspace_id is required' });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('favorites')
      .select('*')
      .eq('user_id', (req as any).userId)
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false });

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    // Enrich with item names
    const enriched = await Promise.all(
      (data || []).map(async (fav) => {
        const table =
          fav.item_type === 'channel'
            ? 'channels'
            : fav.item_type === 'list'
            ? 'lists'
            : fav.item_type === 'folder'
            ? 'folders'
            : 'spaces';

        const { data: item } = await supabaseAdmin
          .from(table)
          .select('id, name')
          .eq('id', fav.item_id)
          .single();

        return { ...fav, item_name: item?.name || 'Unknown' };
      })
    );

    res.json({ success: true, data: enriched });
  } catch (err) {
    console.error('GET /favorites error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

const createSchema = z.object({
  workspace_id: z.string().uuid(),
  item_type: z.enum(['channel', 'list', 'folder', 'space']),
  item_id: z.string().uuid(),
});

// POST /favorites
router.post('/', async (req: Request, res: Response) => {
  try {
    const body = createSchema.parse(req.body);

    const { data, error } = await supabaseAdmin
      .from('favorites')
      .insert({ ...body, user_id: (req as any).userId })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        res.status(409).json({ success: false, error: 'Already favorited' });
        return;
      }
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.status(201).json({ success: true, data });
  } catch (err: any) {
    if (err.name === 'ZodError') {
      res.status(400).json({ success: false, error: 'Invalid request body' });
      return;
    }
    console.error('POST /favorites error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /favorites/:id
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { error } = await supabaseAdmin
      .from('favorites')
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', (req as any).userId);

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.json({ success: true, message: 'Favorite removed' });
  } catch (err) {
    console.error('DELETE /favorites error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
