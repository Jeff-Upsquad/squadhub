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
  /** Free-text note the logger attached to this entry (manual logs only). */
  note?: string | null;
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
/**
 * Did this user's [startedAt, stoppedAt] window fall inside one of their work
 * block runs? A block already counts that wall-clock toward the daily total, so
 * an overlapping per-task entry must NOT bump daily_time_summaries.
 *
 * Both the log path and the delete path ask this, so that a delete only unwinds
 * the day when the log actually fed it.
 */
export async function overlapsWorkBlockRun(
  userId: string,
  startedAt: string,
  stoppedAt: string,
): Promise<boolean> {
  const { data: activeRun } = await supabaseAdmin
    .from('work_block_runs')
    .select('id')
    .eq('user_id', userId)
    .is('ended_at', null)
    .lte('started_at', stoppedAt)
    .limit(1);
  if (activeRun && activeRun.length) return true;

  const { data: closedRun } = await supabaseAdmin
    .from('work_block_runs')
    .select('id')
    .eq('user_id', userId)
    .not('ended_at', 'is', null)
    .lte('started_at', stoppedAt)
    .gte('ended_at', startedAt)
    .limit(1);
  return !!(closedRun && closedRun.length);
}

export async function logTaskTimeEntry(params: LogTaskTimeParams): Promise<LogTaskTimeResult> {
  const { taskId, userId, startedAt, durationSeconds, source, workBlockRunId, note, skipDailySummary } = params;

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

  // A negative correction (source='manual') runs backwards in wall clock. Store
  // the pair ordered so `started_at <= stopped_at` holds for every row — the
  // sign lives in duration_seconds, which is what every aggregate reads.
  const edgeAt = new Date(new Date(startedAt).getTime() + durationSeconds * 1000).toISOString();
  const entryStartedAt = durationSeconds < 0 ? edgeAt : startedAt;
  const stoppedAt = durationSeconds < 0 ? startedAt : edgeAt;

  const { data: entry, error: insertErr } = await supabaseAdmin
    .from('task_time_entries')
    .insert({
      task_id: taskId,
      user_id: userId,
      workspace_id: workspaceId,
      started_at: entryStartedAt,
      stopped_at: stoppedAt,
      duration_seconds: durationSeconds,
      source,
      work_block_run_id: workBlockRunId ?? null,
      note: note ?? null,
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
    // Bucket the day by the entry's own start, not the reordered row, so a
    // negative correction lands on the date the user picked.
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
        // Clamp: a negative correction can exceed what the day actually holds
        // (e.g. removing time logged on an earlier date).
        total_work_seconds: Math.max(0, (existingSummary as any).total_work_seconds + durationSeconds),
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
        total_work_seconds: Math.max(0, durationSeconds),
        total_break_seconds: 0,
        total_no_work_seconds: 0,
        session_count: 1,
        first_start: stoppedAt,
        last_stop: stoppedAt,
      });
  }
}

/**
 * Consolidate contiguous time entries for the same task, user, and source.
 * Merges adjacent segments where the gap between the previous entry's stopped_at
 * and the next entry's started_at is <= 5 seconds (or slight overlap up to 5s).
 * Combines durations, extends the time range, and merges work_block children.
 */
export function consolidateContiguousEntries<
  T extends {
    id?: string;
    task_id: string;
    user_id?: string;
    started_at: string;
    stopped_at: string;
    duration_seconds: number;
    source?: string;
    work_block_run_id?: string | null;
    note?: string | null;
    children?: any[];
    [key: string]: any;
  }
>(entries: T[]): T[] {
  if (!entries || entries.length <= 1) return entries || [];

  // Sort chronologically ascending to merge forward
  const sorted = [...entries].sort(
    (a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime()
  );

  const merged: T[] = [];

  for (const entry of sorted) {
    if (merged.length === 0) {
      merged.push({ ...entry });
      continue;
    }

    const prev = merged[merged.length - 1];

    const sameTask = prev.task_id === entry.task_id;
    const sameUser = !prev.user_id || !entry.user_id || prev.user_id === entry.user_id;
    const sameSource = (prev.source || 'timer') === (entry.source || 'timer');
    const sameRun = (prev.work_block_run_id ?? null) === (entry.work_block_run_id ?? null);
    const sameNote = (prev.note ?? null) === (entry.note ?? null);
    const bothPositive = prev.duration_seconds > 0 && entry.duration_seconds > 0;

    if (sameTask && sameUser && sameSource && sameRun && sameNote && bothPositive) {
      const prevEnd = new Date(prev.stopped_at).getTime();
      const currStart = new Date(entry.started_at).getTime();
      const currEnd = new Date(entry.stopped_at).getTime();

      // Contiguous or overlapping (currStart <= prevEnd + 5s)
      if (currStart <= prevEnd + 5000) {
        if (currEnd > prevEnd) {
          prev.stopped_at = entry.stopped_at;
          // If strictly contiguous (currStart >= prevEnd - 1s), add full duration
          if (currStart >= prevEnd - 1000) {
            prev.duration_seconds += entry.duration_seconds;
          } else {
            // Overlapping duplicate chunk: add only the non-overlapping portion
            const addedSec = Math.max(0, Math.round((currEnd - prevEnd) / 1000));
            prev.duration_seconds += addedSec;
          }
        }

        // Combine work-block children if present
        if (entry.children && entry.children.length > 0) {
          const childMap = new Map<string, { task_id: string; title: string; seconds: number; completed: boolean }>();
          for (const c of prev.children || []) childMap.set(c.task_id, { ...c });
          for (const c of entry.children) {
            const existing = childMap.get(c.task_id);
            if (existing) {
              existing.seconds += c.seconds || 0;
              existing.completed = existing.completed || c.completed;
            } else {
              childMap.set(c.task_id, { ...c });
            }
          }
          prev.children = Array.from(childMap.values()).sort((a, b) => b.seconds - a.seconds);
        }
        continue;
      }
    }

    merged.push({ ...entry });
  }

  // Restore descending order (newest first)
  return merged.sort(
    (a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime()
  );
}

