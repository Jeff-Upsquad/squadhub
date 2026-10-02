import type { Goal, GoalPriority, GoalStatus, GoalStoredStatus, GoalTask } from '@squadhub/shared';

// ── Days ───────────────────────────────────────────────────────────────────
// The timeline works in local calendar days ('YYYY-MM-DD'), the same way the
// rest of the app reads task dates (Intl in the viewer's timezone).

const pad = (n: number) => (n < 10 ? `0${n}` : String(n));

export function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** A task/goal date (day or timestamp) → local day key. */
export function toDayKey(value: string | null | undefined): string | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return null;
  // Date-only values come back from Postgres as UTC midnight — keep their day.
  if (/T00:00:00(\.0+)?(Z|\+00(:?00)?)$/.test(value)) return value.slice(0, 10);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const DAY_MS = 86_400_000;
const utc = (key: string) => Date.UTC(+key.slice(0, 4), +key.slice(5, 7) - 1, +key.slice(8, 10));

export function shiftDay(key: string, n: number): string {
  const d = new Date(utc(key) + n * DAY_MS);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function daysBetween(a: string, b: string): number {
  return Math.round((utc(b) - utc(a)) / DAY_MS);
}

export function weekday(key: string): number {
  return new Date(utc(key)).getUTCDay();
}

/**
 * New value for a task date moved to `day`. Date-only values stay date-only;
 * a timed work date keeps its time of day.
 */
export function moveTaskDate(original: string | null, day: string): string {
  if (!original || /^\d{4}-\d{2}-\d{2}$/.test(original)) return day;
  if (/T00:00:00(\.0+)?(Z|\+00(:?00)?)$/.test(original)) return day;
  const d = new Date(original);
  if (!Number.isFinite(d.getTime()) || (d.getHours() === 0 && d.getMinutes() === 0)) return day;
  return new Date(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10), d.getHours(), d.getMinutes()).toISOString();
}

const fmtShort = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
const fmtYear = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

export function formatDay(key: string | null | undefined, opts: { year?: boolean } = {}): string {
  if (!key) return '';
  const d = new Date(utc(key));
  const sameYear = key.slice(0, 4) === todayKey().slice(0, 4);
  return (opts.year || !sameYear ? fmtYear : fmtShort).format(new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function formatRange(start: string | null, end: string | null): string {
  if (!start && !end) return '';
  if (!start || !end || start === end) return formatDay(start || end);
  const sameMonth = start.slice(0, 7) === end.slice(0, 7);
  return sameMonth
    ? `${formatDay(start)} – ${+end.slice(8, 10)}`
    : `${formatDay(start)} – ${formatDay(end)}`;
}

/** "in 3 days", "today", "2 days ago" */
export function relativeDay(key: string | null): string {
  if (!key) return '';
  const n = daysBetween(todayKey(), key);
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  if (n > 0) return n < 14 ? `in ${n} days` : `in ${Math.round(n / 7)} weeks`;
  return -n < 14 ? `${-n} days ago` : `${Math.round(-n / 7)} weeks ago`;
}

// ── Ranges on a task ───────────────────────────────────────────────────────

export type RangeKind = 'work' | 'plan';
export interface DayRange { start: string; end: string }

/** Work dates (work_date → work_end_date) or start/due dates as day keys. */
export function taskRange(t: GoalTask, kind: RangeKind): DayRange | null {
  const s = toDayKey(kind === 'work' ? t.work_date : t.start_date);
  const e = toDayKey(kind === 'work' ? t.work_end_date : t.due_date);
  if (!s && !e) return null;
  const start = s || e!;
  const end = e && e >= start ? e : start;
  return { start, end };
}

export function goalStartDay(g: Goal): string | null {
  return g.work_start_date || g.start_date || null;
}

/** Started (by its work/start date) and not finished or paused. */
export function isGoalInMotion(g: Goal, today = todayKey()): boolean {
  const start = goalStartDay(g);
  return g.status !== 'achieved' && g.status !== 'on_hold' && (g.status === 'in_progress' || (!!start && start <= today));
}

export function isGoalOverdue(g: Goal, today = todayKey()): boolean {
  return g.status !== 'achieved' && !!g.due_date && g.due_date < today;
}

// ── Labels / colors ────────────────────────────────────────────────────────

export const STATUS_META: Record<GoalStatus, { label: string; color: string }> = {
  planned: { label: 'Planned', color: '#8b93a7' },
  in_progress: { label: 'In progress', color: '#2f7cf6' },
  on_hold: { label: 'On hold', color: '#f08c00' },
  achieved: { label: 'Achieved', color: '#0ca678' },
};
export const STORED_STATUSES: GoalStoredStatus[] = ['planned', 'in_progress', 'on_hold'];

export const PRIORITY_META: Record<GoalPriority, { label: string; color: string; rank: number }> = {
  emergency: { label: 'Emergency', color: '#b91c1c', rank: 0 },
  urgent: { label: 'Urgent', color: '#ef4444', rank: 1 },
  high: { label: 'High', color: '#f97316', rank: 2 },
  normal: { label: 'Normal', color: '#3b82f6', rank: 3 },
  low: { label: 'Low', color: '#94a3b8', rank: 4 },
  none: { label: 'No priority', color: '#cbd5e1', rank: 5 },
};

export const PROJECT_COLORS = [
  '#7c5cff', '#ff6b4a', '#0ca678', '#2f7cf6', '#f59f00',
  '#e64980', '#0c9fb0', '#5c7cfa', '#82b51e', '#ae3ec9',
];

const BAR_COLORS = ['#7c5cff', '#2f7cf6', '#0ca678', '#f59f00', '#e64980', '#0c9fb0', '#ff6b4a', '#5c7cfa', '#82b51e', '#ae3ec9'];

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Stable color per space — the space's own color when it's vivid enough. */
export function spaceColor(t: Pick<GoalTask, 'space_id' | 'space_color'>): string {
  const c = t.space_color;
  if (c && /^#[0-9a-f]{6}$/i.test(c)) {
    const r = parseInt(c.slice(1, 3), 16), g = parseInt(c.slice(3, 5), 16), b = parseInt(c.slice(5, 7), 16);
    const sat = Math.max(r, g, b) - Math.min(r, g, b);
    if (sat > 60) return c;
  }
  return BAR_COLORS[hash(t.space_id || '') % BAR_COLORS.length];
}

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).map((s) => s[0]).slice(0, 2).join('').toUpperCase() || '?';
}

export function taskPath(t: GoalTask): string {
  return [t.space_name, t.folder_name, t.list_name].filter(Boolean).join(' / ');
}

export function errorMessage(e: unknown, fallback = 'Something went wrong'): string {
  const anyE = e as { response?: { data?: { error?: string } }; message?: string };
  return anyE?.response?.data?.error || anyE?.message || fallback;
}
