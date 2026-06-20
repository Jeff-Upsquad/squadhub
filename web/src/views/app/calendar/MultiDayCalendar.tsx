import { useEffect, useMemo, useRef, useState } from 'react';
import { getTaskStatusCategory } from '@squadhub/shared';
import { usePMStore } from '../../../stores/pmStore';
import { useUpdateTask } from '../../../hooks/useTasks';
import {
  useDayPlansRange,
  useScheduleTaskOnDay,
  useMoveDayPlan,
  useUpdateDayPlan,
  useUnscheduleTask,
} from '../../../hooks/useDayPlanner';
import { DND_TASK_ID, DND_TASK_ESTIMATE, dayToWorkDateISO, priorityLevel, setSlimDragImage } from './calendarUtils';

const HOURS = 24;
const PX_PER_MIN = 1; // 60px per hour row
const SNAP_MIN = 15;
const GUTTER = 56; // px — time-label gutter on the left of the grid

interface Props {
  days: string[];   // visible day keys (YYYY-MM-DD), left → right
  todayKey: string;
  onOpenTask: (id: string) => void;
  onOpenDay: (dayKey: string) => void;
}

interface Plan {
  id: string;
  task_id: string;
  plan_date?: string;
  start_minute: number;
  duration_minutes: number;
  all_day?: boolean;
  virtual?: boolean;
  date_field?: 'work' | 'due' | 'start';
  task?: {
    id: string;
    title: string;
    priority?: string | null;
    status?: string | null;
    time_estimate?: number | null;
    task_type_key?: string | null;
    task_type_color?: string | null;
  } | null;
}

function fmtHourLabel(h: number): string {
  if (h === 0) return '12 AM';
  if (h < 12) return `${h} AM`;
  if (h === 12) return '12 PM';
  return `${h - 12} PM`;
}

function fmtMinAsClock(m: number): string {
  const h = Math.floor(m / 60);
  const mm = m % 60;
  const hh12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  const ampm = h < 12 ? 'am' : 'pm';
  return `${hh12}:${mm.toString().padStart(2, '0')}${ampm}`;
}

function fmtTimeRange(start: number, duration: number): string {
  const s = fmtMinAsClock(start);
  if (duration < 30) return s;
  const end = Math.min(1440, start + duration);
  return `${s} – ${fmtMinAsClock(end)}`;
}

function snap(min: number): number {
  return Math.max(0, Math.min(1440 - 1, Math.round(min / SNAP_MIN) * SNAP_MIN));
}

function isAllDaySentinel(p: { start_minute: number; duration_minutes: number }) {
  return p.start_minute === 0 && p.duration_minutes === 1440;
}

function isTaskDone(status?: string | null): boolean {
  if (!status) return false;
  if (status === 'done' || status === 'closed') return true;
  return getTaskStatusCategory(status) === 'closed';
}

function dateFieldLabel(f?: 'work' | 'due' | 'start'): string {
  if (f === 'due') return 'Due';
  if (f === 'start') return 'Starts';
  return 'Work';
}

// Greedy overlap layout within ONE day column (mirrors DayCalendar).
interface Positioned extends Plan { col: number; cols: number }
function positionBlocks(plans: Plan[]): Positioned[] {
  const sorted = [...plans].sort((a, b) => a.start_minute - b.start_minute);
  const result: Positioned[] = [];
  const clusters: Array<{ end: number; members: number[]; cols: number }> = [];
  for (const p of sorted) {
    const end = p.start_minute + p.duration_minutes;
    let cluster = clusters[clusters.length - 1];
    if (!cluster || p.start_minute >= cluster.end) {
      cluster = { end, members: [], cols: 0 };
      clusters.push(cluster);
    } else {
      cluster.end = Math.max(cluster.end, end);
    }
    const used = new Set<number>();
    for (const idx of cluster.members) {
      const o = result[idx];
      if (o.start_minute < end && p.start_minute < o.start_minute + o.duration_minutes) used.add(o.col);
    }
    let col = 0;
    while (used.has(col)) col++;
    result.push({ ...p, col, cols: 1 });
    cluster.members.push(result.length - 1);
    cluster.cols = Math.max(cluster.cols, col + 1);
  }
  for (const c of clusters) for (const idx of c.members) result[idx].cols = c.cols;
  return result;
}

function fmtDayHead(dayKey: string): { wd: string; dom: number } {
  const [y, m, d] = dayKey.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return {
    wd: new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(dt),
    dom: d,
  };
}

