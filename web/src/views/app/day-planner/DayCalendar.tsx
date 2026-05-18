import { useEffect, useMemo, useRef, useState } from 'react';
import { getTaskStatusCategory } from '@squadhub/shared';
import { usePMStore } from '../../../stores/pmStore';
import {
  planDateKey,
  useDayPlans,
  useScheduleTaskOnDay,
  useUnscheduleTask,
  useUpdateDayPlan,
} from '../../../hooks/useDayPlanner';

const HOURS = 24;
const PX_PER_MIN = 1; // each hour row is 60px tall
const SNAP_MIN = 15;

interface Props {
  date: string;  // YYYY-MM-DD being viewed
  today: string; // YYYY-MM-DD that means "today" in user's tz
  onDateChange: (next: string) => void;
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
  return `${startStr}-${fmtMinAsClock(end)}`;
}

function snap(min: number): number {
  return Math.max(0, Math.min(1440 - 1, Math.round(min / SNAP_MIN) * SNAP_MIN));
}

// Long timezone name from the browser ("India Standard Time" for Asia/Kolkata).
// Falls back to a "GMT+offset" string if Intl can't resolve a name.
function tzLabel(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'long' }).formatToParts(new Date());
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

// Plans created during the brief life of the all-day row used start_minute=0 +
// duration_minutes=1440 as a sentinel. We no longer render an all-day section,
// so hide those rows from the timed grid (a 24-hour block at midnight isn't useful).
function isAllDaySentinel(p: { start_minute: number; duration_minutes: number }) {
  return p.start_minute === 0 && p.duration_minutes === 1440;
}

