import { useState } from 'react';
import type { Task, SpaceStatus } from '@squadhub/shared';
import { usePMStore } from '../../../stores/pmStore';
import { useUpdateTask } from '../../../hooks/useTasks';

const PRIORITY_LEVEL: Record<string, string | null> = {
  urgent: 'p0',
  high: 'p1',
  normal: 'p2',
  low: 'p3',
  none: null,
};

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
  return parts.map(p => p[0]?.toUpperCase() || '').join('') || '?';
}

function formatWhen(iso: string | null | undefined): { text: string; state: 'overdue' | 'today' | 'tomorrow' | 'later' | 'none' } {
  if (!iso) return { text: '', state: 'none' };
  const d = new Date(iso);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const that = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const delta = Math.round((that - today) / 86_400_000);
  const hasTime = !(d.getHours() === 0 && d.getMinutes() === 0);
  const time = hasTime ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true }) : '';
  if (delta < 0) {
    return { text: `Overdue · ${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}`, state: 'overdue' };
  }
  if (delta === 0) return { text: time ? `Today · ${time}` : 'Today', state: 'today' };
  if (delta === 1) return { text: time ? `Tomorrow · ${time}` : 'Tomorrow', state: 'tomorrow' };
  if (delta < 7) return { text: d.toLocaleDateString([], { weekday: 'long' }), state: 'later' };
  return { text: d.toLocaleDateString([], { month: 'short', day: 'numeric' }), state: 'later' };
}

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

  const hasSubtasks = !!(task.subtasks && task.subtasks.length > 0);
  const isActive = activeTaskId === task.id;
  const isSelected = selectedTasks.includes(task.id);

  const statusCategory = (task as any).status as string | undefined;
  const isDone = statusCategory === 'done' || statusCategory === 'closed';
  const matchedStatus = statuses.find(s => s.category === statusCategory);
  const priorityLevel = PRIORITY_LEVEL[task.priority || 'none'];
  const when = formatWhen(task.due_date);
  const assignee = task.assignees?.[0];
  const tags = task.tags || [];
  const spaceLabel = (task as any).space?.name || matchedStatus?.name;

  const handleGlyphClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!canEdit) return;
    const next = isDone ? 'todo' : 'done';
    updateTask.mutate({ id: task.id, status: next } as any);
  };

  return (
    <>
      <div
        draggable={canEdit}
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
        className="lv-row"
        data-active={isActive}
        data-selected={isSelected}
        data-done={isDone}
        style={depth > 0 ? { paddingLeft: 20 + depth * 22 } : undefined}
      >
        {/* Checkbox — toggles done */}
        <button
          type="button"
          onClick={handleGlyphClick}
          className="lv-glyph"
          data-done={isDone}
          data-progress={!isDone && statusCategory === 'active'}
          disabled={!canEdit}
          aria-label={isDone ? 'Mark incomplete' : 'Mark complete'}
        />

        {/* Title + meta stack */}
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
          <div className="lv-meta">
            {spaceLabel && <span className="lv-tag">{spaceLabel}</span>}
            {when.text && (
              <>
                {spaceLabel && <span className="sep">·</span>}
                <span
                  className={when.state === 'overdue' ? 'lv-due--overdue' : when.state === 'today' ? 'lv-due--today' : ''}
                >
                  {when.text}
                </span>
              </>
            )}
            {tags.length > 0 && (
              <>
                {(spaceLabel || when.text) && <span className="sep">·</span>}
                <span className="truncate">{tags.slice(0, 2).map(t => `#${t.name}`).join(' ')}{tags.length > 2 ? ` +${tags.length - 2}` : ''}</span>
              </>
            )}
          </div>
        </div>

        {/* Assignee avatar */}
        {assignee ? (
          <span
            className="lv-ava"
            style={{ background: avatarColor(assignee.id || assignee.email) }}
            title={assignee.display_name || assignee.email}
          >
            {initialOf(assignee.display_name || assignee.email)}
          </span>
        ) : (
          <span className="lv-ava lv-ava--empty" title="Unassigned">–</span>
        )}
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
    </>
  );
}
