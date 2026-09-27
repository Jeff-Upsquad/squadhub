import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getTaskStatusCategory } from '@squadhub/shared';
import { usePMStore, focusBucketForMinute } from '../../../stores/pmStore';
import { useUpdateTask } from '../../../hooks/useTasks';
import {
  planDateKey,
  useDayPlans,
  useScheduleTaskOnDay,
  useUnscheduleTask,
  useUpdateDayPlan,
  useScheduleGroupOnDay,
  useUpdateGroupDayPlan,
  useUnscheduleGroup,
} from '../../../hooks/useDayPlanner';
import {
  dayToWorkDateISO,
  slotToWorkDateISO,
  groupRunTargetFromContainer,
  DND_GROUP_CONTAINER_ID,
  DND_GROUP_CONTAINER_TYPE,
  DND_GROUP_CONTAINER_NAME,
  DND_GROUP_ESTIMATE_TOTAL,
  DND_TASK_RECURRING_PARENT,
} from '../calendar/calendarUtils';
import { useSlotDragCreate, SlotCreatePanel } from './SlotCreate';

type GroupContainer = { type: 'list' | 'folder' | 'space'; id: string; name: string };

const HOURS = 24;
const PX_PER_MIN = 1; // each hour row is 60px tall
const SNAP_MIN = 15;
// How long a removed block stays mounted to play its slide-out animation.
// Must match the dp-block-exit keyframe duration in globals.css.
const EXIT_MS = 450;

interface Props {
  date: string;  // YYYY-MM-DD being viewed
  today: string; // YYYY-MM-DD that means "today" in user's tz
  onDateChange: (next: string) => void;
  // ←/→ step a day, T jumps to today. Only the standalone planner opts in —
  // the Home embed shares the page with other keyboard-driven lists.
  keyboard?: boolean;
  // Extra header controls (the planner's Day/Week/Month switcher).
  toolbar?: ReactNode;
}

function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + n);
  return planDateKey(dt);
}

// ISO week number — what Sunsama and most week-aware tools show.
function isoWeekNumber(d: Date): number {
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dayNr = (target.getDay() + 6) % 7; // Mon=0..Sun=6
  target.setDate(target.getDate() - dayNr + 3);
  const firstThursday = new Date(target.getFullYear(), 0, 4);
  const diff = target.getTime() - firstThursday.getTime();
  return 1 + Math.round(diff / (7 * 24 * 60 * 60 * 1000));
}

function fmtHourLabel(h: number): string {
  if (h === 0) return '12am';
  if (h < 12) return `${h}am`;
  if (h === 12) return '12pm';
  return `${h - 12}pm`;
}

function fmtMinAsClock(m: number): string {
  const h = Math.floor(m / 60);
  const mm = m % 60;
  const hh12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  const ampm = h < 12 ? 'am' : 'pm';
  return `${hh12}:${mm.toString().padStart(2, '0')}${ampm}`;
}

// "9:15am-9:45am" for ranged blocks; "8:00am" for single-point/short blocks.
function fmtTimeRange(start: number, duration: number): string {
  const startStr = fmtMinAsClock(start);
  if (duration < 30) return startStr;
  const end = Math.min(1440, start + duration);
  return `${startStr} – ${fmtMinAsClock(end)}`;
}

function snap(min: number): number {
  return Math.max(0, Math.min(1440 - 1, Math.round(min / SNAP_MIN) * SNAP_MIN));
}

// 45 → "45m", 90 → "1h 30m".
function fmtDur(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

// Working-hours band — rows outside it get a quieter background.
const WORK_START_H = 8;
const WORK_END_H = 19;

// Timezone name from the browser: long ("India Standard Time") for tooltips,
// short ("GMT+5:30") for the narrow gutter. Falls back to a "GMT+offset"
// string if Intl can't resolve a name.
function tzLabel(style: 'long' | 'short' = 'long'): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: style }).formatToParts(new Date());
    const name = parts.find((p) => p.type === 'timeZoneName')?.value;
    if (name) return name;
  } catch {
    /* fallthrough */
  }
  const offsetMin = -new Date().getTimezoneOffset();
  const sign = offsetMin >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMin);
  const hh = Math.floor(abs / 60);
  const mm = abs % 60;
  return `GMT${sign}${hh}${mm > 0 ? ':' + mm.toString().padStart(2, '0') : ''}`;
}

