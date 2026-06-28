import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../../supabase';
import { requireAuth } from '../../middleware/auth';
import { requireUserType } from '../../middleware/userType';
import { PARTNER_USER_TYPES } from '@squadhub/shared';
import { addDailyWorkSeconds } from '../../utils/taskTime';

// =====================================================================
// Group runs — give the virtual "parent" row of a grouped task list the
// same run machinery a work block has (start/stop session, auto-collected
// completions, per-task timer overlaps, daily-total time logging, history).
//
// A group has no task row of its own, so runs are keyed by a client-computed
// stable string (group_key) plus a denormalised label and an optional
// workspace (resolved from the originating list) for time attribution.
// =====================================================================

const router = Router();
router.use(requireAuth);
router.use(requireUserType('internal', ...PARTNER_USER_TYPES, 'client', 'client_staff'));

// A grouped-task run is keyed by its container, e.g.
// "group-container:list:<id>". Parse that back out so we can scope activity
// (completions / timer overlaps) to tasks that actually belong to the group.
function parseContainerKey(groupKey: string): { type: 'list' | 'folder' | 'space'; id: string } | null {
  const m = /^group-container:(list|folder|space):(.+)$/.exec(groupKey || '');
  return m ? { type: m[1] as 'list' | 'folder' | 'space', id: m[2] } : null;
}

// Membership mirror of the Home "Tasks in this group" resolution: a task belongs
// to a container iff its NEAREST grouping-enabled ancestor (own list, else
// folder, else space) is exactly that container. Uses the task's primary list,
// matching what the grouped row displays.
async function taskInContainer(
  taskId: string,
  container: { type: 'list' | 'folder' | 'space'; id: string },
): Promise<boolean> {
  const { data: task } = await supabaseAdmin
    .from('tasks').select('list_id').eq('id', taskId).maybeSingle();
  const listId = (task as any)?.list_id;
  if (!listId) return false;
  const { data: list } = await supabaseAdmin
    .from('lists').select('id, space_id, folder_id, group_tasks').eq('id', listId).maybeSingle();
  if (!list) return false;
  const l = list as any;
  let folder: any = null;
  let space: any = null;
  if (l.folder_id) {
    const { data } = await supabaseAdmin.from('folders').select('id, group_tasks').eq('id', l.folder_id).maybeSingle();
    folder = data;
  }
  if (l.space_id) {
    const { data } = await supabaseAdmin.from('spaces').select('id, group_tasks').eq('id', l.space_id).maybeSingle();
    space = data;
  }
  const nearest = l.group_tasks
    ? { type: 'list', id: l.id }
    : folder?.group_tasks
      ? { type: 'folder', id: folder.id }
      : space?.group_tasks
        ? { type: 'space', id: space.id }
        : null;
  return !!nearest && nearest.type === container.type && nearest.id === container.id;
}

// True when `taskId` should NOT be tracked against `run` — i.e. the run targets
// a real container and the task isn't a member of it. Non-container runs (no
// parseable container key) track everything, preserving the generic behaviour.
async function taskOutsideRunGroup(
  run: { group_key: string },
  taskId: string,
): Promise<boolean> {
  const container = parseContainerKey(run.group_key);
  if (!container) return false;
  return !(await taskInContainer(taskId, container));
}

// Resolve a list's workspace (list -> space -> workspace). Best-effort.
async function workspaceForList(listId: string | null | undefined): Promise<string | null> {
  if (!listId) return null;
  const { data: list } = await supabaseAdmin
    .from('lists').select('space_id').eq('id', listId).maybeSingle();
  const spaceId = (list as any)?.space_id;
  if (!spaceId) return null;
  const { data: space } = await supabaseAdmin
    .from('spaces').select('workspace_id').eq('id', spaceId).maybeSingle();
  return (space as any)?.workspace_id ?? null;
}

