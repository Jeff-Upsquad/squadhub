import type { Task } from '@squadhub/shared';

// Sentinel for callers that genuinely have no fading state to thread through
// (e.g., exports, server-side rendering, tests). Real UI callers must pass the
// actual `fadingTaskIds` map from pmStore so status-grouping pipelines can
// keep a task in its pre-fade bucket while the slide-out animation plays.
export const EMPTY_FADING_MAP: ReadonlyMap<string, string> = new Map();

export type GroupBy = 'none' | 'status' | 'work_date' | 'due_date' | 'priority' | 'space' | 'folder' | 'list';

export const GROUP_BY_OPTIONS: { value: GroupBy; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'work_date', label: 'Work date' },
  { value: 'due_date', label: 'Due date' },
  { value: 'priority', label: 'Priority' },
  { value: 'space', label: 'Space' },
  { value: 'folder', label: 'Folder' },
  { value: 'list', label: 'List' },
];

export const LIST_GROUP_BY_OPTIONS: { value: GroupBy; label: string }[] = [
  { value: 'status', label: 'Status' },
  { value: 'none', label: 'None' },
  { value: 'work_date', label: 'Work date' },
  { value: 'due_date', label: 'Due date' },
  { value: 'priority', label: 'Priority' },
];

export type SortBy = 'manual' | 'title' | 'due_date' | 'priority' | 'recent';

export const SORT_BY_OPTIONS: { value: SortBy; label: string }[] = [
  { value: 'manual', label: 'Manual' },
  { value: 'title', label: 'Title (A–Z)' },
  { value: 'due_date', label: 'Due date' },
  { value: 'priority', label: 'Priority' },
  { value: 'recent', label: 'Recently updated' },
];

export function sortTasks(tasks: Task[], by: SortBy): Task[] {
  if (by === 'manual') return tasks;
  const arr = [...tasks];
  switch (by) {
    case 'title':
      return arr.sort((a, b) => a.title.localeCompare(b.title));
    case 'due_date':
      return arr.sort((a, b) => {
        const ax = a.due_date ? new Date(a.due_date).getTime() : Infinity;
        const bx = b.due_date ? new Date(b.due_date).getTime() : Infinity;
        return ax - bx;
      });
    case 'priority':
      return arr.sort((a, b) => {
        const ap = PRIORITY_ORDER[(a.priority as string) || 'none'] ?? 99;
        const bp = PRIORITY_ORDER[(b.priority as string) || 'none'] ?? 99;
        return ap - bp;
      });
    case 'recent':
      return arr.sort((a, b) => {
        const ax = a.updated_at ? new Date(a.updated_at).getTime() : 0;
        const bx = b.updated_at ? new Date(b.updated_at).getTime() : 0;
        return bx - ax;
      });
    default:
      return arr;
  }
}

export function isToday(dateStr: string | null | undefined, tz: string): boolean {
  if (!dateStr) return false;
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  return fmt.format(new Date(dateStr)) === fmt.format(new Date());
}

// True when the date falls on a day strictly after today (in the given tz).
// 'YYYY-MM-DD' keys compare lexicographically. Null/undefined → not future.
export function isFutureDay(dateStr: string | null | undefined, tz: string): boolean {
  if (!dateStr) return false;
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  return fmt.format(new Date(dateStr)) > fmt.format(new Date());
}

export function isTaskForToday(t: Task, tz: string): boolean {
  return isToday(t.work_date, tz) || isToday(t.due_date, tz);
}

export const PRIORITY_ORDER: Record<string, number> = {
  emergency: 0,
  urgent: 1,
  high: 2,
  normal: 3,
  low: 4,
  none: 5,
};

export const PRIORITY_LABELS: Record<string, string> = {
  emergency: 'Emergency',
  urgent: 'Urgent',
  high: 'High',
  normal: 'Normal',
  low: 'Low',
  none: 'No priority',
};