export default function DayCalendar({ date, today, onDateChange }: Props) {
  const { data: plans = [], isLoading } = useDayPlans(date);
  const schedule = useScheduleTaskOnDay();
  const unschedule = useUnscheduleTask();
  const updatePlan = useUpdateDayPlan();
  const setActiveTask = usePMStore((s) => s.setActiveTask);

  const [dragOverHour, setDragOverHour] = useState<number | null>(null);
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

  // On mount (and when navigating back to today), center the current-time line
  // in the visible calendar viewport instead of starting the user at midnight.
  const calRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const isToday = date === today;
  useEffect(() => {
    if (!isToday) return;
    // Wait one tick so the grid + sticky headers are laid out.
    const id = window.setTimeout(() => {
      const cal = calRef.current;
      const grid = gridRef.current;
      if (!cal || !grid) return;
      const nowOffset = grid.offsetTop + nowMinute * PX_PER_MIN;
      cal.scrollTop = Math.max(0, nowOffset - cal.clientHeight / 2);
    }, 0);
    return () => window.clearTimeout(id);
  // We want this to fire only when isToday flips on (initial mount, or after
  // navigating back to today) — not every minute as nowMinute ticks.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isToday]);

  // Drop all-day-sentinel rows from the grid display.
  const timedPlans = useMemo(() => plans.filter((p) => !isAllDaySentinel(p)), [plans]);

  // Sort + lay out timed plans in overlap columns.
  const positioned = useMemo(() => positionBlocks(timedPlans), [timedPlans]);

  // HTML5 drop handler — only fires for list-row drags. Block moves are
  // handled by startMove (mousedown-based) below.
  const handleHourDrop = (hour: number, e: React.DragEvent) => {
    e.preventDefault();
    setDragOverHour(null);

    const taskId = e.dataTransfer.getData('application/x-task-id');
    if (!taskId) return;

    const target = e.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const offsetY = e.clientY - rect.top;
    const minuteInHour = (offsetY / rect.height) * 60;
    const start_minute = snap(hour * 60 + minuteInHour);

    const estStr = e.dataTransfer.getData('application/x-task-estimate');
    const estimate = Number(estStr);
    const duration = Number.isFinite(estimate) && estimate > 0 ? estimate : 30;

    schedule.mutate({
      task_id: taskId,
      plan_date: date,
      start_minute,
      duration_minutes: Math.min(duration, 1440 - start_minute),
    });
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
  }) => (e: React.MouseEvent) => {
    if (e.button !== 0) return; // left mouse only
    // Don't preventDefault yet — let click happen if the user doesn't drag.
    const originY = e.clientY;
    const origin = {
      planId: plan.id,
      taskId: plan.task_id,
      duration: plan.duration_minutes,
      originStart: plan.start_minute,
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
          updatePlan.mutate({
            task_id: cur.taskId,
            plan_date: date,
            start_minute: cur.previewStart,
            duration_minutes: cur.duration,
          });
        } else if (!cur || !cur.threshold) {
          // No real drag → treat as a click to open the task.
          setActiveTask(origin.taskId);
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
    plan: { id: string; task_id: string; start_minute: number; duration_minutes: number },
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
          updatePlan.mutate({
            task_id: plan.task_id,
            plan_date: date,
            start_minute: cur.previewStart,
            duration_minutes: cur.previewDur,
          });
        }
        return null;
      });
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const { weekLabel, weekdayShort, dayOfMonth } = useMemo(() => {
    const [y, m, d] = date.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    return {
      weekLabel: `${new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(dt)} · W${isoWeekNumber(dt)}`,
      weekdayShort: new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(dt),
      dayOfMonth: dt.getDate(),
    };
  }, [date]);

  return (
    <div className="dp-calendar" ref={calRef}>
      {/* Top bar — nav + month/week label */}
      <div className="dp-cal-head">
        <div className="dp-cal-nav">
          <button
            type="button"
            className="nav-btn"
            onClick={() => onDateChange(addDays(date, -1))}
            title="Previous day"
            aria-label="Previous day"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          <button
            type="button"
            className="nav-btn"
            onClick={() => onDateChange(addDays(date, 1))}
            title="Next day"
            aria-label="Next day"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 6l6 6-6 6" />
            </svg>
          </button>
          {!isToday && (
            <button type="button" className="nav-today" onClick={() => onDateChange(today)}>
              Today
            </button>
          )}
          <h2>{weekLabel}</h2>
        </div>
        <div className="dp-cal-meta">{isLoading ? 'Loading…' : `${plans.length} scheduled`}</div>
      </div>

      {/* Day column header: tz on the left gutter, day chip in the column */}
      <div className="dp-col-head">
        <div className="dp-gmt" title={tzLabel()}>{tzLabel()}</div>
        <div className="dp-col-day">
          <div className="dp-day-chip" data-today={isToday}>
            <span className="wd">{weekdayShort}</span>
            <span className="dom">{dayOfMonth}</span>
          </div>
        </div>
      </div>

      {/* Hour grid */}
      <div className="dp-cal-grid" ref={gridRef}>
        {Array.from({ length: HOURS }).map((_, h) => (
          <div key={h} className="dp-hour">
            <span className="label">{fmtHourLabel(h)}</span>
            <div
              className="slot"
              data-dragover={dragOverHour === h ? 'true' : undefined}
              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverHour(h); }}
              onDragLeave={() => setDragOverHour((cur) => (cur === h ? null : cur))}
              onDrop={(e) => handleHourDrop(h, e)}
            />
          </div>
        ))}

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
          const height = Math.max(20, renderDur * PX_PER_MIN);
          return (
            <div
              key={p.id}
              className="dp-block"
              data-moving={isMoving ? 'true' : undefined}
              data-done={isDone ? 'true' : undefined}
              style={{
                top,
                height,
                left: `calc(70px + ${p.col} * (100% - 92px) / ${p.cols})`,
                width: `calc((100% - 92px) / ${p.cols} - 4px)`,
                right: 'auto',
              }}
              title={`${p.task?.title ?? 'Task'} · ${fmtMinAsClock(renderStart)}`}
            >
              {/* Top resize handle — drag to extend earlier */}
              <div
                className="dp-block-handle top"
                onMouseDown={startResize({ id: p.id, task_id: p.task_id, start_minute: p.start_minute, duration_minutes: p.duration_minutes }, 'top')}
                title="Drag to change start time"
              />

              {/* Body — mousedown drag to move (or click to open the task) */}
              <div
                className="dp-block-body"
                onMouseDown={startMove({ id: p.id, task_id: p.task_id, start_minute: p.start_minute, duration_minutes: p.duration_minutes })}
              >
                <button
                  type="button"
                  className="remove"
                  onClick={(e) => { e.stopPropagation(); unschedule.mutate({ task_id: p.task_id, plan_date: date }); }}
                  onMouseDown={(e) => e.stopPropagation()}
                  aria-label="Remove from calendar"
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
                <div className="b-title">{p.task?.title ?? 'Task'}</div>
                <div className="b-meta">
                  <svg className="b-clock" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="9" />
                    <path d="M12 7v5l3 2" />
                  </svg>
                  {fmtTimeRange(renderStart, renderDur)}
                </div>
              </div>

              {/* Bottom resize handle — drag to extend later */}
              <div
                className="dp-block-handle bottom"
                onMouseDown={startResize({ id: p.id, task_id: p.task_id, start_minute: p.start_minute, duration_minutes: p.duration_minutes }, 'bottom')}
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
      </div>
    </div>
  );
}

interface Positioned {
  id: string;
  task_id: string;
  start_minute: number;
  duration_minutes: number;
  task?: { id: string; title: string; status?: string | null } | undefined;
  col: number;
  cols: number;
}

// "Completed" covers both the catalog 'closed' key and the legacy 'done'/'closed'
// text values that earlier task types still write.
function isTaskDone(status?: string | null): boolean {
  if (!status) return false;
  if (status === 'done' || status === 'closed') return true;
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
      task: p.task ? { id: p.task.id, title: p.task.title, status: p.task.status } : undefined,
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
