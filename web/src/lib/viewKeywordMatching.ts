import type { Task, ListViewRow } from '@squadhub/shared';

/**
 * Checks if a task matches any of the provided keywords.
 * Matches case-insensitively across task title, description, and attached tag/label names.
 */
export function taskMatchesKeywords(task: Task, keywords: string[]): boolean {
  if (!keywords || keywords.length === 0) return false;
  const title = (task.title || '').toLowerCase();
  const desc = (task.description || '').toLowerCase();
  const tags = ((task as any).tags || []).map((t: any) => (t.name || '').toLowerCase());

  return keywords.some((kw) => {
    const k = (kw || '').trim().toLowerCase();
    if (!k) return false;
    return title.includes(k) || desc.includes(k) || tags.some((tagName: string) => tagName.includes(k));
  });
}

/**
 * Determines whether a task should be visible in the given view.
 * 
 * Rules:
 * 1. If the task has `metadata.view_id === view.id`, it belongs to this view.
 * 2. If the view has keywords configured:
 *    Task is visible ONLY if it matches at least one keyword (or was explicitly created with this view's id).
 * 3. If the view has NO keywords configured (e.g. the default view or general list):
 *    - If view.config?.showAllTasks is true, task is visible.
 *    - Otherwise, check if ANY other view in allViews has keywords that match this task
 *      (or has metadata.view_id matching that other view). If so, the task is visible ONLY in
 *      that other view, so it is hidden from this view.
 *    - If no other keyword-configured view matches the task, it is visible here.
 */
export function isTaskVisibleInView(
  task: Task,
  activeView: ListViewRow | null | undefined,
  allViews: ListViewRow[] = [],
): boolean {
  if (!activeView) return true;

  // 1. Direct view assignment
  if (task.metadata?.view_id === activeView.id) return true;

  const activeKeywords = (activeView.config?.keywords || []).filter((k) => k && k.trim().length > 0);

  // 2. Active view has keywords
  if (activeKeywords.length > 0) {
    return taskMatchesKeywords(task, activeKeywords);
  }

  // 3. Active view has no keywords
  if (activeView.config?.showAllTasks) return true;

  // Check if any other view with keywords (or direct assignment) claims this task
  const otherViews = allViews.filter((v) => v.id !== activeView.id);
  for (const other of otherViews) {
    if (task.metadata?.view_id === other.id) return false;

    const otherKeywords = (other.config?.keywords || []).filter((k) => k && k.trim().length > 0);
    if (otherKeywords.length > 0 && taskMatchesKeywords(task, otherKeywords)) {
      return false; // Captured by that other view
    }
  }

  return true;
}
