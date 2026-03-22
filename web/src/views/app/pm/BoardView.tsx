import { useMemo, useState } from 'react';
import type { SpaceStatus, Task } from '@squadhub/shared';
import { useTasks, useUpdateTask, useCreateTask, groupTasksByStatus } from '../../../hooks/useTasks';
import { usePMStore } from '../../../stores/pmStore';
import TaskPriorityBadge from './TaskPriorityBadge';

function formatDate(dateStr: string | null | undefined) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  const now = new Date();
  const diff = d.getTime() - now.getTime();
  const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
  const formatted = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  if (days < 0) return { text: formatted, color: 'text-red-500' };
  if (days <= 1) return { text: days === 0 ? 'Today' : 'Tomorrow', color: 'text-yellow-600' };
  return { text: formatted, color: 'text-[#666666]' };
}

// ---- Task card ----
function TaskCard({ task, statuses }: { task: Task; statuses: SpaceStatus[] }) {
  const { setActiveTask } = usePMStore();
  const due = formatDate(task.due_date);

  return (
    <div
      onClick={() => setActiveTask(task.id)}
      className="mb-2 cursor-pointer rounded-lg border border-[#E2E8F0] bg-[#F1F5F9] p-3 transition hover:border-[#CAD5E2] hover:bg-[#F8FAFC]/60"
    >
      <p className="mb-2 text-sm text-[#0F172B]">{task.title}</p>
      <div className="flex flex-wrap items-center gap-2">
        <TaskPriorityBadge priority={task.priority} />
        {due && <span className={`text-xs ${due.color}`}>{due.text}</span>}
        {task.assignees && task.assignees.length > 0 && (
          <div className="ml-auto flex -space-x-1">
            {task.assignees.slice(0, 3).map((u: any) => (
              <div
                key={u.id}
                className="flex h-5 w-5 items-center justify-center rounded-full bg-[#E2E8F0] text-[10px] font-medium text-[#0F172B] ring-1 ring-white"
                title={u.display_name || u.email}
              >
                {(u.display_name || u.email)?.[0]?.toUpperCase()}
              </div>
            ))}
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
  onDrop,
}: {
  status: SpaceStatus;
  tasks: Task[];
  allStatuses: SpaceStatus[];
  listId: string;
  onDrop: (taskId: string, statusId: string) => void;
}) {
  const [addingTask, setAddingTask] = useState(false);
  const [title, setTitle] = useState('');
  const createTask = useCreateTask(listId);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const taskId = e.dataTransfer.getData('text/plain');
    if (taskId) onDrop(taskId, status.id);
  };

  const handleAdd = () => {
    if (!title.trim()) { setAddingTask(false); return; }
    createTask.mutate(
      { title: title.trim(), status_id: status.id },
      { onSuccess: () => { setTitle(''); } },
    );
  };

  return (
    <div
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className="flex w-72 shrink-0 flex-col rounded-lg bg-[#F1F5F9]/60"
    >
      {/* Column header */}
      <div className="flex items-center gap-2 px-3 py-3">
        <span
          className="h-2.5 w-2.5 rounded-full"
          style={{ backgroundColor: status.color }}
        />
        <span className="text-xs font-semibold uppercase tracking-[0.12em] text-[#666666] font-[family-name:var(--font-mono)]">
          {status.name}
        </span>
        <span className="text-xs text-[#999999]">{tasks.length}</span>
      </div>

      {/* Cards */}
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {tasks.map((task) => (
          <div
            key={task.id}
            draggable
            onDragStart={(e) => e.dataTransfer.setData('text/plain', task.id)}
          >
            <TaskCard task={task} statuses={allStatuses} />
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
              className="w-full rounded-lg border border-[#CAD5E2] bg-[#F8FAFC] px-3 py-2 text-sm text-[#0F172B] placeholder-[#999999] outline-none focus:border-[#2962FF] focus:ring-1 focus:ring-[#2962FF]"
            />
          </div>
        ) : (
          <button
            onClick={() => setAddingTask(true)}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-[#999999] transition hover:bg-[#F8FAFC]/50 hover:text-[#0F172B]"
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

  const handleDrop = (taskId: string, statusId: string) => {
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
    <div className="flex flex-1 gap-3 overflow-x-auto p-4">
      {groups.map(({ status, tasks: groupTasks }) => (
        <BoardColumn
          key={status.id}
          status={status}
          tasks={groupTasks}
          allStatuses={statuses}
          listId={listId}
          onDrop={handleDrop}
        />
      ))}
    </div>
  );
}
