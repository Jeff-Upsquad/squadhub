import { useMemo, useState } from 'react';
import type { SpaceStatus, Task } from '@squadhub/shared';
import { useTasks, useUpdateTask, useCreateTask, groupTasksByStatus } from '../../../hooks/useTasks';
import { usePMStore } from '../../../stores/pmStore';
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
      className="mb-2.5 cursor-pointer rounded-lg border border-[#E2E8F0] bg-white p-3 transition hover:border-[#CAD5E2] hover:shadow-sm"
    >
      {/* Top row: tags, priority flag, task progress */}
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
          <span className="ml-auto flex items-center gap-1 text-[10px] text-[#999999]">
            <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            Task {completedSubtasks}/{subtasks.length}
          </span>
        )}
      </div>

      {/* Title */}
      <p className="mb-1.5 text-sm font-medium text-[#0F172B]">{task.title}</p>

      {/* Project sub-line */}
      {listName && (
        <div className="mb-2.5 flex items-center gap-1 text-xs text-[#999999]">
          <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
          </svg>
          {listName} Project
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
                className="flex h-6 w-6 items-center justify-center rounded-full bg-[#E2E8F0] text-[10px] font-medium text-[#0F172B] ring-1.5 ring-white"
                title={u.display_name || u.email}
              >
                {(u.display_name || u.email)?.[0]?.toUpperCase()}
              </div>
            ))}
          </div>
        )}

        {/* Due date */}
        {due && (
          <div className="flex items-center gap-1 text-[11px] text-[#666666]">
            <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            {due}
          </div>
        )}

        {/* Attachment count */}
        {attachmentCount > 0 && (
          <div className="flex items-center gap-1 text-[11px] text-[#666666]">
            <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
            </svg>
            {attachmentCount}
          </div>
        )}

        {/* Comment count */}
        {commentCount > 0 && (
          <div className="flex items-center gap-1 text-[11px] text-[#666666]">
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
}: {
  status: SpaceStatus;
  tasks: Task[];
  allStatuses: SpaceStatus[];
  listId: string;
  listName: string;
  onDrop: (taskId: string, statusId: string) => void;
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
    if (taskId) onDrop(taskId, status.category);
  };

  const handleAdd = () => {
    if (!title.trim()) { setAddingTask(false); return; }
    createTask.mutate(
      { title: title.trim(), status: status.category },
      { onSuccess: () => { setTitle(''); } },
    );
  };

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`flex w-72 shrink-0 flex-col rounded-lg transition-colors ${
        isDragOver ? 'bg-[#E8F0FE] ring-2 ring-[#2962FF]/30' : 'bg-[#F8FAFC]'
      }`}
    >
      {/* Column header */}
      <div className="flex items-center gap-2 px-3 py-3">
        <span
          className="h-2.5 w-2.5 rounded-full"
          style={{ backgroundColor: status.color }}
        />
        <span className="text-sm font-semibold text-[#0F172B]">
          {status.name}
        </span>
        <span className="text-xs text-[#999999]">{tasks.length}</span>

        <div className="flex-1" />

        {/* Ellipsis */}
        <button className="rounded p-0.5 text-[#CAD5E2] hover:bg-[#E2E8F0] hover:text-[#999999]">
          <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
            <circle cx="5" cy="12" r="1.5" />
            <circle cx="12" cy="12" r="1.5" />
            <circle cx="19" cy="12" r="1.5" />
          </svg>
        </button>

        {/* Plus */}
        <button
          onClick={() => setAddingTask(true)}
          className="rounded p-0.5 text-[#CAD5E2] hover:bg-[#E2E8F0] hover:text-[#999999]"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        </button>
      </div>

      {/* Cards */}
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {tasks.map((task) => (
          <div
            key={task.id}
            draggable
            onDragStart={(e) => e.dataTransfer.setData('text/plain', task.id)}
          >
            <TaskCard task={task} statuses={allStatuses} listName={listName} />
          </div>
        ))}

        {/* Quick add */}
        {addingTask ? (
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
              className="w-full rounded-lg border border-[#CAD5E2] bg-white px-3 py-2 text-sm text-[#0F172B] placeholder-[#999999] outline-none focus:border-[#2962FF] focus:ring-1 focus:ring-[#2962FF]"
            />
          </div>
        ) : (
          <button
            onClick={() => setAddingTask(true)}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-[#999999] transition hover:bg-white/60 hover:text-[#0F172B]"
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add task
          </button>
        )}
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
}: {
  listId: string;
  statuses: SpaceStatus[];
  filters?: { status?: string; priority?: string; sort?: string };
  listName?: string;
  searchQuery?: string;
}) {
  const { data: tasks, isLoading } = useTasks(listId, filters);
  const updateTask = useUpdateTask(listId);

  const groups = useMemo(() => {
    const allTasks = (tasks || []).filter(
      (t) => !searchQuery || t.title.toLowerCase().includes(searchQuery.toLowerCase()),
    );
    return groupTasksByStatus(allTasks, statuses);
  }, [tasks, statuses, searchQuery]);

  const handleDrop = (taskId: string, statusId: string) => {
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
    <div className="flex flex-1 gap-3 overflow-x-auto p-4">
      {groups.map(({ status, tasks: groupTasks }) => (
        <BoardColumn
          key={status.id}
          status={status}
          tasks={groupTasks}
          allStatuses={statuses}
          listId={listId}
          listName={listName}
          onDrop={handleDrop}
        />
      ))}
    </div>
  );
}
