import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Task } from '@squadhub/shared';
import { useMyTasks, useUpdateTask } from '../../../hooks/useTasks';
import { useMyTimeEntries } from '../../../hooks/useTaskTimeEntries';
import { useParallelTimers } from '../../../hooks/useParallelTimers';
import { usePMStore, todayKey, effectiveFocusBucket, type FocusBucket } from '../../../stores/pmStore';
import { avatarColor, initialOf, formatWhen } from '../pm/taskHelpers';
import { formatTracked, toLocalDateKey } from '../../../lib/formatDuration';
import { groupTasks, isFutureDay, isTaskFocused, collapseGroupedTasks, isGroupedRow, type GroupBy } from '../../../lib/taskGrouping';
import GroupedTaskRow from './GroupedTaskRow';
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

// Hold rows that are mid-completion-animation in the list until their slide-out
// finishes. The My Home task lists come from a query that DROPS done tasks, and
// completing a task triggers a refetch that would otherwise unmount the row
// before its (.35s-delayed) slide can play — so no animation is ever seen.
// Given the fresh server list and the set of fading task ids, this re-inserts
// any fading task the refetch already dropped — at its previous position so it
// doesn't jump — until the row's transitionend clears it via unmarkFading.
function useRetainFading(fresh: Task[], fadingTaskIds: ReadonlyMap<string, string>): Task[] {
  const cacheRef = useRef(new Map<string, Task>());
  const orderRef = useRef<string[]>([]);
  return useMemo(() => {
    const cache = cacheRef.current;
    for (const t of fresh) cache.set(t.id, t);
    const freshIds = new Set(fresh.map((t) => t.id));
    const dropped = [...fadingTaskIds.keys()].filter((id) => !freshIds.has(id) && cache.has(id));

    let result: Task[];
    if (dropped.length === 0) {
      result = fresh;
    } else {
      const byId = new Map<string, Task>(fresh.map((t) => [t.id, t] as const));
      for (const id of dropped) byId.set(id, cache.get(id)!);
      const ordered: Task[] = [];
      const used = new Set<string>();
      // Previous render's order keeps the retained (fading) rows in their slot.
      for (const id of orderRef.current) {
        const t = byId.get(id);
        if (t && !used.has(id)) { ordered.push(t); used.add(id); }
      }
      // Any genuinely new task not seen last render lands at the end.
      for (const t of fresh) if (!used.has(t.id)) { ordered.push(t); used.add(t.id); }
      result = ordered;
    }

    orderRef.current = result.map((t) => t.id);
    // Forget tasks that are neither present nor animating so the cache can't
    // grow without bound across a long session.
    for (const id of [...cache.keys()]) {
      if (!freshIds.has(id) && !fadingTaskIds.has(id)) cache.delete(id);
    }
    return result;
  }, [fresh, fadingTaskIds]);
}

