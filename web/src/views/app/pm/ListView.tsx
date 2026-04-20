import { useMemo, useState } from 'react';
import type { SpaceStatus, Task } from '@squadhub/shared';
import { useTasks, useUpdateTask, useCreateTask, groupTasksByStatus } from '../../../hooks/useTasks';
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
      status: { id: 'all', name: 'All tasks', color: '#6b7280', position: 0, space_id: '', is_default: false, category: 'active' as const },
      tasks: allTasks,
    }];
  }, [tasks, statuses, groupByStatus, searchQuery]);

  const handleStatusChange = (taskId: string, statusId: string) => {
    updateTask.mutate({ id: taskId, status: statusId });
  };

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-[color:var(--sh-ink-3)]">Loading tasks…</p>
      </div>
    );
  }

  const totalVisible = groups.reduce((n, g) => n + g.tasks.length, 0);

  return (
    <div className="relative flex flex-1 flex-col overflow-auto">
      <div className="lv-wrap">
        {totalVisible === 0 ? (
          <div className="lv-empty">
            {searchQuery ? `No tasks match “${searchQuery}”.` : 'No tasks yet. Press + to add one.'}
          </div>
        ) : (
          groups.map(({ status, tasks: groupTasks }) => (
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
          ))
        )}

        {/* Bulk action bar — floating pill */}
        {canEdit && selectedTasks.length > 0 && (
          <div className="lv-bulk-bar">
            <span className="count">{selectedTasks.length} SELECTED</span>
            <button className="lv-bulk-btn" onClick={(e) => e.stopPropagation()}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5" />
                <path d="M18.586 2.586a2 2 0 112.828 2.828L12 15l-4 1 1-4 9.586-9.414z" />
              </svg>
              Rename
            </button>
            <button className="lv-bulk-btn" onClick={(e) => e.stopPropagation()}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <rect x="9" y="9" width="11" height="11" rx="2" />
                <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
              </svg>
              Duplicate
            </button>
            <button className="lv-bulk-btn" onClick={(e) => e.stopPropagation()}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M5 12h14M13 5l7 7-7 7" />
              </svg>
              Move
            </button>
            <button className="lv-bulk-btn danger" onClick={(e) => { e.stopPropagation(); clearSelection(); }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
              </svg>
              Delete
            </button>
            <button className="lv-bulk-btn" onClick={clearSelection} aria-label="Clear selection">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}
      </div>
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
  const [addTitle, setAddTitle] = useState<string | null>(null);
  const createTask = useCreateTask(listId);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setIsDragOver(true);
  };
  const handleDragLeave = (e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragOver(false);
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const taskId = e.dataTransfer.getData('text/plain');
    if (taskId && onDrop) onDrop(taskId, status.category);
  };

  return (
    <div
      className="lv-group"
      data-dragover={isDragOver}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {showHeader && (
        <div
          className="lv-group-head"
          data-collapsed={isCollapsed}
          onClick={() => toggleGroupCollapse(status.id)}
        >
          <span className="caret">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M9 5l7 7-7 7" />
            </svg>
          </span>
          <span className="status-dot" style={{ backgroundColor: status.color }} />
          <span className="title">{status.name}</span>
          <span className="count">· {tasks.length}</span>
        </div>
      )}

      {!isCollapsed && (
        <div className="lv-group-body">
          {tasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              statuses={allStatuses}
              onStatusChange={onStatusChange}
              canEdit={canEdit}
              listId={listId}
            />
          ))}

          {/* Inline add-task row */}
          {canEdit && addTitle !== null ? (
            <div className="lv-add">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
              <input
                autoFocus
                value={addTitle}
                placeholder="Task title, Enter to add · Esc to cancel"
                onChange={(e) => setAddTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const val = addTitle.trim();
                    if (val) {
                      createTask.mutate(
                        { title: val, status: status.category, list_id: listId },
                        { onSuccess: () => setAddTitle('') }
                      );
                    } else setAddTitle(null);
                  } else if (e.key === 'Escape') {
                    e.stopPropagation();
                    setAddTitle(null);
                  }
                }}
                onBlur={() => {
                  const val = addTitle.trim();
                  if (val) {
                    createTask.mutate(
                      { title: val, status: status.category, list_id: listId },
                      { onSuccess: () => setAddTitle(null) }
                    );
                  } else setAddTitle(null);
                }}
              />
            </div>
          ) : canEdit && !isCollapsed ? (
            <div className="lv-add" onClick={() => setAddTitle('')}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
              <span>Add task</span>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
