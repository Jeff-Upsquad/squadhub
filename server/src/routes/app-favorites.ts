import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../supabase';
import { requireAuth } from '../middleware/auth';

const router = Router();

// Per-user pinned mini-apps shown in the home sidebar's Apps section. Apps are
// identified by slug (not a UUID), so they live in their own table rather than
// the workspace-scoped `favorites` table. Pins are global per user.
router.use(requireAuth);

// GET /app-favorites — slugs the user has pinned, newest last.
router.get('/', async (req: Request, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('app_favorites')
      .select('*')
      .eq('user_id', (req as any).userId)
      .order('created_at', { ascending: true });

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.json({ success: true, data: data || [] });
  } catch (err) {
    console.error('GET /app-favorites error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

const createSchema = z.object({
  app_slug: z.string().min(1).max(100),
});

// POST /app-favorites — pin an app. Idempotent: re-pinning is a no-op.
router.post('/', async (req: Request, res: Response) => {
  try {
    const { app_slug } = createSchema.parse(req.body);

    const { data, error } = await supabaseAdmin
      .from('app_favorites')
      .upsert(
        { user_id: (req as any).userId, app_slug },
        { onConflict: 'user_id,app_slug', ignoreDuplicates: true },
      )
      .select()
      .maybeSingle();

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.status(201).json({ success: true, data });
  } catch (err: any) {
    if (err.name === 'ZodError') {
      res.status(400).json({ success: false, error: 'Invalid request body' });
      return;
    }
    console.error('POST /app-favorites error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /app-favorites/:slug — unpin an app.
router.delete('/:slug', async (req: Request, res: Response) => {
  try {
    const { error } = await supabaseAdmin
      .from('app_favorites')
      .delete()
      .eq('user_id', (req as any).userId)
      .eq('app_slug', req.params.slug);

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.json({ success: true, message: 'App unpinned' });
  } catch (err) {
    console.error('DELETE /app-favorites error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
