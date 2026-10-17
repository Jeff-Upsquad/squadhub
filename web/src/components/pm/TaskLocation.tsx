import type { Task } from '@squadhub/shared';

/** A task's primary home, shared by compact rows and cards. */
export default function TaskLocation({ task, fallbackListName }: {
  task?: Pick<Task, 'space' | 'folder' | 'list'> | null;
  fallbackListName?: string;
}) {
  const path = [task?.space?.name, task?.folder?.name, task?.list?.name || fallbackListName]
    .filter(Boolean).join(' › ');
  if (!path) return null;
  return <span className="task-location" title={path} aria-label={`Task location: ${path}`}>{path}</span>;
}
