const queues = new WeakMap<object, Map<string, Promise<unknown>>>();

/** Save successive edits to one task in order, while other tasks save independently. */
export function queueGoalTaskWrite<T>(scope: object, taskId: string, write: () => Promise<T>): Promise<T> {
  let tasks = queues.get(scope);
  if (!tasks) { tasks = new Map(); queues.set(scope, tasks); }
  const result = (tasks.get(taskId) || Promise.resolve()).catch(() => undefined).then(write);
  tasks.set(taskId, result);
  const clear = () => { if (tasks.get(taskId) === result) tasks.delete(taskId); };
  void result.then(clear, clear);
  return result;
}
