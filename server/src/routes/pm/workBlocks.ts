import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../../supabase';
import { requireAuth } from '../../middleware/auth';
import { requireUserType } from '../../middleware/userType';
import { PARTNER_USER_TYPES } from '@squadhub/shared';
import { logTaskTimeEntry } from '../../utils/taskTime';

const router = Router();
router.use(requireAuth);
router.use(requireUserType('internal', ...PARTNER_USER_TYPES, 'client', 'client_staff'));

const dateRe = /^\d{4}-\d{2}-\d{2}$/;

const recurrenceSchema = z.object({
  kind: z.enum(['none', 'daily', 'weekdays', 'weekly', 'monthly']),
  weekdays: z.array(z.number().int().min(0).max(6)).optional(),
  day_of_month: z.number().int().min(1).max(28).optional(),
  starts_on: z.string().regex(dateRe).optional(),
  ends_on: z.string().regex(dateRe).nullable().optional(),
});

const configCreateSchema = z.object({
  start_minute: z.number().int().min(0).max(1439),
  end_minute: z.number().int().min(1).max(1440),
  recurrence: recurrenceSchema.optional(),
  notify_before_min: z.number().int().min(0).max(60).optional(),
  notify_on_start: z.boolean().optional(),
  notify_on_end: z.boolean().optional(),
});

const configUpdateSchema = configCreateSchema.partial();

// Helper: a task must exist AND be of type work_block before its config can be
// written. Returns the task id if OK, throws-equivalent (returns null) if not.
async function assertWorkBlockTask(taskId: string): Promise<{ ok: boolean; error?: string }> {
  const { data: task, error } = await supabaseAdmin
    .from('tasks')
    .select('id, task_type_id, task_types(key)')
    .eq('id', taskId)
    .single();
  if (error || !task) return { ok: false, error: 'Task not found' };
  const key = (task as any)?.task_types?.key;
  if (key !== 'work_block') return { ok: false, error: 'Task is not a work block' };
  return { ok: true };
}

// =====================================================================
// Config: GET / POST (upsert) / PATCH / DELETE  /pm/work-blocks/:task_id
// =====================================================================

