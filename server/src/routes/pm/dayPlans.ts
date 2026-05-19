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

// Recurrence matching for work-block virtual occurrences. Kept here (not
// in a shared package) so the day-planner endpoint has zero new deps. The
// web client has a mirror in web/src/utils/workBlockRecurrence.ts.
type Recurrence = {
  kind: 'none' | 'daily' | 'weekdays' | 'weekly' | 'monthly';
  weekdays?: number[];
  day_of_month?: number;
  starts_on?: string;
  ends_on?: string | null;
};

function occursOn(rule: Recurrence | null | undefined, dateStr: string): boolean {
  if (!rule) return false;
  if (rule.starts_on && dateStr < rule.starts_on) return false;
  if (rule.ends_on && dateStr > rule.ends_on) return false;
  if (rule.kind === 'none') {
    // One-off blocks: an occurrence only on starts_on (if set).
    return !!rule.starts_on && rule.starts_on === dateStr;
  }
  // Build a UTC-noon Date to dodge DST edges when reading getUTCDay/getUTCDate.
  const d = new Date(`${dateStr}T12:00:00Z`);
  const dow = d.getUTCDay(); // 0=Sun..6=Sat
  const dom = d.getUTCDate();
  if (rule.kind === 'daily') return true;
  if (rule.kind === 'weekdays') return dow >= 1 && dow <= 5;
  if (rule.kind === 'weekly') return Array.isArray(rule.weekdays) && rule.weekdays.includes(dow);
  if (rule.kind === 'monthly') return typeof rule.day_of_month === 'number' && rule.day_of_month === dom;
  return false;
}

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
    .select('id, title, priority, status, time_estimate, list_id, task_type_id, task_types(key, color)')
    .in('id', taskIds);
  if (tasksErr) {
    console.error('[dayPlans] tasks lookup failed:', tasksErr);
  }
  // Flatten task_types join → `task_type_key` / `task_type_color` so day-planner
  // blocks can identify work blocks without an extra round-trip.
  const taskMap = new Map<string, any>(
    (tasks || []).map((t: any) => [
      t.id,
      { ...t, task_type_key: t.task_types?.key ?? null, task_type_color: t.task_types?.color ?? null },
    ]),
  );

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

// GET /pm/day-plans?date=YYYY-MM-DD — caller's plan blocks for the date,
// merged with virtual work-block occurrences whose recurrence rule fires on
// that date. Virtual rows carry `virtual: true` and `kind: 'work_block_occurrence'`
// so the client knows to PATCH them as new task_day_plans rows instead of
// updating a non-existent id.
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
    const realPlans = data || [];
    const realPlanTaskIds = new Set<string>(realPlans.map((p: any) => p.task_id));

    // Pull work-block configs whose task is assigned to the caller. Joining
    // assignee_ids in Supabase: `.contains('assignee_ids', [userId])`.
    const { data: wbConfigs } = await supabaseAdmin
      .from('work_blocks')
      .select(
        'task_id, start_minute, end_minute, recurrence, notify_before_min, notify_on_start, notify_on_end, tasks!inner(id, assignee_ids)',
      )
      .contains('tasks.assignee_ids', [req.userId!]);

    const virtualPlans: any[] = [];
    for (const wb of (wbConfigs || []) as any[]) {
      if (realPlanTaskIds.has(wb.task_id)) continue; // user already has an override
      if (!occursOn(wb.recurrence as Recurrence, date)) continue;
      const duration = (wb.end_minute as number) - (wb.start_minute as number);
      virtualPlans.push({
        id: `wb:${wb.task_id}:${date}`,
        task_id: wb.task_id,
        user_id: req.userId!,
        plan_date: date,
        start_minute: wb.start_minute,
        duration_minutes: duration,
        created_at: null,
        updated_at: null,
        virtual: true,
        kind: 'work_block_occurrence',
        wb_notify_before_min: wb.notify_before_min,
        wb_notify_on_start: wb.notify_on_start,
        wb_notify_on_end: wb.notify_on_end,
      });
    }

    const merged = [...realPlans, ...virtualPlans].sort(
      (a, b) => (a.start_minute || 0) - (b.start_minute || 0),
    );
    const hydrated = await hydrate(merged);
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
