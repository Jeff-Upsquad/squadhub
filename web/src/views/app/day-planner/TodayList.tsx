import { useEffect, useMemo, useRef, useState } from 'react';
import type { Task } from '@squadhub/shared';
import { usePMStore } from '../../../stores/pmStore';
import { useDayPlannerTasks, useUnscheduledTasks, useDayPlans, useFocusTask, planDateKey } from '../../../hooks/useDayPlanner';
import { groupTasks, collapseGroupedTasks, isGroupedRow, GROUP_BY_OPTIONS, type GroupBy } from '../../../lib/taskGrouping';
import GroupedTaskRow from '../home/GroupedTaskRow';
import SnoozeMenu from './SnoozeMenu';

type Badge = 'overdue' | 'today' | 'focus' | 'starts';

// Group-by options mirror Home's Focus list plus Space/Folder/List, so the
// planner palette groups exactly like every other surface. "Work date" stays
// because planning is fundamentally about when you'll do the work.
const GROUP_OPTIONS = GROUP_BY_OPTIONS;

// Persisted under its own scope key so the planner's grouping is independent of
// Home's Focus list (both ride the shared, server-synced groupByScope map).
const GROUP_SCOPE = 'day-planner';
// Status grouping wants a fading-status map for completion animations; the
// palette has none, so a stable empty map keeps the memo dependency constant.
const NO_FADING: ReadonlyMap<string, string> = new Map();

// Capacity the "planned today" meter measures against — a standard 8h workday.
const DAY_CAPACITY_MIN = 8 * 60;

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

