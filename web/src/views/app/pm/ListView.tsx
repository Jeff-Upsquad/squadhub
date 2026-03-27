import { useMemo, useState } from 'react';
import type { SpaceStatus, Task } from '@squadhub/shared';
import { useTasks, useUpdateTask, groupTasksByStatus } from '../../../hooks/useTasks';
import { usePMStore } from '../../../stores/pmStore';
import TaskRow from './TaskRow';
import QuickAddTask from './QuickAddTask';

export default function ListView({
  listId,
  statuses,
  filters,
  hasActiveFilters,
  groupByStatus = true,
}: {
  listId: string;
  statuses: SpaceStatus[];
  filters?: { status?: string; priority?: string; sort?: string };
  hasActiveFilters?: boolean;
  groupByStatus?: boolean;
}) {
  const { data: tasks, isLoading } = useTasks(listId, filters);
  const updateTask = useUpdateTask(listId);

  const groups = useMemo(
    () => groupByStatus ? groupTasksByStatus(tasks || [], statuses) : [{ status: { id: 'all', name: 'All Tasks', color: '#6b7280', position: 0, space_id: '', is_default: false, category: 'active' as const }, tasks: tasks || [] }],
    [tasks, statuses, groupByStatus],
  );

  const handleStatusChange = (taskId: string, statusId: string) => {
    updateTask.mutate({ id: taskId, status: statusId });
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
      {/* Column headers */}
      <div className="sticky top-0 z-20 flex items-center border-b border-[#E2E8F0] bg-[#FAFBFC] px-4 py-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#999999] font-[family-name:var(--font-mono)]">
        <div className="min-w-0 flex-1">Name</div>
        <div className="w-20 shrink-0 text-center">Assignee</div>
        <div className="w-24 shrink-0 text-center">Time tracked</div>
        <div className="w-24 shrink-0 text-center">Start date</div>
        <div className="w-24 shrink-0 text-center">Due date</div>
        <div className="w-20 shrink-0 text-center">Comments</div>
        <div className="w-20 shrink-0 text-center">Created by</div>
        <div className="w-24 shrink-0 text-center">Date created</div>
      </div>

      {groups.map(({ status, tasks: groupTasks }) => (
        <StatusGroup
          key={status.id}
          status={status}
          tasks={groupTasks}
          allStatuses={statuses}
          listId={listId}
          onStatusChange={handleStatusChange}
          showHeader={groupByStatus}
          onDrop={handleStatusChange}
        />
      ))}

      {hasActiveFilters && (
        <div className="flex items-center justify-center py-4">
          <p className="text-xs text-[#999999]">Some tasks are hidden by active filters.</p>
        </div>
      )}
    </div>
  );
}

function StatusGroup({
  status,
  tasks,
  allStatuses,
  listId,
  onStatusChange,
  showHeader = true,
  onDrop,
}: {
  status: SpaceStatus;
  tasks: Task[];
  allStatuses: SpaceStatus[];
  listId: string;
  onStatusChange: (taskId: string, statusId: string) => void;
  showHeader?: boolean;
  onDrop?: (taskId: string, statusId: string) => void;
}) {
  const { collapsedGroups, toggleGroupCollapse } = usePMStore();
  const isCollapsed = collapsedGroups[status.id] || false;
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragOver(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const taskId = e.dataTransfer.getData('text/plain');
    if (taskId && onDrop) onDrop(taskId, status.category);
  };

  return (
    <div
      className={`mb-0 transition-colors ${isDragOver ? 'bg-[#E8F0FE]/50' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Status header */}
      {showHeader && (
        <div
          className="sticky top-[29px] z-10 flex cursor-pointer items-center gap-2 border-b border-[#E2E8F0] bg-white px-4 py-2 transition hover:bg-[#FAFBFC]"
          onClick={() => toggleGroupCollapse(status.id)}
        >
          <svg
            className={`h-3.5 w-3.5 text-[#999999] transition-transform ${isCollapsed ? '' : 'rotate-90'}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          <span
            className="inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-xs font-semibold uppercase tracking-[0.06em]"
            style={{
              backgroundColor: `${status.color}18`,
              color: status.color,
            }}
          >
            {status.name}
          </span>
          <span className="flex h-4.5 min-w-[18px] items-center justify-center rounded-full bg-[#F1F5F9] px-1.5 text-[10px] font-medium text-[#666666]">
            {tasks.length}
          </span>
        </div>
      )}

      {/* Tasks */}
      {!isCollapsed && (
        <>
          {tasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              statuses={allStatuses}
              onStatusChange={onStatusChange}
            />
          ))}
          <QuickAddTask listId={listId} status={status.category} />
        </>
      )}
    </div>
  );
}
