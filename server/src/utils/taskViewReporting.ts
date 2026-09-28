import { supabaseAdmin } from '../supabase';

interface TaskViewCheckItem {
  id: string;
  title: string;
  description?: string | null;
  list_id: string;
  metadata?: any;
}

/**
 * Checks whether a given task belongs to a view with `includeInTimeReport === false`.
 * A task belongs to a view if:
 * 1. `task.metadata?.view_id === view.id`, or
 * 2. The view has configured keywords and any keyword matches the task's title, description, or tags.
 */
export async function isTaskExcludedFromTimeReports(taskId: string): Promise<boolean> {
  const { data: task } = await supabaseAdmin
    .from('tasks')
    .select('id, title, description, list_id, metadata')
    .eq('id', taskId)
    .maybeSingle();

  if (!task || !task.list_id) return false;

  const excluded = await getExcludedTaskIds([task as TaskViewCheckItem]);
  return excluded.has(taskId);
}

/**
 * Given a list of tasks, returns a Set of task IDs that belong to views configured
 * with `includeInTimeReport === false`.
 */
export async function getExcludedTaskIds(tasks: TaskViewCheckItem[]): Promise<Set<string>> {
  const excludedIds = new Set<string>();
  if (!tasks || tasks.length === 0) return excludedIds;

  const listIds = Array.from(new Set(tasks.map((t) => t.list_id).filter(Boolean)));
  if (listIds.length === 0) return excludedIds;

  // Fetch all views for these lists that have includeInTimeReport === false
  const { data: views, error } = await supabaseAdmin
    .from('list_views')
    .select('id, list_id, config')
    .in('list_id', listIds);

  if (error || !views || views.length === 0) return excludedIds;

  const excludedViewsByList = new Map<string, any[]>();
  for (const v of views) {
    const cfg = v.config as any;
    if (cfg && cfg.includeInTimeReport === false) {
      const arr = excludedViewsByList.get(v.list_id) || [];
      arr.push(v);
      excludedViewsByList.set(v.list_id, arr);
    }
  }

  if (excludedViewsByList.size === 0) return excludedIds;

  // For tasks that have excluded views on their list, check keyword / metadata matches
  for (const t of tasks) {
    const listViews = excludedViewsByList.get(t.list_id);
    if (!listViews || listViews.length === 0) continue;

    const titleLower = (t.title || '').toLowerCase();
    const descLower = (t.description || '').toLowerCase();
    const taskViewId = t.metadata?.view_id;

    for (const v of listViews) {
      if (taskViewId && taskViewId === v.id) {
        excludedIds.add(t.id);
        break;
      }

      const keywords = (v.config?.keywords || []) as string[];
      if (keywords.length > 0) {
        const matchesKeyword = keywords.some((kw) => {
          const k = (kw || '').trim().toLowerCase();
          return k && (titleLower.includes(k) || descLower.includes(k));
        });
        if (matchesKeyword) {
          excludedIds.add(t.id);
          break;
        }
      }
    }
  }

  return excludedIds;
}

/**
 * Filter out tasks that belong to views where `includeInTimeReport === false`.
 */
export async function filterTasksExcludedFromTimeReports<T extends { id: string; list_id?: string; title?: string; description?: string | null; metadata?: any }>(
  tasks: T[],
): Promise<T[]> {
  if (!tasks || tasks.length === 0) return tasks;

  // If tasks don't have list_id/title loaded, fetch them
  let checkItems: TaskViewCheckItem[] = [];
  const needsHydration = tasks.some((t) => !t.list_id);

  if (needsHydration) {
    const ids = tasks.map((t) => t.id);
    const { data: hydrated } = await supabaseAdmin
      .from('tasks')
      .select('id, title, description, list_id, metadata')
      .in('id', ids);
    checkItems = (hydrated || []) as TaskViewCheckItem[];
  } else {
    checkItems = tasks.map((t) => ({
      id: t.id,
      title: t.title || '',
      description: t.description || null,
      list_id: t.list_id || '',
      metadata: t.metadata,
    }));
  }

  const excluded = await getExcludedTaskIds(checkItems);
  if (excluded.size === 0) return tasks;

  return tasks.filter((t) => !excluded.has(t.id));
}
