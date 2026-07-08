// ============================================================
// salesPeriod
//
// Period resolution for the admin Sales Dashboard. All sales metrics are
// events-in-period over the Squad CRM tables, so a period is a half-open
// UTC instant range [start_utc, end_utc) derived from IST midnights
// (fixed +05:30 — IST has no DST, see utils/ist). Week = Monday–Sunday in
// IST; month = the IST calendar month; custom = an inclusive IST date
// range (end + 1 day exclusive).
// ============================================================
import { IST_OFFSET_MS } from './ist';

export type SalesPeriodType = 'week' | 'month' | 'custom';

export interface SalesPeriod {
  period_type: SalesPeriodType;
  /** Canonical anchor: week → its Monday 'YYYY-MM-DD'; month → 'YYYY-MM'; custom → 'start..end'. */
  anchor: string;
  label: string;
  /** Inclusive IST calendar dates ('YYYY-MM-DD'). */
  start_ist: string;
  end_ist: string;
  /** UTC instants: start inclusive, end EXCLUSIVE (IST midnight after end_ist). */
  start_utc: string;
  end_utc: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const pad = (n: number) => String(n).padStart(2, '0');
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 'YYYY-MM-DD' → ms of that date's UTC midnight (pure calendar math). */
function dateMs(dateStr: string): number {
  const ms = Date.parse(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(ms)) throw new Error(`Invalid date: ${dateStr}`);
  return ms;
}

function msToDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function addDays(dateStr: string, days: number): string {
  return msToDate(dateMs(dateStr) + days * DAY_MS);
}

/** The IST calendar date at a UTC instant. */
function istDateAt(instant: Date): string {
  return new Date(instant.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** IST midnight of an IST calendar date, as a UTC instant ISO string. */
function istMidnightUtc(dateStr: string): string {
  return new Date(dateMs(dateStr) - IST_OFFSET_MS).toISOString();
}

/** Monday of the (IST) week containing dateStr. */
function mondayOf(dateStr: string): string {
  const dow = new Date(dateMs(dateStr)).getUTCDay(); // 0=Sun .. 6=Sat
  return addDays(dateStr, -((dow + 6) % 7));
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** "Jul 6 – 12, 2026" / "Jun 29 – Jul 5, 2026" / "Dec 29, 2025 – Jan 4, 2026". */
function rangeLabel(start: string, end: string): string {
  const [sy, sm, sd] = start.split('-').map(Number);
  const [ey, em, ed] = end.split('-').map(Number);
  if (sy === ey && sm === em) return `${MONTHS_SHORT[sm - 1]} ${sd} – ${ed}, ${sy}`;
  if (sy === ey) return `${MONTHS_SHORT[sm - 1]} ${sd} – ${MONTHS_SHORT[em - 1]} ${ed}, ${sy}`;
  return `${MONTHS_SHORT[sm - 1]} ${sd}, ${sy} – ${MONTHS_SHORT[em - 1]} ${ed}, ${ey}`;
}

/**
 * Resolve a Sales Dashboard period.
 * - week: `anchor` is any IST date; it normalizes to that week's Monday.
 *   Defaults to the current IST week.
 * - month: `anchor` is 'YYYY-MM'. Defaults to the current IST month.
 * - custom: `start`/`end` are inclusive IST dates (both required).
 */
export function resolveSalesPeriod(
  periodType: SalesPeriodType,
  anchor?: string,
  start?: string,
  end?: string,
  now: Date = new Date(),
): SalesPeriod {
  if (periodType === 'custom') {
    if (!start || !DATE_RE.test(start) || !end || !DATE_RE.test(end)) {
      throw new Error('Custom period requires start and end as YYYY-MM-DD');
    }
    if (dateMs(end) < dateMs(start)) {
      throw new Error('Custom period end must not be before start');
    }
    return {
      period_type: 'custom',
      anchor: `${start}..${end}`,
      label: rangeLabel(start, end),
      start_ist: start,
      end_ist: end,
      start_utc: istMidnightUtc(start),
      end_utc: istMidnightUtc(addDays(end, 1)),
    };
  }

  if (periodType === 'month') {
    const m = /^(\d{4})-(\d{2})$/.exec(anchor || '');
    const todayIst = istDateAt(now);
    let year = m ? Number(m[1]) : Number(todayIst.slice(0, 4));
    let month = m ? Number(m[2]) : Number(todayIst.slice(5, 7));
    if (month < 1 || month > 12) {
      year = Number(todayIst.slice(0, 4));
      month = Number(todayIst.slice(5, 7));
    }
    const startIst = `${year}-${pad(month)}-01`;
    const endIst = `${year}-${pad(month)}-${pad(daysInMonth(year, month))}`;
    return {
      period_type: 'month',
      anchor: `${year}-${pad(month)}`,
      label: `${MONTH_NAMES[month - 1]} ${year}`,
      start_ist: startIst,
      end_ist: endIst,
      start_utc: istMidnightUtc(startIst),
      end_utc: istMidnightUtc(addDays(endIst, 1)),
    };
  }

  // week
  const ref = anchor && DATE_RE.test(anchor) ? anchor : istDateAt(now);
  const monday = mondayOf(ref);
  const sunday = addDays(monday, 6);
  return {
    period_type: 'week',
    anchor: monday,
    label: rangeLabel(monday, sunday),
    start_ist: monday,
    end_ist: sunday,
    start_utc: istMidnightUtc(monday),
    end_utc: istMidnightUtc(addDays(monday, 7)),
  };
}
