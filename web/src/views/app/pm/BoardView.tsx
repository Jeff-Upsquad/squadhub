import { useMemo, useState } from 'react';
import type { SpaceStatus, Task } from '@squadhub/shared';
import { useTasks, useUpdateTask, useCreateTask, groupTasksByStatus } from '../../../hooks/useTasks';
import { usePMStore } from '../../../stores/pmStore';
import { filterTasks, EMPTY_FILTER, type TaskFilterState } from '../../../lib/filters';
import TaskPriorityBadge from './TaskPriorityBadge';

function formatDate(dateStr: string | null | undefined) {
  if (!dateStr) return null;
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ---- Task card ----
function TaskCard({ task, statuses, listName }: { task: Task; statuses: SpaceStatus[]; listName: string }) {
  const { setActiveTask } = usePMStore();
  const tags = (task as any).tags || [];
  const subtasks = task.subtasks || [];
  const completedSubtasks = subtasks.filter((s: any) => s.status === 'done' || (s as any).category === 'done').length;
  const due = formatDate(task.due_date);
  const commentCount = task.comment_count || 0;
  const attachmentCount = (task as any).attachment_count || 0;

  return (
    <div
      onClick={() => setActiveTask(task.id)}
      className="bv-card"
    >
      {/* Top row: tags, priority flag, task progress */}
      {(tags.length > 0 || task.priority !== 'none' || subtasks.length > 0) && (
        <div className="mb-2 flex items-center gap-1.5">
          {tags.map((tag: any) => (
            <span
              key={tag.id || tag.name}
              className="rounded px-1.5 py-0.5 text-[10px] font-medium"
              style={{
                backgroundColor: `${tag.color || '#f97316'}20`,
                color: tag.color || '#f97316',
              }}
            >
              {tag.name}
            </span>
          ))}
          <TaskPriorityBadge priority={task.priority} variant="flag" />
          {subtasks.length > 0 && (
            <span className="ml-auto flex items-center gap-1 text-[10px] text-[color:var(--sh-ink-4)]">
              <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              {completedSubtasks}/{subtasks.length}
            </span>
          )}
        </div>
      )}

      {/* Title */}
      <p className="bv-card-title mb-1.5">{task.title}</p>

      {/* Project sub-line */}
      {listName && (
        <div className="mb-2.5 flex items-center gap-1 text-xs text-[color:var(--sh-ink-4)]">
          <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
          </svg>
          {listName}
        </div>
      )}

      {/* Bottom metadata row */}
      <div className="flex items-center gap-3">
        {/* Avatar stack */}
        {task.assignees && task.assignees.length > 0 && (
          <div className="flex -space-x-1">
            {task.assignees.slice(0, 3).map((u: any) => (
              <div
                key={u.id}
                className="flex h-6 w-6 items-center justify-center rounded-full bg-[color:var(--sh-hair-3)] text-[10px] font-medium text-[color:var(--sh-ink)] ring-1.5 ring-[color:var(--surface)]"
                title={u.display_name || u.email}
              >
                {(u.display_name || u.email)?.[0]?.toUpperCase()}
              </div>
            ))}
          </div>
        )}

        {/* Due date */}
        {due && (
          <div className="flex items-center gap-1 text-[11px] text-[color:var(--sh-ink-3)]">
            <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            {due}
          </div>
        )}

        {/* Attachment count */}
        {attachmentCount > 0 && (
          <div className="flex items-center gap-1 text-[11px] text-[color:var(--sh-ink-3)]">
            <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
            </svg>
            {attachmentCount}
          </div>
        )}

        {/* Comment count */}
        {commentCount > 0 && (
          <div className="flex items-center gap-1 text-[11px] text-[color:var(--sh-ink-3)]">
            <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            {commentCount}
          </div>
        )}
      </div>
    </div>
  );
}

// ---- Board column ----
function BoardColumn({
  status,
  tasks,
  allStatuses,
  listId,
  listName,
  onDrop,
  canEdit = true,
}: {
  status: SpaceStatus;
  tasks: Task[];
  allStatuses: SpaceStatus[];
  listId: string;
  listName: string;
  onDrop: (taskId: string, statusId: string) => void;
  canEdit?: boolean;
}) {
  const [addingTask, setAddingTask] = useState(false);
  const [title, setTitle] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);
  const createTask = useCreateTask(listId);

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
    if (taskId) onDrop(taskId, status.name);
  };

  const handleAdd = () => {
    if (!title.trim()) { setAddingTask(false); return; }
    createTask.mutate(
      { title: title.trim(), status: status.name },
      { onSuccess: () => { setTitle(''); } },
    );
  };

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className="bv-column"
      data-dragover={isDragOver}
    >
      {/* Column header — Instrument Serif title to match list group-head */}
      <div className="bv-column-head">
        <span className="dot" style={{ backgroundColor: status.color }} />
        <span className="title">{status.name}</span>
        <span className="count">· {tasks.length}</span>

        {canEdit && (
          <button
            type="button"
            onClick={() => setAddingTask(true)}
            className="col-action"
            aria-label="Add task to column"
            title="Add task"
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </button>
        )}
      </div>

      {/* Cards */}
      <div className="bv-cards">
        {tasks.map((task) => (
          <div
            key={task.id}
            draggable={canEdit}
            onDragStart={canEdit ? (e) => e.dataTransfer.setData('text/plain', task.id) : undefined}
          >
            <TaskCard task={task} statuses={allStatuses} listName={listName} />
          </div>
        ))}

        {/* Quick add */}
        {canEdit && (addingTask ? (
          <div className="mb-2">
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAdd();
                if (e.key === 'Escape') { setAddingTask(false); setTitle(''); }
              }}
              onBlur={handleAdd}
              placeholder="Task name..."
              className="w-full rounded-lg border border-[color:var(--sh-hair)] bg-[color:var(--surface)] px-3 py-2 text-sm text-[color:var(--sh-ink)] placeholder-[color:var(--sh-ink-4)] outline-none focus:border-[color:var(--sh-accent)] focus:ring-2 focus:ring-[color:var(--sh-accent-soft)]"
            />
          </div>
        ) : (
          <button
            onClick={() => setAddingTask(true)}
            className="bv-add-btn"
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add task
          </button>
        ))}
      </div>
    </div>
  );
}

