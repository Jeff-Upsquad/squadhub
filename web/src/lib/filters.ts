import type { Task, TaskPriority, SpaceStatus, User, TaskTag } from '@squadhub/shared';
import { getTaskStatusCategory } from '@squadhub/shared';

export type DueDatePreset = 'overdue' | 'today' | 'this_week' | 'no_date';

export const DUE_DATE_PRESETS: { value: DueDatePreset; label: string }[] = [
  { value: 'overdue', label: 'Overdue' },
  { value: 'today', label: 'Today' },
  { value: 'this_week', label: 'This week' },
  { value: 'no_date', label: 'No due date' },
];

export const PRIORITY_OPTIONS: TaskPriority[] = ['emergency', 'urgent', 'high', 'normal', 'low', 'none'];

export interface TaskFilterState {
  statusCategories?: string[];
  priorities?: TaskPriority[];
  assigneeIds?: string[];
  tagIds?: string[];
  dueDate?: DueDatePreset[];
}

export const EMPTY_FILTER: TaskFilterState = {};

export function countActiveFilters(f: TaskFilterState | undefined | null): number {
  if (!f) return 0;
  return (
    (f.statusCategories?.length ?? 0) +
    (f.priorities?.length ?? 0) +
    (f.assigneeIds?.length ?? 0) +
    (f.tagIds?.length ?? 0) +
    (f.dueDate?.length ?? 0)
  );
}

export function isFilterEmpty(f: TaskFilterState | undefined | null): boolean {
  return countActiveFilters(f) === 0;
}

function resolveTaskCategory(t: Task): string | null {
  const raw = (t as unknown as { status?: { category?: string } | string | null }).status;
  if (raw && typeof raw === 'object') return raw.category ?? null;
  if (typeof raw === 'string' && raw) {
    if (raw === 'todo' || raw === 'active' || raw === 'done' || raw === 'closed') return raw;
    return getTaskStatusCategory(raw);
  }
  return null;
}

function ymd(d: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

function matchesDueDate(t: Task, presets: DueDatePreset[], tz: string): boolean {
  const due = t.due_date;
  const now = new Date();
  const todayKey = ymd(now, tz);
  const sevenDaysOut = ymd(new Date(now.getTime() + 7 * 86_400_000), tz);

  for (const p of presets) {
    if (p === 'no_date') {
      if (!due) return true;
      continue;
    }
    if (!due) continue;
    const key = ymd(new Date(due), tz);
    if (p === 'today' && key === todayKey) return true;
    if (p === 'overdue' && key < todayKey) return true;
    if (p === 'this_week' && key >= todayKey && key <= sevenDaysOut) return true;
  }
  return false;
}

export function filterTasks(tasks: Task[], filters: TaskFilterState | undefined | null, tz: string): Task[] {
  if (isFilterEmpty(filters)) return tasks;
  const f = filters!;

  return tasks.filter((t) => {
    if (f.statusCategories && f.statusCategories.length > 0) {
      const cat = resolveTaskCategory(t);
      if (!cat || !f.statusCategories.includes(cat)) return false;
    }

    if (f.priorities && f.priorities.length > 0) {
      const p = (t.priority ?? 'none') as TaskPriority;
      if (!f.priorities.includes(p)) return false;
    }

    if (f.assigneeIds && f.assigneeIds.length > 0) {
      const ids = (t.assignees ?? []).map((u) => u.id);
      if (!f.assigneeIds.some((id) => ids.includes(id))) return false;
    }

    if (f.tagIds && f.tagIds.length > 0) {
      const ids = (t.tags ?? []).map((tag) => tag.id);
      if (!f.tagIds.some((id) => ids.includes(id))) return false;
    }

    if (f.dueDate && f.dueDate.length > 0) {
      if (!matchesDueDate(t, f.dueDate, tz)) return false;
    }

    return true;
  });
}

export function deriveAssigneeOptions(tasks: Task[]): User[] {
  const seen = new Map<string, User>();
  for (const t of tasks) {
    for (const u of t.assignees ?? []) {
      if (u && u.id && !seen.has(u.id)) seen.set(u.id, u);
    }
  }
  return [...seen.values()].sort((a, b) =>
    (a.display_name || a.email || '').localeCompare(b.display_name || b.email || ''),
  );
}

export function deriveTagOptions(tasks: Task[]): TaskTag[] {
  const seen = new Map<string, TaskTag>();
  for (const t of tasks) {
    for (const tag of t.tags ?? []) {
      if (tag && tag.id && !seen.has(tag.id)) seen.set(tag.id, tag);
    }
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function deriveStatusCategoryOptions(statuses: SpaceStatus[]): { category: string; name: string; color: string }[] {
  const seen = new Map<string, { category: string; name: string; color: string }>();
  for (const s of statuses) {
    if (!seen.has(s.category)) {
      seen.set(s.category, { category: s.category, name: s.name, color: s.color });
    }
  }
  return [...seen.values()];
}
