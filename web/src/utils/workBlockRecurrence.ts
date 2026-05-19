// Pure helpers for evaluating and describing a work block's recurrence rule.
// Mirrors the server-side helper in server/src/routes/pm/dayPlans.ts —
// when one changes, update the other.

export type RecurrenceKind = 'none' | 'daily' | 'weekdays' | 'weekly' | 'monthly';

export interface Recurrence {
  kind: RecurrenceKind;
  weekdays?: number[];      // for kind='weekly', 0=Sun..6=Sat
  day_of_month?: number;    // for kind='monthly', 1..28
  starts_on?: string;       // YYYY-MM-DD, inclusive
  ends_on?: string | null;  // YYYY-MM-DD, inclusive; null = forever
}

// YYYY-MM-DD in user's local tz. Matches planDateKey from useDayPlanner.ts.
export function dateKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function occursOn(rule: Recurrence | null | undefined, date: Date): boolean {
  if (!rule) return false;
  const key = dateKey(date);
  if (rule.starts_on && key < rule.starts_on) return false;
  if (rule.ends_on && key > rule.ends_on) return false;
  if (rule.kind === 'none') {
    return !!rule.starts_on && rule.starts_on === key;
  }
  const dow = date.getDay();
  const dom = date.getDate();
  if (rule.kind === 'daily') return true;
  if (rule.kind === 'weekdays') return dow >= 1 && dow <= 5;
  if (rule.kind === 'weekly') return Array.isArray(rule.weekdays) && rule.weekdays.includes(dow);
  if (rule.kind === 'monthly') return typeof rule.day_of_month === 'number' && rule.day_of_month === dom;
  return false;
}

const DOW_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function describeRecurrence(rule: Recurrence | null | undefined): string {
  if (!rule || rule.kind === 'none') return 'Does not repeat';
  if (rule.kind === 'daily') return 'Every day';
  if (rule.kind === 'weekdays') return 'Every weekday';
  if (rule.kind === 'weekly') {
    if (!rule.weekdays || rule.weekdays.length === 0) return 'Weekly';
    const sorted = [...rule.weekdays].sort();
    return `Weekly on ${sorted.map((d) => DOW_NAMES[d]).join(', ')}`;
  }
  if (rule.kind === 'monthly') {
    if (typeof rule.day_of_month !== 'number') return 'Monthly';
    const n = rule.day_of_month;
    const suffix = n % 10 === 1 && n !== 11 ? 'st'
      : n % 10 === 2 && n !== 12 ? 'nd'
      : n % 10 === 3 && n !== 13 ? 'rd'
      : 'th';
    return `Monthly on the ${n}${suffix}`;
  }
  return 'Custom';
}

// "9:00 AM" style formatter for a minute-of-day (0..1439).
export function formatMinute(mod: number): string {
  const h = Math.floor(mod / 60);
  const m = mod % 60;
  const hour12 = ((h + 11) % 12) + 1;
  const ampm = h < 12 ? 'AM' : 'PM';
  return `${hour12}:${String(m).padStart(2, '0')} ${ampm}`;
}

// "HH:MM" 24h string for <input type="time">.
export function minuteToInputTime(mod: number): string {
  const h = Math.floor(mod / 60);
  const m = mod % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function inputTimeToMinute(value: string): number {
  const [h, m] = value.split(':').map((n) => parseInt(n, 10));
  if (Number.isNaN(h) || Number.isNaN(m)) return 0;
  return h * 60 + m;
}
