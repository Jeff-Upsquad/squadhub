import { useState } from 'react';
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

  if (days < 0) return { text: formatted, color: 'text-red-500' };
  if (days === 0) return { text: 'Today', color: 'text-yellow-600' };
  if (days === 1) return { text: 'Tomorrow', color: 'text-yellow-600' };
  return { text: formatted, color: 'text-[#666666]' };
}

function formatShortDate(dateStr: string | null | undefined) {
  if (!dateStr) return null;
  return new Date(dateStr).toLocaleDateString('en-US', { day: 'numeric', month: 'numeric', year: '2-digit' });
}

export default function TaskRow({
  task,
  statuses,
  onStatusChange,
  depth = 0,
}: {
  task: Task;
  statuses: SpaceStatus[];
  onStatusChange: (taskId: string, statusId: string) => void;
  depth?: number;
}) {
  const { activeTaskId, setActiveTask } = usePMStore();
  const [expanded, setExpanded] = useState(false);
  const due = formatDate(task.due_date);
  const hasSubtasks = task.subtasks && task.subtasks.length > 0;
  const isActive = activeTaskId === task.id;

  return (
    <>
      <div
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('text/plain', task.id);
          e.dataTransfer.effectAllowed = 'move';
        }}
        onClick={() => setActiveTask(task.id)}
        className={`group flex cursor-pointer items-center border-b border-[#E2E8F0]/50 px-4 py-2 transition hover:bg-[#F8FAFC] ${
          isActive ? 'bg-[#F1F5F9]' : ''
        }`}
        style={{ paddingLeft: `${16 + depth * 24}px` }}
      >
        {/* Name column */}
        <div className="flex min-w-0 flex-1 items-center gap-2">
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

          {/* Status dot */}
          <div className="relative shrink-0">
            <select
              value={(task as any).status}
              onChange={(e) => { e.stopPropagation(); onStatusChange(task.id, e.target.value); }}
              onClick={(e) => e.stopPropagation()}
              className="h-4 w-4 cursor-pointer appearance-none rounded-full border-0 bg-transparent text-[0px] outline-none"
              style={{
                backgroundColor: statuses.find((s) => s.category === (task as any).status)?.color || '#6b7280',
              }}
              title="Change status"
            >
              {statuses.map((s) => (
                <option key={s.id} value={s.category}>{s.name}</option>
              ))}
            </select>
          </div>

          {/* Title */}
          <span className="min-w-0 truncate text-sm text-[#0F172B]">{task.title}</span>

          {/* Subtask count badge */}
          {hasSubtasks && (
            <span className="ml-1 flex items-center gap-0.5 text-[10px] text-[#999999]">
              <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.172 13.828a4 4 0 015.656 0l4-4a4 4 0 00-5.656-5.656l-1.102 1.101" />
              </svg>
              {task.subtasks!.length}
            </span>
          )}

          {/* Priority badge (inline with name) */}
          <TaskPriorityBadge priority={task.priority} />
        </div>

        {/* Assignee */}
        <div className="flex w-20 shrink-0 items-center justify-center">
          {task.assignees && task.assignees.length > 0 ? (
            <div className="flex -space-x-1">
              {task.assignees.slice(0, 2).map((u: any) => (
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
            <span className="text-[10px] text-[#CAD5E2]">—</span>
          )}
        </div>

        {/* Time tracked */}
        <div className="flex w-24 shrink-0 items-center justify-center">
          <span className="text-[11px] text-[#CAD5E2] opacity-0 group-hover:opacity-100">Add time</span>
        </div>

        {/* Start date */}
        <div className="flex w-24 shrink-0 items-center justify-center">
          <span className="text-[10px] text-[#CAD5E2]">—</span>
        </div>

        {/* Due date */}
        <div className="flex w-24 shrink-0 items-center justify-center">
          {due ? (
            <span className={`text-xs ${due.color}`}>{due.text}</span>
          ) : (
            <span className="text-[10px] text-[#CAD5E2]">—</span>
          )}
        </div>

        {/* Comments */}
        <div className="flex w-20 shrink-0 items-center justify-center gap-0.5">
          {task.comment_count ? (
            <>
              <svg className="h-3.5 w-3.5 text-[#999999]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
              <span className="text-[11px] text-[#999999]">{task.comment_count}</span>
            </>
          ) : (
            <span className="text-[10px] text-[#CAD5E2]">—</span>
          )}
        </div>

        {/* Created by */}
        <div className="flex w-20 shrink-0 items-center justify-center">
          {task.creator ? (
            <div
              className="flex h-6 w-6 items-center justify-center rounded-full bg-[#E2E8F0] text-[10px] font-medium text-[#0F172B] ring-1 ring-white"
              title={task.creator.display_name || task.creator.email}
            >
              {(task.creator.display_name || task.creator.email)?.[0]?.toUpperCase()}
            </div>
          ) : (
            <span className="text-[10px] text-[#CAD5E2]">—</span>
          )}
        </div>

        {/* Date created */}
        <div className="flex w-24 shrink-0 items-center justify-center">
          <span className="text-xs text-[#999999]">{formatShortDate(task.created_at)}</span>
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
        />
      ))}
    </>
  );
}
