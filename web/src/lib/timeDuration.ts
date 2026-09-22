// Duration shorthand shared by the estimate + log-time popovers.
//
// One parser for every place a human types a length of time, so "1d 4h" means
// the same thing on a task, in a row editor and in the create panel. A working
// day is 8 hours and a working week is 5 days — the same convention people use
// when they say "that's a two-day job".

export const MINUTES_PER_HOUR = 60;
export const MINUTES_PER_DAY = 8 * 60;
export const MINUTES_PER_WEEK = 5 * MINUTES_PER_DAY;

const UNIT_MINUTES: Record<string, number> = {
  w: MINUTES_PER_WEEK,
  d: MINUTES_PER_DAY,
  h: MINUTES_PER_HOUR,
  m: 1,
};

/**
 * Parse duration shorthand into minutes.
 *
 * Accepts any combination of unit parts ("1w 2d", "2h 30m", "45m", "1.5h"),
 * a clock pair ("2:30" → 2h 30m), or a bare number, which is read as HOURS
 * ("2" → 2h) to match how people type estimates. A leading "-" negates the
 * whole thing, which the log-time popover uses to subtract over-logged time.
 *
 * Returns null when nothing parses, and 0 only for an explicit zero — callers
 * treat 0 as "clear this value".
 */
export function parseDuration(input: string): number | null {
  const raw = input.trim().toLowerCase();
  if (!raw) return null;

  const negative = raw.startsWith('-');
  const body = (negative ? raw.slice(1) : raw).trim();
  if (!body) return null;

  const signed = (mins: number) => (negative ? -mins : mins);

  // "2:30" / "0:45" — clock form.
  const clock = body.match(/^(\d+):([0-5]\d)$/);
  if (clock) return signed(parseInt(clock[1], 10) * 60 + parseInt(clock[2], 10));

  // "1w 2d 3h 30m" — unit form. Every token must be a number + known unit, so
  // typos fall through to null rather than silently parsing half the input.
  const parts = body.match(/(\d+(?:\.\d+)?)\s*([wdhm])/g);
  if (parts) {
    const consumed = parts.join('').replace(/\s/g, '');
    if (body.replace(/\s/g, '') !== consumed) return null;
    let total = 0;
    for (const part of parts) {
      const m = part.match(/(\d+(?:\.\d+)?)\s*([wdhm])/);
      if (!m) return null;
      total += parseFloat(m[1]) * UNIT_MINUTES[m[2]];
    }
    return signed(Math.round(total));
  }

  // Bare number → hours.
  if (/^\d+(\.\d+)?$/.test(body)) return signed(Math.round(parseFloat(body) * 60));

  return null;
}

/**
 * Minutes → shorthand, e.g. 750 → "1d 4h 30m". Days only appear once the value
 * clears a full working day, so short estimates stay in plain hours/minutes.
 */
export function formatDuration(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes) || minutes === 0) return '';
  const sign = minutes < 0 ? '-' : '';
  let rest = Math.abs(Math.round(minutes));

  const days = Math.floor(rest / MINUTES_PER_DAY);
  rest -= days * MINUTES_PER_DAY;
  const hours = Math.floor(rest / MINUTES_PER_HOUR);
  const mins = rest - hours * MINUTES_PER_HOUR;

  const parts: string[] = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (mins) parts.push(`${mins}m`);
  return sign + (parts.join(' ') || '0m');
}

/** Same as formatDuration but in plain hours/minutes — never days. */
export function formatHoursMinutes(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes) || minutes === 0) return '';
  const sign = minutes < 0 ? '-' : '';
  const abs = Math.abs(Math.round(minutes));
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  if (h && m) return `${sign}${h}h ${m}m`;
  if (h) return `${sign}${h}h`;
  return `${sign}${m}m`;
}

/** Seconds → shorthand, for logged time (which is stored in seconds). */
export function formatSecondsDuration(seconds: number | null | undefined): string {
  if (!seconds) return '';
  return formatHoursMinutes(Math.round(seconds / 60)) || (seconds < 0 ? '-0m' : '0m');
}

/** "2:05 pm" for a Date — the one clock format these popovers use. */
export function formatClockTime(d: Date): string {
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
}

/** Local "YYYY-MM-DD", the value shape an <input type="date"> wants. */
export function toDateInputValue(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Local "HH:MM", the value shape an <input type="time"> wants. */
export function toTimeInputValue(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Combine the two input values back into a local Date. */
export function fromDateTimeInputs(dateValue: string, timeValue: string): Date | null {
  const dm = dateValue.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const tm = timeValue.match(/^(\d{1,2}):(\d{2})$/);
  if (!dm || !tm) return null;
  const d = new Date(
    Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]),
    Number(tm[1]), Number(tm[2]), 0, 0,
  );
  return Number.isNaN(d.getTime()) ? null : d;
}
