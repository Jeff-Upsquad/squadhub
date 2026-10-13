import type { Task } from '@squadhub/shared';
import { isTaskCompleted } from './taskGrouping';

/** Carry saved work across days and include timers before their first save. */
export function buildInProgressTasks(
  workedTasks: Task[],
  availableTasks: Task[],
  activeTaskIds: string[],
): Task[] {
  const tasks = new Map(workedTasks.map((task) => [task.id, task]));
  const activeTasks: Task[] = [];
  for (const id of activeTaskIds) {
    if (tasks.has(id)) continue;
    const task = availableTasks.find((candidate) => candidate.id === id);
    if (task) {
      tasks.set(id, task);
      activeTasks.unshift(task);
    }
  }
  const activeIds = new Set(activeTasks.map((task) => task.id));
  return [...activeTasks, ...[...tasks.values()].filter((task) => !activeIds.has(task.id))]
    .filter((task) => !isTaskCompleted(task));
}
