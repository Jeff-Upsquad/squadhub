// "Later today" triage buckets for the Home Focus list. A starred task can be
// moved into Evening (after 3 PM) or Night (after 7 PM). Per-instance
// assignments live in `focusBuckets`. Evening/Night assignments reset at
// local midnight, but explicit main Focus placements persist; a recurring
// task's section is instead remembered per recurrence template in
// `recurringFocusBuckets`, so every freshly spawned copy reappears in the
// same section.
export type FocusBucket = 'evening' | 'night' | 'focus';

// Local-clock thresholds (hour-of-day, 24h) for the two buckets.
export const EVENING_START_HOUR = 15; // 3 PM
export const NIGHT_START_HOUR = 19;   // 7 PM

// Which bucket a minute-of-day falls into when a task is dropped onto the day
// planner grid: ≥7 PM → night, ≥3 PM → evening, earlier → none (main list).
export function focusBucketForMinute(minute: number): FocusBucket | null {
  if (minute >= NIGHT_START_HOUR * 60) return 'night';
  if (minute >= EVENING_START_HOUR * 60) return 'evening';
  return null;
}

// Resolve the section a task currently sits in: an explicit per-instance
// assignment wins; otherwise a recurring task inherits its template's sticky
// section so spawned copies reappear where the user last placed the routine.
// In-progress tasks never inherit template buckets — they stay in In Progress.
export function effectiveFocusBucket(
  task: { id: string; recurring_parent_id?: string | null },
  focusBuckets: Record<string, FocusBucket>,
  recurringFocusBuckets: Record<string, FocusBucket>,
  isInProgress?: boolean,
): FocusBucket | undefined {
  const own = focusBuckets[task.id];
  if (own) return own;
  if (isInProgress) return undefined;
  const parent = task.recurring_parent_id;
  if (parent && recurringFocusBuckets[parent]) return recurringFocusBuckets[parent];
  return undefined;
}
