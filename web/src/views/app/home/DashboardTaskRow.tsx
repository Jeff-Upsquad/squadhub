import { useState } from 'react';
import type { Task } from '@squadhub/shared';
import { usePMStore } from '../../../stores/pmStore';
import { useUpdateTask } from '../../../hooks/useTasks';
import { useIsMobile } from '../../../hooks/useIsMobile';

function hashHue(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) h = (h * 31 + input.charCodeAt(i)) | 0;
  return Math.abs(h) % 360;
}

function avatarColor(seed: string | undefined | null): string {
  if (!seed) return 'oklch(0.6 0.1 260)';
  return `oklch(0.6 0.12 ${hashHue(seed)})`;
}

function initialOf(name: string | undefined | null): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() || '').join('') || '?';
}

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return 'No due date';
  const d = new Date(iso);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const that = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const delta = Math.round((that - today) / 86_400_000);
  const hasTime = !(d.getHours() === 0 && d.getMinutes() === 0);
  const time = hasTime ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true }) : '';
  if (delta < 0) {
    const abs = Math.abs(delta);
    return abs === 1 ? 'Overdue · 1 day' : `Overdue · ${abs} days`;
  }
  if (delta === 0) return time ? `Today · ${time}` : 'Due today';
  if (delta === 1) return time ? `Tomorrow · ${time}` : 'Due tomorrow';
  if (delta < 7) return d.toLocaleDateString([], { weekday: 'long' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

const PRIORITY_LABEL: Record<string, string | null> = {
  urgent: 'Urgent',
  high: 'High',
  normal: null,
  low: null,
  none: null,
};

export default function DashboardTaskRow({ task }: { task: Task }) {
  const setActiveTask = usePMStore((s) => s.setActiveTask);
  const setPeekTask = usePMStore((s) => s.setPeekTask);
  const updateTask = useUpdateTask(null);
  const isMobile = useIsMobile();
  const [isFadingOut, setIsFadingOut] = useState(false);
  const [isHidden, setIsHidden] = useState(false);

  const isDone = ((task as any).status as string | undefined) === 'done' || ((task as any).status as string | undefined) === 'closed';
  const displayDone = isDone || isFadingOut;
  const firstAssignee = (task.assignees && task.assignees[0]) || null;
  const seed = firstAssignee?.display_name || firstAssignee?.email || task.id;
  const color = avatarColor(seed);
  const label = initialOf(firstAssignee?.display_name || firstAssignee?.email);
  const priorityLabel = PRIORITY_LABEL[task.priority as string] || null;
  const isSubtask = !!task.parent_task_id;
  const parentTitle = task.parent_task?.title || null;
  const whenText = formatWhen(task.due_date);
  const isOverdue = whenText.startsWith('Overdue');
  const taskPath = [task.space?.name, task.folder?.name, task.list?.name].filter(Boolean).join(' › ');

  const onOpen = () => {
    if (isMobile) {
      setActiveTask(task.id);
      return;
    }
    setPeekTask(task.id);
  };

  const onToggleDone = (e: React.MouseEvent) => {
    e.stopPropagation();
    const next = isDone ? 'todo' : 'done';
    if (!isDone) setIsFadingOut(true);
    updateTask.mutate(
      { id: task.id, status: next } as any,
      { onError: () => { setIsFadingOut(false); setIsHidden(false); } },
    );
  };

  const onRowTransitionEnd = (e: React.TransitionEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.propertyName === 'transform' && isFadingOut) setIsHidden(true);
  };

  if (isHidden) return null;

  return (
    <div
      className="hmp-task"
      data-done={displayDone}
      data-fading={isFadingOut}
      data-subtask={isSubtask || undefined}
      onClick={onOpen}
      onTransitionEnd={onRowTransitionEnd}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
      style={isSubtask ? { paddingLeft: 24 } : undefined}
    >
      <div
        className="checkbox"
        data-done={displayDone}
        data-celebrating={isFadingOut}
        role="button"
        aria-label={isDone ? 'Mark incomplete' : 'Mark complete'}
        onClick={onToggleDone}
      />
      <div className="body">
        <div className="title">
          {isSubtask && <span style={{ color: 'var(--sh-ink-4)', marginRight: 4 }}>↳</span>}
          {task.title}
        </div>
        <div className="meta">
          {isSubtask && parentTitle && <span>From: {parentTitle}</span>}
          <span className="when" data-overdue={isOverdue || undefined}>{whenText}</span>
          {priorityLabel && (
            <span className="pri" data-urgent={task.priority === 'urgent' || undefined}>{priorityLabel}</span>
          )}
          {taskPath && <span className="path" title={taskPath}>{taskPath}</span>}
        </div>
      </div>
      <div className="hm-ava" style={{ background: color }} title={firstAssignee?.display_name || firstAssignee?.email || 'Unassigned'}>
        {label}
      </div>
      <svg className="open-ind" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="m9 18 6-6-6-6" />
      </svg>
    </div>
  );
}