export default function TodayList() {
  const { data, isLoading, isError, refetch } = useMyTasks();
  const setActiveTask = usePMStore((s) => s.setActiveTask);
  const setActiveDashboardTab = usePMStore((s) => s.setActiveDashboardTab);
  const focusBuckets = usePMStore((s) => s.focusBuckets);
  const recurringFocusBuckets = usePMStore((s) => s.recurringFocusBuckets);
  const rolloverFocusBuckets = usePMStore((s) => s.rolloverFocusBuckets);
  const groupedExpanded = usePMStore((s) => s.groupedExpanded);
  const toggleGroupedExpanded = usePMStore((s) => s.toggleGroupedExpanded);
  const focusBucketCollapsed = usePMStore((s) => s.focusBucketCollapsed);
  const setFocusBucketCollapsed = usePMStore((s) => s.setFocusBucketCollapsed);
  const setActiveSpace = usePMStore((s) => s.setActiveSpace);
  const setActiveSpacePage = usePMStore((s) => s.setActiveSpacePage);
  const setActiveList = usePMStore((s) => s.setActiveList);
  const setActiveFolder = usePMStore((s) => s.setActiveFolder);
  const fadingTaskIds = usePMStore((s) => s.fadingTaskIds);

  const openTask = (id: string) => {
    setActiveDashboardTab(null);
    setActiveTask(id);
  };

  // Open a grouped container in the PM module. Setting the active id triggers
  // MainLayout's nav effects, which switch the view to that list/folder/space.
  const openContainer = (c: { type: 'list' | 'folder' | 'space'; id: string }) => {
    setActiveDashboardTab(null);
    if (c.type === 'list') setActiveList(c.id);
    else if (c.type === 'folder') setActiveFolder(c.id);
    else { setActiveSpace(c.id); setActiveSpacePage(c.id); }
  };

  const tz = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', []);

  // Show ONLY tasks the user has starred (★ Focus) — the focus list is
  // persistent and no longer resets overnight. A starred task whose work_date
  // is in the future is hidden until that day arrives (set it ahead → it drops
  // off here, then comes back when its work date is today). The server-side
  // `focused` bucket carries starred tasks regardless of date so they're always
  // candidates here. (done/closed tasks are filtered out server-side.)
  const rawTasks: Task[] = useMemo(() => {
    if (!data) return [];
    const merged = [...data.overdue, ...data.today, ...(data.focused ?? [])];
    const seen = new Set<string>();
    const unique = merged.filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)));
    return unique.filter((t) => isTaskFocused(t) && !isFutureDay(t.work_date, tz));
  }, [data, tz]);
  // Keep just-completed rows rendered until their slide-out finishes. The
  // my-tasks query DROPS done tasks, and completing one triggers a refetch —
  // without this the row unmounts (~250ms) before the .35s-delayed slide even
  // starts, so no animation is ever seen. useRetainFading re-inserts a task
  // that's mid-fade but already gone from the server data, at its prior slot,
  // until the row's transitionend clears it via unmarkFading. See TodayRow.
  const tasks = useRetainFading(rawTasks, fadingTaskIds);

  // "In progress today" — tasks the user has logged time on today (computed
  // server-side, full task objects, most-recently-worked first). These render
  // as their own section ABOVE the focus list and are pulled out of the focus
  // sections below so a worked task never shows up twice.
  const rawInProgress: Task[] = useMemo(() => data?.in_progress_today ?? [], [data]);
  const inProgressTasks = useRetainFading(rawInProgress, fadingTaskIds);
  const inProgressIds = useMemo(() => new Set(inProgressTasks.map((t) => t.id)), [inProgressTasks]);

  // Split the focus list into the main list plus the manual Evening / Night
  // triage buckets that render as their own sections below it. Tasks already in
  // the "In progress today" section are excluded here to avoid duplicates.
  const focusTasks = useMemo(() => tasks.filter((t) => !inProgressIds.has(t.id)), [tasks, inProgressIds]);
  const mainTasks = useMemo(() => focusTasks.filter((t) => !effectiveFocusBucket(t, focusBuckets, recurringFocusBuckets)), [focusTasks, focusBuckets, recurringFocusBuckets]);
  const eveningTasks = useMemo(() => focusTasks.filter((t) => effectiveFocusBucket(t, focusBuckets, recurringFocusBuckets) === 'evening'), [focusTasks, focusBuckets, recurringFocusBuckets]);
  const nightTasks = useMemo(() => focusTasks.filter((t) => effectiveFocusBucket(t, focusBuckets, recurringFocusBuckets) === 'night'), [focusTasks, focusBuckets, recurringFocusBuckets]);

  const groupBy = usePMStore((s) => s.todayListGroupBy);
  const setTodayListGroupBy = usePMStore((s) => s.setTodayListGroupBy);
  const view = usePMStore((s) => s.todayListView);
  const setTodayListView = usePMStore((s) => s.setTodayListView);
  const [menuOpen, setMenuOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);

  const today = useMemo(() => planDateKey(), []);
  const [viewDate, setViewDate] = useState<string>(today);

  // Time tracked TODAY, per task and in total, from saved time entries plus the
  // live elapsed of any running timer. Drives the per-row "tracked today" chip
  // and the total on the In progress header. We only tick the clock while a
  // timer is actually running so the figures advance live without a permanent
  // 1s interval.
  const { data: timeEntries } = useMyTimeEntries();
  const timers = usePMStore((s) => s.timers);
  const timerSegmentStart = usePMStore((s) => s.timerSegmentStart);
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    if (!timers.length) return;
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [timers.length]);
  const { secondsTodayByTask, totalTodaySeconds } = useMemo(() => {
    // Net seconds tracked today per task. We sum the SIGNED duration of every
    // entry — real timer sessions AND negative manual "Time logged" corrections
    // — so this uses the same signed accounting as the task's own logged total
    // (tasks.time_tracked = sum of all its entries). Summing positive entries
    // only (the old behaviour) silently dropped a downward correction, leaving
    // Home showing more time than the task detail's "Time logged". We floor each
    // task's net at 0 below, so a correction still can't push a row or the
    // header total negative — the concern the old `dur <= 0` skip addressed.
    const net = new Map<string, number>();
    for (const e of timeEntries ?? []) {
      if (toLocalDateKey(e.started_at) !== today) continue;
      net.set(e.task_id, (net.get(e.task_id) || 0) + (e.duration_seconds || 0));
    }
    // Live add-on per running task = its equal split of the CURRENT segment
    // only — earlier segments were already flushed into today's entries above,
    // so this can't double-count.
    if (timers.length && timerSegmentStart != null) {
      const live = Math.max(0, Math.floor((nowTick - timerSegmentStart) / 1000 / timers.length));
      if (live > 0) {
        for (const rt of timers) net.set(rt.taskId, (net.get(rt.taskId) || 0) + live);
      }
    }
    const map = new Map<string, number>();
    let total = 0;
    for (const [taskId, secs] of net) {
      const clamped = Math.max(0, secs);
      map.set(taskId, clamped);
      total += clamped;
    }
    return { secondsTodayByTask: map, totalTodaySeconds: total };
  }, [timeEntries, today, timers, timerSegmentStart, nowTick]);

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

  // Auto-expand the Evening / Night buckets once their time of day arrives
  // (Evening ≥ 3 PM, Night ≥ 7 PM). Fires at most once per local day per bucket
  // — autoOpenFocusBucket stamps focusBucketAutoOpenedDate — so a user who
  // re-collapses a section after its threshold isn't fought by the next tick.
  // Reads from getState() inside the interval to avoid stale closures, so the
  // interval is set up only once.
  useEffect(() => {
    const THRESHOLDS: [FocusBucket, number][] = [['evening', 15], ['night', 19]];
    const check = () => {
      const hour = new Date().getHours();
      const dateKey = todayKey();
      const st = usePMStore.getState();
      for (const [bucket, startHour] of THRESHOLDS) {
        if (hour >= startHour && st.focusBucketAutoOpenedDate[bucket] !== dateKey) {
          st.autoOpenFocusBucket(bucket, dateKey);
        }
      }
    };
    check();
    const id = setInterval(check, 60_000);
    return () => clearInterval(id);
  }, []);

  // Roll the Evening / Night buckets back to the main Focus list at local
  // midnight. Non-recurring tasks fall back; recurring tasks keep their section
  // (remembered per template in recurringFocusBuckets, so the next spawned copy
  // reappears there). rolloverFocusBuckets no-ops until the day flips, so the
  // mount call + once-a-minute tick fire it exactly once when midnight passes,
  // even with the app left open.
  useEffect(() => {
    rolloverFocusBuckets();
    const id = setInterval(rolloverFocusBuckets, 60_000);
    return () => clearInterval(id);
  }, [rolloverFocusBuckets]);

  const groups = useMemo(
    () => (groupBy === 'none' ? [] : groupTasks(mainTasks, groupBy, tz, fadingTaskIds)),
    [mainTasks, groupBy, tz, fadingTaskIds],
  );
  const currentLabel = GROUP_OPTIONS.find((o) => o.value === groupBy)?.label ?? 'None';

  // Render a section's rows, collapsing any tasks whose container has Group Tasks
  // ON into one expandable "Grouped tasks under {name}" row. Plain tasks render
  // as normal TodayRows. (The "In progress today" section opts out — see below.)
  const renderTaskRows = (list: Task[]) =>
    collapseGroupedTasks(list).map((item) =>
      isGroupedRow(item) ? (
        <GroupedTaskRow
          key={`grp:${item.key}`}
          row={item}
          expanded={!!groupedExpanded[item.key]}
          onToggle={() => toggleGroupedExpanded(item.key)}
          onOpenContainer={openContainer}
          renderChild={(t) => (
            <TodayRow key={t.id} task={t} onOpen={openTask} secondsToday={secondsTodayByTask.get(t.id) || 0} />
          )}
        />
      ) : (
        <TodayRow key={item.id} task={item} onOpen={openTask} secondsToday={secondsTodayByTask.get(item.id) || 0} />
      ),
    );

  return (
    <>
    {view === 'list' && !isLoading && !isError && inProgressTasks.length > 0 && (
      <div className="hm-card hm-inprogress-card">
        <div className="hm-card-head">
          <span className="hm-live-dot" aria-hidden="true" />
          <h3>In progress today</h3>
          <span className="hm-count">· {inProgressTasks.length}</span>
          <span className="hm-tracked-total" title="Total time tracked today">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
            </svg>
            {formatTracked(totalTodaySeconds) || '0m'}
          </span>
        </div>
        <div className="hm-list">
          {inProgressTasks.map((t) => (
            <TodayRow key={t.id} task={t} onOpen={openTask} secondsToday={secondsTodayByTask.get(t.id) || 0} />
          ))}
        </div>
      </div>
    )}
    <div className="hm-card">
      <div className="hm-card-head">
        <h3>Focus list</h3>
        {view === 'list' && !isLoading && !isError && (
          <span className="hm-count">· {mainTasks.length}</span>
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

          {!isLoading && !isError && focusTasks.length === 0 && (
            <div className="hm-empty">
              <div className="rule" />
              {tasks.length > 0 ? (
                <>
                  <div className="h">All caught up here.</div>
                  <div className="p">Your starred tasks are in progress above.</div>
                </>
              ) : (
                <>
                  <div className="h">Nothing starred yet.</div>
                  <div className="p">Star a task (★) and it shows up here.</div>
                </>
              )}
            </div>
          )}

          {!isLoading && !isError && mainTasks.length > 0 && (
            groupBy === 'none' ? (
              <div className="hm-list">
                {renderTaskRows(mainTasks)}
              </div>
            ) : (
              groups.map((g) => (
                <div key={g.key} className="hm-group">
                  <div className="hm-group-head">
                    <span>{g.label}</span>
                    <span className="count">· {g.tasks.length}</span>
                  </div>
                  <div className="hm-list" style={{ paddingTop: 0 }}>
                    {renderTaskRows(g.tasks)}
                  </div>
                </div>
              ))
            )
          )}

        </>
      )}
    </div>

      {view === 'list' && !isLoading && !isError && eveningTasks.length > 0 && (
        <BucketSection
          title="Evening"
          hint="after 3 PM"
          tasks={eveningTasks}
          collapsed={!!focusBucketCollapsed.evening}
          onToggle={() => setFocusBucketCollapsed('evening', !focusBucketCollapsed.evening)}
          renderRows={renderTaskRows}
        />
      )}

      {view === 'list' && !isLoading && !isError && nightTasks.length > 0 && (
        <BucketSection
          title="Night"
          hint="after 7 PM"
          tasks={nightTasks}
          collapsed={!!focusBucketCollapsed.night}
          onToggle={() => setFocusBucketCollapsed('night', !focusBucketCollapsed.night)}
          renderRows={renderTaskRows}
        />
      )}
    </>
  );
}

