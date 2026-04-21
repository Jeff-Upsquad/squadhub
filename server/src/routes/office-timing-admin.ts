import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { supabaseAdmin } from '../supabase';

const router = Router();

router.use(requireAuth);
router.use(requireAdmin);

const ELIGIBLE_USER_TYPES = ['internal', 'partner'] as const;

// GET /admin/office-timing/users — list eligible users with their timing row
router.get('/users', async (req: Request, res: Response) => {
  try {
    const userType = req.query.user_type as string | undefined;
    const search = (req.query.search as string || '').trim();

    let query = supabaseAdmin
      .from('users')
      .select('id, display_name, email, user_type, avatar_url, status')
      .in('user_type', Array.from(ELIGIBLE_USER_TYPES))
      .neq('status', 'banned')
      .order('display_name');

    if (userType === 'internal' || userType === 'partner') {
      query = query.eq('user_type', userType);
    }
    if (search) {
      query = query.or(`display_name.ilike.%${search}%,email.ilike.%${search}%`);
    }

    const { data: users, error: usersError } = await query;
    if (usersError) {
      res.status(500).json({ success: false, error: usersError.message });
      return;
    }

    const userIds = (users || []).map(u => u.id);

    const { data: timings, error: timingsError } = userIds.length > 0
      ? await supabaseAdmin
          .from('user_office_timing')
          .select('*')
          .in('user_id', userIds)
      : { data: [], error: null as any };

    if (timingsError) {
      res.status(500).json({ success: false, error: timingsError.message });
      return;
    }

    const timingByUser = new Map((timings || []).map((t: any) => [t.user_id, t]));

    const result = (users || []).map(u => ({
      user: u,
      timing: timingByUser.get(u.id) || null,
    }));

    res.json({ success: true, data: result });
  } catch (err) {
    console.error('List office timing users error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

const timingSchema = z.object({
  label: z.string().min(1).max(80),
  from_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'from_time must be HH:MM'),
  to_time:   z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'to_time must be HH:MM'),
  working_days: z.array(z.number().int().min(0).max(6)).min(1),
  max_break_minutes: z.number().int().min(0).max(720),
  is_active: z.boolean().optional().default(true),
}).refine(v => v.from_time < v.to_time, {
  message: 'to_time must be after from_time',
  path: ['to_time'],
});

// PUT /admin/office-timing/user/:userId — upsert a user's office timing
router.put('/user/:userId', async (req: Request, res: Response) => {
  try {
    const userId = req.params.userId;
    const body = timingSchema.parse(req.body);

    const { data: targetUser, error: userError } = await supabaseAdmin
      .from('users')
      .select('id, user_type')
      .eq('id', userId)
      .single();

    if (userError || !targetUser) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }
    if (!ELIGIBLE_USER_TYPES.includes(targetUser.user_type as any)) {
      res.status(400).json({
        success: false,
        error: 'Office timing is only configurable for internal and partner users',
      });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('user_office_timing')
      .upsert({
        user_id: userId,
        label: body.label,
        from_time: body.from_time,
        to_time: body.to_time,
        working_days: body.working_days,
        max_break_minutes: body.max_break_minutes,
        is_active: body.is_active,
      }, { onConflict: 'user_id' })
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
    console.error('Upsert office timing error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /admin/office-timing/user/:userId — remove a user's office timing
router.delete('/user/:userId', async (req: Request, res: Response) => {
  try {
    const { error } = await supabaseAdmin
      .from('user_office_timing')
      .delete()
      .eq('user_id', req.params.userId);

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.json({ success: true, message: 'Office timing removed' });
  } catch (err) {
    console.error('Delete office timing error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
