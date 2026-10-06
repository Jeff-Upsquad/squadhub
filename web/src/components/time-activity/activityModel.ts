import type { TaskDayPlan, TaskTimeEntry, TimerSession, WorkBlockChildEntry } from '@squadhub/shared';

export type ActivityKind = 'work' | 'break' | 'no_work' | 'overtime' | 'day_plan' | 'block' | 'task';
export interface Activity {
  id: string;
  kind: ActivityKind;
  title: string;
  start: number;
  end: number;
  seconds: number;
  live?: boolean;
  taskId?: string;
  project?: string;
  note?: string | null;
  source?: string;
  isManual?: boolean;
  children?: WorkBlockChildEntry[];
  segments?: Activity[];
}
export const KINDS: { kind: ActivityKind; label: string; color: string }[] = [
  { kind: 'work', label: 'Work', color: '#4bc88d' },
  { kind: 'break', label: 'Break', color: '#eeb85a' },
  { kind: 'overtime', label: 'Overtime', color: '#ef8b70' },
  { kind: 'day_plan', label: 'Day planner', color: '#38bdf8' },
  { kind: 'block', label: 'Work blocks', color: '#ad92ed' },
  { kind: 'task', label: 'Tasks', color: '#71a7ee' },
  { kind: 'no_work', label: 'No work', color: '#9b9fab' },
];
// Attendance dates and office timing are defined in IST throughout SquadHub.
export const TIME_ZONE = 'Asia/Kolkata';
const IST_MS = 330 * 60000;
export function dayKey(stamp: number = Date.now()) {
  return new Date(stamp + IST_MS).toISOString().slice(0, 10);
}
export function dayStart(key: string) { return Date.parse(`${key}T00:00:00+05:30`); }
export function shiftDay(key: string, amount: number) { return dayKey(dayStart(key) + amount * 86400000); }
export function weekStart(key: string) {
  const day = new Date(dayStart(key) + IST_MS).getUTCDay();
  return shiftDay(key, -(day === 0 ? 6 : day - 1));
}
export function dateLabel(stamp: number, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat('en-US', { ...options, timeZone: TIME_ZONE }).format(stamp);
}
export function clock(stamp: number) { return dateLabel(stamp, { hour: 'numeric', minute: '2-digit' }); }
export function duration(seconds: number) {
  const mins = Math.floor(Math.max(0, seconds) / 60);
  return mins >= 60 ? `${Math.floor(mins / 60)}h${mins % 60 ? ` ${mins % 60}m` : ''}` : mins ? `${mins}m` : seconds > 0 ? '<1m' : '0m';
}
export function isAttendance(kind: ActivityKind) { return ['work', 'break', 'no_work', 'overtime'].includes(kind); }

/** Split at local midnight, then split work at each day's commitment. */
export function attendanceActivities(sessions: TimerSession[], commitment: number, now: number): Activity[] {
  const result: Activity[] = [];
  const used = new Map<string, number>();
  const labels = { work: 'Work session', break: 'Break', no_work: 'No work' };
  for (const session of [...sessions].sort((a, b) => Date.parse(a.start_time) - Date.parse(b.start_time))) {
    let start = Date.parse(session.start_time);
    const end = session.end_time ? Date.parse(session.end_time) : now;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    while (start < end) {
      const key = dayKey(start);
      const stop = Math.min(end, dayStart(shiftDay(key, 1)));
      const seconds = (stop - start) / 1000;
      const prior = used.get(key) || 0;
      const regular = session.timer_type === 'work' && commitment > 0
        ? Math.max(0, Math.min(seconds, commitment - prior)) : seconds;
      const add = (kind: ActivityKind, a: number, b: number) => {
        if (b <= a) return;
        result.push({ id: `${session.id}:${a}:${kind}`, kind, title: kind === 'overtime' ? 'Overtime' : labels[session.timer_type], start: a, end: b, seconds: (b - a) / 1000, live: !session.end_time && b === end, source: 'Attendance timer' });
      };
      add(session.timer_type, start, start + regular * 1000);
      if (regular < seconds) add('overtime', start + regular * 1000, stop);
      if (session.timer_type === 'work') used.set(key, prior + seconds);
      start = stop;
    }
  }
  return result;
}
export function taskActivities(entries: TaskTimeEntry[]): Activity[] {
  return entries.filter(e => e.duration_seconds > 0).map(e => ({
    id: `entry:${e.id}`, kind: e.source === 'work_block' ? 'block' : 'task',
    title: e.task?.title || 'Archived task', start: Date.parse(e.started_at), end: Date.parse(e.stopped_at),
    seconds: e.duration_seconds, taskId: e.task_id, project: [e.task?.space?.name, e.task?.list?.name].filter(Boolean).join(' / '),
    note: e.note, source: e.source === 'manual' ? 'Manually logged' : e.source === 'work_block' ? 'Work block timer' : 'Task timer',
    isManual: e.source === 'manual', children: e.children,
  }));
}
export function dayPlanActivities(plans: TaskDayPlan[]): Activity[] {
  const result: Activity[] = [];
  for (const plan of plans) {
    if (!plan.plan_date) continue;
    const isAllDay = Boolean(plan.all_day || (plan.start_minute === 0 && plan.duration_minutes === 1440));
    const startMin = isAllDay ? 9 * 60 : (plan.start_minute ?? 0);
    const durMin = isAllDay ? 30 : Math.max(15, plan.duration_minutes || 30);
    const start = dayStart(plan.plan_date) + startMin * 60000;
    const end = start + durMin * 60000;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;

    const title = plan.task?.title || plan.container?.name || 'Scheduled task';
    const project = plan.task?.list?.name || plan.container?.name;
    const source = plan.kind === 'group_block'
      ? 'Day Planner group'
      : plan.virtual
        ? 'Day Planner (scheduled)'
        : 'Day Planner';

    result.push({
      id: `plan:${plan.id}`,
      kind: 'day_plan',
      title,
      start,
      end,
      seconds: durMin * 60,
      taskId: plan.task_id || plan.task?.id,
      project,
      source,
      note: isAllDay ? 'All day task' : null,
    });
  }
  return result;
}
/** Keep credited task time (including parallel shares) distinct from elapsed wall time. */
export function clipActivity(event: Activity, from: number, to: number): Activity | null {
  if (!Number.isFinite(event.start) || !Number.isFinite(event.end) || event.end <= event.start) return null;
  const start = Math.max(from, event.start), end = Math.min(to, event.end);
  if (end <= start) return null;
  if (event.segments) {
    const segments = event.segments.map(segment => clipActivity(segment, from, to)).filter((segment): segment is Activity => !!segment);
    if (!segments.length) return null;
    return { ...event, start: Math.min(...segments.map(s => s.start)), end: Math.max(...segments.map(s => s.end)), seconds: segments.reduce((sum, s) => sum + s.seconds, 0), segments, live: segments.some(s => s.live), isManual: event.isManual };
  }
  return { ...event, start, end, seconds: event.seconds * (end - start) / (event.end - event.start) };
}

