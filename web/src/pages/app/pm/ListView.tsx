import { useMemo } from 'react';
import type { SpaceStatus, Task } from '@squadhub/shared';
import { useTasks, useUpdateTask, groupTasksByStatus } from '../../../hooks/useTasks';
import TaskRow from './TaskRow';
import QuickAddTask from './QuickAddTask';

export default function ListView({
  listId,
  statuses,
  filters,
}: {
  listId: string;
  statuses: SpaceStatus[];
  filters?: { status_id?: string; priority?: string; sort?: string };
}) {
  const { data: tasks, isLoading } = useTasks(listId, filters);
  const updateTask = useUpdateTask(listId);

  const groups = useMemo(
    () => groupTasksByStatus(tasks || [], statuses),
    [tasks, statuses],
  );

  const handleStatusChange = (taskId: string, statusId: string) => {
    updateTask.mutate({ id: taskId, status_id: statusId });
  };

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-[#999999]">Loading tasks...</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {groups.map(({ status, tasks: groupTasks }) => (
        <StatusGroup
          key={status.id}
          status={status}
          tasks={groupTasks}
          allStatuses={statuses}
          listId={listId}
          onStatusChange={handleStatusChange}
        />
      ))}
    </div>
  );
}

function StatusGroup({
  status,
  tasks,
  allStatuses,
  listId,
  onStatusChange,
}: {
  status: SpaceStatus;
  tasks: Task[];
  allStatuses: SpaceStatus[];
  listId: string;
  onStatusChange: (taskId: string, statusId: string) => void;
}) {
  return (
    <div className="mb-2">
      {/* Status header */}
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-[#E2E8F0] bg-[#ffffff]/90 px-4 py-2 backdrop-blur-sm">
        <span
          className="h-2.5 w-2.5 rounded-full"
          style={{ backgroundColor: status.color }}
        />
        <span className="text-xs font-semibold uppercase tracking-[0.12em] text-[#666666] font-[family-name:var(--font-mono)]">
          {status.name}
        </span>
        <span className="text-xs text-[#999999]">{tasks.length}</span>
      </div>

      {/* Tasks */}
      {tasks.map((task) => (
        <TaskRow
          key={task.id}
          task={task}
          statuses={allStatuses}
          onStatusChange={onStatusChange}
        />
      ))}

      {/* Quick add */}
      <QuickAddTask listId={listId} statusId={status.id} />
    </div>
  );
}
