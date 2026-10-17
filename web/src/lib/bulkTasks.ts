import type { Task } from '@squadhub/shared';

export interface BulkTaskFailure {
  id: string;
  title: string;
  message: string;
}

export interface RunBulkTasksOptions {
  onProgress?: (completed: number, total: number, failure?: BulkTaskFailure) => void;
  signal?: AbortSignal;
}

/** Add/remove only this group's IDs, preserving selections in other groups. */
export function toggleGroupSelection(selected: string[], ids: string[]): string[] {
  const unique = [...new Set(ids)];
  return unique.every((id) => selected.includes(id))
    ? selected.filter((id) => !unique.includes(id))
    : [...new Set([...selected, ...unique])];
}

/** Sequential writes avoid overlapping optimistic cache snapshots/rollbacks. */
export async function runBulkTasks(
  tasks: Task[],
  action: (task: Task) => Promise<unknown>,
  options?: RunBulkTasksOptions | ((completed: number, total: number) => void)
): Promise<BulkTaskFailure[]> {
  const opts: RunBulkTasksOptions = typeof options === 'function' ? { onProgress: options } : options || {};
  const failures: BulkTaskFailure[] = [];
  let completed = 0;
  const total = tasks.length;

  for (const task of tasks) {
    if (opts.signal?.aborted) break;
    try {
      await action(task);
      completed++;
      opts.onProgress?.(completed, total);
    } catch (error) {
      const err = error as { response?: { data?: { error?: string } }; message?: string };
      const failure: BulkTaskFailure = {
        id: task.id,
        title: task.title,
        message: err.response?.data?.error || err.message || 'Could not update task',
      };
      failures.push(failure);
      completed++;
      opts.onProgress?.(completed, total, failure);
    }
  }
  return failures;
}
