import { useEffect, useRef, useState } from 'react';
import type { Task, SpaceStatus, TaskPriority } from '@squadhub/shared';
import { usePMStore } from '../../../stores/pmStore';
import { useAuthStore } from '../../../stores/authStore';
import { useUpdateTask } from '../../../hooks/useTasks';
import { useFocusTask } from '../../../hooks/useDayPlanner';
import { useTaskTypes } from '../../../hooks/useTaskTypes';
import { useActiveWorkBlockRun, useRecordWorkBlockCompletion } from '../../../hooks/useWorkBlocks';
import { useActiveGroupRun, useRecordGroupRunCompletion } from '../../../hooks/useGroupRuns';
import { isTaskFocused } from '../../../lib/taskGrouping';
import { avatarColor, initialOf, formatWhen, nextQuickDate } from './taskHelpers';
import AssigneePicker from './AssigneePicker';
import NoAssigneeCompleteDialog from './NoAssigneeCompleteDialog';
import DatePicker from './DatePicker';
import PriorityPicker, { PRIORITY_META } from './PriorityPicker';

function fmtClock(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return `${m}:${String(s).padStart(2,'0')}`;
}

export default function TaskRow({
  task,
  statuses,
  onStatusChange: _onStatusChange,
  depth = 0,
  canEdit = true,
  listId,
  dimmed = false,
}: {
  task: Task;
  statuses: SpaceStatus[];
  onStatusChange: (taskId: string, statusId: string) => void;
  depth?: number;
  canEdit?: boolean;
  listId: string;
  /** Render faded — used for focused tasks that also appear in the Focus Today banner above. */
  dimmed?: boolean;
}) {
  const { activeTaskId, setActiveTask, selectedTasks, toggleTaskSelection, fadingTaskIds, markFading, unmarkFading, timer: globalTimer } = usePMStore();
  const focusTask = useFocusTask();
  const { data: activeWB } = useActiveWorkBlockRun();
  // Per-row timer indicator: live ticking elapsed for whichever timer this row
  // owns (per-task timer OR a work-block run on this task). Updates once per
  // second only when a relevant timer is active — quiet for everyone else.
  const isPerTaskTimer = globalTimer?.taskId === task.id;
  const isWorkBlockRun = activeWB?.task.id === task.id && !activeWB?.run.ended_at;
  const isTiming = isPerTaskTimer || isWorkBlockRun;
  const [tickElapsed, setTickElapsed] = useState(0);
  useEffect(() => {
    if (!isTiming) { setTickElapsed(0); return; }
    const startMs = isPerTaskTimer
      ? (globalTimer?.startedAt ?? Date.now())
      : new Date(activeWB!.run.started_at).getTime();
    const tick = () => setTickElapsed(Math.max(0, Math.floor((Date.now() - startMs) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [isTiming, isPerTaskTimer, globalTimer?.startedAt, activeWB?.run.started_at]);
  const isFocused = isTaskFocused(task);
  const effectiveListId = listId || (task as any).list_id || task.list?.id || null;
  const updateTask = useUpdateTask(effectiveListId);
  // Task list endpoints don't hydrate the `task_type` join — only the id —
  // so resolve from the cached useTaskTypes() list to drive type-based styling.
  const { data: taskTypesList } = useTaskTypes();
  const resolvedTaskType = (task as any).task_type
    || taskTypesList?.find((t) => t.id === task.task_type_id)
    || null;
  const isWorkBlock = resolvedTaskType?.key === 'work_block';
  const [expanded, setExpanded] = useState(false);

  // Track in-flight quick-date values so rapid clicks read the most recent sent
  // value rather than the stale React Query cache. Cleared when the cache
  // updates (task.work_date / task.due_date change reference).
  const pendingDates = useRef<{ work?: string | null; due?: string | null }>({});
  useEffect(() => { pendingDates.current.work = undefined; }, [task.work_date]);
  useEffect(() => { pendingDates.current.due = undefined; }, [task.due_date]);

  // Inline picker anchors — null = closed, DOMRect = open & positioned
  const [assigneeAnchor, setAssigneeAnchor] = useState<DOMRect | null>(null);
  const [priorityAnchor, setPriorityAnchor] = useState<DOMRect | null>(null);
  const [workDateAnchor, setWorkDateAnchor] = useState<DOMRect | null>(null);
  const [dueDateAnchor, setDueDateAnchor] = useState<DOMRect | null>(null);

  // Completion-time "no assignee" prompt. Both anchored to the checkbox.
  // `noAssigneePrompt` shows the choose-what-to-do popover; `assignCompleteAnchor`
  // shows the people picker for the "assign to someone else" path.
  const [noAssigneePrompt, setNoAssigneePrompt] = useState<DOMRect | null>(null);
  const [assignCompleteAnchor, setAssignCompleteAnchor] = useState<DOMRect | null>(null);
  const currentUser = useAuthStore((s) => s.user);

  const hasSubtasks = !!(task.subtasks && task.subtasks.length > 0);
  const isActive = activeTaskId === task.id;
  const isSelected = selectedTasks.includes(task.id);

  const statusCategory = (task as any).status as string | undefined;
  const isDone = statusCategory === 'done' || statusCategory === 'closed';
  const isFading = fadingTaskIds.has(task.id);
  const displayDone = isDone || isFading;
  const priority = (task.priority || 'none') as TaskPriority;
  const priorityMeta = PRIORITY_META[priority];
  const workWhen = formatWhen(task.work_date);
  const dueWhen = formatWhen(task.due_date);
  const assignees = task.assignees || [];

  const recordCompletion = useRecordWorkBlockCompletion();
  const { data: activeGroupRun } = useActiveGroupRun();
  const recordGroupCompletion = useRecordGroupRunCompletion();

  // Mark this task done, optionally assigning people in the same write. Handles
  // the fade animation snapshot and the active work-block completion log.
  const completeTask = (assigneeIds?: string[]) => {
    // Snapshot the pre-fade status so status-grouping pipelines keep the row
    // in this bucket while the slide animation plays — see pmStore.ts and
    // groupTasksByStatus / groupByStatus for the read side.
    markFading(task.id, statusCategory ?? '');
    // If a work-block run is active for the caller (and this task isn't
    // itself the work block), log this completion against the run. Same
    // hook the detail panel uses — idempotent on the server.
    if (activeWB && activeWB.task.id !== task.id) {
      recordCompletion.mutate({ run_id: activeWB.run.id, completed_task_id: task.id });
    }
    // Same idea for an active group-run session — any task finished while the
    // group's focus session is running is auto-logged against that run.
    if (activeGroupRun?.run && !activeGroupRun.run.ended_at) {
      recordGroupCompletion.mutate({ run_id: activeGroupRun.run.id, completed_task_id: task.id });
    }
    const payload: Record<string, unknown> = { id: task.id, status: 'done' };
    if (assigneeIds) {
      payload.assignee_ids = assigneeIds;
      payload.list_id = effectiveListId || undefined;
    }
    updateTask.mutate(payload as any, { onError: () => { unmarkFading(task.id); } });
  };

  const handleGlyphClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!canEdit) return;
    // Re-opening a completed task: flip straight back to todo, no prompt.
    if (isDone) {
      updateTask.mutate({ id: task.id, status: 'todo' } as any);
      return;
    }
    // Completing a task with nobody assigned: ask first (assign to me / someone
    // else / complete as-is) instead of silently closing it unassigned.
    if (assignees.length === 0) {
      setNoAssigneePrompt((e.currentTarget as HTMLElement).getBoundingClientRect());
      return;
    }
    completeTask();
  };

  const handleRowTransitionEnd = (e: React.TransitionEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.propertyName === 'transform' && isFading) {
      unmarkFading(task.id);
    }
  };

  const openPicker = (
    e: React.MouseEvent,
    setter: (r: DOMRect | null) => void,
  ) => {
    e.stopPropagation();
    if (!canEdit) return;
    setter((e.currentTarget as HTMLElement).getBoundingClientRect());
  };

  const dueValueClass =
    dueWhen.state === 'overdue'
      ? 'lv-cell-value lv-due--overdue'
      : dueWhen.state === 'today'
        ? 'lv-cell-value lv-due--today'
        : 'lv-cell-value';

  return (
    <>
      <div
        draggable={canEdit}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setActiveTask(task.id);
          }
        }}
        onDragStart={canEdit ? (e) => {
          e.dataTransfer.setData('text/plain', task.id);
          e.dataTransfer.effectAllowed = 'move';
        } : undefined}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey) {
            toggleTaskSelection(task.id);
            return;
          }
          setActiveTask(task.id);
        }}
        onTransitionEnd={handleRowTransitionEnd}
        className="lv-row"
        data-active={isActive}
        data-selected={isSelected}
        data-done={displayDone}
        data-fading={isFading}
        data-dimmed={dimmed || undefined}
        data-type={isWorkBlock ? 'work_block' : undefined}
        style={depth > 0 ? { paddingLeft: 20 + depth * 22 } : undefined}
      >
        {/* Checkbox — toggles done */}
        <button
          type="button"
          onClick={handleGlyphClick}
          className="lv-glyph"
          data-done={displayDone}
          data-celebrating={isFading}
          data-progress={!isDone && statusCategory === 'active'}
          disabled={!canEdit}
          aria-label={isDone ? 'Mark incomplete' : 'Mark complete'}
        />

        {/* Title only — meta line (space · due · tags) removed; dedicated columns below */}
        <div className="min-w-0">
          {/* Parent task reference — shown only for subtasks rendered at the top
              level (depth 0); nested subtask rows already sit under their parent
              so the breadcrumb would be redundant. Clicking opens the parent. */}
          {depth === 0 && task.parent_task && (
            <button
              type="button"
              className="lv-parent-ref"
              onClick={(e) => { e.stopPropagation(); setActiveTask(task.parent_task!.id); }}
              title={`Parent task: ${task.parent_task.title}`}
            >
              <span aria-hidden>↳</span>
              <span className="lv-parent-ref-title">{task.parent_task.title}</span>
            </button>
          )}
          <div className="flex items-center gap-1.5 min-w-0">
            {hasSubtasks && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setExpanded(v => !v); }}
                className="shrink-0 text-[color:var(--sh-ink-4)] hover:text-[color:var(--sh-ink)] transition"
                aria-label={expanded ? 'Collapse subtasks' : 'Expand subtasks'}
              >
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform .18s' }}
                >
                  <path d="M9 5l7 7-7 7" />
                </svg>
              </button>
            )}
            {isWorkBlock && (
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke={resolvedTaskType?.color || '#8b5cf6'}
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-label="Work block"
                style={{ flexShrink: 0 }}
              >
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7v5l3 2" />
              </svg>
            )}
            {(resolvedTaskType?.key === 'course' || resolvedTaskType?.key === 'meeting') && (
              <span
                aria-label={resolvedTaskType.name}
                title={resolvedTaskType.name}
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: 999,
                  background: resolvedTaskType.color || 'var(--sh-ink-4)',
                  flexShrink: 0,
                  display: 'inline-block',
                }}
              />
            )}
            <span className="lv-title">{task.title}</span>
            {task.recurring_parent_id && (
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#a855f7"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-label="Recurring task"
                style={{ flexShrink: 0 }}
              >
                <title>Recurring task — spawned by a routine</title>
                <path d="m17 2 4 4-4 4" />
                <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
                <path d="m7 22-4-4 4-4" />
                <path d="M21 13v1a4 4 0 0 1-4 4H3" />
              </svg>
            )}
            {isTiming && (
              <span
                className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold tabular-nums"
                style={{
                  background: isWorkBlockRun
                    ? 'color-mix(in oklch, #8b5cf6 18%, transparent)'
                    : 'rgba(16, 185, 129, 0.15)',
                  color: isWorkBlockRun ? '#7c3aed' : '#047857',
                  flexShrink: 0,
                }}
                title={isWorkBlockRun ? 'Work-block run in progress' : 'Timer running'}
              >
                <span className="relative inline-flex h-1.5 w-1.5">
                  <span
                    className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75"
                    style={{ background: isWorkBlockRun ? '#a78bfa' : '#34d399' }}
                  />
                  <span
                    className="relative inline-flex h-1.5 w-1.5 rounded-full"
                    style={{ background: isWorkBlockRun ? '#8b5cf6' : '#10b981' }}
                  />
                </span>
                {fmtClock(tickElapsed)}
              </span>
            )}
            <button
              type="button"
              className="lv-focus-star"
              data-active={isFocused}
              onClick={(e) => { e.stopPropagation(); focusTask.mutate({ id: task.id, focused: !isFocused }); }}
              aria-label={isFocused ? 'Focused for today — click to remove' : 'Focus today'}
              title={isFocused ? 'Focused for today — click to remove' : 'Focus today'}
            >
              {isFocused ? '★' : '☆'}
            </button>
          </div>
        </div>

        {/* Priority cell — clickable, opens PriorityPicker */}
        <div
          className="lv-cell lv-cell--priority"
          data-empty={priority === 'none'}
          onClick={canEdit ? (e) => openPicker(e, setPriorityAnchor) : undefined}
          style={{ cursor: canEdit ? 'pointer' : 'default' }}
          title={canEdit ? 'Change priority' : undefined}
        >
          {priority === 'none' ? (
            <span className="lv-cell-value">—</span>
          ) : (
            <span className="lv-pri">
              <span className="lv-pri-dot" style={{ background: priorityMeta.color }} />
              <span className="lv-pri-label">{priorityMeta.label}</span>
            </span>
          )}
        </div>

        {/* Assignee cell — clickable, opens AssigneePicker */}
        <div
          className="lv-cell lv-cell--assignee"
          data-empty={assignees.length === 0}
          onClick={canEdit ? (e) => openPicker(e, setAssigneeAnchor) : undefined}
          style={{ cursor: canEdit ? 'pointer' : 'default' }}
          title={canEdit ? 'Change assignees' : undefined}
        >
          {assignees.length > 0 ? (
            <span className="av-stack" aria-label={`${assignees.length} assignee${assignees.length === 1 ? '' : 's'}`}>
              {assignees.slice(0, 2).map((u) => (
                <span
                  key={u.id}
                  className="lv-ava"
                  style={{ background: avatarColor(u.id || u.email) }}
                  title={u.display_name || u.email}
                >
                  {initialOf(u.display_name || u.email)}
                </span>
              ))}
              {assignees.length > 2 && (
                <span className="av-more" title={`${assignees.length - 2} more`}>+{assignees.length - 2}</span>
              )}
            </span>
          ) : (
            <span className="lv-ava lv-ava--empty" title="Unassigned">–</span>
          )}
        </div>

        {/* Work date cell — clickable, opens DatePicker (datetime) */}
        <div
          className="lv-cell lv-cell--date"
          data-empty={!task.work_date}
          onClick={canEdit ? (e) => openPicker(e, setWorkDateAnchor) : undefined}
          style={{ cursor: canEdit ? 'pointer' : 'default' }}
          title={canEdit ? 'Set work date' : undefined}
        >
          <span className="lv-cell-value lv-date-text">
            {task.work_date ? workWhen.text : '—'}
          </span>
          {canEdit && (
            <button
              type="button"
              className="lv-date-today-btn"
              onClick={(e) => {
                e.stopPropagation();
                const cur = pendingDates.current.work !== undefined ? pendingDates.current.work : task.work_date;
                const next = nextQuickDate(cur);
                pendingDates.current.work = next;
                updateTask.mutate({ id: task.id, work_date: next } as any);
              }}
              aria-label="Set work date to today / tomorrow"
              title="Click: today · Click again: tomorrow"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
            </button>
          )}
        </div>

        {/* Due date cell — clickable, opens DatePicker (datetime) */}
        <div
          className="lv-cell lv-cell--date"
          data-empty={!task.due_date}
          onClick={canEdit ? (e) => openPicker(e, setDueDateAnchor) : undefined}
          style={{ cursor: canEdit ? 'pointer' : 'default' }}
          title={canEdit ? 'Set due date' : undefined}
        >
          <span className={`${dueValueClass} lv-date-text`}>
            {task.due_date ? dueWhen.text : '—'}
          </span>
          {canEdit && (
            <button
              type="button"
              className="lv-date-today-btn"
              onClick={(e) => {
                e.stopPropagation();
                const cur = pendingDates.current.due !== undefined ? pendingDates.current.due : task.due_date;
                const next = nextQuickDate(cur);
                pendingDates.current.due = next;
                updateTask.mutate({ id: task.id, due_date: next } as any);
              }}
              aria-label="Set due date to today / tomorrow"
              title="Click: today · Click again: tomorrow"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
            </button>
          )}
        </div>

        {/* More button (6th column) */}
        <div className="lv-cell--more">
          <button
            type="button"
            className="lv-more-btn"
            onClick={(e) => e.stopPropagation()}
            aria-label="More actions"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="1" />
              <circle cx="19" cy="12" r="1" />
              <circle cx="5" cy="12" r="1" />
            </svg>
          </button>
        </div>
      </div>

      {expanded && hasSubtasks && task.subtasks!.map((sub) => (
        <TaskRow
          key={sub.id}
          task={sub}
          statuses={statuses}
          onStatusChange={_onStatusChange}
          depth={depth + 1}
          canEdit={canEdit}
          listId={listId}
        />
      ))}

      {assigneeAnchor && (
        <AssigneePicker
          taskId={task.id}
          currentAssigneeIds={assignees.map(u => u.id)}
          anchorRect={assigneeAnchor}
          onChange={(ids) => updateTask.mutate({ id: task.id, assignee_ids: ids, list_id: effectiveListId || undefined } as any)}
          onClose={() => setAssigneeAnchor(null)}
        />
      )}

      {noAssigneePrompt && (
        <NoAssigneeCompleteDialog
          anchorRect={noAssigneePrompt}
          canAssignToMe={!!currentUser?.id}
          onAssignToMe={() => {
            if (currentUser?.id) completeTask([currentUser.id]);
            else completeTask();
            setNoAssigneePrompt(null);
          }}
          onAssignOther={() => {
            setAssignCompleteAnchor(noAssigneePrompt);
            setNoAssigneePrompt(null);
          }}
          onCompleteAnyway={() => {
            completeTask();
            setNoAssigneePrompt(null);
          }}
          onClose={() => setNoAssigneePrompt(null)}
        />
      )}

      {assignCompleteAnchor && (
        <AssigneePicker
          taskId={task.id}
          currentAssigneeIds={[]}
          anchorRect={assignCompleteAnchor}
          onChange={(ids) => {
            // Picking someone assigns them and completes in one write. An empty
            // selection (Unassign all) just completes unassigned.
            completeTask(ids);
            setAssignCompleteAnchor(null);
          }}
          onClose={() => setAssignCompleteAnchor(null)}
        />
      )}

      {priorityAnchor && (
        <PriorityPicker
          anchorRect={priorityAnchor}
          value={priority}
          taskTitle={task.title}
          onChange={(p) => updateTask.mutate({ id: task.id, priority: p, list_id: effectiveListId || undefined } as any)}
          onClose={() => setPriorityAnchor(null)}
        />
      )}

      {workDateAnchor && (
        <DatePicker
          anchorRect={workDateAnchor}
          value={task.work_date}
          mode="datetime"
          onChange={(next) => updateTask.mutate({ id: task.id, work_date: next, list_id: effectiveListId || undefined } as any)}
          onClose={() => setWorkDateAnchor(null)}
        />
      )}

      {dueDateAnchor && (
        <DatePicker
          anchorRect={dueDateAnchor}
          value={task.due_date}
          mode="datetime"
          onChange={(next) => updateTask.mutate({ id: task.id, due_date: next, list_id: effectiveListId || undefined } as any)}
          onClose={() => setDueDateAnchor(null)}
        />
      )}
    </>
  );
}