export default function MultiDayCalendar({ days, todayKey, onOpenTask, onOpenDay }: Props) {
  const plansByDate = useDayPlansRange(days);
  const schedule = useScheduleTaskOnDay();
  const move = useMoveDayPlan();
  const updatePlan = useUpdateDayPlan();
  const unschedule = useUnscheduleTask();
  const updateTask = useUpdateTask(null);
  const setActiveTask = usePMStore((s) => s.setActiveTask);

  const scrollRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const N = days.length;

  const [dragOver, setDragOver] = useState<{ date: string; start: number } | null>(null);
  const [allDayOver, setAllDayOver] = useState<string | null>(null);
  const [moving, setMoving] = useState<{
    taskId: string; fromDate: string; duration: number; previewDate: string; previewStart: number; threshold: boolean;
  } | null>(null);
  const [resizing, setResizing] = useState<{
    taskId: string; date: string; previewStart: number; previewDur: number;
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

  // On mount / range change, scroll so the work day (or now, if today is shown)
  // is near the top of the viewport instead of midnight.
  const showsToday = days.includes(todayKey);
  useEffect(() => {
    const id = window.setTimeout(() => {
      const sc = scrollRef.current;
      if (!sc) return;
      const target = showsToday ? nowMinute : 8 * 60; // 8am default
      sc.scrollTop = Math.max(0, target * PX_PER_MIN - 40);
    }, 0);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days[0], N]);

  // Split each day's plans into all-day chips vs timed blocks.
  const { allDayByDate, timedByDate } = useMemo(() => {
    const ad: Record<string, Plan[]> = {};
    const td: Record<string, Positioned[]> = {};
    for (const day of days) {
      const plans = (plansByDate[day] ?? []) as unknown as Plan[];
      ad[day] = plans.filter((p) => p.all_day === true);
      td[day] = positionBlocks(plans.filter((p) => !p.all_day && !isAllDaySentinel(p)));
    }
    return { allDayByDate: ad, timedByDate: td };
  }, [plansByDate, days]);

  const hasAllDay = days.some((d) => (allDayByDate[d]?.length ?? 0) > 0);

  // Map a pointer position to the (day, minute) it's over.
  const pointToDayMinute = (clientX: number, clientY: number): { date: string; minute: number } | null => {
    const grid = gridRef.current;
    if (!grid) return null;
    const rect = grid.getBoundingClientRect();
    const colW = (rect.width - GUTTER) / N;
    let idx = Math.floor((clientX - rect.left - GUTTER) / colW);
    idx = Math.max(0, Math.min(N - 1, idx));
    const minute = (clientY - rect.top) / PX_PER_MIN;
    return { date: days[idx], minute };
  };

  // HTML5 drop of a palette row / all-day chip onto a day column → timed plan.
  const handleColumnDrop = (date: string, e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(null);
    const taskId = e.dataTransfer.getData(DND_TASK_ID);
    if (!taskId) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const start = snap((e.clientY - rect.top) / PX_PER_MIN);
    const est = Number(e.dataTransfer.getData(DND_TASK_ESTIMATE));
    const duration = Number.isFinite(est) && est > 0 ? est : 30;
    schedule.mutate({
      task_id: taskId,
      plan_date: date,
      start_minute: start,
      duration_minutes: Math.min(duration, 1440 - start),
    });
  };

  // Drop on the all-day strip → set work_date (date-only) for that day.
  const handleAllDayDrop = (date: string, e: React.DragEvent) => {
    e.preventDefault();
    setAllDayOver(null);
    const taskId = e.dataTransfer.getData(DND_TASK_ID);
    if (!taskId) return;
    const [y, m, d] = date.split('-').map(Number);
    updateTask.mutate({ id: taskId, work_date: dayToWorkDateISO(new Date(y, m - 1, d)) });
  };

  // Mousedown-drag to move a block (across time AND days). The drag outcome is
  // tracked in a closure var (not React state) so the decision in onUp is read
  // directly — side effects stay OUT of the setState updater (StrictMode invokes
  // updaters twice, which would otherwise double-fire the move mutation). A
  // press that never moves past the threshold — or one that ends back where it
  // started — counts as a CLICK and opens the task.
  const DRAG_THRESHOLD = 4;
  const startMove = (plan: Plan, day: string) => (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const originX = e.clientX;
    const originY = e.clientY;
    const origin = { taskId: plan.task_id, fromDate: day, duration: plan.duration_minutes, originStart: plan.start_minute };
    let live: { previewDate: string; previewStart: number } | null = null;

    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - originX;
      const dy = ev.clientY - originY;
      if (!live && Math.max(Math.abs(dx), Math.abs(dy)) <= DRAG_THRESHOLD) return;
      const at = pointToDayMinute(ev.clientX, ev.clientY);
      const previewDate = at ? at.date : origin.fromDate;
      const previewStart = Math.max(0, Math.min(1440 - origin.duration, snap(origin.originStart + Math.round(dy / PX_PER_MIN))));
      live = { previewDate, previewStart };
      setMoving({ taskId: origin.taskId, fromDate: origin.fromDate, duration: origin.duration, previewDate, previewStart, threshold: true });
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      setMoving(null);
      if (live && (live.previewDate !== origin.fromDate || live.previewStart !== origin.originStart)) {
        move.mutate({
          task_id: origin.taskId,
          from_date: origin.fromDate,
          to_date: live.previewDate,
          start_minute: live.previewStart,
          duration_minutes: origin.duration,
        });
      } else {
        setActiveTask(origin.taskId); // click (or no-net-move drag) → open the task
      }
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  // Resize via top/bottom handle (same day only). Same closure-var pattern so
  // the commit runs once, outside the setState updater.
  const startResize = (plan: Plan, day: string, edge: 'top' | 'bottom') => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const origin = { y: e.clientY, start: plan.start_minute, dur: plan.duration_minutes };
    setResizing({ taskId: plan.task_id, date: day, previewStart: origin.start, previewDur: origin.dur });
    const MIN = 15;
    let live: { previewStart: number; previewDur: number } = { previewStart: origin.start, previewDur: origin.dur };
    const onMove = (ev: MouseEvent) => {
      const dy = ev.clientY - origin.y;
      const delta = Math.round(dy / PX_PER_MIN);
      let previewStart = origin.start;
      let previewDur = origin.dur;
      if (edge === 'top') {
        const startDelta = Math.max(-origin.start, Math.min(origin.dur - MIN, delta));
        previewStart = snap(origin.start + startDelta);
        previewDur = origin.start + origin.dur - previewStart;
      } else {
        const target = Math.max(MIN, Math.min(1440 - origin.start, origin.dur + delta));
        previewDur = Math.max(MIN, Math.round(target / SNAP_MIN) * SNAP_MIN);
      }
      live = { previewStart, previewDur };
      setResizing({ taskId: plan.task_id, date: day, previewStart, previewDur });
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      setResizing(null);
      if (live.previewStart !== origin.start || live.previewDur !== origin.dur) {
        updatePlan.mutate({ task_id: plan.task_id, plan_date: day, start_minute: live.previewStart, duration_minutes: live.previewDur });
      }
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const colLeft = (idx: number) => `calc(${GUTTER}px + ${idx} * (100% - ${GUTTER}px) / ${N})`;
  const colWidth = `calc((100% - ${GUTTER}px) / ${N})`;

  return (
    <div className="cal-tt">
      {/* Day headers */}
      <div className="cal-tt-head">
        <div className="cal-tt-corner" />
        {days.map((day) => {
          const { wd, dom } = fmtDayHead(day);
          const isToday = day === todayKey;
          return (
            <button key={day} type="button" className="cal-tt-dayhead" data-today={isToday || undefined} data-past={day < todayKey || undefined} onClick={() => onOpenDay(day)}>
              <span className="wd">{wd}</span>
              <span className="dom" data-today={isToday || undefined}>{dom}</span>
            </button>
          );
        })}
      </div>

      {/* All-day strip (only when something lands there) */}
      {hasAllDay && (
        <div className="cal-tt-allday">
          <div className="cal-tt-allday-lbl">all-day</div>
          {days.map((day) => (
            <div
              key={day}
              className="cal-tt-allday-cell"
              data-dragover={allDayOver === day || undefined}
              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setAllDayOver(day); }}
              onDragLeave={() => setAllDayOver((c) => (c === day ? null : c))}
              onDrop={(e) => handleAllDayDrop(day, e)}
            >
              {(allDayByDate[day] ?? []).map((p) => (
                <div
                  key={p.id}
                  className="cal-chip cal-tt-allday-chip"
                  draggable
                  data-level={priorityLevel((p.task?.priority ?? 'none') as any)}
                  onDragStart={(e) => {
                    e.dataTransfer.setData(DND_TASK_ID, p.task_id);
                    e.dataTransfer.setData(DND_TASK_ESTIMATE, String(p.task?.time_estimate ?? 30));
                    e.dataTransfer.effectAllowed = 'copyMove';
                    setSlimDragImage(e, p.task?.title ?? 'Task');
                  }}
                  onClick={() => onOpenTask(p.task_id)}
                  title={`${p.task?.title ?? 'Task'} · ${dateFieldLabel(p.date_field)} · drag onto the grid to give it a time`}
                >
                  <span className="cal-chip-dot" />
                  <span className="cal-chip-title">{p.task?.title ?? 'Task'}</span>
                  <span className="cal-chip-flag">{dateFieldLabel(p.date_field)}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Scrollable timed grid */}
      <div className="cal-tt-scroll" ref={scrollRef}>
        <div className="cal-tt-grid" ref={gridRef} style={{ height: HOURS * 60 * PX_PER_MIN }}>
          {/* Hour labels in the gutter */}
          {Array.from({ length: HOURS }).map((_, h) => (
            <div key={h} className="cal-tt-hourlabel" style={{ top: h * 60 * PX_PER_MIN }}>
              {h > 0 && fmtHourLabel(h)}
            </div>
          ))}

          {/* Day columns */}
          {days.map((day, idx) => (
            <div
              key={day}
              className="cal-tt-col"
              data-today={day === todayKey || undefined}
              data-past={day < todayKey || undefined}
              style={{ left: colLeft(idx), width: colWidth }}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                setDragOver({ date: day, start: snap((e.clientY - rect.top) / PX_PER_MIN) });
              }}
              onDragLeave={() => setDragOver((c) => (c?.date === day ? null : c))}
              onDrop={(e) => handleColumnDrop(day, e)}
            >
              {/* Live drop preview — shows exactly where (and when) it'll land */}
              {dragOver?.date === day && (
                <div className="cal-tt-drop" style={{ top: dragOver.start * PX_PER_MIN, height: 30 * PX_PER_MIN }}>
                  <span className="cal-tt-drop-time">{fmtMinAsClock(dragOver.start)}</span>
                </div>
              )}

              {(timedByDate[day] ?? []).map((p) => {
                const isResizing = resizing?.taskId === p.task_id && resizing.date === day;
                const isMoving = moving?.taskId === p.task_id && moving.threshold;
                const renderStart = isResizing ? resizing!.previewStart : p.start_minute;
                const renderDur = isResizing ? resizing!.previewDur : p.duration_minutes;
                const done = isTaskDone(p.task?.status);
                const isWb = p.task?.task_type_key === 'work_block';
                const wbColor = p.task?.task_type_color || '#8b5cf6';
                return (
                  <div
                    key={p.id}
                    className="cal-tt-block"
                    data-level={priorityLevel((p.task?.priority ?? 'none') as any)}
                    data-done={done || undefined}
                    data-type={isWb ? 'work_block' : undefined}
                    data-virtual={p.virtual || undefined}
                    data-hidden={isMoving || undefined}
                    style={{
                      top: renderStart * PX_PER_MIN,
                      height: Math.max(18, renderDur * PX_PER_MIN),
                      left: `calc(${p.col} * (100% - 6px) / ${p.cols})`,
                      width: `calc((100% - 6px) / ${p.cols} - 2px)`,
                      ...(isWb ? { background: `color-mix(in oklch, ${wbColor} 18%, transparent)`, borderLeftColor: wbColor } : {}),
                    }}
                    title={`${p.task?.title ?? 'Task'} · ${fmtTimeRange(renderStart, renderDur)}`}
                  >
                    <div className="cal-tt-block-handle top" onMouseDown={startResize(p, day, 'top')} title="Drag to change start" />
                    <div className="cal-tt-block-body" onMouseDown={startMove(p, day)}>
                      {!p.virtual && (
                        <button
                          type="button"
                          className="cal-tt-block-x"
                          onMouseDown={(e) => e.stopPropagation()}
                          onClick={(e) => { e.stopPropagation(); unschedule.mutate({ task_id: p.task_id, plan_date: day }); }}
                          aria-label="Remove from calendar"
                        >
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
                        </button>
                      )}
                      <div className="cal-tt-block-title">{p.task?.title ?? 'Task'}</div>
                      {renderDur >= 30 && <div className="cal-tt-block-time">{fmtTimeRange(renderStart, renderDur)}</div>}
                    </div>
                    <div className="cal-tt-block-handle bottom" onMouseDown={startResize(p, day, 'bottom')} title="Drag to change end" />
                  </div>
                );
              })}
            </div>
          ))}

          {/* Moving preview — floats over the target column */}
          {moving?.threshold && (() => {
            const idx = days.indexOf(moving.previewDate);
            if (idx < 0) return null;
            return (
              <div
                className="cal-tt-block cal-tt-preview"
                style={{
                  top: moving.previewStart * PX_PER_MIN,
                  height: Math.max(18, moving.duration * PX_PER_MIN),
                  left: colLeft(idx),
                  width: colWidth,
                }}
              >
                <div className="cal-tt-block-body">
                  <div className="cal-tt-block-time">{fmtTimeRange(moving.previewStart, moving.duration)}</div>
                </div>
              </div>
            );
          })()}

          {/* Now line on today's column */}
          {showsToday && (() => {
            const idx = days.indexOf(todayKey);
            return (
              <div className="cal-tt-now" style={{ top: nowMinute * PX_PER_MIN, left: colLeft(idx), width: colWidth }}>
                <span className="cal-tt-now-chip">{fmtMinAsClock(nowMinute)}</span>
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
