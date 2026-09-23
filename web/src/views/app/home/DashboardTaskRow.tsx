import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Task } from '@squadhub/shared';
import { usePMStore } from '../../../stores/pmStore';
import { useAuthStore } from '../../../stores/authStore';
import { useUpdateTask } from '../../../hooks/useTasks';
import { useCompletionGate } from '../../../hooks/useCompletionGate';
import { useParallelTimers } from '../../../hooks/useParallelTimers';
import { computeSnoozeTargets } from '../../../hooks/useDayPlanner';
import { useIsMobile } from '../../../hooks/useIsMobile';
import { formatTaskDates } from '../pm/taskHelpers';
import AssigneePicker from '../pm/AssigneePicker';
import IncompleteItemsDialog from '../pm/IncompleteItemsDialog';
import NoAssigneeCompleteDialog from '../pm/NoAssigneeCompleteDialog';

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

  const isDone = ((task as any).status as string | undefined) === 'done' || ((task as any).status as string | undefined) === 'closed' || ((task as any).status as string | undefined) === 'cancelled';
  const displayDone = isDone || isFadingOut;
  const firstAssignee = (task.assignees && task.assignees[0]) || null;
  const seed = firstAssignee?.display_name || firstAssignee?.email || task.id;
  const color = avatarColor(seed);
  const label = initialOf(firstAssignee?.display_name || firstAssignee?.email);
  const priorityLabel = PRIORITY_LABEL[task.priority as string] || null;
  const isSubtask = !!task.parent_task_id;
  const parentTitle = task.parent_task?.title || null;
  // Show work and due dates with explicit labels so a work date is never
  // misread as a due date. Both are shown when both exist.
  const dateDisplay = formatTaskDates(task);
  const whenText = dateDisplay.text;
  const isOverdue = dateDisplay.overdue;
  const taskPath = [task.space?.name, task.folder?.name, task.list?.name].filter(Boolean).join(' › ');

  const onOpen = () => {
    if (isMobile) {
      setActiveTask(task.id);
      return;
    }
    setPeekTask(task.id);
  };

  // Completion writes go through the shared gate so checking off here runs
  // the same subtask/checklist + no-assignee prompts as the list view.
  const completeTask = useCallback((taskId: string, assigneeIds?: string[]) => {
    setIsFadingOut(true);
    const payload: Record<string, unknown> = { id: taskId, status: 'done' };
    if (assigneeIds) {
      payload.assignee_ids = assigneeIds;
      if (task.list_id) payload.list_id = task.list_id;
    }
    updateTask.mutate(
      payload as any,
      { onError: () => { setIsFadingOut(false); setIsHidden(false); } },
    );
  }, [task.id, task.list_id, updateTask]);
  const gate = useCompletionGate({ onComplete: completeTask });
  const currentUser = useAuthStore((s) => s.user);

  const onToggleDone = (e: React.MouseEvent) => {
    e.stopPropagation();
    // Re-opening a completed task: flip straight back, no prompt.
    if (isDone) {
      updateTask.mutate({ id: task.id, status: 'todo' } as any);
      return;
    }
    void gate.requestComplete(task, e);
  };

  const onRowTransitionEnd = (e: React.TransitionEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.propertyName === 'transform' && isFadingOut) setIsHidden(true);
  };

  if (isHidden) return null;

  return (
    <>
      <DashboardTaskRowInner
        task={task}
        isDone={isDone}
        displayDone={displayDone}
        firstAssignee={firstAssignee}
        color={color}
        label={label}
        priorityLabel={priorityLabel}
        isSubtask={isSubtask}
        parentTitle={parentTitle}
        whenText={whenText}
        isOverdue={isOverdue}
        taskPath={taskPath}
        onOpen={onOpen}
        onToggleDone={onToggleDone}
        onRowTransitionEnd={onRowTransitionEnd}
        isFadingOut={isFadingOut}
      />
      {gate.incomplete && (
        <IncompleteItemsDialog
          anchorRect={gate.incomplete.rect}
          openSubtasks={gate.incomplete.subtasks}
          openChecklistItems={gate.incomplete.checklist}
          onViewTask={() => { gate.closeIncomplete(); onOpen(); }}
          onClose={gate.closeIncomplete}
        />
      )}
      {gate.noAssignee && (
        <NoAssigneeCompleteDialog
          anchorRect={gate.noAssignee.rect}
          canAssignToMe={!!currentUser?.id}
          onAssignToMe={() => gate.assignToMe(task.id, currentUser?.id)}
          onAssignOther={gate.moveToAssignOther}
          onCompleteAnyway={() => gate.completeAnyway(task.id)}
          onClose={gate.closeNoAssignee}
        />
      )}
      {gate.assignAnchor && (
        <AssigneePicker
          taskId={task.id}
          currentAssigneeIds={[]}
          anchorRect={gate.assignAnchor.rect}
          onChange={(ids) => gate.completeWithAssignees(task.id, ids)}
          onClose={gate.closeAssign}
        />
      )}
    </>
  );
}

