import type { SpaceStatus, Task, TaskBucket, TaskPlan } from '@squadhub/shared';
import { LEGACY_PLACEHOLDER_KEYS, STAGE_DEFAULT_KEY, TASK_BUCKETS, TASK_PLANS, TASK_PRIORITY_RANK, getTaskStatusDef, taskBucketOf } from '@squadhub/shared';
import { isTaskCompleted } from './taskGrouping';

// Stage workflows separate WHERE a task is (its stage = tasks.status) from HOW
// IMPORTANT it is (tasks.priority) and WHEN it's planned (tasks.work_date).
// These helpers power the stage-mode Board + List: exact-stage columns, the
// shared priority-first ordering, and the bucket columns. (List bucket / plan
// group-bys live in taskGrouping.)

export type BoardColumnsMode = 'stage' | 'bucket';
export type BoardLanesMode = 'none' | 'priority';

/** The raw stage key on a task (tasks.status is stored as text). */
export function stageKeyOf(t: Task, fadingMap?: ReadonlyMap<string, string>): string {
  const snap = fadingMap?.get(t.id);
  const raw = snap !== undefined ? snap : ((t as any).status as string | undefined);
  return (raw || '').trim();
}

function statusMatches(status: SpaceStatus, raw: string): boolean {
  if (!raw) return false;
  const lower = raw.toLowerCase();
  return status.id.toLowerCase() === lower || status.name.toLowerCase() === lower;
}

/** The list's status row for a raw status key / name. */
export function findStatus(statuses: SpaceStatus[], raw: string | null | undefined): SpaceStatus | null {
  if (!raw) return null;
  return statuses.find((x) => statusMatches(x, raw)) || null;
}

/** Placeholder ("current status") stage: per the list's stage set, else the
 *  legacy dependency statuses that are placeholders everywhere. */
export function isPlaceholderStatus(statuses: SpaceStatus[], raw: string | null | undefined): boolean {
  if (!raw) return false;
  if ((LEGACY_PLACEHOLDER_KEYS as readonly string[]).includes(raw)) return true;
  const s = findStatus(statuses, raw);
  if (s) return !!s.is_placeholder;
  return (LEGACY_PLACEHOLDER_KEYS as readonly string[]).includes(raw) || !!getTaskStatusDef(raw)?.is_placeholder;
}

/** Original stage remembered while a task is parked in a placeholder. */
export function originalStatusOf(t: Task): string | null {
  return ((t.metadata as any)?.original_status as string | undefined) || null;
}

/**
 * The stage column a task belongs in. A task parked in a placeholder stays
 * in the stage it came from (or NEW when it never had one), so the board
 * still shows where the work really is.
 */
export function effectiveStageKey(t: Task, statuses: SpaceStatus[], fadingMap?: ReadonlyMap<string, string>): string {
  const raw = stageKeyOf(t, fadingMap);
  if (!isPlaceholderStatus(statuses, raw)) return raw;
  const orig = originalStatusOf(t);
  if (orig && findStatus(statuses, orig) && !isPlaceholderStatus(statuses, orig)) return orig;
  return findStatus(statuses, STAGE_DEFAULT_KEY)?.id || statuses.find((s) => !s.is_placeholder)?.id || raw;
}

export function isTaskOverdue(t: Task, now: number = Date.now()): boolean {
  if (!t.due_date || isTaskCompleted(t)) return false;
  return new Date(t.due_date).getTime() < now;
}

/**
 * The single ordering used inside every stage column / group:
 *   1. priority (Emergency first)   2. overdue first   3. earliest due date
 *   4. earliest planned day          5. creation order
 */
export function sortByStageOrder(tasks: Task[]): Task[] {
  const now = Date.now();
  const time = (s: string | null | undefined) => (s ? new Date(s).getTime() : Infinity);
  return [...tasks].sort((a, b) => {
    const pa = TASK_PRIORITY_RANK[(a.priority as string) || 'none'] ?? 99;
    const pb = TASK_PRIORITY_RANK[(b.priority as string) || 'none'] ?? 99;
    if (pa !== pb) return pa - pb;
    const oa = isTaskOverdue(a, now) ? 0 : 1;
    const ob = isTaskOverdue(b, now) ? 0 : 1;
    if (oa !== ob) return oa - ob;
    const da = time(a.due_date), db = time(b.due_date);
    if (da !== db) return da - db;
    const wa = time(a.work_date), wb = time(b.work_date);
    if (wa !== wb) return wa - wb;
    return time(a.created_at) - time(b.created_at);
  });
}

/** Exact-stage grouping (one column per real stage, in workflow order).
 *  Placeholder stages get no column — their tasks sit in their original
 *  stage. Unknown stages land in the first column so a task is never lost. */