export type Group = { key: string; label: string; sort: number | string; tasks: Task[] };

export function isTaskCompleted(t: Task): boolean {
  const s = (t as unknown as { status?: { category?: string } | string | null }).status;
  if (s && typeof s === 'object') {
    return s.category === 'done' || s.category === 'closed';
  }
  if (typeof s === 'string') return s === 'closed' || s === 'done';
  return false;
}

// Accepts either a ReadonlySet<string> or a ReadonlyMap<string, string> — both
// expose `.has(id)` with identical semantics, which is all this filter needs.
// (The store moved from Set to Map to also carry pre-fade status snapshots.)
export function partitionByCompletion(
  tasks: Task[],
  fadingIds?: ReadonlySet<string> | ReadonlyMap<string, string>,
): { open: Task[]; completed: Task[] } {
  const open: Task[] = [];
  const completed: Task[] = [];
  for (const t of tasks) {
    if (isTaskCompleted(t) && !fadingIds?.has(t.id)) completed.push(t);
    else open.push(t);
  }
  return { open, completed };
}

export function groupByDate(tasks: Task[], field: 'work_date' | 'due_date', tz: string, emptyLabel: string): Group[] {
  const fmtKey = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  const fmtLabel = new Intl.DateTimeFormat(undefined, { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' });
  const now = new Date();
  const todayKey = fmtKey.format(now);
  const tomorrowKey = fmtKey.format(new Date(now.getTime() + 86_400_000));

  const map = new Map<string, Group>();
  for (const t of tasks) {
    const raw = (t as unknown as Record<string, string | null>)[field];
    if (!raw) {
      const k = '__none__';
      if (!map.has(k)) map.set(k, { key: k, label: emptyLabel, sort: Number.MAX_SAFE_INTEGER, tasks: [] });
      map.get(k)!.tasks.push(t);
      continue;
    }
    const d = new Date(raw);
    const key = fmtKey.format(d);
    if (!map.has(key)) {
      let label: string;
      if (key === todayKey) label = 'Today';
      else if (key === tomorrowKey) label = 'Tomorrow';
      else if (key < todayKey) label = `Overdue · ${fmtLabel.format(d)}`;
      else label = fmtLabel.format(d);
      map.set(key, { key, label, sort: key, tasks: [] });
    }
    map.get(key)!.tasks.push(t);
  }
  return [...map.values()].sort((a, b) => {
    if (typeof a.sort === 'number' && typeof b.sort === 'number') return a.sort - b.sort;
    if (typeof a.sort === 'number') return 1;
    if (typeof b.sort === 'number') return -1;
    return (a.sort as string).localeCompare(b.sort as string);
  });
}

export function groupByPriority(tasks: Task[]): Group[] {
  const map = new Map<string, Group>();
  for (const t of tasks) {
    const p = (t.priority as string) || 'none';
    if (!map.has(p)) {
      map.set(p, {
        key: p,
        label: PRIORITY_LABELS[p] || p,
        sort: PRIORITY_ORDER[p] ?? 99,
        tasks: [],
      });
    }
    map.get(p)!.tasks.push(t);
  }
  return [...map.values()].sort((a, b) => (a.sort as number) - (b.sort as number));
}

// `fadingMap` is REQUIRED (not optional) so that any new caller is forced by
// the type checker to thread the store's fading snapshot through \u2014 otherwise
// the optimistic status patch will re-bucket the row before its slide-out
// animation can play. Pass EMPTY_FADING_MAP only in genuine non-UI contexts.
export function groupByStatus(
  tasks: Task[],
  fadingMap: ReadonlyMap<string, string>,
): Group[] {
  const map = new Map<string, Group>();
  for (const t of tasks) {
    // If a task is fading, ignore its (already optimistically-mutated) status
    // and re-derive the bucket from the pre-fade snapshot. Treat the snapshot
    // as a raw string status (the string-status branch below).
    const snapshot = fadingMap.get(t.id);
    const s = snapshot !== undefined
      ? snapshot
      : (t as unknown as { status?: { id?: string; name?: string; position?: number } | string | null }).status;
    let key: string;
    let label: string;
    let sort: number | string;
    if (s && typeof s === 'object') {
      key = s.id || s.name || '__none__';
      label = s.name || 'No status';
      sort = typeof s.position === 'number' ? s.position : (s.name || '').toLowerCase();
    } else if (typeof s === 'string' && s) {
      key = s;
      label = s.charAt(0).toUpperCase() + s.slice(1);
      sort = s;
    } else {
      key = '__none__';
      label = 'No status';
      sort = '\uffff';
    }
    if (!map.has(key)) map.set(key, { key, label, sort, tasks: [] });
    map.get(key)!.tasks.push(t);
  }
  return [...map.values()].sort((a, b) => {
    if (typeof a.sort === 'number' && typeof b.sort === 'number') return a.sort - b.sort;
    if (typeof a.sort === 'number') return -1;
    if (typeof b.sort === 'number') return 1;
    return (a.sort as string).localeCompare(b.sort as string);
  });
}

export function groupByNamedRef(
  tasks: Task[],
  pick: (t: Task) => { id: string; name: string } | null | undefined,
  emptyLabel: string,
): Group[] {
  const map = new Map<string, Group>();
  for (const t of tasks) {
    const ref = pick(t);
    const key = ref?.id || '__none__';
    if (!map.has(key)) {
      map.set(key, {
        key,
        label: ref?.name || emptyLabel,
        sort: ref ? (ref.name || '').toLowerCase() : '\uffff',
        tasks: [],
      });
    }
    map.get(key)!.tasks.push(t);
  }
  return [...map.values()].sort((a, b) => (a.sort as string).localeCompare(b.sort as string));
}

// `fadingMap` is REQUIRED so callers can't accidentally drop the snapshot when
// `by === 'status'`. The other group-by paths don't read `task.status`, so the
// value is unused for them — but the type guard keeps the call site honest.
export function groupTasks(
  tasks: Task[],
  by: GroupBy,
  tz: string,
  fadingMap: ReadonlyMap<string, string>,
): Group[] {
  switch (by) {
    case 'work_date':
      return groupByDate(tasks, 'work_date', tz, 'No work date');
    case 'due_date':
      return groupByDate(tasks, 'due_date', tz, 'No due date');
    case 'priority':
      return groupByPriority(tasks);
    case 'status':
      return groupByStatus(tasks, fadingMap);
    case 'space':
      return groupByNamedRef(tasks, (t) => t.space ?? null, 'No space');
    case 'folder':
      return groupByNamedRef(
        tasks,
        (t) => (t as unknown as { folder?: { id: string; name: string } | null }).folder ?? null,
        'No folder',
      );
    case 'list':
      return groupByNamedRef(tasks, (t) => t.list ?? null, 'No list');
    default:
      return [];
  }
}

export function buildFocusTodayGroup(
  tasks: Task[],
  focusedTodayIds: string[],
  _focusedTodayDate: string,
  _todayKey: string,
  sortBy: SortBy = 'manual',
): Group | null {
  // Focus is persistent now — no date gate; just whether anything is starred.
  // The date params are kept for call-site compatibility but no longer read.
  if (focusedTodayIds.length === 0) return null;
  const ids = new Set(focusedTodayIds);
  const matched = tasks.filter((t) => ids.has(t.id));
  if (matched.length === 0) return null;
  const ordered =
    sortBy === 'manual'
      ? (focusedTodayIds
          .map((id) => matched.find((t) => t.id === id))
          .filter(Boolean) as Task[])
      : sortTasks(matched, sortBy);
  return { key: 'focus_today', label: '★ Focus Today', sort: -1, tasks: ordered };
}