// GET /pm/work-blocks/:task_id — config + recent runs (with completions + task_times) + manual links.
// Defined BEFORE more specific routes like /work-blocks/active, so we fall
// through with next() if the param isn't a UUID.
router.get('/work-blocks/:task_id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const taskId = req.params.task_id as string;
    // Sibling routes like /work-blocks/active live below — let them match.
    if (!/^[0-9a-f-]{36}$/i.test(taskId)) { next(); return; }

    const [
      { data: config, error: configErr },
      { data: runs, error: runsErr },
      { data: links, error: linksErr },
    ] = await Promise.all([
      supabaseAdmin.from('work_blocks').select('*').eq('task_id', taskId).maybeSingle(),
      supabaseAdmin
        .from('work_block_runs')
        .select('*')
        .eq('task_id', taskId)
        .eq('user_id', req.userId!)
        .order('started_at', { ascending: false })
        .limit(50),
      supabaseAdmin
        .from('work_block_links')
        .select('*')
        .eq('work_block_task_id', taskId)
        .order('position', { ascending: true }),
    ]);
    if (configErr) {
      res.status(500).json({ success: false, error: configErr.message });
      return;
    }
    if (runsErr) {
      res.status(500).json({ success: false, error: runsErr.message });
      return;
    }
    if (linksErr) {
      res.status(500).json({ success: false, error: linksErr.message });
      return;
    }

    // Hydrate completions + task_times for each run.
    const runIds = (runs || []).map((r: any) => r.id);
    let completions: any[] = [];
    let taskTimes: any[] = [];
    if (runIds.length > 0) {
      const [{ data: c }, { data: tt }] = await Promise.all([
        supabaseAdmin
          .from('work_block_completions')
          .select('*')
          .in('run_id', runIds)
          .order('completed_at', { ascending: true }),
        supabaseAdmin
          .from('work_block_task_times')
          .select('*')
          .in('run_id', runIds)
          .order('started_at', { ascending: true }),
      ]);
      completions = c || [];
      taskTimes = tt || [];
    }
    // Hydrate task summaries used by completions, task_times, and links.
    const referencedTaskIds = Array.from(
      new Set([
        ...completions.map((c: any) => c.completed_task_id),
        ...taskTimes.map((t: any) => t.task_id),
        ...(links || []).map((l: any) => l.linked_task_id),
      ]),
    );
    let taskMap = new Map<string, any>();
    if (referencedTaskIds.length > 0) {
      const { data: ts } = await supabaseAdmin
        .from('tasks')
        .select('id, title, priority, status, list_id')
        .in('id', referencedTaskIds);
      taskMap = new Map((ts || []).map((t: any) => [t.id, t]));
    }

    const runsHydrated = (runs || []).map((r: any) => ({
      ...r,
      completions: completions
        .filter((c: any) => c.run_id === r.id)
        .map((c: any) => ({ ...c, task: taskMap.get(c.completed_task_id) || null })),
      task_times: taskTimes
        .filter((t: any) => t.run_id === r.id)
        .map((t: any) => ({ ...t, task: taskMap.get(t.task_id) || null })),
    }));
    const linksHydrated = (links || []).map((l: any) => ({
      ...l,
      task: taskMap.get(l.linked_task_id) || null,
    }));

    res.json({
      success: true,
      data: { config: config || null, runs: runsHydrated, links: linksHydrated },
    });
  } catch (err) {
    console.error('[workBlocks GET] error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /pm/work-blocks/:task_id — upsert config.
router.post('/work-blocks/:task_id', async (req: Request, res: Response) => {
  try {
    const taskId = req.params.task_id as string;
    const guard = await assertWorkBlockTask(taskId);
    if (!guard.ok) {
      res.status(400).json({ success: false, error: guard.error });
      return;
    }
    const parsed = configCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.message });
      return;
    }
    const { start_minute, end_minute, recurrence, notify_before_min, notify_on_start, notify_on_end } = parsed.data;
    if (end_minute <= start_minute) {
      res.status(400).json({ success: false, error: 'end_minute must be greater than start_minute' });
      return;
    }
    const { data, error } = await supabaseAdmin
      .from('work_blocks')
      .upsert(
        {
          task_id: taskId,
          start_minute,
          end_minute,
          recurrence: recurrence ?? { kind: 'none' },
          notify_before_min: notify_before_min ?? 5,
          notify_on_start: notify_on_start ?? true,
          notify_on_end: notify_on_end ?? true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'task_id' },
      )
      .select('*')
      .single();
    if (error) {
      console.error('[workBlocks POST] supabase error:', error);
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true, data });
  } catch (err) {
    console.error('[workBlocks POST] error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PATCH /pm/work-blocks/:task_id — partial update.
router.patch('/work-blocks/:task_id', async (req: Request, res: Response) => {
  try {
    const taskId = req.params.task_id as string;
    const parsed = configUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.message });
      return;
    }
    const patch: Record<string, unknown> = { ...parsed.data, updated_at: new Date().toISOString() };
    if (
      patch.start_minute !== undefined &&
      patch.end_minute !== undefined &&
      (patch.end_minute as number) <= (patch.start_minute as number)
    ) {
      res.status(400).json({ success: false, error: 'end_minute must be greater than start_minute' });
      return;
    }
    const { data, error } = await supabaseAdmin
      .from('work_blocks')
      .update(patch)
      .eq('task_id', taskId)
      .select('*')
      .single();
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    if (!data) {
      res.status(404).json({ success: false, error: 'Work block config not found' });
      return;
    }
    res.json({ success: true, data });
  } catch (err) {
    console.error('[workBlocks PATCH] error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /pm/work-blocks/:task_id — remove the work-block config.
router.delete('/work-blocks/:task_id', async (req: Request, res: Response) => {
  try {
    const taskId = req.params.task_id as string;
    const { error } = await supabaseAdmin.from('work_blocks').delete().eq('task_id', taskId);
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    console.error('[workBlocks DELETE] error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// =====================================================================
// Runs: start / stop / current
// =====================================================================

// Close a run: stop any open per-task overlaps, stamp ended_at/duration, and
// log the run's wall-clock as a task_time_entry on the block task so block time
// shows up in the same places as a normal per-task timer (rail Time Sheet, the
// task "Logged" field, the daily timesheet total + design Reports).
async function closeRun(
  run: { id: string; task_id: string; user_id: string; started_at: string },
  endedAt: Date,
): Promise<{ ended_at: string; duration_seconds: number } | null> {
  const duration = Math.max(
    1,
    Math.floor((endedAt.getTime() - new Date(run.started_at).getTime()) / 1000),
  );

  // Close any open per-task overlap rows for this run first so the partial
  // unique index frees up.
  const { data: openTimes } = await supabaseAdmin
    .from('work_block_task_times')
    .select('id, started_at')
    .eq('run_id', run.id)
    .is('ended_at', null);
  if (openTimes && openTimes.length > 0) {
    await Promise.all(
      (openTimes as any[]).map((row) => {
        const d = Math.max(
          1,
          Math.floor((endedAt.getTime() - new Date(row.started_at).getTime()) / 1000),
        );
        return supabaseAdmin
          .from('work_block_task_times')
          .update({ ended_at: endedAt.toISOString(), duration_seconds: d })
          .eq('id', row.id);
      }),
    );
  }

  const { data, error } = await supabaseAdmin
    .from('work_block_runs')
    .update({ ended_at: endedAt.toISOString(), duration_seconds: duration })
    .eq('id', run.id)
    .select('ended_at, duration_seconds')
    .single();
  if (error) {
    console.error('[workBlocks closeRun] run update error:', error);
    return null;
  }

  // Mirror the run as task time on the block task. Best-effort — a logging
  // failure shouldn't fail the stop itself.
  const logged = await logTaskTimeEntry({
    taskId: run.task_id,
    userId: run.user_id,
    startedAt: run.started_at,
    durationSeconds: duration,
    source: 'work_block',
    workBlockRunId: run.id,
  });
  if (!logged.ok) {
    console.error('[workBlocks closeRun] failed to log block time:', logged.error);
  }

  return data as any;
}

// POST /pm/work-blocks/:task_id/runs — start a run for the current user.
router.post('/work-blocks/:task_id/runs', async (req: Request, res: Response) => {
  try {
    const taskId = req.params.task_id as string;
    const guard = await assertWorkBlockTask(taskId);
    if (!guard.ok) {
      res.status(400).json({ success: false, error: guard.error });
      return;
    }
    // Close any pre-existing active run for this user — keeps the unique
    // partial index from rejecting the insert if the previous stop call was
    // lost (offline / crashed tab).
    const startedAt = new Date();
    const { data: existing } = await supabaseAdmin
      .from('work_block_runs')
      .select('id, task_id, user_id, started_at')
      .eq('user_id', req.userId!)
      .is('ended_at', null)
      .maybeSingle();
    if (existing) {
      // Closing the prior run also logs its block time + closes its overlaps.
      await closeRun(existing as any, startedAt);
    }

    const { data, error } = await supabaseAdmin
      .from('work_block_runs')
      .insert({
        task_id: taskId,
        user_id: req.userId!,
        started_at: startedAt.toISOString(),
      })
      .select('*')
      .single();
    if (error) {
      console.error('[workBlocks runs POST] supabase error:', error);
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true, data });
  } catch (err) {
    console.error('[workBlocks runs POST] error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PATCH /pm/work-blocks/runs/:run_id — stop a run. Also closes any open
// task-time rows for this run so the per-task overlap doesn't drift past
// the run boundary if the user forgets to stop a task timer.
router.patch('/work-blocks/runs/:run_id', async (req: Request, res: Response) => {
  try {
    const runId = req.params.run_id as string;
    const { data: existing, error: fetchErr } = await supabaseAdmin
      .from('work_block_runs')
      .select('*')
      .eq('id', runId)
      .eq('user_id', req.userId!)
      .single();
    if (fetchErr || !existing) {
      res.status(404).json({ success: false, error: 'Run not found' });
      return;
    }
    if ((existing as any).ended_at) {
      res.json({ success: true, data: existing });
      return;
    }

    const closed = await closeRun(existing as any, new Date());
    if (!closed) {
      res.status(500).json({ success: false, error: 'Failed to stop run' });
      return;
    }
    res.json({ success: true, data: { ...(existing as any), ...closed } });
  } catch (err) {
    console.error('[workBlocks runs PATCH] error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /pm/work-blocks/active — the caller's active run, if any.
router.get('/work-blocks/active', async (req: Request, res: Response) => {
  try {
    const { data: run } = await supabaseAdmin
      .from('work_block_runs')
      .select('*')
      .eq('user_id', req.userId!)
      .is('ended_at', null)
      .maybeSingle();
    if (!run) {
      res.json({ success: true, data: null });
      return;
    }
    const { data: task } = await supabaseAdmin
      .from('tasks')
      .select('id, title, list_id, task_type_id')
      .eq('id', (run as any).task_id)
      .single();
    res.json({ success: true, data: { run, task } });
  } catch (err) {
    console.error('[workBlocks active GET] error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// =====================================================================
// Completions: auto-recorded by the client when a task is marked done
// while the caller has an active work-block run.
// =====================================================================

const completionCreateSchema = z.object({
  completed_task_id: z.string().uuid(),
});

router.post('/work-blocks/runs/:run_id/completions', async (req: Request, res: Response) => {
  try {
    const runId = req.params.run_id as string;
    const parsed = completionCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.message });
      return;
    }
    // The run must belong to the caller AND must still be active — we record
    // completions against the live session, not historical ones.
    const { data: run } = await supabaseAdmin
      .from('work_block_runs')
      .select('id, user_id, ended_at')
      .eq('id', runId)
      .single();
    if (!run || (run as any).user_id !== req.userId) {
      res.status(404).json({ success: false, error: 'Run not found' });
      return;
    }
    if ((run as any).ended_at) {
      res.status(409).json({ success: false, error: 'Run has already ended' });
      return;
    }
    const { data, error } = await supabaseAdmin
      .from('work_block_completions')
      .upsert(
        {
          run_id: runId,
          completed_task_id: parsed.data.completed_task_id,
          completed_at: new Date().toISOString(),
        },
        { onConflict: 'run_id,completed_task_id' },
      )
      .select('*')
      .single();
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true, data });
  } catch (err) {
    console.error('[workBlocks completions POST] error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// =====================================================================
// Task-time overlaps: opened when a per-task timer starts inside an active
// work-block run; closed when that timer stops (or when the run stops).
// =====================================================================

const taskTimeSchema = z.object({
  task_id: z.string().uuid(),
});

// POST /pm/work-blocks/runs/:run_id/task-times — open an overlap row.
// Idempotent: if there's already an open row for (run, task) we return it.
router.post('/work-blocks/runs/:run_id/task-times', async (req: Request, res: Response) => {
  try {
    const runId = req.params.run_id as string;
    const parsed = taskTimeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.message });
      return;
    }
    const { data: run } = await supabaseAdmin
      .from('work_block_runs')
      .select('id, user_id, ended_at')
      .eq('id', runId)
      .single();
    if (!run || (run as any).user_id !== req.userId) {
      res.status(404).json({ success: false, error: 'Run not found' });
      return;
    }
    if ((run as any).ended_at) {
      res.status(409).json({ success: false, error: 'Run has already ended' });
      return;
    }
    // Reuse an existing open row if present (handles a double-start from
    // the client) — otherwise insert a fresh one.
    const { data: existing } = await supabaseAdmin
      .from('work_block_task_times')
      .select('*')
      .eq('run_id', runId)
      .eq('task_id', parsed.data.task_id)
      .is('ended_at', null)
      .maybeSingle();
    if (existing) {
      res.json({ success: true, data: existing });
      return;
    }
    const { data, error } = await supabaseAdmin
      .from('work_block_task_times')
      .insert({ run_id: runId, task_id: parsed.data.task_id })
      .select('*')
      .single();
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true, data });
  } catch (err) {
    console.error('[workBlocks task-times POST] error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /pm/work-blocks/runs/:run_id/task-times/close — close the open
// overlap row for (run, task). No-op if no open row exists.
router.post('/work-blocks/runs/:run_id/task-times/close', async (req: Request, res: Response) => {
  try {
    const runId = req.params.run_id as string;
    const parsed = taskTimeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.message });
      return;
    }
    const { data: row } = await supabaseAdmin
      .from('work_block_task_times')
      .select('id, started_at, run_id, work_block_runs(user_id)')
      .eq('run_id', runId)
      .eq('task_id', parsed.data.task_id)
      .is('ended_at', null)
      .maybeSingle();
    if (!row) {
      res.json({ success: true, data: null });
      return;
    }
    if (((row as any).work_block_runs?.user_id) !== req.userId) {
      res.status(404).json({ success: false, error: 'Row not found' });
      return;
    }
    const endedAt = new Date();
    const duration = Math.max(
      1,
      Math.floor((endedAt.getTime() - new Date((row as any).started_at).getTime()) / 1000),
    );
    const { data, error } = await supabaseAdmin
      .from('work_block_task_times')
      .update({ ended_at: endedAt.toISOString(), duration_seconds: duration })
      .eq('id', (row as any).id)
      .select('*')
      .single();
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true, data });
  } catch (err) {
    console.error('[workBlocks task-times close] error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// =====================================================================
// Manual links: surface a forward-planning list of "tasks I want to do
// during this work block".
// =====================================================================

const linkCreateSchema = z.object({
  linked_task_id: z.string().uuid(),
  position: z.number().int().min(0).optional(),
});

router.post('/work-blocks/:task_id/links', async (req: Request, res: Response) => {
  try {
    const taskId = req.params.task_id as string;
    const parsed = linkCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.message });
      return;
    }
    if (parsed.data.linked_task_id === taskId) {
      res.status(400).json({ success: false, error: 'Cannot link a work block to itself' });
      return;
    }
    const { data, error } = await supabaseAdmin
      .from('work_block_links')
      .upsert(
        {
          work_block_task_id: taskId,
          linked_task_id: parsed.data.linked_task_id,
          linked_by: req.userId!,
          position: parsed.data.position ?? 0,
        },
        { onConflict: 'work_block_task_id,linked_task_id' },
      )
      .select('*')
      .single();
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true, data });
  } catch (err) {
    console.error('[workBlocks links POST] error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.delete('/work-blocks/:task_id/links/:linked_task_id', async (req: Request, res: Response) => {
  try {
    const { task_id, linked_task_id } = req.params as { task_id: string; linked_task_id: string };
    const { error } = await supabaseAdmin
      .from('work_block_links')
      .delete()
      .eq('work_block_task_id', task_id)
      .eq('linked_task_id', linked_task_id);
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    console.error('[workBlocks links DELETE] error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
