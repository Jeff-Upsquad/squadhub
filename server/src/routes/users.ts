import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { supabaseAdmin } from '../supabase';

const router = Router();

const updateProfileSchema = z.object({
  display_name: z.string().min(1).max(50).optional(),
  avatar_url: z.string().url().nullable().optional(),
});

// GET /users/me — get current user's profile
router.get('/me', requireAuth, async (req: Request, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('id', req.userId!)
      .single();

    if (error || !data) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }

    res.json({ success: true, data });
  } catch (err) {
    console.error('Get user error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PUT /users/me — update current user's profile
router.put('/me', requireAuth, async (req: Request, res: Response) => {
  try {
    const body = updateProfileSchema.parse(req.body);

    const { data, error } = await supabaseAdmin
      .from('users')
      .update(body)
      .eq('id', req.userId!)
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
    console.error('Update user error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
