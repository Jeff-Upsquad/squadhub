import { useMemo, useState } from 'react';
import type { SpaceStatus, Task } from '@squadhub/shared';
import { useTasks, useUpdateTask, groupTasksByStatus } from '../../../hooks/useTasks';
import { usePMStore } from '../../../stores/pmStore';
import TaskRow from './TaskRow';

export default function ListView({
  listId,
  statuses,
  filters,
  groupByStatus = true,
  searchQuery = '',
  canEdit = true,
}: {
  listId: string;
  statuses: SpaceStatus[];
  filters?: { status?: string; priority?: string; sort?: string };
  groupByStatus?: boolean;
  searchQuery?: string;
  canEdit?: boolean;
}) {
  const { data: tasks, isLoading } = useTasks(listId, filters);
  const updateTask = useUpdateTask(listId);
  const { selectedTasks, clearSelection } = usePMStore();

  const groups = useMemo(() => {
    const allTasks = (tasks || []).filter(
      (t) => !searchQuery || t.title.toLowerCase().includes(searchQuery.toLowerCase()),
    );
    if (groupByStatus) {
      return groupTasksByStatus(allTasks, statuses);
    }
    return [{
      status: { id: 'all', name: 'All Tasks', color: '#6b7280', position: 0, space_id: '', is_default: false, category: 'active' as const },
      tasks: allTasks,
    }];
  }, [tasks, statuses, groupByStatus, searchQuery]);

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
    <div className="relative flex flex-1 flex-col overflow-auto">
      <div className="min-w-fit">
        {/* Column headers */}
        <div className="sticky top-0 z-20 flex items-center border-b border-[#E2E8F0] bg-[#FAFBFC] px-4 py-2 text-[11px] font-semibold text-[#999999]">
          <div className="w-8 shrink-0" />
          <div className="min-w-[120px] flex-1">Name task</div>
          <div className="w-36 shrink-0 px-2">Assignee</div>
          <div className="w-28 shrink-0 text-center">Start date</div>
          <div className="w-28 shrink-0 text-center">Due date</div>
          <div className="w-24 shrink-0 text-center">People</div>
          <div className="w-28 shrink-0 text-center">Priority</div>
        </div>

        {/* Status groups */}
        <div className="flex-1">
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
              canEdit={canEdit}
            />
          ))}
        </div>
      </div>

      {/* Selection action bar */}
      {canEdit && selectedTasks.length > 0 && (
        <div className="sticky bottom-0 z-30 flex items-center justify-center gap-3 border-t border-[#E2E8F0] bg-white px-4 py-2.5 shadow-[0_-2px_8px_rgba(0,0,0,0.06)]">
          <span className="flex items-center gap-1.5 rounded-full bg-emerald-600 px-3 py-1 text-xs font-medium text-white">
            {selectedTasks.length} Selected
          </span>

          <button className="flex items-center gap-1.5 rounded px-3 py-1.5 text-xs text-[#666666] hover:bg-[#F1F5F9]">
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
            Rename
          </button>

          <button className="flex items-center gap-1.5 rounded px-3 py-1.5 text-xs text-[#666666] hover:bg-[#F1F5F9]">
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
            Duplicate
          </button>

          <button className="flex items-center gap-1.5 rounded px-3 py-1.5 text-xs text-[#666666] hover:bg-[#F1F5F9]">
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
            </svg>
            Add Favorites
          </button>

          <button className="flex items-center gap-1.5 rounded px-3 py-1.5 text-xs text-[#666666] hover:bg-[#F1F5F9]">
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
            </svg>
            Move
          </button>

          <button
            onClick={clearSelection}
            className="flex items-center gap-1.5 rounded bg-red-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-600"
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            Clear task
          </button>
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
  canEdit = true,
}: {
  status: SpaceStatus;
  tasks: Task[];
  allStatuses: SpaceStatus[];
  listId: string;
  onStatusChange: (taskId: string, statusId: string) => void;
  showHeader?: boolean;
  onDrop?: (taskId: string, statusId: string) => void;
  canEdit?: boolean;
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
          className="sticky top-[33px] z-10 flex cursor-pointer items-center gap-2 border-b border-[#E2E8F0] bg-white px-4 py-2.5 transition hover:bg-[#FAFBFC]"
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
            className="h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: status.color }}
          />

          <span className="text-sm font-semibold text-[#0F172B]">
            {status.name}
          </span>

          <span className="text-xs text-[#999999]">
            {tasks.length}
          </span>

          {/* Ellipsis */}
          <button
            onClick={(e) => e.stopPropagation()}
            className="ml-1 rounded p-0.5 text-[#CAD5E2] hover:bg-[#F1F5F9] hover:text-[#999999]"
          >
            <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
              <circle cx="5" cy="12" r="1.5" />
              <circle cx="12" cy="12" r="1.5" />
              <circle cx="19" cy="12" r="1.5" />
            </svg>
          </button>

          <div className="flex-1" />
        </div>
      )}

      {/* Tasks */}
      {!isCollapsed && tasks.map((task) => (
        <TaskRow
          key={task.id}
          task={task}
          statuses={allStatuses}
          onStatusChange={onStatusChange}
          canEdit={canEdit}
        />
      ))}
    </div>
  );
}