// Close a group run: stop open per-task overlaps, stamp ended_at/duration, and
// add the run's wall-clock to the user's daily total + Reports.
async function closeGroupRun(
  run: { id: string; user_id: string; started_at: string; workspace_id: string | null },
  endedAt: Date,
): Promise<{ ended_at: string; duration_seconds: number } | null> {
  const duration = Math.max(
    1,
    Math.floor((endedAt.getTime() - new Date(run.started_at).getTime()) / 1000),
  );

  // Close any open per-task overlap rows for this run first.
  const { data: openTimes } = await supabaseAdmin
    .from('group_run_task_times')
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
          .from('group_run_task_times')
          .update({ ended_at: endedAt.toISOString(), duration_seconds: d })
          .eq('id', row.id);
      }),
    );
  }

  const { data, error } = await supabaseAdmin
    .from('group_runs')
    .update({ ended_at: endedAt.toISOString(), duration_seconds: duration })
    .eq('id', run.id)
    .select('ended_at, duration_seconds')
    .single();
  if (error) {
    console.error('[groupRuns closeGroupRun] update error:', error);
    return null;
  }

  // Attribute the run to the daily total + Reports. If the workspace wasn't
  // captured at start, fall back to the workspace of a completed task.
  let workspaceId = run.workspace_id;
  if (!workspaceId) {
    const { data: anyCompletion } = await supabaseAdmin
      .from('group_run_completions')
      .select('completed_task_id')
      .eq('run_id', run.id)
      .limit(1)
      .maybeSingle();
    const taskId = (anyCompletion as any)?.completed_task_id;
    if (taskId) {
      const { data: t } = await supabaseAdmin
        .from('tasks').select('list_id').eq('id', taskId).maybeSingle();
      workspaceId = await workspaceForList((t as any)?.list_id);
    }
  }
  if (workspaceId) {
    try {
      await addDailyWorkSeconds({
        userId: run.user_id,
        workspaceId,
        startedAt: run.started_at,
        durationSeconds: duration,
      });
    } catch (err) {
      console.error('[groupRuns closeGroupRun] daily-summary bump failed:', err);
    }
  }

  return data as any;
}

// =====================================================================
// Start / stop / active
// =====================================================================

const startSchema = z.object({
  group_key: z.string().min(1).max(512),
  group_label: z.string().max(256).optional(),
  list_id: z.string().uuid().nullable().optional(),
});

