import { useMemo, useState } from 'react';
import type { Task } from '@squadhub/shared';
import { usePMStore } from '../../../stores/pmStore';
import { useDayPlannerTasks, useDayPlans, useFocusTask, planDateKey } from '../../../hooks/useDayPlanner';
import SnoozeMenu from './SnoozeMenu';

type Badge = 'overdue' | 'today' | 'focus' | 'starts';

function badgesFor(t: Task, todayStr: string, yesterdayStr: string, tomorrowStr: string): Badge[] {
  const toDay = (v: string | null) => (v ? planDateKey(new Date(v)) : null);
  const dueStr = toDay(t.due_date);
  const workStr = toDay(t.work_date);
  const startStr = toDay(t.start_date);
  const focStr = toDay(t.focused_at);
  const out: Badge[] = [];
  if (dueStr && dueStr < todayStr) out.push('overdue');
  if (workStr && workStr <= todayStr) out.push('today');
  if (focStr && (focStr === todayStr || focStr === yesterdayStr)) out.push('focus');
  if (startStr && (startStr === todayStr || startStr === tomorrowStr)) out.push('starts');
  return out;
}

function fmtDate(iso: string | null): string | null {
  if (!iso) return null;
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(iso));
}

function priorityChip(p: Task['priority']): { level: 'emg' | 'p0' | 'p1'; label: string } | null {
  if (p === 'emergency') return { level: 'emg', label: 'EMERGENCY' };
  if (p === 'urgent') return { level: 'p0', label: 'Urgent' };
  if (p === 'high') return { level: 'p1', label: 'High' };
  return null;
}

