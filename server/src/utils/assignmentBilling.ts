// ============================================================
// assignmentBilling
//
// Pure helpers for the per-user Subscription Assignments view:
//   - prorate a card's monthly partner price across the days it was
//     actually active within a chosen calendar month
//   - sum a talent's self-declared "virtual office hours" into a
//     weekly available-hours figure
//
// Kept side-effect-free so it's trivially unit-testable.
// ============================================================

/** Inclusive count of days in the given month (1-based month: 1 = Jan). */
export function daysInMonth(year: number, month: number): number {
  // Day 0 of the next month is the last day of this month.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Number of calendar days a term was active within [year, month].
 *
 * The active window is [start, end], both inclusive and treated as calendar
 * dates (no time-of-day). `end == null` means the term is still open, so it
 * counts through the end of the month (or `todayIso`, whichever is earlier,
 * when the month being billed is the current one — we never bill the future).
 *
 * Returns 0 when the window doesn't intersect the month or when start > end.
 */
export function activeDaysInMonth(
  startIso: string | null,
  endIso: string | null,
  year: number,
  month: number,
  todayIso?: string,
): number {
  if (!startIso) return 0;

  const monthStart = Date.UTC(year, month - 1, 1);
  const total = daysInMonth(year, month);
  const monthEnd = Date.UTC(year, month - 1, total);

  const startMs = dateOnlyMs(startIso);
  if (startMs == null) return 0;

  // Open-ended terms run to month end, capped at today when present.
  let endMs: number;
  if (endIso) {
    const parsed = dateOnlyMs(endIso);
    if (parsed == null) return 0;
    endMs = parsed;
  } else {
    endMs = monthEnd;
    if (todayIso) {
      const todayMs = dateOnlyMs(todayIso);
      if (todayMs != null && todayMs < endMs) endMs = todayMs;
    }
  }

  // Clamp the term window to the month bounds.
  const from = Math.max(startMs, monthStart);
  const to = Math.min(endMs, monthEnd);
  if (to < from) return 0;

  const DAY = 24 * 60 * 60 * 1000;
  return Math.round((to - from) / DAY) + 1; // inclusive of both endpoints
}

/**
 * Prorated monthly payment: the full monthly partner price scaled by the
 * fraction of the month the card was active. Returns 0 when partnerPrice is
 * null/0 or there were no active days.
 */
export function prorateMonthly(
  partnerPrice: number | null,
  startIso: string | null,
  endIso: string | null,
  year: number,
  month: number,
  todayIso?: string,
): number {
  if (!partnerPrice || partnerPrice <= 0) return 0;
  const active = activeDaysInMonth(startIso, endIso, year, month, todayIso);
  if (active <= 0) return 0;
  const total = daysInMonth(year, month);
  return Math.round((partnerPrice * active) / total);
}

export interface VirtualOfficeHour {
  day?: string;
  from?: string;
  to?: string;
}

/**
 * Weekly available hours from a talent's virtual_office_hours array. Each entry
 * is one day's [from, to] time range (HH:MM); summing all entries gives the
 * weekly total. Mirrors the dailyHours math in the Profiles VirtualOfficeHoursPicker.
 */
export function weeklyHoursFromVirtualOffice(
  entries: VirtualOfficeHour[] | null | undefined,
): number {
  if (!Array.isArray(entries)) return 0;
  let minutes = 0;
  for (const e of entries) {
    const from = toMinutes(e?.from);
    const to = toMinutes(e?.to);
    if (from == null || to == null) continue;
    minutes += Math.max(0, to - from);
  }
  return Math.round((minutes / 60) * 100) / 100; // 2dp
}

// ---- internals ----

const TIME_RE = /^\d{1,2}:\d{2}$/;

function toMinutes(t: string | undefined | null): number | null {
  if (!t || !TIME_RE.test(t)) return null;
  const [h, m] = t.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

/** Parse the date portion (YYYY-MM-DD) of an ISO date/timestamp to a UTC ms at midnight. */
function dateOnlyMs(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!y || !mo || !d) return null;
  return Date.UTC(y, mo - 1, d);
}
