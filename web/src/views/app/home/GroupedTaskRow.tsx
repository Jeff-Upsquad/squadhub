import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Task } from '@squadhub/shared';
import type { GroupedRow } from '../../../lib/taskGrouping';
import { usePMStore, type FocusBucket } from '../../../stores/pmStore';
import { useUpdateTask } from '../../../hooks/useTasks';
import { useActiveGroupRun, useStartGroupRun, useStopGroupRun } from '../../../hooks/useGroupRuns';
import DatePicker from '../pm/DatePicker';
import {
  DND_GROUP_CONTAINER_ID,
  DND_GROUP_CONTAINER_TYPE,
  DND_GROUP_CONTAINER_NAME,
  DND_GROUP_ESTIMATE_TOTAL,
} from '../calendar/calendarUtils';

// A single collapsed "Grouped tasks under {name}" row on Home. Renders like a
// task row (so it sits naturally in a .hm-list). Affordances:
//   - the chevron toggles the inline child task list,
//   - the group icon opens the underlying container in PM (onOpenContainer),
//   - clicking the name/row opens the work-block-style group detail panel,
//     where you can run a focus session on the whole group.
//   - on hover, a timer button toggles a group focus session (same Start/Stop
//     run surfaced in the detail panel) and a "move to later" button opens a
//     menu that applies Evening/Night/Tomorrow/Set-work-date to EVERY task in
//     the group at once — the per-task hover actions, lifted to the group.
//
// Generic over `renderChild` so both Home surfaces reuse it: the Focus list
// passes <TodayRow>, the dashboard panel passes <DashboardTaskRow>.
export default function GroupedTaskRow({
  row,
  expanded,
  onToggle,
  onOpenContainer,
  renderChild,
  draggable = false,
}: {
  row: GroupedRow;
  expanded: boolean;
  onToggle: () => void;
  onOpenContainer?: (container: GroupedRow['container']) => void;
  renderChild: (task: Task) => ReactNode;
  // When true (Day Planner), the collapsed header is draggable onto the
  // calendar, where it becomes ONE combined block sized to the summed estimate.
  draggable?: boolean;
}) {
  const setGroupRunPanel = usePMStore((s) => s.setGroupRunPanel);
  const setFocusBucket = usePMStore((s) => s.setFocusBucket);
  const focusBuckets = usePMStore((s) => s.focusBuckets);
  const updateTask = useUpdateTask(null);

  // Mirror GroupRunDetailPanel.openPanel's key so the timer here and the
  // Start/Stop in the detail panel drive the same server-side group run.
  const groupKey = `group-container:${row.container.type}:${row.container.id}`;
  const groupLabel = `Grouped tasks under ${row.container.name}`;
  const listId = row.container.type === 'list' ? row.container.id : null;

  const { data: activeRun } = useActiveGroupRun();
  const startRun = useStartGroupRun();
  const stopRun = useStopGroupRun();
  const isRunningHere = !!activeRun?.run && activeRun.run.group_key === groupKey && !activeRun.run.ended_at;

  // All tasks in a rendered group share a focus bucket (collapseGroupedTasks
  // runs within a single section's list), so the first task's bucket is the
  // group's bucket — used to mark the active menu item and offer "back to Focus".
  const groupBucket: FocusBucket | null = (row.tasks[0] && focusBuckets[row.tasks[0].id]) || null;

  const openPanel = () => {
    setGroupRunPanel({
      key: groupKey,
      label: groupLabel,
      listId,
      tasks: row.tasks.map((t) => ({ id: t.id, title: t.title })),
    });
  };

  const toggleTimer = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isRunningHere && activeRun?.run) {
      stopRun.mutate({ run_id: activeRun.run.id, group_key: groupKey });
    } else {
      startRun.mutate({ group_key: groupKey, group_label: groupLabel, list_id: listId });
    }
  };

  // ----- "Move to later" menu (applies to every task in the group) -----
  // Fixed-viewport coordinates for the menu (null = closed). Portaled to <body>
  // so it can't be clipped by `.hm-card { overflow: hidden }`. Same pattern as
  // the per-task bucket menu in TodayList.
  const [menuPos, setMenuPos] = useState<{ left: number; top: number } | null>(null);
  // Anchor rect for the work-date picker (null = closed).
  const [dateAnchor, setDateAnchor] = useState<DOMRect | null>(null);
  const bucketRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const openMenu = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (menuPos) { setMenuPos(null); return; }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const MENU_W = 200;
    const MENU_H = 210;
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
    for (const t of row.tasks) setFocusBucket(t.id, next);
    setMenuPos(null);
  };

  // "Tomorrow" — push every task's work_date to tomorrow's local-midnight
  // (mirrors TodayRow.moveToTomorrow). A future work_date drops a task from the
  // focus list, so the whole group slides off after the refetch.
  const moveToTomorrow = (e: React.MouseEvent) => {
    e.stopPropagation();
    setMenuPos(null);
    const tomorrow = new Date();
    tomorrow.setHours(0, 0, 0, 0);
    tomorrow.setDate(tomorrow.getDate() + 1);
    for (const t of row.tasks) {
      if (focusBuckets[t.id]) setFocusBucket(t.id, null);
      updateTask.mutate({ id: t.id, work_date: tomorrow.toISOString() } as any);
    }
  };

  // "Set work date…" — open the shared DatePicker anchored to the move button,
  // then write the chosen date onto EVERY task in the group.
  const openDatePicker = (e: React.MouseEvent) => {
    e.stopPropagation();
    const rect = bucketRef.current?.getBoundingClientRect() ?? null;
    setMenuPos(null);
    setDateAnchor(rect);
  };

  const applyWorkDate = (next: string | null) => {
    for (const t of row.tasks) {
      updateTask.mutate({ id: t.id, work_date: next } as any);
    }
  };

  return (
    <>
      <div
        className="hm-task hm-grouped"
        data-expanded={expanded || undefined}
        data-tracking={isRunningHere || undefined}
        draggable={draggable || undefined}
        onDragStart={
          draggable
            ? (e) => {
                const total = row.tasks.reduce((s, t) => s + (t.time_estimate ?? 30), 0);
                e.dataTransfer.setData(DND_GROUP_CONTAINER_ID, row.container.id);
                e.dataTransfer.setData(DND_GROUP_CONTAINER_TYPE, row.container.type);
                e.dataTransfer.setData(DND_GROUP_CONTAINER_NAME, row.container.name);
                e.dataTransfer.setData(DND_GROUP_ESTIMATE_TOTAL, String(total));
                e.dataTransfer.effectAllowed = 'copyMove';
              }
            : undefined
        }
        onClick={openPanel}
        role="button"
        tabIndex={0}
        aria-label={`Open ${row.container.name} group session`}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPanel(); }
        }}
      >
        <span
          className="hm-grouped-chevron"
          data-expanded={expanded || undefined}
          role="button"
          tabIndex={0}
          aria-label={expanded ? 'Collapse' : 'Expand'}
          title={expanded ? 'Collapse' : 'Expand'}
          onClick={(e) => { e.stopPropagation(); onToggle(); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onToggle(); }
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="m9 18 6-6-6-6" />
          </svg>
        </span>
        <span
          className="hm-grouped-icon"
          role={onOpenContainer ? 'button' : undefined}
          tabIndex={onOpenContainer ? 0 : undefined}
          aria-hidden={onOpenContainer ? undefined : 'true'}
          aria-label={onOpenContainer ? `Open ${row.container.name}` : undefined}
          title={onOpenContainer ? `Open ${row.container.name}` : undefined}
          onClick={(e) => {
            if (!onOpenContainer) return;
            e.stopPropagation();
            onOpenContainer(row.container);
          }}
          onKeyDown={(e) => {
            if (!onOpenContainer) return;
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onOpenContainer(row.container); }
          }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m12 2 9 4.5-9 4.5-9-4.5L12 2Z" />
            <path d="m3 12 9 4.5 9-4.5" />
            <path d="m3 17 9 4.5 9-4.5" />
          </svg>
        </span>
        <div className="t">
          <span className="title hm-grouped-title">
            Grouped tasks under {row.container.name}
          </span>
        </div>
        <button
          type="button"
          className="hm-timer-btn"
          data-active={isRunningHere || undefined}
          aria-label={isRunningHere ? 'Stop group session' : 'Start group session'}
          title={isRunningHere ? 'Stop group session' : 'Start group session'}
          onClick={toggleTimer}
        >
          {isRunningHere ? (
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
            aria-label="Move group to later today"
            aria-haspopup="menu"
            aria-expanded={!!menuPos}
            title="Move group to later today"
            onClick={openMenu}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m9 18 6-6-6-6" />
            </svg>
          </button>
        </div>
        <span className="hm-count">· {row.count}</span>
      </div>
      {menuPos && createPortal(
        <div
          ref={menuRef}
          className="hm-bucket-menu"
          role="menu"
          style={{ left: menuPos.left, top: menuPos.top }}
          onClick={(e) => e.stopPropagation()}
        >
          <button type="button" role="menuitem" className="hm-bucket-menu-item" data-active={groupBucket === 'evening'} onClick={(e) => moveTo(e, 'evening')}>
            <span>Evening</span>
            <span className="dim">after 3 PM</span>
          </button>
          <button type="button" role="menuitem" className="hm-bucket-menu-item" data-active={groupBucket === 'night'} onClick={(e) => moveTo(e, 'night')}>
            <span>Night</span>
            <span className="dim">after 7 PM</span>
          </button>
          <div className="hm-bucket-menu-sep" role="separator" />
          <button type="button" role="menuitem" className="hm-bucket-menu-item" onClick={openDatePicker}>
            <span>Set work date…</span>
            <span className="dim">all {row.count} tasks</span>
          </button>
          <button type="button" role="menuitem" className="hm-bucket-menu-item" onClick={moveToTomorrow}>
            <span>Tomorrow</span>
            <span className="dim">moves work date</span>
          </button>
          {groupBucket && (
            <button type="button" role="menuitem" className="hm-bucket-menu-item" onClick={(e) => moveTo(e, null)}>
              <span>Move to Focus list</span>
            </button>
          )}
        </div>,
        document.body,
      )}
      {dateAnchor && createPortal(
        <DatePicker
          anchorRect={dateAnchor}
          value={row.tasks[0]?.work_date ?? null}
          mode="datetime"
          onChange={applyWorkDate}
          onClose={() => setDateAnchor(null)}
        />,
        document.body,
      )}
      {expanded && (
        <div className="hm-list hm-grouped-children" style={{ paddingTop: 0 }}>
          {row.tasks.map((t) => renderChild(t))}
        </div>
      )}
    </>
  );
}