// ---- Main BoardView ----
export default function BoardView({
  listId,
  statuses,
  filters,
  listName = '',
  searchQuery = '',
  canEdit = true,
}: {
  listId: string;
  statuses: SpaceStatus[];
  filters?: TaskFilterState;
  listName?: string;
  searchQuery?: string;
  canEdit?: boolean;
}) {
  const { data: tasks, isLoading } = useTasks(listId, undefined);
  const updateTask = useUpdateTask(listId);
  const fadingTaskIds = usePMStore((s) => s.fadingTaskIds);
  const tz = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);

  const groups = useMemo(() => {
    let arr = filterTasks(tasks ?? [], filters ?? EMPTY_FILTER, tz);
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      arr = arr.filter((t) => t.title.toLowerCase().includes(q));
    }
    return groupTasksByStatus(arr, statuses, fadingTaskIds);
  }, [tasks, statuses, searchQuery, filters, tz, fadingTaskIds]);

  const handleDrop = (taskId: string, statusId: string) => {
    if (!canEdit) return;
    updateTask.mutate({ id: taskId, status: statusId });
  };

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-[color:var(--sh-ink-3)]">Loading tasks...</p>
      </div>
    );
  }

  return (
    <div className="lv-canvas relative flex flex-1 overflow-hidden">
      <div className="bv-board">
        {groups.map(({ status, tasks: groupTasks }) => (
          <BoardColumn
            key={status.id}
            status={status}
            tasks={groupTasks}
            allStatuses={statuses}
            listId={listId}
            listName={listName}
            onDrop={handleDrop}
            canEdit={canEdit}
          />
        ))}
      </div>
    </div>
  );
}
