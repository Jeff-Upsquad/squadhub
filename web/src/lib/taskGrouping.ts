import type { Task, TaskType, SpaceStatus } from '@squadhub/shared';
import { getTaskStatusCategory, getTaskStatusDef, TASK_BUCKETS, TASK_PLANS, taskBucketOf, taskPlanOf } from '@squadhub/shared';

// Sentinel for callers that genuinely have no fading state to thread through
// (e.g., exports, server-side rendering, tests). Real UI callers must pass the
// actual `fadingTaskIds` map from pmStore so status-grouping pipelines can
// keep a task in its pre-fade bucket while the slide-out animation plays.
export const EMPTY_FADING_MAP: ReadonlyMap<string, string> = new Map();

export type GroupBy = 'none' | 'status' | 'work_date' | 'due_date' | 'priority' | 'task_type' | 'space' | 'folder' | 'list' | 'label' | 'bucket' | 'plan';

export const GROUP_BY_OPTIONS: { value: GroupBy; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'work_date', label: 'Work date' },
  { value: 'due_date', label: 'Due date' },
  { value: 'priority', label: 'Priority' },
  { value: 'status', label: 'Status' },
  { value: 'task_type', label: 'Task type' },
  { value: 'space', label: 'Space' },
  { value: 'folder', label: 'Folder' },
  { value: 'list', label: 'List' },
  { value: 'label', label: 'Label' },
];

export const LIST_GROUP_BY_OPTIONS: { value: GroupBy; label: string }[] = [
  { value: 'status', label: 'Status' },
  { value: 'none', label: 'None' },
  { value: 'work_date', label: 'Work date' },
  { value: 'due_date', label: 'Due date' },
  { value: 'priority', label: 'Priority' },
  { value: 'task_type', label: 'Task type' },
  { value: 'space', label: 'Space' },
  { value: 'folder', label: 'Folder' },
  { value: 'list', label: 'List' },
  { value: 'label', label: 'Label' },
];

// Extra groupings for lists on a stage workflow (stages ≠ priority ≠ plan).
export const STAGE_GROUP_BY_OPTIONS: { value: GroupBy; label: string }[] = [
  { value: 'bucket', label: 'Bucket' },
  { value: 'plan', label: 'Plan' },
];

/** Order of groups (and sections): ascending = natural order. */
export type GroupDirection = 'asc' | 'desc';

export type SortBy = 'manual' | 'title' | 'due_date' | 'priority' | 'recent';

export const SORT_BY_OPTIONS: { value: SortBy; label: string }[] = [
  { value: 'manual', label: 'Manual' },
  { value: 'title', label: 'Title (A–Z)' },
  { value: 'due_date', label: 'Due date' },
  { value: 'priority', label: 'Priority' },
  { value: 'recent', label: 'Recently updated' },
];

// Default order for grouped views: oldest first so newly added tasks land at
// the bottom of their group. Used when no explicit sort (manual/none) is set —
// explicit sorts (title, due date, priority, recent) still take precedence.
export function sortByCreationOrder(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    const ax = a.created_at ? new Date(a.created_at).getTime() : 0;
    const bx = b.created_at ? new Date(b.created_at).getTime() : 0;
    if (ax !== bx) return ax - bx;
    return (a.id || '').localeCompare(b.id || '');
  });
}

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

