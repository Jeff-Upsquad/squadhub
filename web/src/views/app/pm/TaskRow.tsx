import { useState } from 'react';
import type { Task, SpaceStatus } from '@squadhub/shared';
import { usePMStore } from '../../../stores/pmStore';
import TaskPriorityBadge from './TaskPriorityBadge';

function formatDateFull(dateStr: string | null | undefined) {
  if (!dateStr) return null;
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function TaskRow({
  task,
  statuses,
  onStatusChange,
  depth = 0,
  canEdit = true,
}: {
  task: Task;
  statuses: SpaceStatus[];
  onStatusChange: (taskId: string, statusId: string) => void;
  depth?: number;
  canEdit?: boolean;
}) {
  const { activeTaskId, setActiveTask, selectedTasks, toggleTaskSelection } = usePMStore();
  const [expanded, setExpanded] = useState(false);
  const hasSubtasks = task.subtasks && task.subtasks.length > 0;
  const isActive = activeTaskId === task.id;
  const isSelected = selectedTasks.includes(task.id);

  return (
    <>
      <div
        draggable={canEdit}
        onDragStart={canEdit ? (e) => {
          e.dataTransfer.setData('text/plain', task.id);
          e.dataTransfer.effectAllowed = 'move';
        } : undefined}
        onClick={() => setActiveTask(task.id)}
        className={`group flex cursor-pointer items-center border-b border-[#E2E8F0]/50 px-4 py-2.5 transition hover:bg-[#F8FAFC] ${
          isActive ? 'bg-[#F1F5F9]' : ''
        } ${isSelected ? 'bg-[#EEF2FF]' : ''}`}
        style={{ paddingLeft: `${16 + depth * 24}px` }}
      >
        {/* Checkbox */}
        <div className="w-8 shrink-0 flex items-center justify-center">
          {canEdit && (
            <input
              type="checkbox"
              checked={isSelected}
              onChange={(e) => { e.stopPropagation(); toggleTaskSelection(task.id); }}
              onClick={(e) => e.stopPropagation()}
              className="h-3.5 w-3.5 rounded border-[#CAD5E2] text-[#2962FF] focus:ring-[#2962FF] cursor-pointer"
            />
          )}
        </div>

        {/* Name task column */}
        <div className="flex min-w-[120px] flex-1 items-center gap-2">
          {/* Expand arrow for subtasks */}
          {hasSubtasks ? (
            <button
              onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
              className="shrink-0 rounded p-0.5 text-[#999999] hover:bg-[#E2E8F0] hover:text-[#0F172B]"
            >
              <svg
                className={`h-3 w-3 transition-transform ${expanded ? 'rotate-90' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          ) : (
            <span className="w-4 shrink-0" />
          )}

          {/* Title */}
          <span className="min-w-0 truncate text-sm text-[#0F172B]">{task.title}</span>
        </div>

        {/* Assignee (avatar + name) */}
        <div className="flex w-36 shrink-0 items-center gap-2 px-2">
          {task.assignees && task.assignees.length > 0 ? (
            <>
              <div
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#E2E8F0] text-[10px] font-medium text-[#0F172B] ring-1 ring-white"
                title={task.assignees[0].display_name || task.assignees[0].email}
              >
                {(task.assignees[0].display_name || task.assignees[0].email)?.[0]?.toUpperCase()}
              </div>
              <span className="min-w-0 truncate text-xs text-[#0F172B]">
                {task.assignees[0].display_name || task.assignees[0].email}
              </span>
            </>
          ) : (
            <span className="text-xs text-[#CAD5E2]">&mdash;</span>
          )}
        </div>

        {/* Start date */}
        <div className="flex w-28 shrink-0 items-center justify-center">
          <span className="text-xs text-[#666666]">
            {formatDateFull((task as any).start_date) || <span className="text-[#CAD5E2]">&mdash;</span>}
          </span>
        </div>

        {/* Due date */}
        <div className="flex w-28 shrink-0 items-center justify-center">
          <span className="text-xs text-[#666666]">
            {formatDateFull(task.due_date) || <span className="text-[#CAD5E2]">&mdash;</span>}
          </span>
        </div>

        {/* People (avatar stack) */}
        <div className="flex w-24 shrink-0 items-center justify-center">
          {task.assignees && task.assignees.length > 0 ? (
            <div className="flex -space-x-1.5">
              {task.assignees.slice(0, 4).map((u: any) => (
                <div
                  key={u.id}
                  className="flex h-6 w-6 items-center justify-center rounded-full bg-[#E2E8F0] text-[10px] font-medium text-[#0F172B] ring-1 ring-white"
                  title={u.display_name || u.email}
                >
                  {(u.display_name || u.email)?.[0]?.toUpperCase()}
                </div>
              ))}
            </div>
          ) : (
            <span className="text-xs text-[#CAD5E2]">&mdash;</span>
          )}
        </div>

        {/* Priority (flag) */}
        <div className="flex w-28 shrink-0 items-center justify-center">
          <TaskPriorityBadge priority={task.priority} variant="flag" />
        </div>
      </div>

      {/* Expanded subtasks */}
      {expanded && hasSubtasks && task.subtasks!.map((sub) => (
        <TaskRow
          key={sub.id}
          task={sub}
          statuses={statuses}
          onStatusChange={onStatusChange}
          depth={depth + 1}
          canEdit={canEdit}
        />
      ))}
    </>
  );
}
