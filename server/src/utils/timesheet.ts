import { supabaseAdmin } from '../supabase';
import { IST_OFFSET_MS } from './ist';
import type {
  TimesheetProgressLine,
  TimesheetCompletedTask,
  OfficeTimingSummary,
} from '@squadhub/shared';

// Tasks are considered "complete" when their TEXT status is closed/done
// (see migration 042_task_status_catalog and pm/tasks.ts filters).
const COMPLETED_STATUSES = ['closed', 'done'];

// ---- date helpers (all date strings are YYYY-MM-DD in IST) ----

function isoDate(d: Date): string {
  return d.toISOString().split('T')[0];
}

/** IST calendar date for a timestamptz (e.g. task_time_entries.started_at). */
function istDateOf(ts: string): string {
  return isoDate(new Date(new Date(ts).getTime() + IST_OFFSET_MS));
}

/** Mon–Sun week containing `date`. */
export function weekRange(date: string): { start: string; end: string } {
  const d = new Date(date + 'T00:00:00Z');
  const dow = d.getUTCDay(); // 0 Sun .. 6 Sat
  const mondayOffset = dow === 0 ? 6 : dow - 1;
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - mondayOffset);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return { start: isoDate(monday), end: isoDate(sunday) };
}

/** Calendar month containing `date`. */
export function monthRange(date: string): { start: string; end: string } {
  const d = new Date(date + 'T00:00:00Z');
  const first = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
  return { start: isoDate(first), end: isoDate(last) };
}

/** YYYY-MM-DD one day after the given date (exclusive upper bound for ranges). */
function nextDay(date: string): string {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return isoDate(d);
}

function unique<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

// ---- task → client resolution (task → list → folder → client) ----

export type TaskClient = { client_id: string | null; client_name: string | null };

/**
 * Map each task id to its client via lists.folder_id → folders.client_id.
 * Mirrors the list/folder hydrate used in server/src/routes/pm/tasks.ts.
 */
export async function getTaskClientMap(taskIds: string[]): Promise<Map<string, TaskClient>> {
  const out = new Map<string, TaskClient>();
  if (taskIds.length === 0) return out;

  const { data: tasks } = await supabaseAdmin
    .from('tasks')
    .select('id, list_id')
    .in('id', taskIds);

  const listIds = unique((tasks || []).map((t: any) => t.list_id).filter(Boolean));
  const { data: lists } = listIds.length
    ? await supabaseAdmin.from('lists').select('id, folder_id').in('id', listIds)
    : { data: [] as any[] };

  const folderIds = unique((lists || []).map((l: any) => l.folder_id).filter(Boolean));
  const { data: folders } = folderIds.length
    ? await supabaseAdmin.from('folders').select('id, client_id').in('id', folderIds)
    : { data: [] as any[] };

  const clientIds = unique((folders || []).map((f: any) => f.client_id).filter(Boolean));
  const { data: clients } = clientIds.length
    ? await supabaseAdmin.from('clients').select('id, business_name').in('id', clientIds)
    : { data: [] as any[] };

  const listById = new Map((lists || []).map((l: any) => [l.id, l]));
  const folderById = new Map((folders || []).map((f: any) => [f.id, f]));
  const clientById = new Map((clients || []).map((c: any) => [c.id, c]));

  for (const t of (tasks || []) as any[]) {
    const l = listById.get(t.list_id);
    const f = l?.folder_id ? folderById.get(l.folder_id) : null;
    const c = f?.client_id ? clientById.get(f.client_id) : null;
    out.set(t.id, {
      client_id: c?.id ?? null,
      client_name: c?.business_name ?? null,
    });
  }
  return out;
}

// ---- completed tasks ----

type RawCompletedTask = {
  id: string;
  title: string;
  work_date: string | null;
  time_tracked: number;
};

/**
 * Completed tasks assigned to a user whose work_date falls in [startDate, endDate].
 *
 * Assignees live on `tasks.assignee_ids` (a UUID[] column), queried with the
 * Postgres array-contains operator — same pattern as GET /pm/tasks/my.
 *
 * Note: tasks carry no `completed_at`. We use work_date + a closed/done status as
 * the v1 proxy for "completed on this day". Progress values are user-editable
 * before submit, so the approximation is acceptable.
 */
export async function getCompletedTasksForUser(
  userId: string,
  startDate: string,
  endDate: string,
): Promise<RawCompletedTask[]> {
  // work_date is a timestamptz; use a half-open [startDate, endDate+1) range so
  // midnight-stored values land in the right day regardless of server timezone.
  const { data: tasks } = await supabaseAdmin
    .from('tasks')
    .select('id, title, work_date, time_tracked')
    .contains('assignee_ids', [userId])
    .in('status', COMPLETED_STATUSES)
    .not('work_date', 'is', null)
    .gte('work_date', startDate)
    .lt('work_date', nextDay(endDate));

  return (tasks || []) as RawCompletedTask[];
}

/** Completed tasks for a single day, hydrated with client, for the review list. */
export async function getCompletedTasksWithClient(
  userId: string,
  date: string,
): Promise<TimesheetCompletedTask[]> {
  const tasks = await getCompletedTasksForUser(userId, date, date);
  const clientMap = await getTaskClientMap(tasks.map((t) => t.id));
  return tasks.map((t) => {
    const c = clientMap.get(t.id);
    return {
      id: t.id,
      title: t.title,
      client_id: c?.client_id ?? null,
      client_name: c?.client_name ?? null,
      time_tracked_seconds: t.time_tracked || 0,
    };
  });
}

