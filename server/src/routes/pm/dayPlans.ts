import { Router, Request, Response } from 'express';
import { hydrateLists } from './tasks';
import { z } from 'zod';
import { supabaseAdmin } from '../../supabase';
import { requireAuth } from '../../middleware/auth';
import { requireUserType } from '../../middleware/userType';
import { PARTNER_USER_TYPES } from '@squadhub/shared';
import { taskRecurrenceOccursOn, type TaskRecurrence } from '@squadhub/shared';

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

// Formatter for splitting a TIMESTAMPTZ into local day + minute-of-day in the
// caller's tz. Returns null for an invalid/unknown IANA name so a bad ?tz=
// simply disables date-derived occurrences instead of 500ing the endpoint.
function makeTzFmt(tz: string): Intl.DateTimeFormat | null {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    });
  } catch {
    return null;
  }
}

function dayMinuteOf(fmt: Intl.DateTimeFormat, iso: string): { day: string; minute: number } {
  const parts = fmt.formatToParts(new Date(iso));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '0';
  return {
    day: `${get('year')}-${get('month')}-${get('day')}`,
    minute: Number(get('hour')) * 60 + Number(get('minute')),
  };
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

// Group blocks schedule a whole container (multi-home group) as one combined
// block. Stored in group_day_plans, keyed by (container, user, date).
const groupCreateSchema = z.object({
  container_type: z.enum(['list', 'folder', 'space']),
  container_id: z.string().uuid(),
  plan_date: z.string().regex(dateRe),
  start_minute: z.number().int().min(0).max(1439),
  duration_minutes: z.number().int().min(1).max(1440),
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
    .select('id, title, priority, status, time_estimate, list_id, recurrence, recurring_parent_id, recurrence_instance_date, task_type_id, task_types(key, color)')
    .in('id', taskIds);
  if (tasksErr) {
    console.error('[dayPlans] tasks lookup failed:', tasksErr);
  }
  // Flatten task_types join → `task_type_key` / `task_type_color` so day-planner
  // blocks can identify work blocks without an extra round-trip.
  const taskMap = new Map<string, any>(
    (await hydrateLists(tasks || [])).map((t: any) => [
      t.id,
      { ...t, task_type_key: t.task_types?.key ?? null, task_type_color: t.task_types?.color ?? null },
    ]),
  );

  // Linked tasks for time/break blocks so the calendar can render them inside
  // the block without an extra round-trip per block.
  const linksByBlock = new Map<string, Array<{ id: string; title: string; status: string | null }>>();
  const blockIds = (tasks || [])
    .filter((t: any) => t.task_types?.key === 'work_block' || t.task_types?.key === 'break_block')
    .map((t: any) => t.id);
  if (blockIds.length > 0) {
    const { data: links, error: linksErr } = await supabaseAdmin
      .from('work_block_links')
      .select('work_block_task_id, linked_task_id, position')
      .in('work_block_task_id', blockIds)
      .order('position', { ascending: true });
    if (linksErr) {
      console.error('[dayPlans] work-block links lookup failed:', linksErr);
    } else if (links && links.length > 0) {
      const linkedIds = Array.from(new Set((links as any[]).map((l: any) => l.linked_task_id)));
      const { data: linkedTasks, error: linkedErr } = await supabaseAdmin
        .from('tasks')
        .select('id, title, status')
        .in('id', linkedIds);
      if (linkedErr) {
        console.error('[dayPlans] linked-tasks lookup failed:', linkedErr);
      }
      const linkedMap = new Map<string, any>((linkedTasks || []).map((t: any) => [t.id, t]));
      for (const l of links as any[]) {
        const lt = linkedMap.get(l.linked_task_id);
        if (!lt) continue;
        const arr = linksByBlock.get(l.work_block_task_id) ?? [];
        arr.push({ id: lt.id, title: lt.title ?? 'Untitled task', status: lt.status ?? null });
        linksByBlock.set(l.work_block_task_id, arr);
      }
    }
  }

  return plans.map((p) => {
    const t = taskMap.get(p.task_id);
    return {
      ...p,
      task: t
        ? { ...t, linked_tasks: linksByBlock.get(p.task_id) ?? [] }
        : null,
    };
  });
}

// Container-level group blocks for the caller on a date. Each is ONE combined
// block standing in for a whole multi-home group; its display name is resolved
// from the container's own table (lists / folders / spaces). Shaped like a
// TaskDayPlan with kind='group_block', task=null, and a `container`.
async function loadGroupBlocks(userId: string, date: string): Promise<any[]> {
  const { data: rows, error } = await supabaseAdmin
    .from('group_day_plans')
    .select('*')
    .eq('user_id', userId)
    .eq('plan_date', date);
  if (error) {
    console.error('[dayPlans] group blocks lookup failed:', error);
    return [];
  }
  if (!rows || rows.length === 0) return [];

  const tableFor = { list: 'lists', folder: 'folders', space: 'spaces' } as const;
  const idsByType: Record<'list' | 'folder' | 'space', string[]> = { list: [], folder: [], space: [] };
  for (const r of rows as any[]) {
    const ct = r.container_type as 'list' | 'folder' | 'space';
    if (idsByType[ct]) idsByType[ct].push(r.container_id);
  }
  const nameMap = new Map<string, string>(); // `${type}:${id}` -> name
  for (const type of ['list', 'folder', 'space'] as const) {
    const ids = Array.from(new Set(idsByType[type]));
    if (!ids.length) continue;
    const { data: named } = await supabaseAdmin.from(tableFor[type]).select('id, name').in('id', ids);
    for (const n of (named || []) as any[]) nameMap.set(`${type}:${n.id}`, n.name);
  }

  return (rows as any[]).map((r) => ({
    ...r,
    kind: 'group_block',
    task: null,
    container: {
      type: r.container_type,
      id: r.container_id,
      name: nameMap.get(`${r.container_type}:${r.container_id}`) ?? 'Group',
    },
  }));
}

// GET /pm/day-plans?date=YYYY-MM-DD&tz=Area/City — caller's plan blocks for
// the date, merged with three kinds of virtual rows:
//   - work-block occurrences whose recurrence rule fires on that date, and
//   - recurrence occurrences: routine templates (tasks.recurrence) whose rule
//     fires on that date, so a daily repeat shows on every future day — not
//     just after the midnight spawner materializes that day's copy, and
//   - date-derived occurrences: assigned tasks whose work/due/start date lands
//     on that date in the caller's tz. A timestamp with a time-of-day becomes
//     a timed block; a date-only value (midnight local) becomes an all-day row
//     (`all_day: true`). Only computed when ?tz= is present — minute-of-day is
//     meaningless without it, and older clients keep their old payload.
// Virtual rows carry `virtual: true` and a `kind` so the client knows to POST
// them as new task_day_plans rows instead of updating a non-existent id.
router.get('/day-plans', async (req: Request, res: Response) => {
  try {
    const date = req.query.date as string;
    if (!date || !dateRe.test(date)) {
      res.status(400).json({ success: false, error: 'date=YYYY-MM-DD is required' });
      return;
    }
    const { data, error } = await supabaseAdmin
      .from('task_day_plans') // tenant-scope: caller's own rows (user_id = caller)
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

    // Date-derived occurrences. Tasks the user has already placed (real plan)
    // or that fired as a work-block occurrence above are skipped — an explicit
    // placement always outranks one inferred from a date field.
    const dateVirtuals: any[] = [];
    const tzFmt = typeof req.query.tz === 'string' && req.query.tz ? makeTzFmt(req.query.tz) : null;
    if (tzFmt) {
      const occupied = new Set<string>([
        ...realPlanTaskIds,
        ...virtualPlans.map((p) => p.task_id as string),
      ]);
      // UTC window wide enough to contain local-day `date` for any tz offset
      // (-12..+14). Exact day matching happens below in the caller's tz.
      // Millisecond part is stripped — PostgREST's or() parser chokes on the
      // extra dot inside the value.
      const base = new Date(`${date}T00:00:00Z`).getTime();
      const fromIso = new Date(base - 24 * 3600_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
      const toIso = new Date(base + 48 * 3600_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
      const win = (f: string) => `and(${f}.gte.${fromIso},${f}.lt.${toIso})`;
      const { data: dateTasks, error: dateErr } = await supabaseAdmin
        .from('tasks')
        .select('id, work_date, due_date, start_date, time_estimate, snoozed_until, recurring_parent_id')
        .contains('assignee_ids', [req.userId!])
        // Routine templates are expanded separately below — their own stale
        // work/due dates must not leak in as one-off occurrences here.
        .is('recurrence', null)
        .not('status', 'in', '(done,closed,cancelled,Done,Closed,Cancelled)')
        .or([win('work_date'), win('due_date'), win('start_date')].join(','));
      if (dateErr) {
        console.error('[dayPlans GET] date-task lookup failed:', dateErr);
      }
      const now = new Date();
      for (const t of (dateTasks || []) as any[]) {
        if (occupied.has(t.id)) continue;
        // A routine instance must not render alongside its template's explicit
        // placement: when the user drags the 9am recurrence virtual onto the
        // calendar (real plan for the template id), the auto-spawned copy's
        // date-derived 6pm block would otherwise duplicate the same title.
        // The explicit placement always wins.
        if (t.recurring_parent_id && occupied.has(t.recurring_parent_id)) continue;
        if (t.snoozed_until && new Date(t.snoozed_until) > now) continue;
        // First field that lands on the viewed day wins; work_date outranks
        // due/start because the planner is about when you'll do the work.
        let field: 'work' | 'due' | 'start' | null = null;
        let minute = 0;
        for (const [f, v] of [
          ['work', t.work_date],
          ['due', t.due_date],
          ['start', t.start_date],
        ] as const) {
          if (!v) continue;
          const dm = dayMinuteOf(tzFmt, v);
          if (dm.day === date) { field = f; minute = dm.minute; break; }
        }
        if (!field) continue;
        // Midnight local = no time picked — same convention as the web
        // client's hasTime check in taskHelpers.ts.
        const allDay = minute === 0;
        const est = typeof t.time_estimate === 'number' && t.time_estimate > 0 ? t.time_estimate : 30;
        dateVirtuals.push({
          id: `td:${t.id}:${date}:${field}`,
          task_id: t.id,
          user_id: req.userId!,
          plan_date: date,
          start_minute: allDay ? 0 : minute,
          duration_minutes: allDay ? 1440 : Math.max(15, Math.min(est, 1440 - minute)),
          created_at: null,
          updated_at: null,
          virtual: true,
          kind: 'date_occurrence',
          all_day: allDay,
          date_field: field,
        });
      }
    }

    // Recurrence occurrences. Routine templates (tasks.recurrence != null) are
    // hidden from list views — only spawned copies render — so without this a
    // daily repeat shows on just the day the spawner already materialized and
    // every future day looks empty. Expand the rule virtually: when it fires
    // on the viewed date, synthesize a block from the template's time-of-day
    // (work > due > start) and estimate. Skipped when the day already has a
    // real plan, a work-block/date occurrence, or a materialized instance for
    // that template — an explicit placement or the real copy always wins.
    const recurrenceVirtuals: any[] = [];
    {
      const { data: templates, error: tmplErr } = await supabaseAdmin
        .from('tasks')
        .select('id, work_date, due_date, start_date, time_estimate, snoozed_until, recurrence, recurrence_paused')
        .contains('assignee_ids', [req.userId!])
        .not('recurrence', 'is', null)
        .not('status', 'in', '(done,closed,cancelled,Done,Closed,Cancelled)');
      if (tmplErr) {
        console.error('[dayPlans GET] recurrence lookup failed:', tmplErr);
      } else {
        const due = (templates || []).filter(
          (t: any) =>
            !t.recurrence_paused &&
            taskRecurrenceOccursOn(t.recurrence as TaskRecurrence, date),
        );
        if (due.length > 0) {
          // Materialized copies for this date — their parent templates must
          // not also render as virtuals (would duplicate the block).
          const parentIds = due.map((t: any) => t.id);
          const { data: instances } = await supabaseAdmin
            .from('tasks')
            .select('recurring_parent_id')
            .in('recurring_parent_id', parentIds)
            .eq('recurrence_instance_date', date);
          const hasInstance = new Set<string>(
            ((instances || []) as any[])
              .map((r: any) => r.recurring_parent_id)
              .filter(Boolean),
          );
          const occupied = new Set<string>([
            ...realPlanTaskIds,
            ...virtualPlans.map((p) => p.task_id as string),
            ...dateVirtuals.map((p) => p.task_id as string),
          ]);
          const now = new Date();
          for (const t of due as any[]) {
            if (occupied.has(t.id) || hasInstance.has(t.id)) continue;
            if (t.snoozed_until && new Date(t.snoozed_until) > now) continue;
            // Template's time-of-day carries onto each occurrence. When the
            // server has the caller's tz, read the clock time off the first
            // set field (work > due > start); without tz or without any date,
            // fall back to an all-day row.
            let field: 'work' | 'due' | 'start' | null = null;
            let minute = 0;
            if (tzFmt) {
              for (const [f, v] of [
                ['work', t.work_date],
                ['due', t.due_date],
                ['start', t.start_date],
              ] as const) {
                if (!v) continue;
                field = f;
                minute = dayMinuteOf(tzFmt, v).minute;
                break;
              }
            }
            const allDay = minute === 0;
            const est =
              typeof t.time_estimate === 'number' && t.time_estimate > 0 ? t.time_estimate : 30;
            recurrenceVirtuals.push({
              id: `rec:${t.id}:${date}`,
              task_id: t.id,
              user_id: req.userId!,
              plan_date: date,
              start_minute: allDay ? 0 : minute,
              duration_minutes: allDay ? 1440 : Math.max(15, Math.min(est, 1440 - minute)),
              created_at: null,
              updated_at: null,
              virtual: true,
              kind: 'recurrence_occurrence',
              all_day: allDay,
              date_field: field ?? 'work',
            });
          }
        }
      }
    }

    const merged = [...realPlans, ...virtualPlans, ...dateVirtuals, ...recurrenceVirtuals].sort(
      (a, b) => (a.start_minute || 0) - (b.start_minute || 0),
    );
    const hydrated = await hydrate(merged);
    const groupBlocks = await loadGroupBlocks(req.userId!, date);
    res.json({ success: true, data: [...hydrated, ...groupBlocks] });
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
      .from('task_day_plans') // tenant-scope: caller's own rows (user_id = caller)
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
      .from('task_day_plans') // tenant-scope: caller's own rows (user_id = caller)
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
      .from('task_day_plans') // tenant-scope: caller's own rows (user_id = caller)
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

// POST /pm/group-day-plans — upsert a combined block for a whole group
// (container) on a day. Dragging the same group to another time overwrites,
// same as the per-task POST above.
router.post('/group-day-plans', async (req: Request, res: Response) => {
  try {
    const parsed = groupCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.message });
      return;
    }
    const { container_type, container_id, plan_date, start_minute, duration_minutes } = parsed.data;
    const { data, error } = await supabaseAdmin
      .from('group_day_plans')
      .upsert(
        {
          container_type,
          container_id,
          user_id: req.userId!,
          plan_date,
          start_minute,
          duration_minutes,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'container_type,container_id,user_id,plan_date' },
      )
      .select('*')
      .single();
    if (error) {
      console.error('[groupDayPlans POST] supabase error:', error);
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true, data: { ...data, kind: 'group_block' } });
  } catch (err) {
    console.error('Create group day plan error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /pm/group-day-plans?container_type=&container_id=&plan_date= — remove a
// group's block from a day. Keyed by container (not row id) to dodge the same
// optimistic-id race as the task × button.
router.delete('/group-day-plans', async (req: Request, res: Response) => {
  try {
    const container_type = req.query.container_type as string | undefined;
    const container_id = req.query.container_id as string | undefined;
    const plan_date = req.query.plan_date as string | undefined;
    if (!container_type || !container_id || !plan_date || !dateRe.test(plan_date)) {
      res.status(400).json({ success: false, error: 'container_type, container_id and plan_date=YYYY-MM-DD are required' });
      return;
    }
    const { error } = await supabaseAdmin
      .from('group_day_plans') // tenant-scope: caller's own rows (user_id = caller)
      .delete()
      .eq('container_type', container_type)
      .eq('container_id', container_id)
      .eq('plan_date', plan_date)
      .eq('user_id', req.userId!);
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Delete group day plan error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
