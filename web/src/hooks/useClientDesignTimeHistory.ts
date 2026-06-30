import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import api from '../services/api';
import type { DesignPlan } from './useClientDesignPlan';

// ---------------------------------------------------------------------------
// Elapsed time: "idle" time (a day or half-day where no active work happened)
// that still counts toward the billed total. Written by the elapsed-time cron
// into elapsed_time_entries and surfaced per day via the /time-summary endpoint
// (elapsed_seconds). The buckets below carry real elapsedHours; the Reports UI
// shows them alongside actual hours.
export const ELAPSED_ENABLED = true;

interface DailySummary {
  date: string;
  total_work_seconds: number;
  elapsed_seconds?: number;
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
export interface HistoryPeriod {
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
  isCurrent: boolean;
}

export function useClientDesignTimeHistory(
  folderId: string | undefined,
  plan: DesignPlan,
  period?: HistoryPeriod,
): TimeHistory {
  const today = startOfDay(new Date());
  const earliestMonth = new Date(today.getFullYear(), today.getMonth() - (MONTHS_BACK - 1), 1);
  const defFromISO = toISODate(earliestMonth);
  const defToISO = toISODate(today);
  // A non-current period (Previous month / custom range) scopes every bucket to
  // its own dates. Fetch a window wide enough to cover both the default rolling
  // view and the selected range.
  const scoped = period && !period.isCurrent ? period : null;
  const fromISO = scoped && scoped.from < defFromISO ? scoped.from : defFromISO;
  const toISO = scoped && scoped.to > defToISO ? scoped.to : defToISO;

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
    const emap = new Map<string, number>();
    for (const s of data || []) {
      map.set(s.date, s.total_work_seconds || 0);
      emap.set(s.date, s.elapsed_seconds || 0);
    }

    const todayISO = toISODate(today);
    const yesterdayISO = toISODate(addDays(today, -1));

    // ---- Period-scoped view (Previous month / custom range) ----------------
    // Every section follows the selected dates instead of the rolling windows.
    if (scoped) {
      const start = startOfDay(new Date(`${scoped.from}T00:00:00`));
      const end = startOfDay(new Date(`${scoped.to}T00:00:00`));
      const inRange = (d: Date) => d >= start && d <= end;

      // Days — every day in the range, most-recent first.
      const sDays: DayPoint[] = [];
      for (let d = new Date(end); d >= start; d = addDays(d, -1)) {
        const iso = toISODate(d);
        const weekend = d.getDay() === 0 || d.getDay() === 6;
        const isToday = iso === todayISO;
        const label = isToday
          ? 'Today'
          : iso === yesterdayISO
            ? 'Yesterday'
            : `${DAY_LABELS[d.getDay()]} ${shortDate(d)}`;
        sDays.push({
          date: iso,
          label,
          actualHours: (map.get(iso) || 0) / 3600,
          elapsedHours: (emap.get(iso) || 0) / 3600,
          allotHours: weekend ? 0 : plan.dailyHours,
          today: isToday,
          weekend,
        });
      }

      // Weeks — every week overlapping the range, oldest first. Partial boundary
      // weeks sum only their in-range days, and labels clamp to the period so
      // e.g. "Previous month" never spills into a neighbouring month.
      const sWeeks: WeekPoint[] = [];
      for (let cur = startOfWeek(start); cur <= end; cur = addDays(cur, 7)) {
        const ws = new Date(cur);
        const we = addDays(ws, 6);
        let secs = 0;
        let esecs = 0;
        for (let k = 0; k < 7; k++) {
          const dd = addDays(ws, k);
          if (inRange(dd)) {
            secs += map.get(toISODate(dd)) || 0;
            esecs += emap.get(toISODate(dd)) || 0;
          }
        }
        const anchor = ws < start ? start : ws;
        const dispEnd = we > end ? end : we;
        sWeeks.push({
          key: toISODate(ws),
          label: `${shortDate(anchor)} – ${shortDate(dispEnd)}`,
          start: ws,
          end: we,
          actualHours: secs / 3600,
          elapsedHours: esecs / 3600,
          allotHours: plan.weeklyHours,
          current: today >= ws && today <= we && inRange(today),
        });
      }

      // Months — every month overlapping the range, oldest first.
      const sMonths: MonthPoint[] = [];
      const lastM = new Date(end.getFullYear(), end.getMonth(), 1);
      for (
        let m = new Date(start.getFullYear(), start.getMonth(), 1);
        m <= lastM;
        m = new Date(m.getFullYear(), m.getMonth() + 1, 1)
      ) {
        const daysInMonth = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
        let secs = 0;
        let esecs = 0;
        for (let day = 1; day <= daysInMonth; day++) {
          const dd = new Date(m.getFullYear(), m.getMonth(), day);
          if (inRange(dd)) {
            secs += map.get(toISODate(dd)) || 0;
            esecs += emap.get(toISODate(dd)) || 0;
          }
        }
        sMonths.push({
          key: `${m.getFullYear()}-${m.getMonth() + 1}`,
          label: `${MONTH_LABELS[m.getMonth()]} ${m.getFullYear()}`,
          start: new Date(m),
          actualHours: secs / 3600,
          elapsedHours: esecs / 3600,
          allotHours: plan.monthlyHours,
          current:
            m.getFullYear() === today.getFullYear() &&
            m.getMonth() === today.getMonth() &&
            inRange(today),
        });
      }

      return { days: sDays, weeks: sWeeks, months: sMonths, loading: isLoading };
    }

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
        elapsedHours: (emap.get(iso) || 0) / 3600,
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
      let esecs = 0;
      for (let k = 0; k < 7; k++) {
        secs += map.get(toISODate(addDays(ws, k))) || 0;
        esecs += emap.get(toISODate(addDays(ws, k))) || 0;
      }
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
        elapsedHours: esecs / 3600,
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
      let esecs = 0;
      for (let day = 1; day <= daysInMonth; day++) {
        const k = toISODate(new Date(mStart.getFullYear(), mStart.getMonth(), day));
        secs += map.get(k) || 0;
        esecs += emap.get(k) || 0;
      }
      const current = i === 0;
      months.push({
        key: `${mStart.getFullYear()}-${mStart.getMonth() + 1}`,
        label: MONTH_LABELS[mStart.getMonth()],
        start: mStart,
        actualHours: secs / 3600,
        elapsedHours: esecs / 3600,
        // monthlyHours is prorated for the current month; for past months it is
        // an approximate reference allotment (true historical plan not stored).
        allotHours: plan.monthlyHours,
        current,
      });
    }

    return { days, weeks, months, loading: isLoading };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, isLoading, plan.dailyHours, plan.weeklyHours, plan.monthlyHours, scoped?.from, scoped?.to]);
}
