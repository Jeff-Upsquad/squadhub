import type { Task } from '@squadhub/shared';
import { isFutureDay, isTaskCompleted, isTaskFocused } from './taskGrouping';

export type WorkedTaskContext = {
  workedAtByTask: Record<string, string>;
  timeZone: string;
  today: string;
};

/** A later work day defers older work until the user works on the task again. */
export function isDeferredWorkedTask(task: Task, context: WorkedTaskContext): boolean {
  const lastWorkedAt = context.workedAtByTask[task.id];
  if (!lastWorkedAt || !task.work_date) return false;
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: context.timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const workedDay = fmt.format(new Date(lastWorkedAt));
  return workedDay !== context.today && fmt.format(new Date(task.work_date)) > workedDay;
}

/** Starred tasks and deferred worked tasks return to Focus on their work day. */
export function buildFocusTasks(availableTasks: Task[], context: WorkedTaskContext, dismissedTaskIds: string[] = []): Task[] {
  const unique = new Map(availableTasks.map((task) => [task.id, task]));
  const dismissed = new Set(dismissedTaskIds);
  return [...unique.values()]
    .filter((task) => !isTaskCompleted(task)
      && (isTaskFocused(task) || isDeferredWorkedTask(task, context))
      && !(dismissed.has(task.id) && isDeferredWorkedTask(task, context))
      && !isFutureDay(task.work_date, context.timeZone))
    .sort((a, b) => (a.focused_at ?? '').localeCompare(b.focused_at ?? ''));
}

/** Carry saved work across days and include timers before their first save. */
export function buildInProgressTasks(
  workedTasks: Task[],
  availableTasks: Task[],
  activeTaskIds: string[],
  context: WorkedTaskContext,
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
  const addedIds = new Set(activeTasks.map((task) => task.id));
  const activeIds = new Set(activeTaskIds);
  return [...activeTasks, ...[...tasks.values()].filter((task) => !addedIds.has(task.id))]
    .filter((task) => !isTaskCompleted(task)
      && (activeIds.has(task.id) || !isDeferredWorkedTask(task, context)));
}