// An open task whose work date and/or due date falls on a day strictly after
// today. The List view snoozes these out of the main groups into a collapsed
// "Upcoming" section (which bypasses date filters), so a future-dated task is
// never invisible — and it automatically rejoins the main list once its day
// arrives.
export function isTaskUpcoming(t: Task, tz: string): boolean {
  if (isTaskCompleted(t)) return false;
  return isFutureDay(t.work_date, tz) || isFutureDay(t.due_date, tz);
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

export type Group = { key: string; label: string; sort: number | string; tasks: Task[]; color?: string };

// A synthetic "Grouped tasks under {name}" row. Produced by collapseGroupedTasks
// when a task's server-resolved `group_container` is non-null (the nearest
// ancestor container with Group Tasks ON). Carries the child tasks so the row can
// expand inline, plus their count for the badge.
export type GroupedRow = {
  __grouped: true;
  key: string; // container id
  container: NonNullable<Task['group_container']>;
  count: number;
  tasks: Task[];
};

export function isGroupedRow(x: Task | GroupedRow): x is GroupedRow {
  return (x as GroupedRow).__grouped === true;
}

// Collapse tasks belonging to a grouped container into one GroupedRow each,
// leaving ungrouped tasks untouched. Each grouped row is placed at the index of
// its first member so it slots naturally among the plain rows.
//
// Multi-homing: a task is added to EVERY grouped container it belongs to — its
// primary list chain plus any secondary "ALSO IN" list (server-resolved into
// `group_containers`). So the same task can appear inside two distinct "Grouped
// tasks under X" rows. Endpoints that don't compute `group_containers` fall back
// to the single `group_container`.
//
// A container that ends up with a single task is NOT worth a collapsible row, so
// it's always unwrapped back into a plain TodayRow in place. Plain rows are
// de-duped by task id so a task that's the lone member of more than one group
// (or already shown ungrouped) is emitted only once at the top level — while it
// still appears as a child inside any multi-task group it also belongs to.
export function collapseGroupedTasks(tasks: Task[]): (Task | GroupedRow)[] {
  const out: (Task | GroupedRow)[] = [];
  const rowByContainer = new Map<string, GroupedRow>();
  for (const t of tasks) {
    const containers = t.group_containers ?? (t.group_container ? [t.group_container] : []);
    if (containers.length === 0) {
      out.push(t);
      continue;
    }
    for (const gc of containers) {
      let row = rowByContainer.get(gc.id);
      if (!row) {
        row = { __grouped: true, key: gc.id, container: gc, count: 0, tasks: [] };
        rowByContainer.set(gc.id, row);
        out.push(row);
      }
      row.tasks.push(t);
      row.count += 1;
    }
  }
  const emittedPlain = new Set<string>();
  const result: (Task | GroupedRow)[] = [];
  for (const item of out) {
    // Multi-task group → keep collapsed. Single-task group → unwrap its lone task.
    const plain = isGroupedRow(item) ? (item.tasks.length === 1 ? item.tasks[0] : null) : item;
    if (plain) {
      if (emittedPlain.has(plain.id)) continue; // already shown as a plain row elsewhere
      emittedPlain.add(plain.id);
      result.push(plain);
    } else {
      result.push(item);
    }
  }
  return result;
}

export function isTaskCompleted(t: Task): boolean {
  const s = (t as unknown as { status?: { category?: string } | string | null }).status;
  if (s && typeof s === 'object') {
    return s.category === 'done' || s.category === 'closed';
  }
  if (typeof s === 'string') {
    const lower = s.toLowerCase().trim();
    if (lower === 'closed' || lower === 'done' || lower === 'cancelled') return true;
    const cat = getTaskStatusCategory(s);
    if (cat === 'done' || cat === 'closed') return true;
  }
  const category = (t as unknown as { category?: string | null }).category;
  if (category === 'done' || category === 'closed') return true;
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
  orderedStatuses?: SpaceStatus[],
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
      const rawKey = s.id || s.name || '__none__';
      // UUIDs stay exact; status keys/names collapse case-insensitively so
      // 'Open' vs 'OPEN' never fork a second bucket from dirty data.
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawKey);
      key = isUuid ? rawKey : rawKey.toLowerCase().trim() || '__none__';
      label = s.name || 'No status';
      sort = typeof s.position === 'number' ? s.position : (s.name || '').toLowerCase();
    } else if (typeof s === 'string' && s) {
      const trimmed = s.trim();
      const lower = trimmed.toLowerCase();
      // Merge casing variants ('OPEN' + 'open') into one bucket. Prefer the
      // catalog label ('OPEN') when known so headers stay consistent.
      const def = getTaskStatusDef(lower) || getTaskStatusDef(trimmed);
      key = def?.key || lower || '__none__';
      label = def?.label || (trimmed.charAt(0).toUpperCase() + trimmed.slice(1));
      sort = lower;
    } else {
      key = '__none__';
      label = 'No status';
      sort = '\uffff';
    }
    if (!map.has(key)) map.set(key, { key, label, sort, tasks: [] });
    map.get(key)!.tasks.push(t);
  }
  const out = [...map.values()];
  // When the caller's workflow order is known (Space / Folder views), follow
  // the original status-group position instead of alphabetical order.
  if (orderedStatuses && orderedStatuses.length > 0) {
    const order = new Map<string, number>();
    orderedStatuses.forEach((s, idx) => {
      const idKey = (s.id || '').toLowerCase().trim();
      const nameKey = (s.name || '').toLowerCase().trim();
      if (idKey && !order.has(idKey)) order.set(idKey, idx);
      if (nameKey && !order.has(nameKey)) order.set(nameKey, idx);
    });
    return out.sort((a, b) => {
      const ai = order.get(a.key.toLowerCase().trim());
      const bi = order.get(b.key.toLowerCase().trim());
      const aKnown = ai !== undefined;
      const bKnown = bi !== undefined;
      if (aKnown && bKnown) return (ai as number) - (bi as number);
      if (aKnown) return -1;
      if (bKnown) return 1;
      return a.label.toLowerCase().localeCompare(b.label.toLowerCase());
    });
  }
  return out.sort((a, b) => {
    if (typeof a.sort === 'number' && typeof b.sort === 'number') return a.sort - b.sort;
    if (typeof a.sort === 'number') return -1;
    if (typeof b.sort === 'number') return 1;
    return (a.sort as string).localeCompare(b.sort as string);
  });
}