/** One calendar block per task per IST day: earliest start to latest end,
 *  carrying the sum of actually allocated seconds. Parallel timers must not
 *  split a task into multiple sections. */
export function combineTaskSegments(events: Activity[]): Activity[] {
  const grouped = new Map<string, Activity[]>();
  const result: Activity[] = [];
  for (const event of events) {
    if (event.kind !== 'task' || !event.taskId) { result.push(event); continue; }
    if (!Number.isFinite(event.start) || !Number.isFinite(event.end)) continue;
    for (let stamp = event.start; stamp < event.end;) {
      const date = dayKey(stamp), next = dayStart(shiftDay(date, 1));
      const clipped = clipActivity(event, dayStart(date), next);
      if (clipped) {
        const manualKey = clipped.isManual ? 'manual' : 'timer';
        const key = `task-day:${event.taskId}:${date}:${manualKey}`;
        const segments = grouped.get(key) || [];
        segments.push(...(clipped.segments || [clipped]));
        grouped.set(key, segments);
      }
      stamp = next;
    }
  }
  for (const [key, segments] of grouped) {
    segments.sort((a, b) => a.start - b.start || a.end - b.end);
    const isManual = segments.some(s => s.isManual);
    const latest = segments.reduce((a, b) => (b.end > a.end ? b : a));
    result.push({
      ...latest,
      id: key,
      start: Math.min(...segments.map(s => s.start)),
      end: Math.max(...segments.map(s => s.end)),
      seconds: segments.reduce((sum, s) => sum + s.seconds, 0),
      live: segments.some(s => s.live),
      source: segments.length > 1 ? (isManual ? 'Manually logged' : 'Task time') : segments[0].source,
      isManual,
      note: segments.length > 1 ? null : segments[0].note,
      segments: segments.length > 1 ? segments : undefined,
    });
  }
  return result;
}

/** Interval partitioning keeps concurrent task timers independently selectable. */
export function layoutActivities(events: Activity[], minimumDuration = 0) {
  const ordered = [...events].sort((a, b) => a.start - b.start || b.end - a.end);
  const positioned: { event: Activity; column: number; columns: number }[] = [];
  let cluster: typeof positioned = [], ends: number[] = [], clusterEnd = -Infinity;
  const flush = () => { for (const item of cluster) item.columns = ends.length; cluster = []; ends = []; };
  for (const event of ordered) {
    if (event.start >= clusterEnd) flush();
    let column = ends.findIndex(end => end <= event.start);
    if (column === -1) column = ends.length;
    const visualEnd = Math.max(event.end, event.start + minimumDuration);
    ends[column] = visualEnd;
    const item = { event, column, columns: 1 };
    positioned.push(item); cluster.push(item); clusterEnd = Math.max(clusterEnd, visualEnd);
  }
  flush();
  return positioned;
}
