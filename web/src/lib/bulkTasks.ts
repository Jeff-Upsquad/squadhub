import type { Task } from '@squadhub/shared';

/** Add/remove only this group's IDs, preserving selections in other groups. */
export function toggleGroupSelection(selected: string[], ids: string[]): string[] {
  const unique = [...new Set(ids)];
  return unique.every((id) => selected.includes(id))
    ? selected.filter((id) => !unique.includes(id))
    : [...new Set([...selected, ...unique])];
}

/** Sequential writes avoid overlapping optimistic cache snapshots/rollbacks. */
export async function runBulkTasks(tasks: Task[], action: (task: Task) => Promise<unknown>) {
  const failures: { id: string; title: string; message: string }[] = [];
  for (const task of tasks) {
    try { await action(task); }
    catch (error) {
      const err = error as { response?: { data?: { error?: string } }; message?: string };
      failures.push({ id: task.id, title: task.title, message: err.response?.data?.error || err.message || 'Could not update task' });
    }
  }
  return failures;
}
