import type { DragEvent } from 'react';
import type { Task } from '@squadhub/shared';
import type { MyTasksBuckets } from '../../../hooks/useTasks';
import { planDateKey } from '../../../hooks/useDayPlanner';

// Drag MIME keys — identical to the Day Planner's so a palette row can be
// dropped onto the month/week grids AND onto the embedded DayCalendar's hour
// slots without any special-casing.
export const DND_TASK_ID = 'application/x-task-id';
export const DND_TASK_ESTIMATE = 'application/x-task-estimate';

// YYYY-MM-DD for the local-midnight of a calendar cell.
export function cellKey(d: Date): string {
  return planDateKey(d);
}

// We store a scheduled day as the *local-midnight* ISO timestamp (mirrors
// taskHelpers.nextQuickDate). Reading it back through planDateKey(new Date(iso))
// returns the same local day in every timezone — a plain "YYYY-MM-DD" string
// would shift a day west of UTC.
export function dayToWorkDateISO(d: Date): string {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString();
}

// Which calendar day a task lands on: its work_date if set, otherwise its
// due_date. Returns null when the task has neither (it only shows in the
// unscheduled palette). `source` tells the chip whether it can be unscheduled
// (work) or is just surfaced by its due date (due).
export function taskDayKey(t: Task): { key: string; source: 'work' | 'due' } | null {
  if (t.work_date) return { key: planDateKey(new Date(t.work_date)), source: 'work' };
  if (t.due_date) return { key: planDateKey(new Date(t.due_date)), source: 'due' };
  return null;
}

// Flatten the My-Tasks buckets into one de-duplicated list. done/closed tasks
// are already filtered server-side.
export function flattenMyTasks(b: MyTasksBuckets | undefined): Task[] {
  if (!b) return [];
  const merged = [
    ...(b.overdue ?? []),
    ...(b.today ?? []),
    ...(b.tomorrow ?? []),
    ...(b.upcoming ?? []),
    ...(b.later ?? []),
    ...(b.focused ?? []),
    ...(b.in_progress_today ?? []),
  ];
  const seen = new Set<string>();
  return merged.filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)));
}

// Group tasks onto calendar days, keyed by YYYY-MM-DD. Each entry keeps the
// placement source so the chip can decide whether to show a remove (×) button.
export function groupTasksByDay(tasks: Task[]): Map<string, { task: Task; source: 'work' | 'due' }[]> {
  const map = new Map<string, { task: Task; source: 'work' | 'due' }[]>();
  for (const t of tasks) {
    const d = taskDayKey(t);
    if (!d) continue;
    const arr = map.get(d.key);
    if (arr) arr.push({ task: t, source: d.source });
    else map.set(d.key, [{ task: t, source: d.source }]);
  }
  // Sort each day's chips: work-scheduled first, then by priority weight.
  for (const arr of map.values()) {
    arr.sort((a, b) => {
      if (a.source !== b.source) return a.source === 'work' ? -1 : 1;
      return priorityWeight(b.task.priority) - priorityWeight(a.task.priority);
    });
  }
  return map;
}

export function priorityWeight(p: Task['priority']): number {
  switch (p) {
    case 'emergency': return 5;
    case 'urgent': return 4;
    case 'high': return 3;
    case 'normal': return 2;
    case 'low': return 1;
    default: return 0;
  }
}

// Maps a task priority to a chip accent level used by the .cal-chip CSS.
export function priorityLevel(p: Task['priority']): 'emg' | 'p0' | 'p1' | 'p2' | 'none' {
  if (p === 'emergency') return 'emg';
  if (p === 'urgent') return 'p0';
  if (p === 'high') return 'p1';
  if (p === 'normal' || p === 'low') return 'p2';
  return 'none';
}

// ---- Month / week math (Sunday-start, matching the app's DatePicker) ----

// `weekStartsOn`: 0=Sun … 6=Sat — the weekday the grid's first column shows.
export function startOfMonthGrid(monthAnchor: Date, weekStartsOn = 0): Date {
  const first = new Date(monthAnchor.getFullYear(), monthAnchor.getMonth(), 1);
  const offset = (first.getDay() - weekStartsOn + 7) % 7; // days back to the row start
  const start = new Date(first);
  start.setDate(1 - offset);
  start.setHours(0, 0, 0, 0);
  return start;
}

// 42 cells (6 weeks) covering the month that `monthAnchor` falls in.
export function buildMonthCells(monthAnchor: Date, weekStartsOn = 0): Date[] {
  const start = startOfMonthGrid(monthAnchor, weekStartsOn);
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

// The 7 days of the week containing `anchor`, starting on `weekStartsOn`.
export function buildWeekCells(anchor: Date, weekStartsOn = 0): Date[] {
  const offset = (anchor.getDay() - weekStartsOn + 7) % 7;
  const start = new Date(anchor);
  start.setDate(anchor.getDate() - offset);
  start.setHours(0, 0, 0, 0);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

export function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

export function addDays(d: Date, n: number): Date {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
}

const WD_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const WEEKDAY_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Short weekday headers rotated so `weekStartsOn` is first.
export function weekdayLabels(weekStartsOn = 0): string[] {
  return Array.from({ length: 7 }, (_, i) => WD_SHORT[(weekStartsOn + i) % 7]);
}

// A compact, cursor-anchored drag image so a drop lands where the pointer is
// (the default full-row ghost hangs below the cursor, making timed drops feel
// ~15min low). Hotspot near the top-left keeps the pointer at the block's start.
export function setSlimDragImage(e: DragEvent, label: string): void {
  if (typeof document === 'undefined') return;
  const el = document.createElement('div');
  el.textContent = label.length > 42 ? `${label.slice(0, 41)}…` : label;
  el.style.cssText =
    'position:fixed;top:-1000px;left:-1000px;padding:4px 10px;border-radius:7px;' +
    'background:#2563eb;color:#fff;font:600 12px/1.2 Inter,system-ui,sans-serif;' +
    'white-space:nowrap;box-shadow:0 6px 16px rgba(0,0,0,.32);pointer-events:none;z-index:9999;';
  document.body.appendChild(el);
  try {
    e.dataTransfer.setDragImage(el, 12, 4);
  } catch {
    /* setDragImage unsupported — fall back to the default ghost */
  }
  setTimeout(() => el.remove(), 0);
}
