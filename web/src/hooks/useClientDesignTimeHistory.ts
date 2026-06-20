import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import api from '../services/api';
import type { DesignPlan } from './useClientDesignPlan';

// ---------------------------------------------------------------------------
// Elapsed time is a planned feature: "idle" time (a day or half-day where no
// work happened) that still counts toward the billed total. The data source
// does not exist yet, so every elapsed value is 0 and the UI renders it as a
// disabled / "coming soon" field. Flip this flag (and feed real numbers into
// the buckets below) when the feature ships.
export const ELAPSED_ENABLED = false;

interface DailySummary {
  date: string;
  total_work_seconds: number;
}

export interface DayPoint {
  date: string; // YYYY-MM-DD
  label: string; // "Today", "Yesterday", "Mon Jun 16"
  actualHours: number;
  elapsedHours: number;
  allotHours: number;
  today: boolean;
  weekend: boolean;
}

export interface WeekPoint {
  key: string; // ISO date of week start (Mon)
  label: string; // "This week", "Last week", "Jun 9 – 15"
  start: Date;
  end: Date;
  actualHours: number;
  elapsedHours: number;
  allotHours: number;
  current: boolean;
}

export interface MonthPoint {
  key: string; // "2026-6"
  label: string; // "June", "May"
  start: Date;
  actualHours: number;
  elapsedHours: number;
  allotHours: number;
  current: boolean;
}

export interface TimeHistory {
  days: DayPoint[]; // most-recent-first, last 14 days
  weeks: WeekPoint[]; // oldest-first, last 10 weeks
  months: MonthPoint[]; // oldest-first, last 6 months
  loading: boolean;
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_LABELS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const DAYS_BACK = 14;
const WEEKS_BACK = 10;
const MONTHS_BACK = 6;

function toISODate(d: Date): string {
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

// Monday-based week start, matching useClientDesignPlan.
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

/**
 * Fetches a wide window of per-day work totals for the folder (one sparse query
 * via the existing /time-summary endpoint) and rolls it up into day / week /
 * month buckets with the plan's allotments attached. No backend change needed.
 */
export function useClientDesignTimeHistory(folderId: string | undefined, plan: DesignPlan): TimeHistory {
  const today = startOfDay(new Date());
  const earliestMonth = new Date(today.getFullYear(), today.getMonth() - (MONTHS_BACK - 1), 1);
  const fromISO = toISODate(earliestMonth);
  const toISO = toISODate(today);

  const { data, isLoading } = useQuery({
    queryKey: ['folder-time-history', folderId, fromISO, toISO],
    queryFn: async () => {
      try {
        const res = await api.get(
          `/pm/folders/${folderId}/time-summary?from=${fromISO}&to=${toISO}`,
        );
        return res.data.data as DailySummary[];
      } catch {
        return [] as DailySummary[];
      }
    },
    enabled: !!folderId,
  });

  return useMemo(() => {
    const map = new Map<string, number>();
    for (const s of data || []) map.set(s.date, s.total_work_seconds || 0);

    const todayISO = toISODate(today);
    const yesterdayISO = toISODate(addDays(today, -1));

    // ---- Daily (last N days, most-recent first) ----
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
        elapsedHours: 0,
        allotHours: weekend ? 0 : plan.dailyHours,
        today: iso === todayISO,
        weekend,
      });
    }

    // ---- Weekly (last N weeks, oldest first) ----
    const weeks: WeekPoint[] = [];
    const curWeekStart = startOfWeek(today);
    for (let i = WEEKS_BACK - 1; i >= 0; i--) {
      const ws = addDays(curWeekStart, -i * 7);
      const we = addDays(ws, 6);
      let secs = 0;
      for (let k = 0; k < 7; k++) secs += map.get(toISODate(addDays(ws, k))) || 0;
      const current = i === 0;
      const lastWeek = i === 1;
      const label = current
        ? 'This week'
        : lastWeek
          ? 'Last week'
          : `${shortDate(ws)} – ${shortDate(we)}`;
      weeks.push({
        key: toISODate(ws),
        label,
        start: ws,
        end: we,
        actualHours: secs / 3600,
        elapsedHours: 0,
        allotHours: plan.weeklyHours,
        current,
      });
    }

    // ---- Monthly (last N months, oldest first) ----
    const months: MonthPoint[] = [];
    for (let i = MONTHS_BACK - 1; i >= 0; i--) {
      const mStart = new Date(today.getFullYear(), today.getMonth() - i, 1);
      const daysInMonth = new Date(mStart.getFullYear(), mStart.getMonth() + 1, 0).getDate();
      let secs = 0;
      for (let day = 1; day <= daysInMonth; day++) {
        secs += map.get(toISODate(new Date(mStart.getFullYear(), mStart.getMonth(), day))) || 0;
      }
      const current = i === 0;
      months.push({
        key: `${mStart.getFullYear()}-${mStart.getMonth() + 1}`,
        label: MONTH_LABELS[mStart.getMonth()],
        start: mStart,
        actualHours: secs / 3600,
        elapsedHours: 0,
        // monthlyHours is prorated for the current month; for past months it is
        // an approximate reference allotment (true historical plan not stored).
        allotHours: plan.monthlyHours,
        current,
      });
    }

    return { days, weeks, months, loading: isLoading };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, isLoading, plan.dailyHours, plan.weeklyHours, plan.monthlyHours]);
}