// A collapsible "later today" bucket card (Evening / Night) on the Focus list.
// The whole header toggles the section; the chevron rotates and the rows hide
// when collapsed. Auto-expands at its time of day — see the effect in TodayList.
function BucketSection({
  title,
  hint,
  tasks,
  collapsed,
  onToggle,
  renderRows,
}: {
  title: string;
  hint: string;
  tasks: Task[];
  collapsed: boolean;
  onToggle: () => void;
  renderRows: (list: Task[]) => React.ReactNode;
}) {
  return (
    <div className="hm-card hm-bucket-card" data-collapsed={collapsed || undefined}>
      <div
        className="hm-card-head hm-bucket-head"
        role="button"
        tabIndex={0}
        aria-expanded={!collapsed}
        onClick={onToggle}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}
      >
        <span className="hm-bucket-chevron" data-expanded={!collapsed || undefined} aria-hidden="true">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="m9 18 6-6-6-6" />
          </svg>
        </span>
        <h3>{title}</h3>
        <span className="hm-count">· {tasks.length}</span>
        <span className="hm-bucket-hint">{hint}</span>
      </div>
      {!collapsed && (
        <div className="hm-list">
          {renderRows(tasks)}
        </div>
      )}
    </div>
  );
}

function TodayRow({ task: t, onOpen, secondsToday = 0 }: { task: Task; onOpen: (id: string) => void; secondsToday?: number }) {
  const updateTask = useUpdateTask(null);
  const setFocusBucket = usePMStore((s) => s.setFocusBucket);
  const ownBucket = usePMStore((s) => s.focusBuckets[t.id]);
  const recurringFocusBuckets = usePMStore((s) => s.recurringFocusBuckets);
  // Effective section: an explicit per-instance bucket wins; a recurring task
  // otherwise inherits its template's sticky section.
  const bucket = ownBucket ?? (t.recurring_parent_id ? recurringFocusBuckets[t.recurring_parent_id] : undefined);
  const markFading = usePMStore((s) => s.markFading);
  const unmarkFading = usePMStore((s) => s.unmarkFading);
  const isFading = usePMStore((s) => s.fadingTaskIds.has(t.id));
  const { timers, requestStartTimer, stopTimer } = useParallelTimers();
  const isTracking = timers.some((x) => x.taskId === t.id);

  const onTimerClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isTracking) {
      await stopTimer(t.id);
      return;
    }
    // With nothing running this starts the primary timer; otherwise it opens
    // the global conflict dialog offering to add this task as a secondary.
    await requestStartTimer({ taskId: t.id, taskTitle: t.title, listId: t.list_id || '', baseTracked: t.time_tracked || 0 });
  };
  const [isHidden, setIsHidden] = useState(false);
  // Fixed-viewport coordinates for the bucket menu (null = closed). The menu is
  // portaled to <body> and positioned via getBoundingClientRect so it can't be
  // clipped by `.hm-card { overflow: hidden }`.
  const [menuPos, setMenuPos] = useState<{ left: number; top: number } | null>(null);
  const bucketRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const openMenu = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (menuPos) { setMenuPos(null); return; }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const MENU_W = 188;
    const MENU_H = 184;
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
      if (bucketRef.current?.contains(tgt) || menuRef.current?.contains(tgt)) return;
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

  const moveTo = (e: React.MouseEvent, next: FocusBucket | null) => {
    e.stopPropagation();
    // For a recurring task, also persist the section against its template so
    // future copies inherit it and it survives the midnight rollover.
    setFocusBucket(t.id, next, t.recurring_parent_id ?? undefined);
    setMenuPos(null);
  };

  // "Tomorrow" — push the task's work_date to tomorrow's local-midnight (mirrors
  // taskHelpers.nextQuickDate). A future work_date drops the task from the focus
  // list (see TodayList's `!isFutureDay` filter), so hide the row immediately for
  // instant feedback; the refetch then unmounts it for good. Clear any
  // Evening/Night bucket so it doesn't linger client-side if the task comes back.
  const moveToTomorrow = (e: React.MouseEvent) => {
    e.stopPropagation();
    setMenuPos(null);
    if (bucket) setFocusBucket(t.id, null);
    const tomorrow = new Date();
    tomorrow.setHours(0, 0, 0, 0);
    tomorrow.setDate(tomorrow.getDate() + 1);
    setIsHidden(true);
    updateTask.mutate(
      { id: t.id, work_date: tomorrow.toISOString() } as any,
      { onError: () => setIsHidden(false) },
    );
  };

  const when = formatWhen(t.due_date);
  const assignee = t.assignees?.[0];
  const label = t.list?.name || t.space?.name || '';
  const isSubtask = !!t.parent_task_id;
  const parentTitle = t.parent_task?.title || null;
  const status = (t as any).status as string | undefined;
  const isDone = status === 'done' || status === 'closed';
  const displayDone = isDone || isFading;

  const onToggleDone = (e: React.MouseEvent) => {
    e.stopPropagation();
    const next = isDone ? 'todo' : 'done';
    // markFading both celebrates this row and keeps it rendered (via the parent's
    // useRetainFading) through the slide, even after the completion refetch drops
    // the now-done task from the my-tasks list.
    if (!isDone) markFading(t.id, status ?? '');
    updateTask.mutate(
      { id: t.id, status: next } as any,
      { onError: () => { unmarkFading(t.id); setIsHidden(false); } },
    );
  };

  const onRowTransitionEnd = (e: React.TransitionEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    // Clean up when the slide (transform) OR the fade (opacity) finishes. Under
    // prefers-reduced-motion the transform transition is disabled, so without the
    // opacity fallback the row would stay retained (invisible) forever.
    if ((e.propertyName === 'transform' || e.propertyName === 'opacity') && isFading) {
      setIsHidden(true);
      unmarkFading(t.id);
    }
  };

  if (isHidden) return null;

  return (
    <div
      className="hm-task"
      data-done={displayDone}
      data-fading={isFading}
      data-subtask={isSubtask || undefined}
      data-tracking={isTracking || undefined}
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
        data-celebrating={isFading}
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
      {secondsToday > 0 && (
        <span className="hm-tracked" data-live={isTracking || undefined} title="Tracked today">
          {formatTracked(secondsToday)}
        </span>
      )}
      <button
        type="button"
        className="hm-timer-btn"
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
      <div className="hm-bucket" ref={bucketRef}>
        <button
          type="button"
          className="hm-bucket-btn"
          data-open={menuPos ? true : undefined}
          aria-label="Move to later today"
          aria-haspopup="menu"
          aria-expanded={!!menuPos}
          title="Move to later today"
          onClick={openMenu}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m9 18 6-6-6-6" />
          </svg>
        </button>
      </div>
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
      {menuPos && createPortal(
        <div
          ref={menuRef}
          className="hm-bucket-menu"
          role="menu"
          style={{ left: menuPos.left, top: menuPos.top }}
          onClick={(e) => e.stopPropagation()}
        >
          <button type="button" role="menuitem" className="hm-bucket-menu-item" data-active={bucket === 'evening'} onClick={(e) => moveTo(e, 'evening')}>
            <span>Evening</span>
            <span className="dim">after 3 PM</span>
          </button>
          <button type="button" role="menuitem" className="hm-bucket-menu-item" data-active={bucket === 'night'} onClick={(e) => moveTo(e, 'night')}>
            <span>Night</span>
            <span className="dim">after 7 PM</span>
          </button>
          <div className="hm-bucket-menu-sep" role="separator" />
          <button type="button" role="menuitem" className="hm-bucket-menu-item" onClick={moveToTomorrow}>
            <span>Tomorrow</span>
            <span className="dim">moves work date</span>
          </button>
          {bucket && (
            <button type="button" role="menuitem" className="hm-bucket-menu-item" onClick={(e) => moveTo(e, null)}>
              <span>Move to Focus list</span>
            </button>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