// ---- tracked time per client ----

type RawTimeEntry = { task_id: string; started_at: string; duration_seconds: number };

async function getTimeEntries(userId: string, startDate: string, endDate: string): Promise<RawTimeEntry[]> {
  const { data } = await supabaseAdmin
    .from('task_time_entries')
    .select('task_id, started_at, duration_seconds')
    .eq('user_id', userId)
    .gte('started_at', `${startDate}T00:00:00+05:30`)
    .lte('started_at', `${endDate}T23:59:59.999+05:30`);
  return (data || []) as RawTimeEntry[];
}

// ---- progress computation ----

/**
 * Compute per-client/per-kind progress for a user on a given date.
 * Returns one line per active target with day/week/month achievement:
 *   - item targets  → count of completed tasks for that client in the bucket
 *   - hours targets → tracked time on that client's tasks, in hours
 */
export async function computeProgress(userId: string, date: string): Promise<TimesheetProgressLine[]> {
  const { data: targets } = await supabaseAdmin
    .from('timesheet_targets')
    .select('client_id, kind, label, per_day, per_week, per_month, clients(id, business_name)')
    .eq('user_id', userId)
    .eq('is_active', true);

  if (!targets || targets.length === 0) return [];

  const month = monthRange(date);
  const week = weekRange(date);
  const inWeek = (d: string) => d >= week.start && d <= week.end;
  const inDay = (d: string) => d === date;

  const hasItem = targets.some((t: any) => t.kind === 'item');
  const hasHours = targets.some((t: any) => t.kind === 'hours');

  // Completed tasks across the month (item targets)
  const completed = hasItem ? await getCompletedTasksForUser(userId, month.start, month.end) : [];
  // Time entries across the month (hours targets)
  const entries = hasHours ? await getTimeEntries(userId, month.start, month.end) : [];

  const allTaskIds = unique([
    ...completed.map((t) => t.id),
    ...entries.map((e) => e.task_id),
  ]);
  const clientMap = await getTaskClientMap(allTaskIds);

  return (targets as any[]).map((t) => {
    const clientName = t.clients?.business_name ?? 'Client';
    let achievedDay = 0;
    let achievedWeek = 0;
    let achievedMonth = 0;

    if (t.kind === 'item') {
      for (const task of completed) {
        const c = clientMap.get(task.id);
        if (c?.client_id !== t.client_id) continue;
        // work_date is a timestamptz string — compare on the date part only.
        const wd = (task.work_date || '').slice(0, 10);
        achievedMonth += 1;
        if (inWeek(wd)) achievedWeek += 1;
        if (inDay(wd)) achievedDay += 1;
      }
    } else {
      let secDay = 0;
      let secWeek = 0;
      let secMonth = 0;
      for (const e of entries) {
        const c = clientMap.get(e.task_id);
        if (c?.client_id !== t.client_id) continue;
        const ed = istDateOf(e.started_at);
        secMonth += e.duration_seconds;
        if (inWeek(ed)) secWeek += e.duration_seconds;
        if (inDay(ed)) secDay += e.duration_seconds;
      }
      const toHours = (s: number) => Math.round((s / 3600) * 100) / 100;
      achievedDay = toHours(secDay);
      achievedWeek = toHours(secWeek);
      achievedMonth = toHours(secMonth);
    }

    return {
      client_id: t.client_id,
      client_name: clientName,
      kind: t.kind,
      label: t.label || '',
      target_day: Number(t.per_day) || 0,
      target_week: Number(t.per_week) || 0,
      target_month: Number(t.per_month) || 0,
      achieved_day: achievedDay,
      achieved_week: achievedWeek,
      achieved_month: achievedMonth,
      auto_day: achievedDay,
    };
  });
}

// ---- virtual office timing + tracked hours ----

/**
 * Office window (from user_office_timing) + total tracked work seconds for the
 * given IST date (summed across the user's daily_time_summaries rows).
 */
export async function getOfficeAndTracked(
  userId: string,
  date: string,
): Promise<{ office_timing: OfficeTimingSummary | null; tracked_work_seconds: number }> {
  const [{ data: timing }, { data: summaries }] = await Promise.all([
    supabaseAdmin
      .from('user_office_timing')
      .select('label, from_time, to_time, working_days, max_break_minutes, is_active')
      .eq('user_id', userId)
      .eq('is_active', true)
      .maybeSingle(),
    supabaseAdmin
      .from('daily_time_summaries')
      .select('total_work_seconds')
      .eq('user_id', userId)
      .eq('date', date),
  ]);

  let office_timing: OfficeTimingSummary | null = null;
  if (timing) {
    const [fh, fm] = timing.from_time.split(':').map(Number);
    const [th, tm] = timing.to_time.split(':').map(Number);
    const totalSeconds = Math.max(0, ((th * 60 + tm) - (fh * 60 + fm)) * 60);
    office_timing = {
      label: timing.label,
      from_time: timing.from_time,
      to_time: timing.to_time,
      working_days: timing.working_days,
      max_break_minutes: timing.max_break_minutes,
      office_hours_total_seconds: totalSeconds,
    };
  }

  const tracked_work_seconds = (summaries || []).reduce(
    (sum: number, s: any) => sum + (s.total_work_seconds || 0),
    0,
  );

  return { office_timing, tracked_work_seconds };
}
