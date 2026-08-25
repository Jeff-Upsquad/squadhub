import { supabaseAdmin } from '../supabase';
import { IST_OFFSET_MS } from './ist';

export type LogTaskTimeSource = 'timer' | 'manual' | 'work_block';

export interface LogTaskTimeParams {
  taskId: string;
  userId: string;
  /** ISO timestamp the entry started at. */
  startedAt: string;
  /** Seconds logged. May be negative for a manual correction. */
  durationSeconds: number;
  source: LogTaskTimeSource;
  /** Set for source='work_block' so the Time Sheet can nest the run's sub-items. */
  workBlockRunId?: string | null;
  /**
   * Skip the daily_time_summaries bump when this wall-clock is already counted
   * elsewhere — e.g. a per-task timer that overlapped a work-block run, where
   * the block itself is the authoritative contribution to the daily total.
   */
  skipDailySummary?: boolean;
}

export interface LogTaskTimeResult {
  ok: boolean;
  error?: string;
  entry?: any;
  workspaceId?: string;
}

/**
 * Record one time entry on a task and keep the three shared aggregates in sync:
 *   1. task_time_entries — per-session history (rail Time Sheet panel)
 *   2. tasks.time_tracked — the task detail "Logged" field
 *   3. daily_time_summaries — daily timesheet total + design Reports
 *      (unless skipDailySummary).
 *
 * Also applies the unassigned-task fallback: logging positive time on a task
 * with no assignees makes the logger the assignee (see ensureAssigneeOnTimeLogged).
 *
 * Extracted from POST /pm/tasks/:id/time-entries so the work-block run-close
 * path logs block time through the exact same flow. Callers are responsible for
 * any access-control checks before invoking.
 */
export async function logTaskTimeEntry(params: LogTaskTimeParams): Promise<LogTaskTimeResult> {
  const { taskId, userId, startedAt, durationSeconds, source, workBlockRunId, skipDailySummary } = params;

  // Resolve list → space → workspace for the entry's workspace_id.
  const { data: task } = await supabaseAdmin
    .from('tasks')
    .select('id, list_id, time_tracked, assignee_ids')
    .eq('id', taskId)
    .single();
  if (!task) return { ok: false, error: 'Task not found' };

  const { data: list } = await supabaseAdmin
    .from('lists').select('space_id').eq('id', (task as any).list_id).single();
  const { data: space } = (list as any)?.space_id
    ? await supabaseAdmin.from('spaces').select('workspace_id').eq('id', (list as any).space_id).single()
    : { data: null as any };
  const workspaceId = (space as any)?.workspace_id;
  if (!workspaceId) return { ok: false, error: 'Cannot resolve workspace for task' };

  const stoppedAt = new Date(new Date(startedAt).getTime() + durationSeconds * 1000).toISOString();

  const { data: entry, error: insertErr } = await supabaseAdmin
    .from('task_time_entries')
    .insert({
      task_id: taskId,
      user_id: userId,
      workspace_id: workspaceId,
      started_at: startedAt,
      stopped_at: stoppedAt,
      duration_seconds: durationSeconds,
      source,
      work_block_run_id: workBlockRunId ?? null,
    })
    .select()
    .single();
  if (insertErr) return { ok: false, error: insertErr.message };

  // Bump the aggregate cache on the task (task detail "Logged" field).
  const newTotal = ((task as any).time_tracked || 0) + durationSeconds;
  await supabaseAdmin
    .from('tasks')
    .update({ time_tracked: newTotal })
    .eq('id', taskId);

  if (durationSeconds > 0) {
    await ensureAssigneeOnTimeLogged(taskId, userId, ((task as any).assignee_ids as string[] | null) ?? null);
  }

  if (!skipDailySummary) {
    await upsertDailySummary(userId, workspaceId, startedAt, stoppedAt, durationSeconds);
  }

  return { ok: true, entry, workspaceId };
}

/**
 * Unassigned-task fallback: whoever logs time on a task with no assignees
 * becomes its assignee — logged work implies ownership. Only fires when
 * `currentAssigneeIds` is empty/null; callers must pass the value they read
 * in the same flow (never undefined) so we can't clobber existing assignees.
 */
export async function ensureAssigneeOnTimeLogged(
  taskId: string,
  userId: string,
  currentAssigneeIds: string[] | null,
): Promise<void> {
  if (!currentAssigneeIds || currentAssigneeIds.length === 0) {
    await supabaseAdmin
      .from('tasks')
      .update({ assignee_ids: [userId] })
      .eq('id', taskId);
  }
}

/**
 * Public wrapper: add wall-clock to the user's daily timesheet total + design
 * Reports (daily_time_summaries, context='default') without recording a
 * task_time_entry. Used by group runs, which have no task row of their own to
 * attribute a per-session time entry to but should still feed the daily total.
 */
export async function addDailyWorkSeconds(params: {
  userId: string;
  workspaceId: string;
  startedAt: string;
  durationSeconds: number;
}): Promise<void> {
  const stoppedAt = new Date(
    new Date(params.startedAt).getTime() + params.durationSeconds * 1000,
  ).toISOString();
  await upsertDailySummary(
    params.userId,
    params.workspaceId,
    params.startedAt,
    stoppedAt,
    params.durationSeconds,
  );
}

/**
 * Add `durationSeconds` to the user's daily_time_summaries row for the IST date
 * of `startedAt` (context='default'), creating the row if needed. This is the
 * aggregate the daily timesheet total and design Reports read.
 */
async function upsertDailySummary(
  userId: string,
  workspaceId: string,
  startedAt: string,
  stoppedAt: string,
  durationSeconds: number,
): Promise<void> {
  const startedIst = new Date(new Date(startedAt).getTime() + IST_OFFSET_MS);
  const entryDate = `${startedIst.getUTCFullYear()}-${String(startedIst.getUTCMonth() + 1).padStart(2, '0')}-${String(startedIst.getUTCDate()).padStart(2, '0')}`;

  const { data: existingSummary } = await supabaseAdmin
    .from('daily_time_summaries')
    .select('id, total_work_seconds')
    .eq('user_id', userId)
    .eq('workspace_id', workspaceId)
    .eq('date', entryDate)
    .eq('context', 'default')
    .maybeSingle();

  if (existingSummary) {
    await supabaseAdmin
      .from('daily_time_summaries')
      .update({
        total_work_seconds: (existingSummary as any).total_work_seconds + durationSeconds,
        updated_at: new Date().toISOString(),
      })
      .eq('id', (existingSummary as any).id);
  } else {
    await supabaseAdmin
      .from('daily_time_summaries')
      .insert({
        user_id: userId,
        workspace_id: workspaceId,
        context: 'default',
        date: entryDate,
        total_work_seconds: durationSeconds,
        total_break_seconds: 0,
        total_no_work_seconds: 0,
        session_count: 1,
        first_start: stoppedAt,
        last_stop: stoppedAt,
      });
  }
}
