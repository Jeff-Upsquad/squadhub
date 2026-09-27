'use client';
import { useEffect, useMemo, useState } from 'react';
import { useMyTasks } from '../../../hooks/useTasks';
import { usePMStore } from '../../../stores/pmStore';
import { useTabsStore } from '../../../stores/tabsStore';
import { buildHomeSnapshot } from '../../../lib/tabSnapshots';
import { planDateKey, useDayPlans } from '../../../hooks/useDayPlanner';
import DayCalendar from '../day-planner/DayCalendar';
import {
  buildMonthCells,
  cellKey,
  flattenMyTasks,
  groupTasksByDay,
  weekdayLabels,
} from './calendarUtils';

function Tab({ label, badge, active, onClick }: { label: string; badge?: number; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative flex items-center gap-1.5 pb-2.5 pt-1 text-[13px] transition ${
        active ? 'font-semibold text-[var(--sh-ink)]' : 'font-medium text-[var(--sh-ink-3)] hover:text-[var(--sh-ink)]'
      }`}
    >
      {label}
      {badge != null && badge > 0 && (
        <span className="grid h-[18px] min-w-[18px] place-items-center rounded-[5px] bg-[var(--sh-ink)] px-1 text-[10.5px] font-semibold leading-none text-[var(--surface)]">
          {badge}
        </span>
      )}
      {active && <span className="absolute inset-x-0 bottom-0 h-[2px] rounded-full bg-[var(--sh-ink)]" />}
    </button>
  );
}

/**
 * Cal hover peek — same floating-card language as the inbox hover view
 * (fixed card at the rail, header + tabs + feed). The default Today tab embeds
 * the exact Day Planner day grid (all-day strip + timed blocks + now-line);
 * Days keeps the mini-month days view and To schedule the unscheduled tasks.
 */
export default function CalendarRailPreview({
  onClose,
  onHoverEnter,
  onHoverLeave,
  onOpenSection,
  onOpenPlanner,
  pinned = false,
}: {
  onClose: () => void;
  onHoverEnter?: () => void;
  onHoverLeave?: () => void;
  onOpenSection: () => void;
  onOpenPlanner: () => void;
  pinned?: boolean;
}) {
  const { data, isLoading } = useMyTasks();
  const weekStartsOn = usePMStore((s) => s.calendarWeekStart) ?? 0;
  const setActiveTask = usePMStore((s) => s.setActiveTask);
  const [tab, setTab] = useState<'today' | 'days' | 'to-schedule'>('today');

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const todayKey = useMemo(() => planDateKey(), []);
  const today = useMemo(() => new Date(), []);
  const monthAnchor = today;

  const allTasks = useMemo(() => flattenMyTasks(data), [data]);
  const byDay = useMemo(() => groupTasksByDay(allTasks), [allTasks]);
  const cells = useMemo(() => buildMonthCells(monthAnchor, weekStartsOn), [monthAnchor, weekStartsOn]);
  const labels = useMemo(() => weekdayLabels(weekStartsOn), [weekStartsOn]);

  const monthLabel = useMemo(
    () => new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(monthAnchor),
    [monthAnchor],
  );

  const scheduledCount = useMemo(() => allTasks.filter((t) => t.work_date || t.due_date).length, [allTasks]);
  const unscheduled = useMemo(() => allTasks.filter((t) => !t.work_date && !t.due_date), [allTasks]);

  const weekAhead = useMemo(() => {
    const out: { key: string; date: Date; count: number }[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
      const key = cellKey(d);
      out.push({ key, date: d, count: byDay.get(key)?.length ?? 0 });
    }
    return out;
  }, [today, byDay]);

  const openTask = (id: string) => {
    useTabsStore.getState().openInNewTab(buildHomeSnapshot('my-tasks'));
    setActiveTask(id);
    onClose();
  };

  // Today's block count for the tab badge (same query the grid uses).
  const { data: dayPlans = [] } = useDayPlans(todayKey);

  return (
    <>
      {pinned && <div className="fixed inset-0 z-40" onClick={onClose} aria-hidden="true" />}

      <div
        className="inbox-slider-panel sh-view fixed left-2 right-2 top-14 bottom-4 z-50 flex flex-col overflow-hidden rounded-[14px] border border-[var(--sh-hair)] bg-[var(--surface)] md:left-[76px] md:right-auto md:top-3 md:bottom-3 md:w-[520px]"
        style={{ boxShadow: '0 18px 50px rgba(10, 10, 10, 0.16), 0 2px 8px rgba(10, 10, 10, 0.06)' }}
        onPointerEnter={onHoverEnter}
        onPointerLeave={onHoverLeave}
      >
        {/* Header — same row as inbox hover */}
        <div className="flex items-center gap-2.5 px-5 pb-3 pt-4">
          <svg className="h-[18px] w-[18px] text-[var(--sh-ink)]" viewBox="0 0 24 24" fill="currentColor" stroke="none">
            <rect x="4" y="5.4" width="16" height="14.6" rx="3" />
            <path d="M8.5 3.3v3.2M15.5 3.3v3.2" fill="none" stroke="var(--surface)" strokeWidth={1.7} strokeLinecap="round" />
            <path d="M4.4 9.7h15.2" fill="none" stroke="var(--surface)" strokeWidth={1.6} strokeLinecap="round" />
            <g fill="var(--surface)">
              <circle cx="8.7" cy="13.7" r="1" /><circle cx="12" cy="13.7" r="1" /><circle cx="15.3" cy="13.7" r="1" />
              <circle cx="8.7" cy="16.8" r="1" /><circle cx="12" cy="16.8" r="1" />
            </g>
          </svg>
          <h3 className="text-[15px] font-semibold text-[var(--sh-ink)]">Calendar</h3>
          {scheduledCount > 0 && (
            <span className="grid h-[18px] min-w-[18px] place-items-center rounded-[5px] bg-[var(--sh-ink)] px-1 text-[10.5px] font-semibold leading-none text-[var(--surface)]">
              {scheduledCount}
            </span>
          )}
          <div className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close calendar preview"
            className="grid h-7 w-7 place-items-center rounded-[8px] text-[var(--sh-ink-3)] transition hover:bg-[var(--sh-hair-3)] hover:text-[var(--sh-ink)]"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
              <path d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs — same row as inbox hover */}
        <div className="flex items-end gap-5 border-b border-[var(--sh-hair)] px-5">
          <Tab label="Today" badge={dayPlans.length} active={tab === 'today'} onClick={() => setTab('today')} />
          <Tab label="Days" active={tab === 'days'} onClick={() => setTab('days')} />
          <Tab label="To schedule" badge={unscheduled.length} active={tab === 'to-schedule'} onClick={() => setTab('to-schedule')} />
          <div className="flex-1" />
          <button
            type="button"
            onClick={tab === 'today' ? onOpenPlanner : onOpenSection}
            className="pb-2.5 pt-1 text-[11.5px] font-medium text-[var(--sh-ink-3)] transition hover:text-[var(--sh-ink)]"
          >
            {tab === 'today' ? 'Open Day Planner →' : `${monthLabel} · Open calendar →`}
          </button>
        </div>

        {/* Feed — the Today grid scrolls internally, other tabs scroll here */}
        <div className={`min-h-0 flex-1 ${tab === 'today' ? 'overflow-hidden' : 'overflow-y-auto'}`}>
          {tab === 'today' ? (
            <div className="cal-hover-day">
              <DayCalendar date={todayKey} today={todayKey} onDateChange={() => {}} />
            </div>
          ) : isLoading && allTasks.length === 0 ? (
            <div className="px-5 py-8 text-[13px] text-[var(--sh-ink-3)]">Loading…</div>
          ) : tab === 'days' ? (
            <div className="cal-rail-preview">
              <div className="cal-rail-grid-head">
                {labels.map((w, i) => (
                  <div key={i} className="cal-rail-wd">{w[0]}</div>
                ))}
              </div>
              <div className="cal-rail-grid">
                {cells.map((day) => {
                  const key = cellKey(day);
                  const count = byDay.get(key)?.length ?? 0;
                  const isToday = key === todayKey;
                  const inMonth = day.getMonth() === monthAnchor.getMonth();
                  return (
                    <div
                      key={key}
                      className="cal-rail-cell"
                      data-today={isToday || undefined}
                      data-outside={!inMonth || undefined}
                      title={`${key} · ${count} task${count === 1 ? '' : 's'}`}
                    >
                      <span className="cal-rail-num">{day.getDate()}</span>
                      {count > 0 && (
                        <span className="cal-rail-dots" aria-hidden="true">
                          {[0, 1, 2].slice(0, Math.min(3, count)).map((d) => (
                            <i key={d} />
                          ))}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="cal-rail-week">
                <div className="cal-rail-week-head">Next 7 days</div>
                {weekAhead.map(({ key, date, count }) => {
                  const items = (byDay.get(key) ?? []).slice(0, 2);
                  const dayName = new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(date);
                  return (
                    <div key={key} className="cal-rail-row" data-today={key === todayKey || undefined}>
                      <span className="cal-rail-row-day">
                        {dayName} <em>{date.getDate()}</em>
                      </span>
                      <span className="cal-rail-row-tasks">
                        {count === 0 ? (
                          <span className="cal-rail-row-empty">—</span>
                        ) : (
                          items.map(({ task }) => (
                            <button
                              key={task.id}
                              type="button"
                              className="cal-rail-task"
                              title={task.title}
                              onClick={() => openTask(task.id)}
                            >
                              {task.title}
                            </button>
                          ))
                        )}
                        {count > items.length && <span className="cal-rail-more">+{count - items.length} more</span>}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : unscheduled.length === 0 ? (
            <div className="px-5 py-12 text-center text-[13px] text-[var(--sh-ink-3)]">
              Everything is scheduled.
            </div>
          ) : (
            unscheduled.slice(0, 30).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => openTask(t.id)}
                className="flex w-full items-center gap-2.5 border-b border-[var(--sh-hair-3)] px-5 py-3 text-left transition hover:bg-[var(--sh-hair-3)]"
              >
                <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--sh-ink)]">{t.title}</span>
                <span className="shrink-0 text-[11px] text-[var(--sh-ink-4)]">
                  {(t.list as any)?.name || (t.space as any)?.name || ''}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </>
  );
}