// 90 → "1h 30m", 45 → "45m", 120 → "2h".
export function fmtDuration(min: number): string {
  const m = Math.max(0, Math.round(min));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${r}m`;
  return r ? `${h}h ${r}m` : `${h}h`;
}

function priorityChip(p: Task['priority']): { level: 'emg' | 'p0' | 'p1'; label: string } | null {
  if (p === 'emergency') return { level: 'emg', label: 'Emergency' };
  if (p === 'urgent') return { level: 'p0', label: 'Urgent' };
  if (p === 'high') return { level: 'p1', label: 'High' };
  return null;
}

export default function TodayList() {
  const { data: tasks = [], isLoading } = useDayPlannerTasks();
  const { data: unscheduled = [], isLoading: unscheduledLoading } = useUnscheduledTasks();
  const focusTask = useFocusTask();
  const setActiveTask = usePMStore((s) => s.setActiveTask);

  // Group-by preference (persisted, planner-scoped) + multi-home expand state.
  const groupBy = (usePMStore((s) => s.groupByScope[GROUP_SCOPE]) ?? 'none') as GroupBy;
  const setScopedGroupBy = usePMStore((s) => s.setScopedGroupBy);
  const groupedExpanded = usePMStore((s) => s.groupedExpanded);
  const toggleGroupedExpanded = usePMStore((s) => s.toggleGroupedExpanded);

  // Setters used to open a grouped container in the PM module (group-row icon).
  const setActiveDashboardTab = usePMStore((s) => s.setActiveDashboardTab);
  const setActiveSpace = usePMStore((s) => s.setActiveSpace);
  const setActiveSpacePage = usePMStore((s) => s.setActiveSpacePage);
  const setActiveList = usePMStore((s) => s.setActiveList);
  const setActiveFolder = usePMStore((s) => s.setActiveFolder);

  const [snoozeAnchor, setSnoozeAnchor] = useState<{ taskId: string; isSnoozed: boolean; left: number; top: number } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const headActionsRef = useRef<HTMLDivElement>(null);

  // Bottom "No date" section — off by default, persisted per browser.
  const [showUnscheduled, setShowUnscheduled] = useState(() => {
    try {
      return localStorage.getItem('dp-show-unscheduled') === '1';
    } catch {
      return false;
    }
  });
  const toggleUnscheduled = () => {
    setShowUnscheduled((v) => {
      try {
        localStorage.setItem('dp-show-unscheduled', v ? '0' : '1');
      } catch { /* ignore */ }
      return !v;
    });
  };

  const tz = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', []);

  const { todayStr, yesterdayStr, tomorrowStr, todayLabel } = useMemo(() => {
    const now = new Date();
    const dayMs = 24 * 60 * 60 * 1000;
    return {
      todayStr: planDateKey(now),
      yesterdayStr: planDateKey(new Date(now.getTime() - dayMs)),
      tomorrowStr: planDateKey(new Date(now.getTime() + dayMs)),
      todayLabel: new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(now),
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
  // Containers already dropped as a combined group block today — hide those
  // grouped rows from the palette (mirrors how a scheduled single task vanishes).
  const scheduledContainerIds = useMemo(
    () => new Set(todayPlans.filter((p) => p.kind === 'group_block' && p.container).map((p) => p.container!.id)),
    [todayPlans],
  );
  const matchesQuery = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return () => true;
    return (t: Task) =>
      t.title.toLowerCase().includes(q) ||
      !!t.list?.name?.toLowerCase().includes(q) ||
      !!t.space?.name?.toLowerCase().includes(q);
  }, [query]);
  const unplannedTasks = useMemo(
    () => tasks.filter((t) => !scheduledTaskIds.has(t.id)),
    [tasks, scheduledTaskIds],
  );
  const visibleTasks = useMemo(() => unplannedTasks.filter(matchesQuery), [unplannedTasks, matchesQuery]);
  const visibleUnscheduled = useMemo(
    () => unscheduled.filter((t) => !scheduledTaskIds.has(t.id)).filter(matchesQuery),
    [unscheduled, scheduledTaskIds, matchesQuery],
  );

  // Day summary — what's already on today's grid vs. what's still waiting.
  const plannedMin = useMemo(
    () => todayPlans
      .filter((p) => !p.all_day && !(p.start_minute === 0 && p.duration_minutes === 1440))
      .reduce((sum, p) => sum + p.duration_minutes, 0),
    [todayPlans],
  );
  const toPlanMin = useMemo(
    () => unplannedTasks.reduce((sum, t) => sum + (t.time_estimate ?? 0), 0),
    [unplannedTasks],
  );
  const plannedPct = Math.min(100, Math.round((plannedMin / DAY_CAPACITY_MIN) * 100));
  const overCapacity = plannedMin > DAY_CAPACITY_MIN;

  const groups = useMemo(
    () => (groupBy === 'none' ? [] : groupTasks(visibleTasks, groupBy, tz, NO_FADING)),
    [visibleTasks, groupBy, tz],
  );

  // Close the group-by menu on an outside click or Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (headActionsRef.current && !headActionsRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const openContainer = (c: { type: 'list' | 'folder' | 'space'; id: string }) => {
    setActiveDashboardTab(null);
    if (c.type === 'list') setActiveList(c.id);
    else if (c.type === 'folder') setActiveFolder(c.id);
    else { setActiveSpace(c.id); setActiveSpacePage(c.id); }
  };

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
      left: Math.max(8, rect.right - 220),
      top: flipUp ? rect.top - MENU_HEIGHT - MARGIN : rect.bottom + MARGIN,
    });
  };

  // A single draggable palette row. Used both as a top-level row and as the
  // child renderer for collapsed multi-home ("ALSO IN") groups, so a grouped
  // task drags onto the calendar exactly like any other task.
  const renderRow = (t: Task) => {
    const badges = badgesFor(t, todayStr, yesterdayStr, tomorrowStr).filter((b) => b !== 'today');
    const pri = priorityChip(t.priority);
    const isFocused = !!t.focused_at;
    // One date is enough to plan with: overdue due date first, then work, then start.
    const dateLabel = t.due_date
      ? `Due ${fmtDate(t.due_date)}`
      : t.work_date
        ? `Work ${fmtDate(t.work_date)}`
        : t.start_date
          ? `Starts ${fmtDate(t.start_date)}`
          : null;
    const crumbs = [t.space?.name, t.folder?.name, t.list?.name].filter(Boolean) as string[];
    return (
      <div
        key={t.id}
        className="dp-row"
        role="button"
        tabIndex={0}
        draggable
        data-dragging={draggingId === t.id || undefined}
        data-priority={pri?.level}
        onDragStart={(e) => {
          e.dataTransfer.setData('application/x-task-id', t.id);
          e.dataTransfer.setData('application/x-task-estimate', String(t.time_estimate ?? 30));
          // Recurrence template id (empty for non-recurring) so a drop into the
          // Evening/Night window can make the section stick for future copies.
          e.dataTransfer.setData('application/x-task-recurring-parent', t.recurring_parent_id ?? '');
          // Match the slot's dropEffect='move' — see DayCalendar.
          e.dataTransfer.effectAllowed = 'copyMove';
          setDraggingId(t.id);
        }}
        onDragEnd={() => setDraggingId(null)}
        onClick={() => setActiveTask(t.id)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActiveTask(t.id); } }}
        title="Click to open · drag onto the calendar to schedule"
      >
        <span className="grip" aria-hidden="true">
          <svg width="8" height="14" viewBox="0 0 8 14" fill="currentColor">
            <circle cx="2" cy="2" r="1.2" /><circle cx="6" cy="2" r="1.2" />
            <circle cx="2" cy="7" r="1.2" /><circle cx="6" cy="7" r="1.2" />
            <circle cx="2" cy="12" r="1.2" /><circle cx="6" cy="12" r="1.2" />
          </svg>
        </span>
        <button
          type="button"
          className="star"
          data-on={isFocused}
          onClick={(e) => { e.stopPropagation(); focusTask.mutate({ id: t.id, focused: !isFocused }); }}
          title={isFocused ? 'Remove from Focus today' : 'Mark as Focus today'}
          aria-label={isFocused ? 'Remove from Focus today' : 'Mark as Focus today'}
          aria-pressed={isFocused}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill={isFocused ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={1.7} strokeLinejoin="round">
            <path d="M12 2.5l2.97 6.02 6.65.97-4.81 4.69 1.13 6.62L12 17.7l-5.94 3.12 1.13-6.62L2.38 9.49l6.65-.97L12 2.5z" />
          </svg>
        </button>
        <div className="body">
          <div className="title">{t.title}</div>
          {crumbs.length > 0 && (
            <div className="crumb" title={crumbs.join(' › ')}>
              {crumbs.map((c, i) => (
                <span key={i} className="part">
                  {i > 0 && <span className="sep">›</span>}
                  <span className="name">{c}</span>
                </span>
              ))}
            </div>
          )}
          {(pri || badges.length > 0 || dateLabel) && (
            <div className="meta">
              {pri && (
                <span className="dp-tag pri" data-level={pri.level}>
                  <span className="dot" />
                  {pri.label}
                </span>
              )}
              {badges.map((b) => (
                <span key={b} className={`dp-tag ${b}`}>{badgeLabel(b)}</span>
              ))}
              {dateLabel && <span className="dp-date" data-overdue={badges.includes('overdue') || undefined}>{dateLabel}</span>}
            </div>
          )}
        </div>
        <div className="side">
          <span className="est" data-empty={!t.time_estimate || undefined} title={t.time_estimate ? 'Estimate' : 'No estimate — schedules as 30m'}>
            {t.time_estimate ? fmtDuration(t.time_estimate) : '30m'}
          </span>
          <button type="button" className="snooze" onClick={(e) => openSnooze(e, t)} title="Snooze" aria-label="Snooze task">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="13" r="8" />
              <path d="M12 9v4l2.5 1.5M5 3 2.5 5.5M19 3l2.5 2.5" />
            </svg>
          </button>
        </div>
      </div>
    );
  };

  // Collapse multi-homed tasks into one expandable "Grouped tasks under {name}"
  // row (same as Home); plain tasks render as normal draggable rows.
  const renderRows = (list: Task[]) =>
    collapseGroupedTasks(list)
      // Hide a group whose combined block is already on today's calendar.
      .filter((item) => !(isGroupedRow(item) && scheduledContainerIds.has(item.container.id)))
      .map((item) =>
        isGroupedRow(item) ? (
          <GroupedTaskRow
            key={`grp:${item.key}`}
            row={item}
            expanded={!!groupedExpanded[item.key]}
            onToggle={() => toggleGroupedExpanded(item.key)}
            onOpenContainer={openContainer}
            renderChild={renderRow}
            draggable
          />
        ) : (
          renderRow(item)
        ),
      );

  const currentLabel = GROUP_OPTIONS.find((o) => o.value === groupBy)?.label ?? 'None';
  const filtering = query.trim().length > 0;

  return (
    <div className="dp-list">
      <div className="dp-list-head">
        <div className="dp-list-title">
          <div className="min-w-0">
            <h2>Planner</h2>
            <div className="sub">{todayLabel}</div>
          </div>
          <div className="dp-head-actions" ref={headActionsRef}>
            <button
              type="button"
              className="hm-pill"
              onClick={() => setMenuOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 6h16M7 12h10M10 18h4" />
              </svg>
              {groupBy === 'none' ? 'Group' : currentLabel}
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
            {menuOpen && (
              <div className="hm-menu" role="menu">
                <div className="hm-menu-label">Group tasks by</div>
                {GROUP_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    role="menuitemradio"
                    aria-checked={groupBy === opt.value}
                    className="hm-menu-item"
                    data-active={groupBy === opt.value}
                    onClick={() => { setScopedGroupBy(GROUP_SCOPE, opt.value); setMenuOpen(false); }}
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
        </div>

        {/* Day summary: how full today's calendar is, and what's left to place. */}
        <div className="dp-summary" data-over={overCapacity || undefined}>
          <div className="dp-summary-stats">
            <div className="stat">
              <span className="v">{fmtDuration(plannedMin)}</span>
              <span className="k">planned</span>
            </div>
            <div className="stat">
              <span className="v">{unplannedTasks.length}</span>
              <span className="k">to place</span>
            </div>
            <div className="stat">
              <span className="v">{fmtDuration(toPlanMin)}</span>
              <span className="k">left to plan</span>
            </div>
          </div>
          <div
            className="dp-meter"
            role="meter"
            aria-label="Planned time against an 8 hour day"
            aria-valuemin={0}
            aria-valuemax={DAY_CAPACITY_MIN}
            aria-valuenow={Math.min(plannedMin, DAY_CAPACITY_MIN)}
          >
            <span style={{ width: `${plannedPct}%` }} />
          </div>
          <div className="dp-meter-caption">
            {overCapacity
              ? `${fmtDuration(plannedMin - DAY_CAPACITY_MIN)} over an 8h day`
              : `${fmtDuration(DAY_CAPACITY_MIN - plannedMin)} free in an 8h day`}
          </div>
        </div>

        <label className="dp-search">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') setQuery(''); }}
            placeholder="Filter tasks"
            aria-label="Filter tasks"
          />
          {filtering && (
            <button type="button" className="clear" onClick={() => setQuery('')} aria-label="Clear filter">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          )}
        </label>
      </div>

      <div className="dp-tray">
        <div className="dp-tray-hint">
          <span>{filtering ? `${visibleTasks.length} matching` : 'To plan'}</span>
          <span className="drag-hint">Drag onto the calendar →</span>
        </div>
        {isLoading && visibleTasks.length === 0 ? (
          <div className="dp-skeletons" aria-label="Loading tasks">
            <div className="dp-skel" /><div className="dp-skel" /><div className="dp-skel" />
          </div>
        ) : visibleTasks.length === 0 ? (
          <div className="dp-empty">
            <span className="ico" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                {tasks.length > 0 && !filtering
                  ? <path d="M5 13l4 4L19 7" />
                  : <><rect x="3" y="4.5" width="18" height="17" rx="3" /><path d="M3 9.5h18M8 2.5v4M16 2.5v4" /></>}
              </svg>
            </span>
            <span className="t">
              {filtering
                ? 'No tasks match'
                : tasks.length === 0
                  ? 'Nothing to plan yet'
                  : 'Everything is scheduled'}
            </span>
            <span className="s">
              {filtering
                ? 'Try a different word, or clear the filter.'
                : tasks.length === 0
                  ? 'Star a task or give it a work date to see it here.'
                  : 'Remove a block from the calendar to bring its task back.'}
            </span>
          </div>
        ) : groupBy === 'none' ? (
          <div className="dp-cards">{renderRows(visibleTasks)}</div>
        ) : (
          groups.map((g) => (
            <div key={g.key} className="hm-group">
              <div className="hm-group-head">
                {g.color && <span className="swatch" aria-hidden="true" style={{ background: g.color }} />}
                <span>{g.label}</span>
                <span className="count">{g.tasks.length}</span>
              </div>
              <div className="dp-cards">{renderRows(g.tasks)}</div>
            </div>
          ))
        )}
      </div>

      {/* Dateless tasks assigned to you — hidden from the planner by design.
          Collapsed by default; toggle persists in localStorage. Sticky bottom
          bar so it's always visible, with a count pill so it can't be missed. */}
      <div className="dp-nodate" data-open={showUnscheduled || undefined}>
        <button
          type="button"
          className="dp-nodate-toggle"
          onClick={toggleUnscheduled}
          aria-expanded={showUnscheduled}
          title={showUnscheduled ? 'Hide tasks without dates' : 'Show tasks without dates'}
        >
          <span className="ico" aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4.5" width="18" height="17" rx="3" />
              <path d="M3 9.5h18M8 2.5v4M16 2.5v4" />
              <path d="M9.5 15.5l1.2 1.2 2.8-2.8" />
            </svg>
          </span>
          <span className="txt">
            <span className="t">Tasks with no date</span>
            <span className="s">
              {showUnscheduled ? 'Drag one onto the calendar to schedule it' : 'Review and plan the ones without a date'}
            </span>
          </span>
          <span className="count" data-zero={visibleUnscheduled.length === 0 || undefined} aria-label={`${visibleUnscheduled.length} tasks with no date`}>
            {unscheduledLoading ? '…' : visibleUnscheduled.length}
          </span>
          <svg className="chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 15l6-6 6 6" />
          </svg>
        </button>
        {showUnscheduled && (
          <div className="dp-nodate-body">
            {unscheduledLoading && visibleUnscheduled.length === 0 ? (
              <div className="dp-skeletons"><div className="dp-skel" /><div className="dp-skel" /></div>
            ) : visibleUnscheduled.length === 0 ? (
              <div className="dp-empty compact"><span className="s">No dateless tasks assigned to you.</span></div>
            ) : (
              <div className="dp-cards">{renderRows(visibleUnscheduled)}</div>
            )}
          </div>
        )}
      </div>

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