export default function TodayList() {
  const { data: tasks = [], isLoading } = useDayPlannerTasks();
  const focusTask = useFocusTask();
  const setActiveTask = usePMStore((s) => s.setActiveTask);
  const [snoozeAnchor, setSnoozeAnchor] = useState<{ taskId: string; isSnoozed: boolean; left: number; top: number } | null>(null);

  const { todayStr, yesterdayStr, tomorrowStr } = useMemo(() => {
    const now = new Date();
    const dayMs = 24 * 60 * 60 * 1000;
    return {
      todayStr: planDateKey(now),
      yesterdayStr: planDateKey(new Date(now.getTime() - dayMs)),
      tomorrowStr: planDateKey(new Date(now.getTime() + dayMs)),
    };
  }, []);

  // Tasks already on today's calendar are hidden from this list. The query
  // invalidates whenever a plan is created / moved / deleted, so the row
  // reappears automatically when a block is removed from the calendar.
  // All-day rows don't count — a date-only task sits in the strip *and*
  // stays here until it's dragged onto the grid and given a time.
  const { data: todayPlans = [] } = useDayPlans(todayStr);
  const scheduledTaskIds = useMemo(
    () => new Set(todayPlans.filter((p) => !p.all_day).map((p) => p.task_id)),
    [todayPlans],
  );
  const visibleTasks = useMemo(
    () => tasks.filter((t) => !scheduledTaskIds.has(t.id)),
    [tasks, scheduledTaskIds],
  );

  const openSnooze = (e: React.MouseEvent, t: Task) => {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    // Menu is ~180px tall (3 rows + optional unsnooze). Flip above the button
    // if there isn't enough room below — otherwise it gets clipped by the
    // bottom of the viewport.
    const MENU_HEIGHT = 180;
    const MARGIN = 4;
    const flipUp = rect.bottom + MARGIN + MENU_HEIGHT > window.innerHeight;
    setSnoozeAnchor({
      taskId: t.id,
      isSnoozed: !!t.snoozed_until && new Date(t.snoozed_until) > new Date(),
      left: rect.right - 220,
      top: flipUp ? rect.top - MENU_HEIGHT - MARGIN : rect.bottom + MARGIN,
    });
  };

  return (
    <div className="dp-list">
      <div className="dp-list-head">
        <div>
          <h2>Planner</h2>
          <div className="sub">{visibleTasks.length} {visibleTasks.length === 1 ? 'task' : 'tasks'} · drag to schedule</div>
        </div>
      </div>

      {isLoading && visibleTasks.length === 0 ? (
        <div className="dp-empty">Loading…</div>
      ) : visibleTasks.length === 0 ? (
        <div className="dp-empty">
          {tasks.length === 0
            ? 'Nothing to plan. Star a task or set a work date to surface it here.'
            : 'Everything is scheduled. Remove a block from the calendar to bring it back.'}
        </div>
      ) : (
        visibleTasks.map((t) => {
          const badges = badgesFor(t, todayStr, yesterdayStr, tomorrowStr).filter((b) => b !== 'today');
          const pri = priorityChip(t.priority);
          const isFocused = !!t.focused_at;
          return (
            <div
              key={t.id}
              className="dp-row"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('application/x-task-id', t.id);
                e.dataTransfer.setData('application/x-task-estimate', String(t.time_estimate ?? 30));
                // Match the slot's dropEffect='move' — see DayCalendar.
                e.dataTransfer.effectAllowed = 'copyMove';
              }}
              onClick={() => setActiveTask(t.id)}
              title="Click to open · drag to schedule"
            >
              <div
                className="star"
                data-on={isFocused}
                onClick={(e) => { e.stopPropagation(); focusTask.mutate({ id: t.id, focused: !isFocused }); }}
                title={isFocused ? 'Remove from Focus today' : 'Mark as Focus today'}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill={isFocused ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={1.6} strokeLinejoin="round">
                  <path d="M12 2.5l2.97 6.02 6.65.97-4.81 4.69 1.13 6.62L12 17.7l-5.94 3.12 1.13-6.62L2.38 9.49l6.65-.97L12 2.5z" />
                </svg>
              </div>
              <div className="body">
                <div className="title">{t.title}</div>
                <div className="meta">
                  {pri && (
                    <span className="td-pri-chip" data-level={pri.level}>
                      <span className="dot" />
                      {pri.label}
                    </span>
                  )}
                  {badges.map((b) => (
                    <span key={b} className={`badge ${b}`}>{badgeLabel(b)}</span>
                  ))}
                  {t.due_date && <span>Due {fmtDate(t.due_date)}</span>}
                  {t.work_date && <span>Work {fmtDate(t.work_date)}</span>}
                  {t.start_date && <span>Start {fmtDate(t.start_date)}</span>}
                  {t.time_estimate ? <span>· {t.time_estimate}m</span> : null}
                  {(t.space?.name || t.folder?.name || t.list?.name) && (
                    <span className="crumb">
                      {t.space?.name && <span className="name">{t.space.name}</span>}
                      {t.folder?.name && (<><span className="sep">›</span><span className="name">{t.folder.name}</span></>)}
                      {t.list?.name && (<><span className="sep">›</span><span className="name">{t.list.name}</span></>)}
                    </span>
                  )}
                </div>
              </div>
              <div className="actions">
                <button type="button" className="icon" onClick={(e) => openSnooze(e, t)} title="Snooze">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="9" />
                    <path d="M12 7v5l3 2" />
                  </svg>
                </button>
              </div>
            </div>
          );
        })
      )}

      {snoozeAnchor && (
        <SnoozeMenu
          taskId={snoozeAnchor.taskId}
          isSnoozed={snoozeAnchor.isSnoozed}
          anchor={{ left: snoozeAnchor.left, top: snoozeAnchor.top }}
          onClose={() => setSnoozeAnchor(null)}
        />
      )}
    </div>
  );
}

function badgeLabel(b: Badge): string {
  switch (b) {
    case 'overdue': return 'Overdue';
    case 'today': return 'Today';
    case 'focus': return 'Focus';
    case 'starts': return 'Starts soon';
  }
}