export function groupTasksByStage(
  tasks: Task[],
  statuses: SpaceStatus[],
  fadingMap: ReadonlyMap<string, string>,
): { status: SpaceStatus; tasks: Task[] }[] {
  const groups = statuses.filter((s) => !s.is_placeholder).map((status) => ({ status, tasks: [] as Task[] }));
  if (groups.length === 0) return groups;
  for (const t of tasks) {
    const raw = effectiveStageKey(t, statuses, fadingMap);
    const g = groups.find((x) => statusMatches(x.status, raw)) || groups[0];
    g.tasks.push(t);
  }
  return groups.map((g) => ({ ...g, tasks: sortByStageOrder(g.tasks) }));
}

/** Bucket of a task given the list's stage set (falls back to the registry). */
export function bucketOfTask(t: Task, statuses: SpaceStatus[], fadingMap?: ReadonlyMap<string, string>): TaskBucket {
  const raw = stageKeyOf(t, fadingMap);
  const s = statuses.find((x) => statusMatches(x, raw));
  if (s) return taskBucketOf(s);
  const def = getTaskStatusDef(raw);
  return taskBucketOf(def ? { group: def.group, category: def.category } : null);
}

export type SimpleGroup = { key: string; label: string; color: string; tasks: Task[] };

export function groupTasksByBucket(tasks: Task[], statuses: SpaceStatus[], fadingMap: ReadonlyMap<string, string>): SimpleGroup[] {
  return TASK_BUCKETS.map((b) => ({
    key: b.key,
    label: `${b.emoji} ${b.label}`,
    color: b.color,
    tasks: sortByStageOrder(tasks.filter((t) => bucketOfTask(t, statuses, fadingMap) === b.key)),
  }));
}

export const PRIORITY_LANES: { key: string; label: string; color: string }[] = [
  { key: 'emergency', label: 'Emergency', color: '#b91c1c' },
  { key: 'urgent', label: 'Urgent', color: '#ef4444' },
  { key: 'high', label: 'High', color: '#f97316' },
  { key: 'normal', label: 'Normal', color: '#3b82f6' },
  { key: 'low', label: 'Low', color: '#6b7280' },
  { key: 'none', label: 'No priority', color: '#9ca3af' },
];

/** First stage of a bucket — where a card dropped on a bucket column lands. */
export function firstStageInBucket(statuses: SpaceStatus[], bucket: TaskBucket): SpaceStatus | null {
  return statuses.find((s) => taskBucketOf(s) === bucket) || null;
}

export function planMeta(plan: TaskPlan) {
  return TASK_PLANS.find((p) => p.key === plan)!;
}

/** Picker-section order for status groups shown across workflows. */
export const STATUS_SECTION_ORDER = [
  'not_started', 'priority_urgency', 'in_motion', 'up_next', 'scheduled_queued', 'routines', 'blocked_paused', 'done',
];

export type DirectoryStatusGroup = { key: string; label: string; color: string; status: SpaceStatus | null; tasks: Task[] };

/**
 * Status grouping for views spanning lists on different workflows (Space /
 * Folder pages). `directory` is every status keyed by its stable key, so a
 * Design list's CLIENT REVIEW and a Software list's CODE REVIEW both resolve
 * to proper labels and sections. Parked tasks group under their original
 * stage; groups follow section order, then workflow position, and tasks
 * inside follow the stage ordering (priority first).
 */
export function groupTasksByStatusDirectory(
  tasks: Task[],
  directory: SpaceStatus[],
  fadingMap: ReadonlyMap<string, string>,
  fallbackStatuses: SpaceStatus[] = [],
): DirectoryStatusGroup[] {
  const lookup = [...directory, ...fallbackStatuses];
  const groups = new Map<string, DirectoryStatusGroup>();
  for (const t of tasks) {
    const raw = stageKeyOf(t, fadingMap);
    let key = raw;
    if (isPlaceholderStatus(lookup, raw)) {
      const orig = originalStatusOf(t);
      if (orig && !isPlaceholderStatus(lookup, orig)) key = orig;
    }
    const status = findStatus(lookup, key);
    const gKey = (status?.id || key || '__none__').toLowerCase();
    let g = groups.get(gKey);
    if (!g) {
      g = {
        key: gKey,
        label: status?.name || (key ? key.charAt(0).toUpperCase() + key.slice(1) : 'No status'),
        color: status?.color || '#9ca3af',
        status,
        tasks: [],
      };
      groups.set(gKey, g);
    }
    g.tasks.push(t);
  }
  const sectionRank = (s: SpaceStatus | null) => {
    const i = s?.group ? STATUS_SECTION_ORDER.indexOf(s.group) : -1;
    return i === -1 ? STATUS_SECTION_ORDER.length : i;
  };
  return [...groups.values()]
    .sort((a, b) => sectionRank(a.status) - sectionRank(b.status)
      || (a.status?.position ?? 9999) - (b.status?.position ?? 9999)
      || a.label.localeCompare(b.label))
    .map((g) => ({ ...g, tasks: sortByStageOrder(g.tasks) }));
}
