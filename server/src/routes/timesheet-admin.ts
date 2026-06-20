import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requireMiniAppOrAdmin } from '../middleware/miniApp';
import { supabaseAdmin } from '../supabase';
import { getEligibleUsers } from '../utils/checkin';

const router = Router();

// Shares the 'check-ins' mini app grant with the rest of the admin module.
router.use(requireAuth);
router.use(requireMiniAppOrAdmin('check-ins'));

// GET /admin/timesheet/users — eligible users + their active target count.
router.get('/users', async (_req: Request, res: Response) => {
  try {
    const eligible = await getEligibleUsers();

    const { data: targets } = await supabaseAdmin
      .from('timesheet_targets')
      .select('user_id')
      .eq('is_active', true);

    const counts = new Map<string, number>();
    for (const t of (targets || []) as any[]) {
      counts.set(t.user_id, (counts.get(t.user_id) || 0) + 1);
    }

    const data = eligible.map((u) => ({
      id: u.id,
      display_name: u.display_name,
      email: u.email,
      avatar_url: u.avatar_url,
      target_count: counts.get(u.id) || 0,
    }));

    res.json({ success: true, data });
  } catch (err) {
    console.error('Timesheet admin users error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /admin/timesheet/clients — active clients for the target editor.
router.get('/clients', async (_req: Request, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('clients')
      .select('id, business_name')
      .eq('status', 'active')
      .order('business_name');

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true, data });
  } catch (err) {
    console.error('Timesheet admin clients error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /admin/timesheet/targets?user_id= — a user's targets (with client name).
router.get('/targets', async (req: Request, res: Response) => {
  try {
    const userId = req.query.user_id as string;
    if (!userId) {
      res.status(400).json({ success: false, error: 'user_id is required' });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('timesheet_targets')
      .select('*, clients(id, business_name)')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true, data });
  } catch (err) {
    console.error('Timesheet admin targets error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PUT /admin/timesheet/targets/:userId — replace a user's full target set.
const targetSchema = z.object({
  client_id: z.string().uuid(),
  kind: z.enum(['hours', 'item']),
  label: z.string().max(60).default(''),
  per_day: z.number().min(0).default(0),
  per_week: z.number().min(0).default(0),
  per_month: z.number().min(0).default(0),
});
const replaceSchema = z.object({ targets: z.array(targetSchema) });

router.put('/targets/:userId', async (req: Request, res: Response) => {
  try {
    const userId = req.params.userId;
    const { targets } = replaceSchema.parse(req.body);

    // Replace-set semantics: drop existing, insert the provided lines.
    const { error: delError } = await supabaseAdmin
      .from('timesheet_targets')
      .delete()
      .eq('user_id', userId);
    if (delError) {
      res.status(500).json({ success: false, error: delError.message });
      return;
    }

    if (targets.length > 0) {
      // De-dupe by (client_id, kind) to respect the unique constraint.
      const seen = new Set<string>();
      const rows = targets
        .filter((t) => {
          const key = `${t.client_id}:${t.kind}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .map((t) => ({
          user_id: userId,
          client_id: t.client_id,
          kind: t.kind,
          label: t.label,
          per_day: t.per_day,
          per_week: t.per_week,
          per_month: t.per_month,
          is_active: true,
          updated_at: new Date().toISOString(),
        }));

      const { error: insError } = await supabaseAdmin.from('timesheet_targets').insert(rows);
      if (insError) {
        res.status(500).json({ success: false, error: insError.message });
        return;
      }
    }

    const { data } = await supabaseAdmin
      .from('timesheet_targets')
      .select('*, clients(id, business_name)')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });

    res.json({ success: true, data });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Timesheet admin replace targets error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /admin/timesheet/history — submissions with filters.
router.get('/history', async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));
    const offset = (page - 1) * limit;
    const userId = req.query.user_id as string;
    const status = req.query.status as string;
    const startDate = req.query.start_date as string;
    const endDate = req.query.end_date as string;

    let query = supabaseAdmin
      .from('timesheets')
      .select('*, users(id, display_name, email, avatar_url)', { count: 'exact' })
      .order('date', { ascending: false })
      .range(offset, offset + limit - 1);

    if (userId) query = query.eq('user_id', userId);
    if (status) query = query.eq('status', status);
    if (startDate) query = query.gte('date', startDate);
    if (endDate) query = query.lte('date', endDate);

    const { data, error, count } = await query;
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.json({ success: true, data, total: count || 0, page, limit });
  } catch (err) {
    console.error('Timesheet admin history error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
