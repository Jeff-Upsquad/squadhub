import { useEffect, useMemo, useRef, useState } from 'react';
import type { Task } from '@squadhub/shared';
import { useMyTasks, useUpdateTask } from '../../../hooks/useTasks';
import { usePMStore } from '../../../stores/pmStore';
import { avatarColor, initialOf, formatWhen } from '../pm/taskHelpers';
import { groupTasks, isFutureDay, type GroupBy } from '../../../lib/taskGrouping';
import DayCalendar from '../day-planner/DayCalendar';
import { planDateKey } from '../../../hooks/useDayPlanner';

const GROUP_OPTIONS: { value: GroupBy; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'priority', label: 'Priority' },
  { value: 'due_date', label: 'Due date' },
  { value: 'status', label: 'Status' },
  { value: 'space', label: 'Space' },
  { value: 'list', label: 'List' },
];

export default function TodayList() {
  const { data, isLoading, isError, refetch } = useMyTasks();
  const setActiveTask = usePMStore((s) => s.setActiveTask);
  const setActiveDashboardTab = usePMStore((s) => s.setActiveDashboardTab);
  const focusedTodayIds = usePMStore((s) => s.focusedTodayIds);

  const openTask = (id: string) => {
    setActiveDashboardTab(null);
    setActiveTask(id);
  };

  const tz = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', []);

  // Show ONLY tasks the user has starred (★ Focus) — the focus list is
  // persistent and no longer resets overnight. A starred task whose work_date
  // is in the future is hidden until that day arrives (set it ahead → it drops
  // off here, then comes back when its work date is today). The server-side
  // `focused` bucket carries starred tasks regardless of date so they're always
  // candidates here. (done/closed tasks are filtered out server-side.)
  const tasks: Task[] = useMemo(() => {
    if (!data) return [];
    const merged = [...data.overdue, ...data.today, ...(data.focused ?? [])];
    const seen = new Set<string>();
    const unique = merged.filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)));
    const focusedSet = new Set(focusedTodayIds);
    return unique.filter((t) => focusedSet.has(t.id) && !isFutureDay(t.work_date, tz));
  }, [data, focusedTodayIds, tz]);

  const groupBy = usePMStore((s) => s.todayListGroupBy);
  const setTodayListGroupBy = usePMStore((s) => s.setTodayListGroupBy);
  const fadingTaskIds = usePMStore((s) => s.fadingTaskIds);
  const view = usePMStore((s) => s.todayListView);
  const setTodayListView = usePMStore((s) => s.setTodayListView);
  const [menuOpen, setMenuOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);

  const today = useMemo(() => planDateKey(), []);
  const [viewDate, setViewDate] = useState<string>(today);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (anchorRef.current && !anchorRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const groups = useMemo(
    () => (groupBy === 'none' ? [] : groupTasks(tasks, groupBy, tz, fadingTaskIds)),
    [tasks, groupBy, tz, fadingTaskIds],
  );
  const currentLabel = GROUP_OPTIONS.find((o) => o.value === groupBy)?.label ?? 'None';

  return (
    <div className="hm-card">
      <div className="hm-card-head">
        <h3>Today</h3>
        {view === 'list' && !isLoading && !isError && (
          <span className="hm-count">· {tasks.length}</span>
        )}
        <div className="hm-head-actions">
          {view === 'list' && (
            <div ref={anchorRef} style={{ position: 'relative' }}>
              <button
                type="button"
                className="hm-pill"
                onClick={() => setMenuOpen((v) => !v)}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
              >
                <span className="dim">Group:</span>
                {currentLabel}
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </button>
              {menuOpen && (
                <div className="hm-menu" role="menu">
                  {GROUP_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      role="menuitem"
                      className="hm-menu-item"
                      data-active={groupBy === opt.value}
                      onClick={() => { setTodayListGroupBy(opt.value); setMenuOpen(false); }}
                    >
                      <span>{opt.label}</span>
                      {groupBy === opt.value && (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <button
            type="button"
            className="hm-pill"
            onClick={() => setTodayListView(view === 'list' ? 'calendar' : 'list')}
            aria-label={view === 'list' ? 'Switch to calendar view' : 'Switch to list view'}
            title={view === 'list' ? 'Switch to calendar view' : 'Switch to list view'}
            style={{ padding: '0 8px' }}
          >
            {view === 'list' ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="8" y1="6" x2="21" y2="6" />
                <line x1="8" y1="12" x2="21" y2="12" />
                <line x1="8" y1="18" x2="21" y2="18" />
                <line x1="3" y1="6" x2="3.01" y2="6" />
                <line x1="3" y1="12" x2="3.01" y2="12" />
                <line x1="3" y1="18" x2="3.01" y2="18" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {view === 'calendar' ? (
        <div className="td-cal-embed" style={{ height: 'calc(100vh - 180px)', minHeight: 600 }}>
          <DayCalendar date={viewDate} today={today} onDateChange={setViewDate} />
        </div>
      ) : (
        <>
          {isLoading && (
            <div className="hm-list" aria-hidden="true">
              <div className="hm-skel" />
              <div className="hm-skel" style={{ animationDelay: '0.15s' }} />
              <div className="hm-skel" style={{ animationDelay: '0.3s' }} />
            </div>
          )}

          {isError && !isLoading && (
            <div className="hm-state">
              Couldn't load today's list.{' '}
              <span className="retry" role="button" tabIndex={0} onClick={() => refetch()} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); refetch(); } }}>Retry</span>
            </div>
          )}

          {!isLoading && !isError && tasks.length === 0 && (
            <div className="hm-empty">
              <div className="rule" />
              <div className="h">Nothing starred yet.</div>
              <div className="p">Star a task (★) and it shows up here.</div>
            </div>
          )}

          {!isLoading && !isError && tasks.length > 0 && (
            groupBy === 'none' ? (
              <div className="hm-list">
                {tasks.map((t) => (
                  <TodayRow key={t.id} task={t} onOpen={openTask} />
                ))}
              </div>
            ) : (
              groups.map((g) => (
                <div key={g.key} className="hm-group">
                  <div className="hm-group-head">
                    <span>{g.label}</span>
                    <span className="count">· {g.tasks.length}</span>
                  </div>
                  <div className="hm-list" style={{ paddingTop: 0 }}>
                    {g.tasks.map((t) => (
                      <TodayRow key={t.id} task={t} onOpen={openTask} />
                    ))}
                  </div>
                </div>
              ))
            )
          )}
        </>
      )}
    </div>
  );
}

function TodayRow({ task: t, onOpen }: { task: Task; onOpen: (id: string) => void }) {
  const updateTask = useUpdateTask(null);
  const [isFadingOut, setIsFadingOut] = useState(false);
  const [isHidden, setIsHidden] = useState(false);

  const when = formatWhen(t.due_date);
  const assignee = t.assignees?.[0];
  const label = t.list?.name || t.space?.name || '';
  const isSubtask = !!t.parent_task_id;
  const parentTitle = t.parent_task?.title || null;
  const status = (t as any).status as string | undefined;
  const isDone = status === 'done' || status === 'closed';
  const displayDone = isDone || isFadingOut;

  const onToggleDone = (e: React.MouseEvent) => {
    e.stopPropagation();
    const next = isDone ? 'todo' : 'done';
    if (!isDone) setIsFadingOut(true);
    updateTask.mutate(
      { id: t.id, status: next } as any,
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
      className="hm-task"
      data-done={displayDone}
      data-fading={isFadingOut}
      data-subtask={isSubtask || undefined}
      onClick={() => onOpen(t.id)}
      onTransitionEnd={onRowTransitionEnd}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(t.id); } }}
      style={isSubtask ? { paddingLeft: 26 } : undefined}
    >
      <div
        className="checkbox"
        data-done={displayDone}
        data-celebrating={isFadingOut}
        role="button"
        aria-label={isDone ? 'Mark incomplete' : 'Mark complete'}
        onClick={onToggleDone}
      />
      <div className="t">
        <span className="title">
          {isSubtask && <span style={{ color: 'var(--sh-ink-4)', marginRight: 4 }}>↳</span>}
          {t.title}
        </span>
        {isSubtask && parentTitle && <span className="hm-parent">↳ {parentTitle}</span>}
        {label && <span className="hm-tag">{label}</span>}
      </div>
      {when.text && (
        <span className="hm-when" data-overdue={when.state === 'overdue' || undefined}>
          {when.text}
        </span>
      )}
      {assignee ? (
        <div
          className="hm-ava"
          style={{ background: avatarColor(assignee.id || assignee.email) }}
          title={assignee.display_name || assignee.email}
        >
          {initialOf(assignee.display_name || assignee.email)}
        </div>
      ) : (
        <div className="hm-ava" data-empty="true" title="Unassigned">
          –
        </div>
      )}
    </div>
  );
}
