// Pure roll-up math for the public design-space share view. Ported from
// useClientDesignTimeHistory.ts + useClientDesignPlan.ts so the unauthenticated
// /space/[token] page can render the same Reports/Dashboard numbers without the
// React Query hooks (those call the authenticated API).

import type {
  DesignShareDailyPoint,
  DesignSharePlan,
  DesignShareStatusLane,
  DesignShareTask,
} from '@squadhub/shared';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_LABELS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const DAYS_BACK = 14;
const WEEKS_BACK = 10;
const MONTHS_BACK = 6;

export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

// Monday-based week start.
function startOfWeek(d: Date): Date {
  const day = d.getDay();
  const diff = (day + 6) % 7;
  const out = startOfDay(d);
  out.setDate(out.getDate() - diff);
  return out;
}

function shortDate(d: Date): string {
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export interface DayPoint {
  date: string;
  label: string;
  actualHours: number;
  allotHours: number;
  today: boolean;
  weekend: boolean;
}
export interface WeekPoint {
  key: string;
  label: string;
  actualHours: number;
  allotHours: number;
  current: boolean;
}
export interface MonthPoint {
  key: string;
  label: string;
  actualHours: number;
  allotHours: number;
  current: boolean;
}
export interface TimeHistory {
  days: DayPoint[]; // most-recent-first, last 14 days
  weeks: WeekPoint[]; // oldest-first, last 10 weeks
  months: MonthPoint[]; // oldest-first, last 6 months
}

function secondsByDate(summary: DesignShareDailyPoint[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const s of summary || []) map.set(s.date, s.total_work_seconds || 0);
  return map;
}

/** Rolls daily time totals into day/week/month buckets with plan allotments. */
export function rollupTimeHistory(
  summary: DesignShareDailyPoint[],
  plan: DesignSharePlan,
): TimeHistory {
  const today = startOfDay(new Date());
  const map = secondsByDate(summary);
  const todayISO = toISODate(today);
  const yesterdayISO = toISODate(addDays(today, -1));
  const dailyHours = plan.daily_hours ?? 0;
  const weeklyHours = plan.weekly_hours ?? 0;
  const monthlyHours = plan.monthly_hours ?? 0;

  const days: DayPoint[] = [];
  for (let i = 0; i < DAYS_BACK; i++) {
    const d = addDays(today, -i);
    const iso = toISODate(d);
    const weekend = d.getDay() === 0 || d.getDay() === 6;
    let label: string;
    if (iso === todayISO) label = 'Today';
    else if (iso === yesterdayISO) label = 'Yesterday';
    else label = `${DAY_LABELS[d.getDay()]} ${shortDate(d)}`;
    days.push({
      date: iso,
      label,
      actualHours: (map.get(iso) || 0) / 3600,
      allotHours: weekend ? 0 : dailyHours,
      today: iso === todayISO,
      weekend,
    });
  }

  const weeks: WeekPoint[] = [];
  const curWeekStart = startOfWeek(today);
  for (let i = WEEKS_BACK - 1; i >= 0; i--) {
    const ws = addDays(curWeekStart, -i * 7);
    const we = addDays(ws, 6);
    let secs = 0;
    for (let k = 0; k < 7; k++) secs += map.get(toISODate(addDays(ws, k))) || 0;
    const current = i === 0;
    const label = current ? 'This week' : i === 1 ? 'Last week' : `${shortDate(ws)} – ${shortDate(we)}`;
    weeks.push({ key: toISODate(ws), label, actualHours: secs / 3600, allotHours: weeklyHours, current });
  }

  const months: MonthPoint[] = [];
  for (let i = MONTHS_BACK - 1; i >= 0; i--) {
    const mStart = new Date(today.getFullYear(), today.getMonth() - i, 1);
    const daysInMonth = new Date(mStart.getFullYear(), mStart.getMonth() + 1, 0).getDate();
    let secs = 0;
    for (let day = 1; day <= daysInMonth; day++) {
      secs += map.get(toISODate(new Date(mStart.getFullYear(), mStart.getMonth(), day))) || 0;
    }
    months.push({
      key: `${mStart.getFullYear()}-${mStart.getMonth() + 1}`,
      label: MONTH_LABELS[mStart.getMonth()],
      actualHours: secs / 3600,
      allotHours: monthlyHours,
      current: i === 0,
    });
  }

  return { days, weeks, months };
}

export interface PlanUsage {
  dailyHours: number;
  weeklyHours: number;
  monthlyHours: number;
  usedToday: number;
  usedWeek: number;
  usedMonth: number;
}

/** This-day / this-week / this-month worked hours vs plan allotment. */
export function computePlanUsage(summary: DesignShareDailyPoint[], plan: DesignSharePlan): PlanUsage {
  const map = secondsByDate(summary);
  const today = startOfDay(new Date());
  const todayKey = toISODate(today);
  const weekStart = startOfWeek(today);

  let weekSecs = 0;
  for (let k = 0; k < 7; k++) weekSecs += map.get(toISODate(addDays(weekStart, k))) || 0;

  const mStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const daysInMonth = new Date(mStart.getFullYear(), mStart.getMonth() + 1, 0).getDate();
  let monthSecs = 0;
  for (let day = 1; day <= daysInMonth; day++) {
    monthSecs += map.get(toISODate(new Date(mStart.getFullYear(), mStart.getMonth(), day))) || 0;
  }

  const round1 = (n: number) => Math.round(n * 10) / 10;
  return {
    dailyHours: plan.daily_hours ?? 0,
    weeklyHours: plan.weekly_hours ?? 0,
    monthlyHours: plan.monthly_hours ?? 0,
    usedToday: round1((map.get(todayKey) || 0) / 3600),
    usedWeek: round1(weekSecs / 3600),
    usedMonth: round1(monthSecs / 3600),
  };
}

export const LANE_LABEL: Record<DesignShareStatusLane, string> = {
  queued: 'Queued',
  progress: 'In progress',
  review: 'In review',
  done: 'Completed',
};

export const LANE_ORDER: DesignShareStatusLane[] = ['progress', 'review', 'queued', 'done'];

/** Total tracked hours across the given tasks (task.time_tracked is seconds). */
export function totalHoursSpent(tasks: DesignShareTask[]): number {
  const secs = tasks.reduce((s, t) => s + (t.time_tracked || 0), 0);
  return Math.round((secs / 3600) * 10) / 10;
}

export function countByLane(tasks: DesignShareTask[]): Record<DesignShareStatusLane, number> {
  const out: Record<DesignShareStatusLane, number> = { queued: 0, progress: 0, review: 0, done: 0 };
  for (const t of tasks) out[t.status] += 1;
  return out;
}

export function formatHours(h: number): string {
  if (!h) return '0h';
  if (h < 1) return `${Math.round(h * 60)}m`;
  const whole = Math.floor(h);
  const mins = Math.round((h - whole) * 60);
  return mins ? `${whole}h ${mins}m` : `${whole}h`;
}
