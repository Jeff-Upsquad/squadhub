import { useMemo, useState } from 'react';
import type { Task } from '@squadhub/shared';
import { usePMStore } from '../../../stores/pmStore';
import { useFocusTask, planDateKey } from '../../../hooks/useDayPlanner';
import { DND_TASK_ID, DND_TASK_ESTIMATE, priorityLevel, setSlimDragImage } from './calendarUtils';

type Filter = 'unscheduled' | 'all';

function priLabel(p: Task['priority']): string | null {
  if (p === 'emergency') return 'Emergency';
  if (p === 'urgent') return 'Urgent';
  if (p === 'high') return 'High';
  return null;
}

function fmtShort(iso: string | null | undefined): string | null {
  if (!iso) return null;
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(iso));
}

/**
 * Left rail of the Calendar — the same focus/today/overdue tasks Home surfaces,
 * each draggable onto the calendar. Dropping a row on a day sets its work_date;
 * the "Unscheduled" filter then drops it from this list (it now lives on the
 * grid). The drag payload matches the Day Planner's, so rows also drop straight
 * onto the embedded day grid's hour slots.
 */
export default function CalendarTaskPalette({
  tasks,
  isLoading,
  scheduledIds,
}: {
  tasks: Task[];
  isLoading: boolean;
  /** Tasks already placed on the calendar (work_date or a timed day-plan). */
  scheduledIds: Set<string>;
}) {
  const setActiveTask = usePMStore((s) => s.setActiveTask);
  const focusTask = useFocusTask();
  // Default to the "to schedule" list so a task drops out the moment it's
  // dragged onto the calendar; switch to All to see (and re-drag) everything.
  const [filter, setFilter] = useState<Filter>('unscheduled');

  const todayStr = useMemo(() => planDateKey(), []);

  const visible = useMemo(() => {
    const list = filter === 'unscheduled' ? tasks.filter((t) => !scheduledIds.has(t.id)) : tasks;
    // Unscheduled / overdue first, then scheduled, by date.
    return [...list].sort((a, b) => {
      const aw = scheduledIds.has(a.id) ? 1 : 0;
      const bw = scheduledIds.has(b.id) ? 1 : 0;
      if (aw !== bw) return aw - bw;
      const ad = a.work_date || a.due_date || '';
      const bd = b.work_date || b.due_date || '';
      return ad.localeCompare(bd);
    });
  }, [tasks, filter, scheduledIds]);

  const unscheduledCount = useMemo(() => tasks.filter((t) => !scheduledIds.has(t.id)).length, [tasks, scheduledIds]);

  return (
    <div className="cal-palette">
      <div className="cal-palette-head">
        <div>
          <h2>Tasks</h2>
          <div className="sub">{visible.length} {visible.length === 1 ? 'task' : 'tasks'} · drag onto a day</div>
        </div>
        <div className="cal-seg" role="tablist" aria-label="Task filter">
          <button
            type="button"
            role="tab"
            aria-selected={filter === 'all'}
            data-active={filter === 'all'}
            onClick={() => setFilter('all')}
          >
            All
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={filter === 'unscheduled'}
            data-active={filter === 'unscheduled'}
            onClick={() => setFilter('unscheduled')}
          >
            To schedule{unscheduledCount > 0 ? ` · ${unscheduledCount}` : ''}
          </button>
        </div>
      </div>

      {isLoading && visible.length === 0 ? (
        <div className="cal-empty">Loading…</div>
      ) : visible.length === 0 ? (
        <div className="cal-empty">
          {filter === 'unscheduled'
            ? 'Everything is scheduled. Switch to All to see your tasks.'
            : 'Nothing here yet. Star a task or set a date to surface it.'}
        </div>
      ) : (
        <div className="cal-palette-list">
          {visible.map((t) => {
            const pri = priLabel(t.priority);
            const isFocused = !!t.focused_at;
            const isScheduled = scheduledIds.has(t.id);
            const overdue = !!t.due_date && planDateKey(new Date(t.due_date)) < todayStr;
            const label = t.list?.name || t.space?.name || '';
            return (
              <div
                key={t.id}
                className="cal-prow"
                draggable
                data-scheduled={isScheduled ? 'true' : undefined}
                onDragStart={(e) => {
                  e.dataTransfer.setData(DND_TASK_ID, t.id);
                  e.dataTransfer.setData(DND_TASK_ESTIMATE, String(t.time_estimate ?? 30));
                  e.dataTransfer.effectAllowed = 'copyMove';
                  setSlimDragImage(e, t.title);
                }}
                onClick={() => setActiveTask(t.id)}
                title="Click to open · drag onto a day to schedule"
              >
                <button
                  type="button"
                  className="cal-prow-star"
                  data-on={isFocused}
                  onClick={(e) => { e.stopPropagation(); focusTask.mutate({ id: t.id, focused: !isFocused }); }}
                  title={isFocused ? 'Remove from Focus' : 'Mark as Focus'}
                  aria-label={isFocused ? 'Remove from Focus' : 'Mark as Focus'}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill={isFocused ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={1.6} strokeLinejoin="round">
                    <path d="M12 2.5l2.97 6.02 6.65.97-4.81 4.69 1.13 6.62L12 17.7l-5.94 3.12 1.13-6.62L2.38 9.49l6.65-.97L12 2.5z" />
                  </svg>
                </button>
                <span className="cal-prow-pri" data-level={priorityLevel(t.priority)} aria-hidden="true" />
                <div className="cal-prow-body">
                  <div className="cal-prow-title">{t.title}</div>
                  <div className="cal-prow-meta">
                    {pri && <span className="cal-prow-prilabel" data-level={priorityLevel(t.priority)}>{pri}</span>}
                    {t.work_date ? (
                      <span className="cal-prow-when">Work {fmtShort(t.work_date)}</span>
                    ) : isScheduled ? (
                      <span className="cal-prow-when">Scheduled</span>
                    ) : t.due_date ? (
                      <span className="cal-prow-when" data-overdue={overdue || undefined}>Due {fmtShort(t.due_date)}</span>
                    ) : null}
                    {label && <span className="cal-prow-tag">{label}</span>}
                  </div>
                </div>
                <svg className="cal-prow-grip" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <circle cx="9" cy="6" r="1.4" /><circle cx="15" cy="6" r="1.4" />
                  <circle cx="9" cy="12" r="1.4" /><circle cx="15" cy="12" r="1.4" />
                  <circle cx="9" cy="18" r="1.4" /><circle cx="15" cy="18" r="1.4" />
                </svg>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
