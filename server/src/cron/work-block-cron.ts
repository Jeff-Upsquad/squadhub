import { supabaseAdmin } from '../supabase';
import { logTaskActivity } from '../utils/taskActivity';
import {
  FALLBACK_TIME_ZONE,
  getTimeZonesByUser,
  localDateKeyInZone,
} from '../utils/userTimeZone';

/**
 * Time-block completion cron. A time block (task_types.key = 'work_block') is a
 * calendar-native object: once its scheduled day is over it should not linger
 * anywhere as open work. When that day has passed — at the OWNER'S local
 * midnight (users.time_zone, captured from the client's X-Time-Zone header) —
 * AND no time was ever tracked on the block (no logged seconds, no runs — not
 * even an active one), mark the task done. Blocks WITH tracked time are left
 * for the user to close, and repeating blocks stay open for their future
 * occurrences (they only age out once their recurrence ends_on has passed).
 * Fully idempotent.
 */

type WorkBlockRecurrence = {
  kind?: 'none' | 'daily' | 'weekdays' | 'weekly' | 'monthly' | null;
  starts_on?: string | null;
  ends_on?: string | null;
};

// A block's last scheduled day is either a plain calendar date (recurrence
// rules store YYYY-MM-DD) or an instant whose LOCAL day depends on the owner's
// zone (work/due dates are timestamptz stored as local midnight).
type ScheduledDay = { kind: 'date'; day: string } | { kind: 'instant'; iso: string };

function lastScheduledDay(
  recurrence: WorkBlockRecurrence | null | undefined,
  task: { work_date?: string | null; due_date?: string | null },
): ScheduledDay | null {
  if (recurrence?.kind && recurrence.kind !== 'none') {
    // A repeating schedule only ends at its ends_on; without one it recurs
    // forever and must stay open for future occurrences.
    return recurrence.ends_on ? { kind: 'date', day: recurrence.ends_on } : null;
  }
  // One-off: the occurrence day is starts_on, falling back to the task's own
  // work/due date (creation pre-fills work_date for scheduled blocks).
  if (recurrence?.starts_on) return { kind: 'date', day: recurrence.starts_on };
  if (task.work_date) return { kind: 'instant', iso: task.work_date };
  if (task.due_date) return { kind: 'instant', iso: task.due_date };
  return null;
}

// Is the scheduled day over in `zone`? A plain date compares literally; an
// instant first resolves to its calendar day in that zone.
function dayIsOverInZone(scheduled: ScheduledDay, zone: string | null | undefined, now: Date): boolean {
  const today = localDateKeyInZone(zone, now);
  if (scheduled.kind === 'date') return scheduled.day < today;
  return localDateKeyInZone(zone, new Date(scheduled.iso)) < today;
}

export async function autoCompleteExpiredTimeBlocks(): Promise<{ completed: number }> {
  const { data: typeRows, error: typeErr } = await supabaseAdmin
    .from('task_types')
    .select('id')
    .eq('key', 'work_block');
  if (typeErr || !typeRows || typeRows.length === 0) {
    if (typeErr) console.error('[TimeBlock Cron] task_types lookup failed:', typeErr);
    return { completed: 0 };
  }

  const { data: tasks, error } = await supabaseAdmin
    .from('tasks')
    .select('id, title, status, time_tracked, work_date, due_date, assignee_ids, work_blocks(recurrence)')
    .in('task_type_id', (typeRows as any[]).map((t) => t.id))
    .not('status', 'in', '(done,closed,cancelled,Done,Closed,Cancelled)');
  if (error) {
    console.error('[TimeBlock Cron] tasks lookup failed:', error);
    return { completed: 0 };
  }

  const noTimeTracked = ((tasks || []) as any[]).filter((t) => (t.time_tracked ?? 0) <= 0);
  if (noTimeTracked.length === 0) return { completed: 0 };

  // Any run (past or active) means wall-clock was spent on the block — skip those.
  const { data: runRows } = await supabaseAdmin
    .from('work_block_runs')
    .select('task_id')
    .in('task_id', noTimeTracked.map((t) => t.id));
  const withRuns = new Set(((runRows || []) as any[]).map((r) => r.task_id));

  const candidates = noTimeTracked.filter((t) => !withRuns.has(t.id));
  if (candidates.length === 0) return { completed: 0 };

  // Resolve each owner's zone once. A shared block counts as expired only
  // after its day has ended for EVERY assignee; a block with no assignees
  // (or a user with no stored zone) falls back to the default zone.
  const assigneeIds = Array.from(
    new Set(candidates.flatMap((t) => (Array.isArray(t.assignee_ids) ? t.assignee_ids : []))),
  );
  const zonesByUser = await getTimeZonesByUser(assigneeIds);

  const now = new Date();
  const expired = candidates.filter((t) => {
    const cfg = Array.isArray(t.work_blocks) ? (t.work_blocks[0] as any) : null;
    const scheduledDay = lastScheduledDay(cfg?.recurrence as WorkBlockRecurrence | null, t);
    if (!scheduledDay) return false;
    const zones: Array<string | null> = Array.isArray(t.assignee_ids) && t.assignee_ids.length > 0
      ? t.assignee_ids.map((id: string) => zonesByUser.get(id) ?? FALLBACK_TIME_ZONE)
      : [FALLBACK_TIME_ZONE];
    return zones.every((z) => dayIsOverInZone(scheduledDay, z, now));
  });
  if (expired.length === 0) return { completed: 0 };

  const nowIso = now.toISOString();
  let completed = 0;
  for (const t of expired) {
    const { error: updateErr } = await supabaseAdmin
      .from('tasks')
      .update({ status: 'done', completed_at: nowIso, updated_at: nowIso })
      .eq('id', t.id)
      .not('status', 'in', '(done,closed,cancelled,Done,Closed,Cancelled)'); // re-check: don't clobber a concurrent manual change
    if (updateErr) {
      console.error(`[TimeBlock Cron] failed to complete ${t.id}:`, updateErr);
      continue;
    }
    completed += 1;
    // Best-effort audit trail; a logging failure must not fail the sweep.
    void logTaskActivity(t.id, null, [
      { event_type: 'field_change', field: 'status', old_value: t.status ?? null, new_value: 'done' },
    ]);
  }

  if (completed > 0) {
    console.log(`[TimeBlock Cron] Auto-completed ${completed} expired time block(s) with no tracked time`);
  }
  return { completed };
}

export function startWorkBlockCompletionCron(): void {
  // Boot sweep — delayed so startup isn't blocked.
  setTimeout(() => {
    autoCompleteExpiredTimeBlocks().catch((err) =>
      console.error('[TimeBlock Cron] Boot sweep failed:', err),
    );
  }, 8000);

  // Local midnights roll over continuously across user zones; a 15-minute
  // cadence completes expired blocks soon after their day ends without
  // polling the database hard.
  setInterval(() => {
    autoCompleteExpiredTimeBlocks().catch((err) =>
      console.error('[TimeBlock Cron] Sweep failed:', err),
    );
  }, 15 * 60 * 1000);

  console.log('[TimeBlock Cron] Time block completion cron initialized');
}
