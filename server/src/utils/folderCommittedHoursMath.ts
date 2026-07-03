// ============================================================
// folderCommittedHoursMath
//
// Pure, dependency-free math for period-aware committed hours. Kept separate
// from folderCommittedHours.ts (which touches the DB) so it's trivially unit-
// testable. See folderCommittedHours.ts for the narrative.
// ============================================================

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
function pad2(n: number): string {
  return String(n).padStart(2, '0');
}
export function istTodayISO(): string {
  const d = new Date(Date.now() + IST_OFFSET_MS);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

export interface PlanSegment {
  start: string; // YYYY-MM-DD (inclusive)
  end: string | null; // YYYY-MM-DD (inclusive) or null = open
  daily: number | null;
  weekly: number | null;
}
export interface FolderPlanTimeline {
  hasCard: boolean;
  segments: PlanSegment[];
  workingDays: Set<number>; // 0=Sun .. 6=Sat
}

const DAY_NAME_TO_INDEX: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
};
export function parseWorkingDays(arr: unknown): Set<number> {
  const set = new Set<number>();
  if (Array.isArray(arr)) {
    for (const d of arr) {
      const k = String(d).slice(0, 3).toLowerCase();
      if (k in DAY_NAME_TO_INDEX) set.add(DAY_NAME_TO_INDEX[k]);
    }
  }
  if (set.size === 0) [1, 2, 3, 4, 5].forEach((i) => set.add(i)); // default Mon–Fri
  return set;
}

export function snapDaily(snap: any): number | null {
  const v = snap?.plan?.daily_hours;
  return v != null ? Number(v) : null;
}
export function snapWeekly(snap: any): number | null {
  const v = snap?.plan?.weekly_hours;
  return v != null ? Number(v) : null;
}

/** Plan daily hours in effect on a date (ignores working-day; null if uncovered).
 *  Later terms win when ranges touch at a boundary. */
export function segmentDailyForDate(tl: FolderPlanTimeline, dateISO: string): number | null {
  let match: PlanSegment | null = null;
  for (const s of tl.segments) {
    if (s.start <= dateISO && (s.end == null || s.end >= dateISO)) match = s;
  }
  return match?.daily ?? null;
}
export function segmentWeeklyForDate(tl: FolderPlanTimeline, dateISO: string): number | null {
  let match: PlanSegment | null = null;
  for (const s of tl.segments) {
    if (s.start <= dateISO && (s.end == null || s.end >= dateISO)) match = s;
  }
  return match?.weekly ?? null;
}

/** Committed target hours for one date: 0 on non-working days / outside all
 *  segments; else the covering segment's daily hours. */
export function dailyTargetForDate(tl: FolderPlanTimeline, dateISO: string): number {
  const dow = new Date(dateISO + 'T00:00:00Z').getUTCDay();
  if (!tl.workingDays.has(dow)) return 0;
  return segmentDailyForDate(tl, dateISO) ?? 0;
}

export function eachDate(from: string, to: string): string[] {
  const out: string[] = [];
  let d = new Date(from + 'T00:00:00Z');
  const end = new Date(to + 'T00:00:00Z');
  while (d <= end) {
    out.push(`${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`);
    d = new Date(d.getTime() + 86400000);
  }
  return out;
}

/** Sum of each working day's target across [from, to] (inclusive). */
export function committedHoursForRange(tl: FolderPlanTimeline, from: string, to: string): number {
  let sum = 0;
  for (const day of eachDate(from, to)) sum += dailyTargetForDate(tl, day);
  return Math.round(sum * 100) / 100;
}

/** Per-date committed target for a range (working-day aware). */
export function dailyTargetsForRange(
  tl: FolderPlanTimeline,
  from: string,
  to: string,
): { date: string; hours: number }[] {
  return eachDate(from, to).map((date) => ({ date, hours: dailyTargetForDate(tl, date) }));
}

/** IST month bounds (first/last day) for the month containing `dateISO`. */
export function istMonthBounds(dateISO: string): { start: string; end: string } {
  const [y, m] = dateISO.split('-').map(Number);
  const start = `${y}-${pad2(m)}-01`;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start, end: `${y}-${pad2(m)}-${pad2(lastDay)}` };
}

/** IST week bounds (Mon–Sun) for the week containing `dateISO`. */
export function istWeekBounds(dateISO: string): { start: string; end: string } {
  const d = new Date(dateISO + 'T00:00:00Z');
  const dow = d.getUTCDay(); // 0=Sun
  const diffToMon = (dow + 6) % 7;
  const monday = new Date(d.getTime() - diffToMon * 86400000);
  const sunday = new Date(monday.getTime() + 6 * 86400000);
  const fmt = (x: Date) => `${x.getUTCFullYear()}-${pad2(x.getUTCMonth() + 1)}-${pad2(x.getUTCDate())}`;
  return { start: fmt(monday), end: fmt(sunday) };
}

export interface FolderCommittedHours {
  hasCard: boolean;
  daily_hours: number | null; // plan daily in effect today
  weekly_hours: number | null; // blended committed hours across this week's working days
  monthly_hours: number | null; // blended committed hours across this month's working days
  daily_targets: { date: string; hours: number }[]; // per-day targets for the current month
}

/** Derive the period-aware figures from a timeline, as of `today` (IST date). */
export function computeCommittedFromTimeline(
  tl: FolderPlanTimeline,
  today: string,
): FolderCommittedHours {
  if (!tl.hasCard) {
    return { hasCard: false, daily_hours: null, weekly_hours: null, monthly_hours: null, daily_targets: [] };
  }

  // No segment carries daily hours (no terms + no snapshot daily, or a plan
  // defined only weekly) → return nulls, NOT zeros: the consumers' existing
  // fallbacks (`?? 20`, `?? daily*20`) only engage on null/undefined, and a
  // hard 0 would zero every target. Weekly still resolves from the covering
  // segment when the plan defines it.
  const hasDaily = tl.segments.some((s) => s.daily != null);
  if (!hasDaily) {
    return {
      hasCard: true,
      daily_hours: null,
      weekly_hours: segmentWeeklyForDate(tl, today),
      monthly_hours: null,
      daily_targets: [],
    };
  }

  const week = istWeekBounds(today);
  const month = istMonthBounds(today);
  // daily_targets must cover the rendered WEEK too — it can straddle a month
  // boundary, and a map that stops at the month edge would read as a 0h target
  // for the adjacent month's days.
  const targetsFrom = week.start < month.start ? week.start : month.start;
  const targetsTo = week.end > month.end ? week.end : month.end;
  return {
    hasCard: true,
    daily_hours: segmentDailyForDate(tl, today),
    weekly_hours: committedHoursForRange(tl, week.start, week.end),
    monthly_hours: committedHoursForRange(tl, month.start, month.end),
    daily_targets: dailyTargetsForRange(tl, targetsFrom, targetsTo),
  };
}
