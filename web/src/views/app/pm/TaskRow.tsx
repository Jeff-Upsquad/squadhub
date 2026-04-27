import { useState } from 'react';
import type { Task, SpaceStatus } from '@squadhub/shared';
import { usePMStore } from '../../../stores/pmStore';
import { useUpdateTask } from '../../../hooks/useTasks';
import { avatarColor, initialOf, formatWhen } from './taskHelpers';
import AssigneePicker from './AssigneePicker';
import DatePicker from './DatePicker';

const PRIORITY_LEVEL: Record<string, string | null> = {
  urgent: 'p0',
  high: 'p1',
  normal: 'p2',
  low: 'p3',
  none: null,
};

export default function TaskRow({
  task,
  statuses,
  onStatusChange: _onStatusChange,
  depth = 0,
  canEdit = true,
  listId,
}: {
  task: Task;
  statuses: SpaceStatus[];
  onStatusChange: (taskId: string, statusId: string) => void;
  depth?: number;
  canEdit?: boolean;
  listId: string;
}) {
  const { activeTaskId, setActiveTask, selectedTasks, toggleTaskSelection } = usePMStore();
  const updateTask = useUpdateTask(listId);
  const [expanded, setExpanded] = useState(false);
  const [isFadingOut, setIsFadingOut] = useState(false);
  const [isHidden, setIsHidden] = useState(false);

  // Inline picker anchors — null = closed, DOMRect = open & positioned
  const [assigneeAnchor, setAssigneeAnchor] = useState<DOMRect | null>(null);
  const [workDateAnchor, setWorkDateAnchor] = useState<DOMRect | null>(null);
  const [dueDateAnchor, setDueDateAnchor] = useState<DOMRect | null>(null);

  const hasSubtasks = !!(task.subtasks && task.subtasks.length > 0);
  const isActive = activeTaskId === task.id;
  const isSelected = selectedTasks.includes(task.id);

  const statusCategory = (task as any).status as string | undefined;
  const isDone = statusCategory === 'done' || statusCategory === 'closed';
  const displayDone = isDone || isFadingOut;
  const priorityLevel = PRIORITY_LEVEL[task.priority || 'none'];
  const workWhen = formatWhen(task.work_date);
  const dueWhen = formatWhen(task.due_date);
  const assignees = task.assignees || [];

  const handleGlyphClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!canEdit) return;
    const next = isDone ? 'todo' : 'done';
    if (!isDone) setIsFadingOut(true);
    updateTask.mutate(
      { id: task.id, status: next } as any,
      { onError: () => { setIsFadingOut(false); setIsHidden(false); } },
    );
  };

  const handleRowTransitionEnd = (e: React.TransitionEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.propertyName === 'transform' && isFadingOut) setIsHidden(true);
  };

  if (isHidden) return null;

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
        data-fading={isFadingOut}
        style={depth > 0 ? { paddingLeft: 20 + depth * 22 } : undefined}
      >
        {/* Checkbox — toggles done */}
        <button
          type="button"
          onClick={handleGlyphClick}
          className="lv-glyph"
          data-done={displayDone}
          data-celebrating={isFadingOut}
          data-progress={!isDone && statusCategory === 'active'}
          disabled={!canEdit}
          aria-label={isDone ? 'Mark incomplete' : 'Mark complete'}
        />

        {/* Title only — meta line (space · due · tags) removed; dedicated columns below */}
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            {priorityLevel && (priorityLevel === 'p0' || priorityLevel === 'p1') && (
              <span className="lv-priority-dot" data-level={priorityLevel} aria-label={`Priority ${priorityLevel.toUpperCase()}`} />
            )}
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
            <span className="lv-title">{task.title}</span>
          </div>
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
          <span className="lv-cell-value">
            {task.work_date ? workWhen.text : '—'}
          </span>
        </div>

        {/* Due date cell — clickable, opens DatePicker (datetime) */}
        <div
          className="lv-cell lv-cell--date"
          data-empty={!task.due_date}
          onClick={canEdit ? (e) => openPicker(e, setDueDateAnchor) : undefined}
          style={{ cursor: canEdit ? 'pointer' : 'default' }}
          title={canEdit ? 'Set due date' : undefined}
        >
          <span className={dueValueClass}>
            {task.due_date ? dueWhen.text : '—'}
          </span>
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
          onChange={(ids) => updateTask.mutate({ id: task.id, assignee_ids: ids } as any)}
          onClose={() => setAssigneeAnchor(null)}
        />
      )}

      {workDateAnchor && (
        <DatePicker
          anchorRect={workDateAnchor}
          value={task.work_date}
          mode="datetime"
          onChange={(next) => updateTask.mutate({ id: task.id, work_date: next } as any)}
          onClose={() => setWorkDateAnchor(null)}
        />
      )}

      {dueDateAnchor && (
        <DatePicker
          anchorRect={dueDateAnchor}
          value={task.due_date}
          mode="datetime"
          onChange={(next) => updateTask.mutate({ id: task.id, due_date: next } as any)}
          onClose={() => setDueDateAnchor(null)}
        />
      )}
    </>
  );
}