// POST /pm/group-runs/runs — start a group run for the current user.
router.post('/group-runs/runs', async (req: Request, res: Response) => {
  try {
    const parsed = startSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.message });
      return;
    }
    const startedAt = new Date();

    // Close any pre-existing active run for this user — keeps the unique
    // partial index from rejecting the insert if a prior stop was lost.
    const { data: existing } = await supabaseAdmin
      .from('group_runs')
      .select('id, user_id, started_at, workspace_id')
      .eq('user_id', req.userId!)
      .is('ended_at', null)
      .maybeSingle();
    if (existing) {
      await closeGroupRun(existing as any, startedAt);
    }

    const workspaceId = await workspaceForList(parsed.data.list_id ?? null);

    const { data, error } = await supabaseAdmin
      .from('group_runs')
      .insert({
        user_id: req.userId!,
        group_key: parsed.data.group_key,
        group_label: parsed.data.group_label ?? '',
        workspace_id: workspaceId,
        started_at: startedAt.toISOString(),
      })
      .select('*')
      .single();
    if (error) {
      console.error('[groupRuns runs POST] supabase error:', error);
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true, data });
  } catch (err) {
    console.error('[groupRuns runs POST] error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PATCH /pm/group-runs/runs/:run_id — stop a run.
router.patch('/group-runs/runs/:run_id', async (req: Request, res: Response) => {
  try {
    const runId = req.params.run_id as string;
    const { data: existing, error: fetchErr } = await supabaseAdmin
      .from('group_runs')
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
    const closed = await closeGroupRun(existing as any, new Date());
    if (!closed) {
      res.status(500).json({ success: false, error: 'Failed to stop run' });
      return;
    }
    res.json({ success: true, data: { ...(existing as any), ...closed } });
  } catch (err) {
    console.error('[groupRuns runs PATCH] error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /pm/group-runs/active — the caller's active group run, if any.
router.get('/group-runs/active', async (req: Request, res: Response) => {
  try {
    const { data: run } = await supabaseAdmin
      .from('group_runs')
      .select('*')
      .eq('user_id', req.userId!)
      .is('ended_at', null)
      .maybeSingle();
    res.json({ success: true, data: run ? { run } : null });
  } catch (err) {
    console.error('[groupRuns active GET] error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /pm/group-runs/history?key=<group_key> — recent runs for a group,
// hydrated with completions + task_times for the activity breakdown.
router.get('/group-runs/history', async (req: Request, res: Response) => {
  try {
    const groupKey = (req.query.key as string) || '';
    if (!groupKey) {
      res.status(400).json({ success: false, error: 'Missing key' });
      return;
    }
    const { data: runs, error } = await supabaseAdmin
      .from('group_runs')
      .select('*')
      .eq('group_key', groupKey)
      .eq('user_id', req.userId!)
      .order('started_at', { ascending: false })
      .limit(50);
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    const runIds = (runs || []).map((r: any) => r.id);
    let completions: any[] = [];
    let taskTimes: any[] = [];
    if (runIds.length > 0) {
      const [{ data: c }, { data: tt }] = await Promise.all([
        supabaseAdmin
          .from('group_run_completions')
          .select('*')
          .in('run_id', runIds)
          .order('completed_at', { ascending: true }),
        supabaseAdmin
          .from('group_run_task_times')
          .select('*')
          .in('run_id', runIds)
          .order('started_at', { ascending: true }),
      ]);
      completions = c || [];
      taskTimes = tt || [];
    }
    const referencedTaskIds = Array.from(
      new Set([
        ...completions.map((c: any) => c.completed_task_id),
        ...taskTimes.map((t: any) => t.task_id),
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
    res.json({ success: true, data: { runs: runsHydrated } });
  } catch (err) {
    console.error('[groupRuns history GET] error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// =====================================================================
// Completions — auto-recorded when a task is marked done while the caller
// has an active group run.
// =====================================================================

const completionSchema = z.object({ completed_task_id: z.string().uuid() });

router.post('/group-runs/runs/:run_id/completions', async (req: Request, res: Response) => {
  try {
    const runId = req.params.run_id as string;
    const parsed = completionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.message });
      return;
    }
    const { data: run } = await supabaseAdmin
      .from('group_runs')
      .select('id, user_id, ended_at, group_key')
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
    // Only count tasks that belong to this grouped task — completing something
    // in another list during the session is ignored.
    if (await taskOutsideRunGroup(run as any, parsed.data.completed_task_id)) {
      res.json({ success: true, data: null, skipped: true });
      return;
    }
    const { data, error } = await supabaseAdmin
      .from('group_run_completions')
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
    console.error('[groupRuns completions POST] error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// =====================================================================
// Per-task timer overlaps — opened when a per-task timer starts inside an
// active group run; closed when that timer stops (or when the run stops).
// =====================================================================

const taskTimeSchema = z.object({ task_id: z.string().uuid() });

router.post('/group-runs/runs/:run_id/task-times', async (req: Request, res: Response) => {
  try {
    const runId = req.params.run_id as string;
    const parsed = taskTimeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.message });
      return;
    }
    const { data: run } = await supabaseAdmin
      .from('group_runs')
      .select('id, user_id, ended_at, group_key')
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
    // Only track per-task timers for tasks that belong to this grouped task.
    if (await taskOutsideRunGroup(run as any, parsed.data.task_id)) {
      res.json({ success: true, data: null, skipped: true });
      return;
    }
    const { data: existing } = await supabaseAdmin
      .from('group_run_task_times')
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
      .from('group_run_task_times')
      .insert({ run_id: runId, task_id: parsed.data.task_id })
      .select('*')
      .single();
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true, data });
  } catch (err) {
    console.error('[groupRuns task-times POST] error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.post('/group-runs/runs/:run_id/task-times/close', async (req: Request, res: Response) => {
  try {
    const runId = req.params.run_id as string;
    const parsed = taskTimeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.message });
      return;
    }
    const { data: row } = await supabaseAdmin
      .from('group_run_task_times')
      .select('id, started_at, run_id, group_runs(user_id)')
      .eq('run_id', runId)
      .eq('task_id', parsed.data.task_id)
      .is('ended_at', null)
      .maybeSingle();
    if (!row) {
      res.json({ success: true, data: null });
      return;
    }
    if (((row as any).group_runs?.user_id) !== req.userId) {
      res.status(404).json({ success: false, error: 'Row not found' });
      return;
    }
    const endedAt = new Date();
    const duration = Math.max(
      1,
      Math.floor((endedAt.getTime() - new Date((row as any).started_at).getTime()) / 1000),
    );
    const { data, error } = await supabaseAdmin
      .from('group_run_task_times')
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
    console.error('[groupRuns task-times close] error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