// Plans created during the brief life of the legacy all-day row used
// start_minute=0 + duration_minutes=1440 as a sentinel. Those real rows are
// hidden from the timed grid (a 24-hour block at midnight isn't useful);
// today's all-day strip is fed by `all_day` virtual rows from the server.
function isAllDaySentinel(p: { start_minute: number; duration_minutes: number }) {
  return p.start_minute === 0 && p.duration_minutes === 1440;
}

function dateFieldLabel(f?: 'work' | 'due' | 'start'): string {
  if (f === 'due') return 'Due';
  if (f === 'start') return 'Starts';
  return 'Work';
}

export default function DayCalendar({ date, today, onDateChange, keyboard = false, toolbar }: Props) {
  const { data: plans = [], isLoading } = useDayPlans(date);
  const schedule = useScheduleTaskOnDay();
  const unschedule = useUnscheduleTask();
  const updatePlan = useUpdateDayPlan();
  const scheduleGroup = useScheduleGroupOnDay();
  const updateGroupPlan = useUpdateGroupDayPlan();
  const unscheduleGroup = useUnscheduleGroup();
  const updateTask = useUpdateTask(null);
  const setActiveTask = usePMStore((s) => s.setActiveTask);
  const setFocusBucket = usePMStore((s) => s.setFocusBucket);
  const setGroupRunPanel = usePMStore((s) => s.setGroupRunPanel);
  const qc = useQueryClient();

  // Work-date edits made inside the open task panel defer their calendar
  // refresh (see useUpdateTask) so the block stays put while editing. When the
  // panel closes, refetch — the removed block then plays its slide-out
  // animation on return. (DayPlannerView has the same guard for range modes
  // where this component isn't mounted; double-invalidation is harmless.)
  const activeTaskId = usePMStore((s) => s.activeTaskId);
  const prevActiveTask = useRef<string | null>(null);
  useEffect(() => {
    if (prevActiveTask.current != null && activeTaskId == null) {
      qc.invalidateQueries({ queryKey: ['day-plans'] });
      qc.invalidateQueries({ queryKey: ['day-planner'] });
      qc.invalidateQueries({ queryKey: ['my-tasks'] });
    }
    prevActiveTask.current = activeTaskId;
  }, [activeTaskId, qc]);

  // Snapped minute under the cursor while a palette row is dragged over the
  // grid — drives the "drop here" ghost so the landing time is visible.
  const [dragOverMin, setDragOverMin] = useState<number | null>(null);
  // Click-and-drag on empty grid space → new task in that slot.
  const slotCreate = useSlotDragCreate(PX_PER_MIN);
  const [allDayOver, setAllDayOver] = useState(false);
  // Block being moved via mousedown drag — drives the live preview position.
  const [moving, setMoving] = useState<{
    planId: string;
    taskId: string;
    duration: number;
    previewStart: number;
    threshold: boolean;
  } | null>(null);
  // Live preview while a top/bottom resize handle is being dragged.
  const [resizing, setResizing] = useState<{
    planId: string;
    previewStart: number;
    previewDur: number;
  } | null>(null);
  const [nowMinute, setNowMinute] = useState(() => {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  });

  useEffect(() => {
    const t = setInterval(() => {
      const d = new Date();
      setNowMinute(d.getHours() * 60 + d.getMinutes());
    }, 60_000);
    return () => clearInterval(t);
  }, []);

  // On mount (and when navigating back to today), position the current-time
  // line near the top of the visible calendar viewport so the user starts
  // looking at "now + upcoming hours" rather than the middle of the day.
  const calRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const isToday = date === today;
  useEffect(() => {
    if (!isToday) return;
    // Wait one tick so the grid + sticky headers are laid out.
    const id = window.setTimeout(() => {
      const cal = calRef.current;
      if (!cal || !gridRef.current) return;
      // The sticky header + all-day strip sit above the grid and occupy
      // exactly grid.offsetTop of the viewport, so scrolling by the now-line's
      // minute offset (minus an hour of headroom) lands it just below them.
      cal.scrollTop = Math.max(0, (nowMinute - 60) * PX_PER_MIN);
    }, 0);
    return () => window.clearTimeout(id);
  // We want this to fire only when isToday flips on (initial mount, or after
  // navigating back to today) — not every minute as nowMinute ticks.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isToday]);

  // A drag cancelled outside the grid (Esc, drop elsewhere) never fires the
  // grid's dragleave — clear the ghost whenever any drag ends.
  useEffect(() => {
    const clear = () => setDragOverMin(null);
    document.addEventListener('dragend', clear);
    document.addEventListener('drop', clear);
    return () => {
      document.removeEventListener('dragend', clear);
      document.removeEventListener('drop', clear);
    };
  }, []);

  useEffect(() => {
    if (!keyboard) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      if (e.key === 'ArrowLeft') onDateChange(addDays(date, -1));
      else if (e.key === 'ArrowRight') onDateChange(addDays(date, 1));
      else if (e.key === 't' || e.key === 'T') onDateChange(today);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [keyboard, date, today, onDateChange]);

  // Date-only occurrences go to the all-day strip; everything else (minus
  // legacy all-day sentinels) lands on the timed grid.
  const allDayPlans = useMemo(() => plans.filter((p) => p.all_day === true), [plans]);
  const timedPlans = useMemo(
    () => plans.filter((p) => !p.all_day && !isAllDaySentinel(p)),
    [plans],
  );

  // Sort + lay out timed plans in overlap columns.
  const positioned = useMemo(() => positionBlocks(timedPlans), [timedPlans]);

  // Blocks that just left this day (work date moved to tomorrow, block
  // unscheduled, …) stay mounted briefly with data-exiting so they slide out
  // to the right instead of popping off the grid. Snapshots keep each block's
  // exact position + column width so there's no jump before the animation.
  // Day navigation (←/→/Today) swaps the whole grid — no exit animation there.
  const [exitingTimed, setExitingTimed] = useState<Positioned[]>([]);
  const [exitingAllDay, setExitingAllDay] = useState<any[]>([]);
  const prevTimed = useRef<Map<string, Positioned>>(new Map());
  const prevAllDay = useRef<Map<string, any>>(new Map());
  const exitingDate = useRef(date);
  useEffect(() => {
    if (exitingDate.current !== date) {
      exitingDate.current = date;
      prevTimed.current = new Map(positioned.map((p) => [p.id, p]));
      prevAllDay.current = new Map(allDayPlans.map((p: any) => [p.id, p]));
      setExitingTimed([]);
      setExitingAllDay([]);
      return;
    }
    const curTimed = new Map(positioned.map((p) => [p.id, p]));
    const removedTimed = [...prevTimed.current.values()].filter((p) => !curTimed.has(p.id));
    prevTimed.current = curTimed;
    const curAll = new Map(allDayPlans.map((p: any) => [p.id, p]));
    const removedAll = [...prevAllDay.current.values()].filter((p) => !curAll.has(p.id));
    prevAllDay.current = curAll;
    if (removedTimed.length === 0 && removedAll.length === 0) return;
    if (removedTimed.length > 0) {
      setExitingTimed((curEx) => {
        const ids = new Set(curEx.map((p) => p.id));
        return [...curEx, ...removedTimed.filter((p) => !ids.has(p.id))];
      });
    }
    if (removedAll.length > 0) {
      setExitingAllDay((curEx) => {
        const ids = new Set(curEx.map((p) => p.id));
        return [...curEx, ...removedAll.filter((p) => !ids.has(p.id))];
      });
    }
    const t = window.setTimeout(() => {
      if (removedTimed.length > 0) {
        setExitingTimed((curEx) => curEx.filter((p) => !removedTimed.some((r) => r.id === p.id)));
      }
      if (removedAll.length > 0) {
        setExitingAllDay((curEx) => curEx.filter((p) => !removedAll.some((r) => r.id === p.id)));
      }
    }, EXIT_MS);
    return () => window.clearTimeout(t);
  }, [positioned, allDayPlans, date]);

  // HTML5 drop handler — only fires for list-row drags. Block moves are
  // handled by startMove (mousedown-based) below.
  const handleHourDrop = (hour: number, e: React.DragEvent) => {
    e.preventDefault();
    setDragOverMin(null);

    const target = e.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const offsetY = e.clientY - rect.top;
    const minuteInHour = (offsetY / rect.height) * 60;
    const start_minute = snap(hour * 60 + minuteInHour);

    // Group drop → ONE combined block sized to the summed estimate.
    const containerId = e.dataTransfer.getData(DND_GROUP_CONTAINER_ID);
    if (containerId) {
      const totalEst = Number(e.dataTransfer.getData(DND_GROUP_ESTIMATE_TOTAL));
      const dur = Number.isFinite(totalEst) && totalEst > 0 ? totalEst : 30;
      scheduleGroup.mutate({
        container_type: e.dataTransfer.getData(DND_GROUP_CONTAINER_TYPE) as GroupContainer['type'],
        container_id: containerId,
        container_name: e.dataTransfer.getData(DND_GROUP_CONTAINER_NAME),
        plan_date: date,
        start_minute,
        duration_minutes: Math.min(dur, 1440 - start_minute),
      });
      return;
    }

    const taskId = e.dataTransfer.getData('application/x-task-id');
    if (!taskId) return;

    const estStr = e.dataTransfer.getData('application/x-task-estimate');
    const estimate = Number(estStr);
    const duration = Number.isFinite(estimate) && estimate > 0 ? estimate : 30;

    schedule.mutate({
      task_id: taskId,
      plan_date: date,
      start_minute,
      duration_minutes: Math.min(duration, 1440 - start_minute),
    });
    // Mirror the slot onto the task: its work date AND time now reflect where
    // it sits on the calendar (the day-plan block above carries the duration).
    updateTask.mutate({ id: taskId, work_date: slotToWorkDateISO(date, start_minute) });
    // For today, mirror the slot's time-of-day onto the Home Focus list: an
    // Evening/Night slot files it under that section, earlier slots clear it.
    // For a recurring task the section sticks against its template.
    if (date === today) {
      const recurringParent = e.dataTransfer.getData(DND_TASK_RECURRING_PARENT) || undefined;
      setFocusBucket(taskId, focusBucketForMinute(start_minute), recurringParent);
    }
  };

  // Drop on the all-day strip → set work_date (date-only) for the viewed day,
  // overwriting any existing work date+time (drops the time-of-day).
  const handleAllDayDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setAllDayOver(false);
    const taskId = e.dataTransfer.getData('application/x-task-id');
    if (!taskId) return;
    const [y, m, d] = date.split('-').map(Number);
    updateTask.mutate({ id: taskId, work_date: dayToWorkDateISO(new Date(y, m - 1, d)) });
  };

  // Mousedown-based block move (instead of HTML5 drag). Same pattern as the
  // resize handles below — much more reliable than HTML5 drag for this kind
  // of in-place move (no pointer-events timing race, no drag-image quirks),
  // and we get a live preview while the user drags.
  const DRAG_THRESHOLD_PX = 4;
  const startMove = (plan: {
    id: string;
    task_id: string;
    start_minute: number;
    duration_minutes: number;
    kind?: 'group_block';
    container?: GroupContainer;
  }) => (e: React.MouseEvent) => {
    if (e.button !== 0) return; // left mouse only
    // Don't preventDefault yet — let click happen if the user doesn't drag.
    const originY = e.clientY;
    const origin = {
      planId: plan.id,
      taskId: plan.task_id,
      duration: plan.duration_minutes,
      originStart: plan.start_minute,
      kind: plan.kind,
      container: plan.container,
    };

    const onMove = (ev: MouseEvent) => {
      const dy = ev.clientY - originY;
      const passedThreshold = Math.abs(dy) > DRAG_THRESHOLD_PX;
      if (!passedThreshold && !moving) return;
      const deltaMin = Math.round(dy / PX_PER_MIN);
      const candidate = origin.originStart + deltaMin;
      const previewStart = Math.max(
        0,
        Math.min(1440 - origin.duration, snap(candidate)),
      );
      setMoving({
        planId: origin.planId,
        taskId: origin.taskId,
        duration: origin.duration,
        previewStart,
        threshold: true,
      });
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      setMoving((cur) => {
        if (cur && cur.threshold && cur.previewStart !== origin.originStart) {
          if (origin.kind === 'group_block' && origin.container) {
            updateGroupPlan.mutate({
              container_type: origin.container.type,
              container_id: origin.container.id,
              plan_date: date,
              start_minute: cur.previewStart,
              duration_minutes: cur.duration,
            });
          } else {
            updatePlan.mutate({
              task_id: cur.taskId,
              plan_date: date,
              start_minute: cur.previewStart,
              duration_minutes: cur.duration,
            });
            // Re-timing a block on today's grid re-files it on the Home Focus
            // list: Evening/Night window → that section, earlier → main list.
            if (date === today) setFocusBucket(cur.taskId, focusBucketForMinute(cur.previewStart));
          }
        } else if (!cur || !cur.threshold) {
          // No real drag → a click. A group block opens the group session panel
          // (matching the palette row); a task block opens the task.
          if (origin.kind === 'group_block' && origin.container) {
            setGroupRunPanel(groupRunTargetFromContainer(qc, origin.container));
          } else {
            setActiveTask(origin.taskId);
          }
        }
        return null;
      });
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  // Resize via top/bottom handle. Tracks the drag on document so the cursor can
  // leave the block; commits on mouseup via useUpdateDayPlan (optimistic).
  const startResize = (
    plan: { id: string; task_id: string; start_minute: number; duration_minutes: number; kind?: 'group_block'; container?: GroupContainer },
    edge: 'top' | 'bottom',
  ) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const origin = {
      y: e.clientY,
      start: plan.start_minute,
      dur: plan.duration_minutes,
    };
    setResizing({ planId: plan.id, previewStart: origin.start, previewDur: origin.dur });

    const onMove = (ev: MouseEvent) => {
      const dy = ev.clientY - origin.y;
      const deltaMin = Math.round(dy / PX_PER_MIN);
      let previewStart = origin.start;
      let previewDur = origin.dur;
      const MIN_DUR = 15;
      if (edge === 'top') {
        // top handle moves the start; duration adjusts to keep end-of-block fixed.
        const maxStartDelta = origin.dur - MIN_DUR;
        const startDelta = Math.max(-origin.start, Math.min(maxStartDelta, deltaMin));
        previewStart = snap(origin.start + startDelta);
        previewDur = origin.start + origin.dur - previewStart;
      } else {
        // bottom handle changes duration only.
        const maxDur = 1440 - origin.start;
        const target = Math.max(MIN_DUR, Math.min(maxDur, origin.dur + deltaMin));
        previewDur = Math.max(MIN_DUR, Math.round(target / SNAP_MIN) * SNAP_MIN);
      }
      setResizing({ planId: plan.id, previewStart, previewDur });
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      setResizing((cur) => {
        if (cur && (cur.previewStart !== origin.start || cur.previewDur !== origin.dur)) {
          if (plan.kind === 'group_block' && plan.container) {
            updateGroupPlan.mutate({
              container_type: plan.container.type,
              container_id: plan.container.id,
              plan_date: date,
              start_minute: cur.previewStart,
              duration_minutes: cur.previewDur,
            });
          } else {
            updatePlan.mutate({
              task_id: plan.task_id,
              plan_date: date,
              start_minute: cur.previewStart,
              duration_minutes: cur.previewDur,
            });
          }
        }
        return null;
      });
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const { dayTitle, weekLabel, relLabel } = useMemo(() => {
    const [y, m, d] = date.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    const [ty, tm, td] = today.split('-').map(Number);
    const diff = Math.round((dt.getTime() - new Date(ty, tm - 1, td).getTime()) / 86_400_000);
    const rel = diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : diff === -1 ? 'Yesterday' : null;
    return {
      dayTitle: new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' }).format(dt),
      weekLabel: `${new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(dt)} · Week ${isoWeekNumber(dt)}`,
      relLabel: rel,
    };
  }, [date, today]);

  const plannedMin = useMemo(
    () => timedPlans.reduce((sum, p) => sum + p.duration_minutes, 0),
    [timedPlans],
  );
  // Past days are fully "elapsed"; today shades up to the now-line.
  const elapsedMin = date < today ? 1440 : isToday ? nowMinute : 0;

  // Dragover → snapped minute within the hovered hour (same math as the drop).
  const slotDragOver = (hour: number) => (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const min = snap(hour * 60 + ((e.clientY - rect.top) / rect.height) * 60);
    setDragOverMin((cur) => (cur === min ? cur : min));
  };

  return (
    <div className="dp-calendar" ref={calRef}>
      {/* Top bar — day title + segmented prev / Today / next */}
      <div className="dp-cal-head">
        <div className="dp-cal-title">
          <h2>
            {dayTitle}
            {relLabel && <span className="dp-rel" data-today={isToday || undefined}>{relLabel}</span>}
          </h2>
          <div className="sub">
            {weekLabel}
            {isLoading ? ' · Loading…' : (
              <>
                {' · '}{timedPlans.length} {timedPlans.length === 1 ? 'block' : 'blocks'}
                {plannedMin > 0 && ` · ${fmtDur(plannedMin)} planned`}
                {allDayPlans.length > 0 && ` · ${allDayPlans.length} all-day`}
              </>
            )}
          </div>
        </div>
        <div className="dp-cal-tools">
          {toolbar}
          <div className="dp-seg" role="group" aria-label="Change day">
            <button
              type="button"
              className="nav-btn"
              onClick={() => onDateChange(addDays(date, -1))}
              title={keyboard ? 'Previous day (←)' : 'Previous day'}
              aria-label="Previous day"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>
            <button
              type="button"
              className="nav-today"
              data-active={isToday || undefined}
              onClick={() => onDateChange(today)}
              disabled={isToday}
              title={keyboard ? 'Jump to today (T)' : 'Jump to today'}
            >
              Today
            </button>
            <button
              type="button"
              className="nav-btn"
              onClick={() => onDateChange(addDays(date, 1))}
              title={keyboard ? 'Next day (→)' : 'Next day'}
              aria-label="Next day"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 6l6 6-6 6" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* All-day strip — sticky under the header so date-only tasks stay
          visible while the hour grid scrolls. Timezone sits in the gutter. */}
      <div className="dp-col-head">
        <div className="dp-allday-label">
          <span>All-day</span>
          <span className="dp-gmt" title={tzLabel()}>{tzLabel('short')}</span>
        </div>
        <div
          className="dp-allday-items"
          data-dragover={allDayOver || undefined}
          onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setAllDayOver(true); }}
          onDragLeave={() => setAllDayOver(false)}
          onDrop={handleAllDayDrop}
        >
          {allDayPlans.length === 0 && (
            <span className="dp-allday-empty">{allDayOver ? 'Drop to plan it for the whole day' : 'Drop a task here to plan it without a time'}</span>
          )}
          {allDayPlans.map((p) => {
            const isWb = p.task?.task_type_key === 'work_block';
            const wbColor = p.task?.task_type_color || '#8b5cf6';
            return (
              <div
                key={p.id}
                className="dp-allday-chip"
                draggable
                data-type={isWb ? 'work_block' : undefined}
                style={isWb ? ({ '--dp-accent': wbColor } as React.CSSProperties) : undefined}
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/x-task-id', p.task_id);
                  e.dataTransfer.setData('application/x-task-estimate', String(p.task?.time_estimate ?? 30));
                  e.dataTransfer.setData(DND_TASK_RECURRING_PARENT, (p.task as any)?.recurring_parent_id ?? '');
                  e.dataTransfer.effectAllowed = 'copyMove';
                }}
                onClick={() => setActiveTask(p.task_id)}
                title={`${p.task?.title ?? 'Task'} · ${dateFieldLabel(p.date_field)} ${date} · drag onto the grid to give it a time`}
              >
                <span className="t">{p.task?.title ?? 'Task'}</span>
                <span className="f">{dateFieldLabel(p.date_field)}</span>
              </div>
            );
          })}
          {exitingAllDay.map((p) => (
            <div key={`exit-${p.id}`} className="dp-allday-chip" data-exiting="true" aria-hidden="true">
              <span className="t">{p.task?.title ?? 'Task'}</span>
              <span className="f">{dateFieldLabel(p.date_field)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Hour grid */}
      <div
        className="dp-cal-grid"
        ref={gridRef}
        data-dragging={dragOverMin !== null || undefined}
        onDragLeave={(e) => {
          // Only clear when the cursor actually leaves the grid, not when it
          // crosses between hour rows.
          if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) setDragOverMin(null);
        }}
      >
        {elapsedMin > 0 && <div className="dp-past" style={{ height: elapsedMin * PX_PER_MIN }} aria-hidden="true" />}

        {Array.from({ length: HOURS }).map((_, h) => (
          <div key={h} className="dp-hour" data-off={h < WORK_START_H || h >= WORK_END_H || undefined}>
            {/* Hide the hour label the now-chip would sit on top of. */}
            <span className="label">{h === 0 || (isToday && Math.abs(h * 60 - nowMinute) < 15) ? '' : fmtHourLabel(h)}</span>
            <div
              className="slot"
              onDragOver={slotDragOver(h)}
              onMouseDown={(e) => slotCreate.begin(date, e, gridRef.current)}
              onDrop={(e) => handleHourDrop(h, e)}
            />
          </div>
        ))}

        {slotCreate.selection?.date === date && (
          <div
            className="dp-new-block"
            style={{ top: slotCreate.selection.start * PX_PER_MIN, height: Math.max(22, slotCreate.selection.dur * PX_PER_MIN - 2) }}
            aria-hidden="true"
          >
            <span className="t">New task</span>
            <span className="m">{fmtTimeRange(slotCreate.selection.start, slotCreate.selection.dur)} · {fmtDur(slotCreate.selection.dur)}</span>
          </div>
        )}

        {dragOverMin !== null && (
          <div className="dp-ghost" style={{ top: dragOverMin * PX_PER_MIN, height: 30 * PX_PER_MIN }} aria-hidden="true">
            <span>Drop at {fmtMinAsClock(dragOverMin)}</span>
          </div>
        )}

        {positioned.map((p) => {
          const isResizing = resizing?.planId === p.id;
          const isMoving = moving?.planId === p.id && moving.threshold;
          const renderStart = isResizing
            ? resizing!.previewStart
            : isMoving
              ? moving!.previewStart
              : p.start_minute;
          const renderDur = isResizing ? resizing!.previewDur : p.duration_minutes;
          const isDone = isTaskDone(p.task?.status);
          const top = renderStart * PX_PER_MIN;
          const height = Math.max(22, renderDur * PX_PER_MIN - 2);
          // Work-block occurrences carry a `task_type_key` from the server's
          // hydrate and a `virtual` flag from the day-plans GET extension.
          const isWorkBlock = (p.task as any)?.task_type_key === 'work_block';
          const wbColor = (p.task as any)?.task_type_color || '#8b5cf6';
          const isVirtual = (p as any).virtual === true;
          const isGroup = p.kind === 'group_block';
          const groupName = p.container?.name ?? 'Group';
          // Compact (single-line) layout for blocks too short to stack title + time.
          const size = renderDur < 30 ? 'xs' : renderDur < 45 ? 'sm' : undefined;
          const blockTitle = isGroup ? `Grouped tasks under ${groupName}` : p.task?.title ?? 'Task';
          return (
            <div
              key={p.id}
              className="dp-block"
              data-moving={isMoving ? 'true' : undefined}
              data-resizing={isResizing ? 'true' : undefined}
              data-done={isDone ? 'true' : undefined}
              data-type={isGroup ? 'group_block' : isWorkBlock ? 'work_block' : undefined}
              data-priority={!isGroup && !isWorkBlock ? p.task?.priority ?? undefined : undefined}
              data-virtual={isVirtual ? 'true' : undefined}
              data-size={size}
              style={{
                top,
                height,
                left: `calc(64px + ${p.col} * (100% - 80px) / ${p.cols})`,
                width: `calc((100% - 80px) / ${p.cols} - 4px)`,
                right: 'auto',
                ...(isWorkBlock ? ({ '--dp-accent': wbColor } as React.CSSProperties) : {}),
              }}
              title={`${blockTitle} · ${fmtTimeRange(renderStart, renderDur)}${isWorkBlock ? ' · Work block' : ''}`}
            >
              {/* Top resize handle — drag to extend earlier */}
              <div
                className="dp-block-handle top"
                onMouseDown={startResize({ id: p.id, task_id: p.task_id, start_minute: p.start_minute, duration_minutes: p.duration_minutes, kind: p.kind, container: p.container }, 'top')}
                title="Drag to change start time"
              />

              {/* Body — mousedown drag to move (or click to open the task) */}
              <div
                className="dp-block-body"
                onMouseDown={startMove({ id: p.id, task_id: p.task_id, start_minute: p.start_minute, duration_minutes: p.duration_minutes, kind: p.kind, container: p.container })}
              >
                {!isVirtual && (
                  <button
                    type="button"
                    className="remove"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (isGroup && p.container) {
                        unscheduleGroup.mutate({ container_type: p.container.type, container_id: p.container.id, plan_date: date });
                      } else {
                        unschedule.mutate({ task_id: p.task_id, plan_date: date });
                      }
                    }}
                    onMouseDown={(e) => e.stopPropagation()}
                    aria-label="Remove from calendar"
                    title="Remove from calendar"
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M6 6l12 12M18 6L6 18" />
                    </svg>
                  </button>
                )}
                <div className="b-title">
                  {isDone && (
                    <svg className="b-check" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-label="Done">
                      <path d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                  {blockTitle}
                </div>
                <div className="b-meta">
                  <span className="b-time">{fmtTimeRange(renderStart, renderDur)}</span>
                  {renderDur >= 30 && <span className="b-dur">{fmtDur(renderDur)}</span>}
                  {isGroup
                    ? <span className="b-src">Group</span>
                    : isWorkBlock
                      ? <span className="b-src">Work block</span>
                      : p.date_field && <span className="b-src">{dateFieldLabel(p.date_field)}</span>}
                </div>
              </div>

              {/* Bottom resize handle — drag to extend later */}
              <div
                className="dp-block-handle bottom"
                onMouseDown={startResize({ id: p.id, task_id: p.task_id, start_minute: p.start_minute, duration_minutes: p.duration_minutes, kind: p.kind, container: p.container }, 'bottom')}
                title="Drag to change end time"
              />
            </div>
          );
        })}

        {isToday && (
          <div className="dp-now" style={{ top: nowMinute * PX_PER_MIN }}>
            <span className="dp-now-chip">{fmtMinAsClock(nowMinute)}</span>
          </div>
        )}

        {exitingTimed.map((p) => {
          const top = p.start_minute * PX_PER_MIN;
          const height = Math.max(22, p.duration_minutes * PX_PER_MIN - 2);
          const isWorkBlock = (p.task as any)?.task_type_key === 'work_block';
          const wbColor = (p.task as any)?.task_type_color || '#8b5cf6';
          const isGroup = p.kind === 'group_block';
          const blockTitle = isGroup ? `Grouped tasks under ${p.container?.name ?? 'Group'}` : p.task?.title ?? 'Task';
          return (
            <div
              key={`exit-${p.id}`}
              className="dp-block"
              data-exiting="true"
              aria-hidden="true"
              style={{
                top,
                height,
                left: `calc(64px + ${p.col} * (100% - 80px) / ${p.cols})`,
                width: `calc((100% - 80px) / ${p.cols} - 4px)`,
                right: 'auto',
                ...(isWorkBlock ? ({ '--dp-accent': wbColor } as React.CSSProperties) : {}),
              }}
            >
              <div className="dp-block-body">
                <div className="b-title">{blockTitle}</div>
                <div className="b-meta">
                  <span className="b-time">{fmtTimeRange(p.start_minute, p.duration_minutes)}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {slotCreate.pending && (
        <SlotCreatePanel slot={slotCreate.pending} today={today} onClose={slotCreate.clear} />
      )}
    </div>
  );
}

interface Positioned {
  id: string;
  task_id: string;
  start_minute: number;
  duration_minutes: number;
  task?: { id: string; title: string; status?: string | null; priority?: string | null; task_type_key?: string | null; task_type_color?: string | null } | undefined;
  col: number;
  cols: number;
  virtual?: boolean;
  date_field?: 'work' | 'due' | 'start';
  kind?: 'group_block';
  container?: GroupContainer;
}

// "Completed" covers both the catalog 'closed' key and the legacy 'done'/'closed'
// text values that earlier task types still write.
function isTaskDone(status?: string | null): boolean {
  if (!status) return false;
  if (status === 'done' || status === 'closed' || status === 'cancelled') return true;
  return getTaskStatusCategory(status) === 'closed';
}

// Greedy overlap layout: walk plans in order, assign each to the first column
// that has no overlap with prior plans, then back-fill `cols` per cluster.
function positionBlocks(plans: any[]): Positioned[] {
  const sorted = [...plans].sort((a, b) => a.start_minute - b.start_minute);
  const result: Positioned[] = [];
  const clusters: Array<{ start: number; end: number; cols: number; members: number[] }> = [];

  for (const p of sorted) {
    const end = p.start_minute + p.duration_minutes;
    // find or open cluster
    let cluster = clusters[clusters.length - 1];
    if (!cluster || p.start_minute >= cluster.end) {
      cluster = { start: p.start_minute, end, cols: 0, members: [] };
      clusters.push(cluster);
    } else {
      cluster.end = Math.max(cluster.end, end);
    }
    // pick lowest free column index in this cluster
    const used = new Set<number>();
    for (const idx of cluster.members) {
      const other = result[idx];
      const otherEnd = other.start_minute + other.duration_minutes;
      if (other.start_minute < end && p.start_minute < otherEnd) used.add(other.col);
    }
    let col = 0;
    while (used.has(col)) col++;
    result.push({
      id: p.id,
      task_id: p.task_id,
      start_minute: p.start_minute,
      duration_minutes: p.duration_minutes,
      task: p.task
        ? {
            id: p.task.id,
            title: p.task.title,
            status: p.task.status,
            priority: p.task.priority ?? null,
            task_type_key: p.task.task_type_key ?? null,
            task_type_color: p.task.task_type_color ?? null,
          }
        : undefined,
      virtual: p.virtual === true,
      date_field: p.date_field,
      kind: p.kind === 'group_block' ? 'group_block' : undefined,
      container: p.container,
      col,
      cols: 1,
    });
    cluster.members.push(result.length - 1);
    cluster.cols = Math.max(cluster.cols, col + 1);
  }
  // Apply cluster-wide cols
  for (const c of clusters) {
    for (const idx of c.members) result[idx].cols = c.cols;
  }
  return result;
}
