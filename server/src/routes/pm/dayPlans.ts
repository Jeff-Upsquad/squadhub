import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../../supabase';
import { requireAuth } from '../../middleware/auth';
import { requireUserType } from '../../middleware/userType';
import { PARTNER_USER_TYPES } from '@squadhub/shared';

const router = Router();
router.use(requireAuth);
router.use(requireUserType('internal', ...PARTNER_USER_TYPES, 'client', 'client_staff'));

const dateRe = /^\d{4}-\d{2}-\d{2}$/;

const createSchema = z.object({
  task_id: z.string().uuid(),
  plan_date: z.string().regex(dateRe),
  start_minute: z.number().int().min(0).max(1439),
  duration_minutes: z.number().int().min(1).max(1440),
});

const updateSchema = z.object({
  start_minute: z.number().int().min(0).max(1439).optional(),
  duration_minutes: z.number().int().min(1).max(1440).optional(),
});

// Join each plan row with a minimal task summary so the calendar block can
// render title + duration without an extra round-trip.
async function hydrate(plans: any[]): Promise<any[]> {
  const taskIds = Array.from(new Set(plans.map((p) => p.task_id)));
  if (taskIds.length === 0) return plans;
  // NB: live tasks table has `status` TEXT (catalog key) but NOT `status_id`
  // despite what the shared TS Task type claims — including status_id here
  // makes Supabase reject the whole select with 42703.
  const { data: tasks, error: tasksErr } = await supabaseAdmin
    .from('tasks')
    .select('id, title, priority, status, time_estimate, list_id')
    .in('id', taskIds);
  if (tasksErr) {
    console.error('[dayPlans] tasks lookup failed:', tasksErr);
  }
  const taskMap = new Map<string, any>((tasks || []).map((t: any) => [t.id, t]));

  const listIds = Array.from(
    new Set((tasks || []).map((t: any) => t.list_id).filter(Boolean)),
  );
  const { data: lists } = listIds.length
    ? await supabaseAdmin.from('lists').select('id, name').in('id', listIds)
    : { data: [] as any[] };
  const listMap = new Map<string, any>((lists || []).map((l: any) => [l.id, l]));

  return plans.map((p) => {
    const t = taskMap.get(p.task_id);
    const l = t?.list_id ? listMap.get(t.list_id) : null;
    return {
      ...p,
      task: t ? { ...t, list: l ? { id: l.id, name: l.name } : null } : null,
    };
  });
}

// GET /pm/day-plans?date=YYYY-MM-DD — caller's plan blocks for the date.
router.get('/day-plans', async (req: Request, res: Response) => {
  try {
    const date = req.query.date as string;
    if (!date || !dateRe.test(date)) {
      res.status(400).json({ success: false, error: 'date=YYYY-MM-DD is required' });
      return;
    }
    const { data, error } = await supabaseAdmin
      .from('task_day_plans')
      .select('*')
      .eq('user_id', req.userId!)
      .eq('plan_date', date)
      .order('start_minute', { ascending: true });
    if (error) {
      console.error('[dayPlans GET] supabase error:', error);
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    const hydrated = await hydrate(data || []);
    res.json({ success: true, data: hydrated });
  } catch (err) {
    console.error('Get day plans error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /pm/day-plans — upsert a block for (task_id, user_id, plan_date).
// Dragging the same task onto a different time on the same day overwrites.
router.post('/day-plans', async (req: Request, res: Response) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.message });
      return;
    }
    const { task_id, plan_date, start_minute, duration_minutes } = parsed.data;

    const { data, error } = await supabaseAdmin
      .from('task_day_plans')
      .upsert(
        {
          task_id,
          user_id: req.userId!,
          plan_date,
          start_minute,
          duration_minutes,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'task_id,user_id,plan_date' },
      )
      .select('*')
      .single();
    if (error) {
      console.error('[dayPlans POST] supabase error:', error);
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    const [hydrated] = await hydrate([data]);
    res.json({ success: true, data: hydrated });
  } catch (err) {
    console.error('Create day plan error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PATCH /pm/day-plans/:id — move or resize a block. Caller must own it.
router.patch('/day-plans/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.message });
      return;
    }
    const patch: Record<string, unknown> = { ...parsed.data, updated_at: new Date().toISOString() };
    const { data, error } = await supabaseAdmin
      .from('task_day_plans')
      .update(patch)
      .eq('id', id)
      .eq('user_id', req.userId!)
      .select('*')
      .single();
    if (error) {
      console.error('[dayPlans PATCH] supabase error:', error);
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    if (!data) {
      res.status(404).json({ success: false, error: 'Day plan not found' });
      return;
    }
    const [hydrated] = await hydrate([data]);
    res.json({ success: true, data: hydrated });
  } catch (err) {
    console.error('Patch day plan error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /pm/day-plans/:id — caller must own it.
router.delete('/day-plans/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const { error } = await supabaseAdmin
      .from('task_day_plans')
      .delete()
      .eq('id', id)
      .eq('user_id', req.userId!);
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Delete day plan error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /pm/day-plans?task_id=...&plan_date=YYYY-MM-DD — unschedule a task
// from a specific day for the caller. Used by the Day Planner's × button:
// targeting by (task, date) instead of plan id avoids a race where the user
// dismisses a block whose optimistic id hasn't been swapped for the real
// UUID yet (the per-id DELETE would silently no-op and the refetch would
// bring the plan back).
router.delete('/day-plans', async (req: Request, res: Response) => {
  try {
    const task_id = req.query.task_id as string | undefined;
    const plan_date = req.query.plan_date as string | undefined;
    if (!task_id || !plan_date || !dateRe.test(plan_date)) {
      res.status(400).json({ success: false, error: 'task_id and plan_date=YYYY-MM-DD are required' });
      return;
    }
    const { error } = await supabaseAdmin
      .from('task_day_plans')
      .delete()
      .eq('task_id', task_id)
      .eq('plan_date', plan_date)
      .eq('user_id', req.userId!);
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Delete day plan by task error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
