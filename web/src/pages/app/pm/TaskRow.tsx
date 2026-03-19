import type { Task, SpaceStatus } from '@squadhub/shared';
import { usePMStore } from '../../../stores/pmStore';
import TaskPriorityBadge from './TaskPriorityBadge';

function formatDate(dateStr: string | null | undefined) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  const now = new Date();
  const diff = d.getTime() - now.getTime();
  const days = Math.ceil(diff / (1000 * 60 * 60 * 24));

  const formatted = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  if (days < 0) return { text: formatted, color: 'text-red-400' };
  if (days === 0) return { text: 'Today', color: 'text-yellow-400' };
  if (days === 1) return { text: 'Tomorrow', color: 'text-yellow-400' };
  return { text: formatted, color: 'text-[#888]' };
}

export default function TaskRow({
  task,
  statuses,
  onStatusChange,
}: {
  task: Task;
  statuses: SpaceStatus[];
  onStatusChange: (taskId: string, statusId: string) => void;
}) {
  const { setActiveTask } = usePMStore();
  const due = formatDate(task.due_date);

  return (
    <div
      onClick={() => setActiveTask(task.id)}
      className="group flex cursor-pointer items-center gap-3 border-b border-[#222]/50 px-4 py-2 transition hover:bg-[#111]/30"
    >
      {/* Status dot / dropdown */}
      <div className="relative">
        <select
          value={task.status_id}
          onChange={(e) => { e.stopPropagation(); onStatusChange(task.id, e.target.value); }}
          onClick={(e) => e.stopPropagation()}
          className="h-4 w-4 cursor-pointer appearance-none rounded-full border-0 bg-transparent text-[0px] outline-none"
          style={{
            backgroundColor: statuses.find((s) => s.id === task.status_id)?.color || '#6b7280',
          }}
          title="Change status"
        >
          {statuses.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </div>

      {/* Title */}
      <span className="min-w-0 flex-1 truncate text-sm text-[#ededed]">{task.title}</span>

      {/* Priority */}
      <TaskPriorityBadge priority={task.priority} />

      {/* Assignees */}
      {task.assignees && task.assignees.length > 0 && (
        <div className="flex -space-x-1">
          {task.assignees.slice(0, 3).map((u: any) => (
            <div
              key={u.id}
              className="flex h-5 w-5 items-center justify-center rounded-full bg-[#222] text-[10px] font-medium text-[#ededed] ring-1 ring-[#0a0a0a]"
              title={u.display_name || u.email}
            >
              {(u.display_name || u.email)?.[0]?.toUpperCase()}
            </div>
          ))}
        </div>
      )}

      {/* Due date */}
      {due && (
        <span className={`shrink-0 text-xs ${due.color}`}>{due.text}</span>
      )}
    </div>
  );
}
