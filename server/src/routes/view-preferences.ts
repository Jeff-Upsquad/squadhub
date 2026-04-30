import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../supabase';
import { requireAuth } from '../middleware/auth';

const router = Router();

router.use(requireAuth);

const bodySchema = z.object({
  preferences: z.record(z.unknown()),
});

router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;

    const { data, error } = await supabaseAdmin
      .from('user_view_preferences')
      .select('preferences')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.json({ success: true, data: { preferences: data?.preferences ?? {} } });
  } catch (err) {
    console.error('Get view preferences error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.put('/', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { preferences } = bodySchema.parse(req.body);

    const { data, error } = await supabaseAdmin
      .from('user_view_preferences')
      .upsert(
        { user_id: userId, preferences },
        { onConflict: 'user_id' },
      )
      .select()
      .single();

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.json({ success: true, data });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Save view preferences error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