// Universal bucket of each task's stage, in fixed order. Uses the caller's
// stage set when given (so renamed stages resolve), else the status registry.
export function groupByBucket(
  tasks: Task[],
  fadingMap: ReadonlyMap<string, string>,
  orderedStatuses?: SpaceStatus[],
): Group[] {
  const bucketOf = (t: Task) => {
    const snap = fadingMap.get(t.id);
    const raw = String(snap !== undefined ? snap : ((t as unknown as { status?: string }).status ?? '')).trim().toLowerCase();
    const s = orderedStatuses?.find((x) => x.id.toLowerCase() === raw || x.name.toLowerCase() === raw);
    if (s) return taskBucketOf(s);
    const def = getTaskStatusDef(raw);
    return taskBucketOf(def ? { group: def.group, category: def.category } : null);
  };
  return TASK_BUCKETS.map((b, i) => ({
    key: b.key,
    label: `${b.emoji} ${b.label}`,
    sort: i,
    color: b.color,
    tasks: tasks.filter((t) => bucketOf(t) === b.key),
  })).filter((g) => g.tasks.length > 0);
}

// "When will I do it", derived from work_date (Missed / Today / … / Someday).
export function groupByPlan(tasks: Task[], tz: string): Group[] {
  return TASK_PLANS.map((p, i) => ({
    key: p.key,
    label: p.label,
    sort: i,
    color: p.color,
    tasks: tasks.filter((t) => taskPlanOf(t.work_date, tz) === p.key),
  })).filter((g) => g.tasks.length > 0);
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

// A task can carry several labels, so (unlike space/folder/list) it appears
// under EVERY label it has — mirroring how multi-homing renders a task inside
// each of its groups. Untagged tasks collect under "No label" (sorted last).
export function groupByLabel(tasks: Task[]): Group[] {
  const map = new Map<string, Group>();
  for (const t of tasks) {
    const tags = t.tags ?? [];
    if (tags.length === 0) {
      const k = '__none__';
      if (!map.has(k)) map.set(k, { key: k, label: 'No label', sort: '\uffff', tasks: [] });
      map.get(k)!.tasks.push(t);
      continue;
    }
    for (const tag of tags) {
      const key = tag.id || tag.name;
      if (!map.has(key)) {
        map.set(key, {
          key,
          label: tag.name || 'Unnamed label',
          sort: (tag.name || '').toLowerCase(),
          tasks: [],
          color: tag.color,
        });
      }
      map.get(key)!.tasks.push(t);
    }
  }
  return [...map.values()].sort((a, b) => (a.sort as string).localeCompare(b.sort as string));
}

// Group tasks by their task type. Resolves the type definition either from
// joined task_type object or from the optional taskTypes list (by task_type_id
// or task_type_key). Untyped tasks collect under "No task type" sorted last.
export function groupByTaskType(tasks: Task[], taskTypes?: TaskType[]): Group[] {
  const typeById = new Map<string, TaskType>();
  const typeByKey = new Map<string, TaskType>();
  if (taskTypes) {
    for (const tt of taskTypes) {
      if (tt.id) typeById.set(tt.id, tt);
      if (tt.key) typeByKey.set(tt.key, tt);
    }
  }

  const map = new Map<string, Group>();
  for (const t of tasks) {
    const rawType = (t as any).task_type;
    const typeId = t.task_type_id || rawType?.id || null;
    const typeKey = (t as any).task_type_key || rawType?.key || null;
    const resolvedType = (typeId ? typeById.get(typeId) : null)
      || (typeKey ? typeByKey.get(typeKey) : null)
      || rawType
      || null;

    if (!resolvedType && !typeId && !typeKey) {
      const k = '__none__';
      if (!map.has(k)) {
        map.set(k, { key: k, label: 'No task type', sort: Number.MAX_SAFE_INTEGER, tasks: [] });
      }
      map.get(k)!.tasks.push(t);
      continue;
    }

    const key = resolvedType?.id || typeId || resolvedType?.key || typeKey || '__none__';
    if (!map.has(key)) {
      const label = resolvedType?.name || resolvedType?.key || 'No task type';
      const color = resolvedType?.color || (t as any).task_type_color || undefined;
      const sort = typeof resolvedType?.position === 'number' ? resolvedType.position : (label || '').toLowerCase();
      map.set(key, {
        key,
        label,
        color,
        sort,
        tasks: [],
      });
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

// `fadingMap` is REQUIRED so callers can't accidentally drop the snapshot when
// `by === 'status'`. The other group-by paths don't read `task.status`, so the
// value is unused for them — but the type guard keeps the call site honest.
export function groupTasks(
  tasks: Task[],
  by: GroupBy,
  tz: string,
  fadingMap: ReadonlyMap<string, string>,
  taskTypes?: TaskType[],
  orderedStatuses?: SpaceStatus[],
): Group[] {
  switch (by) {
    case 'work_date':
      return groupByDate(tasks, 'work_date', tz, 'No work date');
    case 'due_date':
      return groupByDate(tasks, 'due_date', tz, 'No due date');
    case 'priority':
      return groupByPriority(tasks);
    case 'status':
      return groupByStatus(tasks, fadingMap, orderedStatuses);
    case 'task_type':
      return groupByTaskType(tasks, taskTypes);
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
    case 'label':
      return groupByLabel(tasks);
    case 'bucket':
      return groupByBucket(tasks, fadingMap, orderedStatuses);
    case 'plan':
      return groupByPlan(tasks, tz);
    default:
      return [];
  }
}

// Focus is server-backed (the task's `focused_at` column, set by PATCH /focus
// from any device incl. the desktop app) and *persistent*: a starred task stays
// focused until it's explicitly unstarred (which clears focused_at to null). It
// does NOT reset overnight. The home Focus list additionally hides a starred
// task whose work_date is in the future until that day arrives (see TodayList).
export function isTaskFocused(t: Task): boolean {
  return t.focused_at != null;
}

export function buildFocusTodayGroup(tasks: Task[], sortBy: SortBy = 'manual'): Group | null {
  const matched = tasks.filter((t) => isTaskFocused(t));
  if (matched.length === 0) return null;
  const ordered =
    sortBy === 'manual'
      ? [...matched].sort((a, b) => (a.focused_at ?? '').localeCompare(b.focused_at ?? ''))
      : sortTasks(matched, sortBy);
  return { key: 'focus_today', label: 'Focus Today', sort: -1, tasks: ordered };
}

// Nest flat subtask rows (list endpoints with include_subtasks return them as
// top-level siblings) under their parents, so each parent row can offer the
// expandable subtask dropdown (TaskRow chevron). Subtasks whose parent isn't in
// the array — e.g. the parent only lives here via a multi-home link while the
// children belong to its primary list — stay at the top level with their parent
// breadcrumb, preserving the previous flat behaviour for those orphans.
export function nestSubtasks(tasks: Task[]): Task[] {
  if (!tasks.some((t) => t.parent_task_id)) return tasks;
  const byParent = new Map<string, Task[]>();
  const tops: Task[] = [];
  for (const t of tasks) {
    if (t.parent_task_id) {
      const arr = byParent.get(t.parent_task_id);
      if (arr) arr.push(t);
      else byParent.set(t.parent_task_id, [t]);
    } else {
      tops.push(t);
    }
  }
  const presentIds = new Set(tasks.map((t) => t.id));
  const nested = tops.map((t) => {
    const subs = byParent.get(t.id);
    return subs ? { ...t, subtasks: subs } : t;
  });
  for (const [pid, subs] of byParent) {
    if (!presentIds.has(pid)) nested.push(...subs);
  }
  return nested;
}

// Run a predicate over a nested list subtask-aware: a parent is kept when the
// parent itself matches (all its subtasks stay) OR when any subtask matches
// (the parent is kept carrying just the matching subtasks) — so searching or
// filtering for a subtask surfaces it under its parent instead of hiding it.
export function filterWithSubtasks(tasks: Task[], pred: (t: Task) => boolean): Task[] {
  const out: Task[] = [];
  for (const t of tasks) {
    const subs = t.subtasks;
    if (!subs || subs.length === 0) {
      if (pred(t)) out.push(t);
      continue;
    }
    if (pred(t)) {
      out.push(t);
      continue;
    }
    const matching = subs.filter(pred);
    if (matching.length > 0) out.push({ ...t, subtasks: matching });
  }
  return out;
}