function DashboardTaskRowInner({
  task,
  isDone,
  displayDone,
  firstAssignee,
  color,
  label,
  priorityLabel,
  isSubtask,
  parentTitle,
  whenText,
  isOverdue,
  taskPath,
  onOpen,
  onToggleDone,
  onRowTransitionEnd,
  isFadingOut,
}: {
  task: Task;
  isDone: boolean;
  displayDone: boolean;
  firstAssignee: { display_name?: string; email?: string } | null;
  color: string;
  label: string;
  priorityLabel: string | null;
  isSubtask: boolean;
  parentTitle: string | null;
  whenText: string;
  isOverdue: boolean;
  taskPath: string;
  onOpen: () => void;
  onToggleDone: (e: React.MouseEvent) => void;
  onRowTransitionEnd: (e: React.TransitionEvent<HTMLDivElement>) => void;
  isFadingOut: boolean;
}) {
  const updateTask = useUpdateTask(null);
  const { timers, requestStartTimer, stopTimer } = useParallelTimers();
  const isTracking = timers.some((x) => x.taskId === task.id);
  const [menuPos, setMenuPos] = useState<{ left: number; top: number } | null>(null);
  const moveRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // Tomorrow / This Saturday / Next Monday at local midnight — shared with the
  // Focus list rows so every surface moves dates identically.
  const targets = useMemo(() => computeSnoozeTargets(), []);

  const onTimerClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isTracking) {
      await stopTimer(task.id);
      return;
    }
    await requestStartTimer({ taskId: task.id, taskTitle: task.title, listId: task.list_id || '', baseTracked: task.time_tracked || 0 });
  };

  const openMenu = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (menuPos) { setMenuPos(null); return; }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const MENU_W = 210;
    const MENU_H = 150;
    const MARGIN = 6;
    const flipUp = rect.bottom + MARGIN + MENU_H > window.innerHeight;
    setMenuPos({
      left: Math.max(8, rect.right - MENU_W),
      top: flipUp ? rect.top - MENU_H - MARGIN : rect.bottom + MARGIN,
    });
  };

  useEffect(() => {
    if (!menuPos) return;
    const onDown = (e: MouseEvent) => {
      const tgt = e.target as Node;
      if (moveRef.current?.contains(tgt) || menuRef.current?.contains(tgt)) return;
      setMenuPos(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuPos(null); };
    const onScroll = () => setMenuPos(null);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [menuPos]);

  const moveWorkDate = (e: React.MouseEvent, iso: string) => {
    e.stopPropagation();
    setMenuPos(null);
    updateTask.mutate({ id: task.id, work_date: iso } as any);
  };

  return (
    <>
    <div
      className="hmp-task"
      data-done={displayDone}
      data-fading={isFadingOut}
      data-subtask={isSubtask || undefined}
      data-tracking={isTracking || undefined}
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
      <button
        type="button"
        className="hmp-timer-btn"
        data-active={isTracking || undefined}
        aria-label={isTracking ? 'Stop timer' : 'Start timer'}
        title={isTracking ? 'Stop timer' : 'Start timer'}
        onClick={onTimerClick}
      >
        {isTracking ? (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <rect x="6" y="6" width="12" height="12" rx="2" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="9.5" y1="2.5" x2="14.5" y2="2.5" />
            <line x1="12" y1="2.5" x2="12" y2="5" />
            <circle cx="12" cy="14" r="7.5" />
            <line x1="12" y1="14" x2="14.5" y2="11.5" />
          </svg>
        )}
      </button>
      <div className="hmp-move" ref={moveRef}>
        <button
          type="button"
          className="hmp-move-btn"
          data-open={menuPos ? true : undefined}
          aria-label="Move work date"
          aria-haspopup="menu"
          aria-expanded={!!menuPos}
          title="Move work date"
          onClick={openMenu}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m9 18 6-6-6-6" />
          </svg>
        </button>
      </div>
      <div className="hm-ava" style={{ background: color }} title={firstAssignee?.display_name || firstAssignee?.email || 'Unassigned'}>
        {label}
      </div>
      <svg className="open-ind" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="m9 18 6-6-6-6" />
      </svg>
    </div>
    {menuPos && createPortal(
      <div
        ref={menuRef}
        className="hm-bucket-menu"
        role="menu"
        style={{ left: menuPos.left, top: menuPos.top }}
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" role="menuitem" className="hm-bucket-menu-item" onClick={(e) => moveWorkDate(e, targets.tomorrow.iso)}>
          <span>To tomorrow</span>
          <span className="dim">{targets.tomorrow.date}</span>
        </button>
        <button type="button" role="menuitem" className="hm-bucket-menu-item" onClick={(e) => moveWorkDate(e, targets.saturday.iso)}>
          <span>This weekend</span>
          <span className="dim">{targets.saturday.date}</span>
        </button>
        <button type="button" role="menuitem" className="hm-bucket-menu-item" onClick={(e) => moveWorkDate(e, targets.nextMonday.iso)}>
          <span>Next week</span>
          <span className="dim">{targets.nextMonday.date}</span>
        </button>
      </div>,
      document.body,
    )}
    </>
  );
}
