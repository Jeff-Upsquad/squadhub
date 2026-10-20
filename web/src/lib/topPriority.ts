import type { Task } from '@squadhub/shared';
import { isTaskCompleted } from './taskGrouping';
import { EVENING_START_HOUR, NIGHT_START_HOUR, type FocusBucket } from './focusBuckets';

/**
 * "Top Priority" tasks are only surfaced on My Home once they are actually
 * due. The card follows the same rules the rest of My Home already applies:
 *
 *  - a work date in the future holds the task back until that day arrives —
 *    exactly the rule the Focus list (and the Urgent card) already apply;
 *  - an Evening / Night placement holds the task back until that time of day
 *    arrives (the bucket sections open at 3 PM / 7 PM), the same way moving a
 *    task out of the main Focus list defers it to its own section.
 *
 * When the gates open, the task reappears in the Top Priority card.
 */

export type TopPriorityInput = {
  /** The task being tested. */
  task: Task;
  /**
   * The task's Evening / Night placement, if it has one. `undefined` (or
   * 'focus') means the task sits in the main list and isn't time-gated.
   */
  bucket: FocusBucket | undefined;
  /**
   * True when the placement comes from a recurring template (sticky across
   * days) rather than a per-instance placement (cleared at local midnight).
   */
  bucketIsTemplate: boolean;
  /** The instant the gate is evaluated against. */
  now: Date;
  /** The user's timezone (browser-resolved). */
  timeZone: string;
};

export type TopPriorityVisibility = {
  /** Whether the task belongs in the Top Priority card right now. */
  visible: boolean;
  /** The instant the task becomes visible again (null when already visible). */
  visibleFrom: number | null;
};

// Formatter cache — building an Intl.DateTimeFormat is expensive and the Home
// page re-evaluates this gate for every task on every render.
const dayFormatters = new Map<string, Intl.DateTimeFormat>();
function dayFormatter(timeZone: string): Intl.DateTimeFormat {
  let fmt = dayFormatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    });
    dayFormatters.set(timeZone, fmt);
  }
  return fmt;
}

// YYYY-MM-DD for an instant in the given timezone.
export function topPriorityDayKey(date: Date, timeZone: string): string {
  return dayFormatter(timeZone).format(date);
}

// The zone's offset from UTC (ms) at a given instant.
function tzOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUTC = Date.UTC(
    get('year'), get('month') - 1, get('day'),
    get('hour') % 24, get('minute'), get('second'),
  );
  return asUTC - date.getTime();
}

// The instant a wall-clock time falls on in a given timezone. Two passes settle
// the offset — the first guess can land on the wrong side of a DST switch.
function zonedTime(dayKey: string, hour: number, minute: number, timeZone: string): number {
  const [y, m, d] = dayKey.split('-').map(Number);
  const wall = Date.UTC(y, m - 1, d, hour, minute, 0, 0);
  let ts = wall;
  for (let i = 0; i < 2; i++) {
    const next = wall - tzOffsetMs(new Date(ts), timeZone);
    if (next === ts) break;
    ts = next;
  }
  return ts;
}

// Local midnight of a YYYY-MM-DD day key, in the user's timezone.
function localMidnight(key: string, timeZone: string): number {
  return zonedTime(key, 0, 0, timeZone);
}

// The opening hour of a bucket, or null when the task isn't time-gated.
function bucketOpenHour(bucket: FocusBucket | undefined): number | null {
  if (bucket === 'evening') return EVENING_START_HOUR;
  if (bucket === 'night') return NIGHT_START_HOUR;
  return null;
}

/**
 * The section a task currently sits in, plus where that placement came from.
 * A per-instance placement is wiped at local midnight, so it can only defer a
 * task within the current day; a recurring template placement is sticky and
 * reappears on every spawned copy.
 */
export function resolveTopPriorityBucket(
  task: Task,
  focusBuckets: Record<string, FocusBucket>,
  recurringFocusBuckets: Record<string, FocusBucket>,
  isInProgress: boolean,
): { bucket: FocusBucket | undefined; isTemplate: boolean } {
  const own = focusBuckets[task.id];
  if (own) return { bucket: own, isTemplate: false };
  if (isInProgress) return { bucket: undefined, isTemplate: false };
  const parent = task.recurring_parent_id;
  if (parent && recurringFocusBuckets[parent]) {
    return { bucket: recurringFocusBuckets[parent], isTemplate: true };
  }
  return { bucket: undefined, isTemplate: false };
}

/**
 * When (and whether) the task belongs in the Top Priority card.
 *
 * Two gates, both mirroring the rest of My Home:
 *
 *  - the work-date gate defers the task until its work day arrives. It uses
 *    the very same day-level rule the Focus list applies to starred tasks
 *    (`isFutureDay`), so a task behaves identically in both places.
 *  - the bucket gate defers the task until its Evening / Night time of day
 *    arrives. A per-instance placement is wiped at the next local midnight,
 *    so it can never defer a task past the current day; a recurring template
 *    placement is sticky and defers the task on whichever day it becomes
 *    eligible.
 */
export function topPriorityVisibility({
  task,
  bucket,
  bucketIsTemplate,
  now,
  timeZone,
}: TopPriorityInput): TopPriorityVisibility {
  if (isTaskCompleted(task)) return { visible: false, visibleFrom: null };

  const today = topPriorityDayKey(now, timeZone);
  const workDay = task.work_date ? topPriorityDayKey(new Date(task.work_date), timeZone) : null;
  // Same day-level rule as the Focus list's `!isFutureDay(work_date)` gate.
  const workIsFuture = !!workDay && workDay > today;

  // The work-date gate: the task is held back until its work day starts.
  const workFrom = workIsFuture && workDay ? localMidnight(workDay, timeZone) : null;

  const openHour = bucketOpenHour(bucket);
  if (openHour == null) {
    return { visible: workFrom == null, visibleFrom: workFrom };
  }

  // A per-instance placement only survives until the next midnight, so it can
  // never defer a task whose work day hasn't started yet — by then the
  // placement is gone.
  if (!bucketIsTemplate && workIsFuture) {
    return { visible: false, visibleFrom: workFrom };
  }

  // The bucket opens on the day the task becomes eligible.
  const eligibleDay = workIsFuture && workDay ? workDay : today;
  const bucketOpens = zonedTime(eligibleDay, openHour, 0, timeZone);
  const bucketFrom = bucketOpens > now.getTime() ? bucketOpens : null;

  const gates = [workFrom, bucketFrom].filter((v): v is number => v != null);
  if (!gates.length) return { visible: true, visibleFrom: null };
  const visibleFrom = Math.max(...gates);
  // A gate that has already elapsed means the task is due now.
  if (visibleFrom <= now.getTime()) return { visible: true, visibleFrom: null };
  return { visible: false, visibleFrom };
}
