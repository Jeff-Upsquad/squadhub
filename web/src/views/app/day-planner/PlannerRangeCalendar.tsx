import { useEffect, useMemo, type ReactNode } from 'react';
import { usePMStore } from '../../../stores/pmStore';
import { useMyTasks, useUpdateTask } from '../../../hooks/useTasks';
import MultiDayCalendar from '../calendar/MultiDayCalendar';
import MonthGrid from '../calendar/MonthGrid';
import { addDays, addMonths, buildWeekCells, cellKey, dayToWorkDateISO, flattenMyTasks } from '../calendar/calendarUtils';

export type PlannerMode = 'day' | '3day' | 'weekdays' | 'week' | 'month';

export const PLANNER_MODES: { key: PlannerMode; label: string; hint: string }[] = [
  { key: 'day', label: 'Day', hint: 'One day' },
  { key: '3day', label: '3 Day', hint: 'Three days from the selected day' },
  { key: 'weekdays', label: 'Weekdays', hint: 'Monday to Friday' },
  { key: 'week', label: 'Week', hint: 'Full week' },
  { key: 'month', label: 'Month', hint: 'Whole month' },
];

function fromKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// Visible day keys for a multi-day mode, anchored on the selected date.
//   3day     → the selected day + the next two
//   weekdays → Mon–Fri of the selected day's week (a weekend rolls forward)
//   week     → the full week, starting on the user's start-of-week day
export function rangeDays(mode: Exclude<PlannerMode, 'day' | 'month'>, anchorKey: string, weekStartsOn: number): string[] {
  const anchor = fromKey(anchorKey);
  if (mode === '3day') return [0, 1, 2].map((i) => cellKey(addDays(anchor, i)));
  if (mode === 'weekdays') {
    const dow = anchor.getDay(); // Sun=0 … Sat=6
    const monday = dow === 6 ? addDays(anchor, 2) : dow === 0 ? addDays(anchor, 1) : addDays(anchor, 1 - dow);
    return [0, 1, 2, 3, 4].map((i) => cellKey(addDays(monday, i)));
  }
  return buildWeekCells(anchor, weekStartsOn).map(cellKey);
}

// How far ←/→ moves the anchor in each mode.
export function stepAnchor(mode: PlannerMode, anchorKey: string, dir: -1 | 1): string {
  const anchor = fromKey(anchorKey);
  if (mode === 'month') return cellKey(addMonths(anchor, dir));
  if (mode === '3day') return cellKey(addDays(anchor, dir * 3));
  if (mode === 'day') return cellKey(addDays(anchor, dir));
  return cellKey(addDays(anchor, dir * 7));
}

function isoWeek(d: Date): number {
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  t.setDate(t.getDate() - ((t.getDay() + 6) % 7) + 3);
  const firstThursday = new Date(t.getFullYear(), 0, 4);
  return 1 + Math.round((t.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
}

// Segmented Day / 3 Day / Weekdays / Week / Month control — rendered in the
// header of both the single-day calendar and the range views.
export function PlannerModeSwitch({ mode, onChange }: { mode: PlannerMode; onChange: (m: PlannerMode) => void }) {
  return (
    <div className="dp-seg dp-modes" role="tablist" aria-label="Calendar view">
      {PLANNER_MODES.map((m) => (
        <button
          key={m.key}
          type="button"
          role="tab"
          aria-selected={mode === m.key}
          data-active={mode === m.key || undefined}
          title={m.hint}
          onClick={() => onChange(m.key)}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}

interface Props {
  mode: Exclude<PlannerMode, 'day'>;
  date: string;   // anchor day key
  today: string;
  onDateChange: (next: string) => void;
  onOpenDay: (dayKey: string) => void;
  toolbar: ReactNode;
}

// Multi-day (3 Day / Weekdays / Week) and Month views for the Day Planner.
// Reuses the Calendar app's grids, so drag-to-schedule, move/resize and the
// drop preview behave exactly as they do there; the header matches the
// planner's single-day calendar.
export default function PlannerRangeCalendar({ mode, date, today, onDateChange, onOpenDay, toolbar }: Props) {
  const weekStartsOn = usePMStore((s) => s.calendarWeekStart);
  const setActiveTask = usePMStore((s) => s.setActiveTask);
  const updateTask = useUpdateTask(null);
  // Month cells list tasks by work/due date (not day-plan blocks).
  const { data: myTasks } = useMyTasks();
  const monthTasks = useMemo(() => (mode === 'month' ? flattenMyTasks(myTasks) : []), [mode, myTasks]);

  const days = useMemo(
    () => (mode === 'month' ? [] : rangeDays(mode, date, weekStartsOn)),
    [mode, date, weekStartsOn],
  );
  const inView = mode === 'month'
    ? date.slice(0, 7) === today.slice(0, 7)
    : days.includes(today);

  const { title, sub } = useMemo(() => {
    const anchor = fromKey(date);
    if (mode === 'month') {
      return { title: new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(anchor), sub: 'Month' };
    }
    const a = fromKey(days[0]);
    const b = fromKey(days[days.length - 1]);
    const mo = (d: Date) => new Intl.DateTimeFormat(undefined, { month: 'short' }).format(d);
    const t = a.getMonth() === b.getMonth()
      ? `${mo(a)} ${a.getDate()} – ${b.getDate()}, ${b.getFullYear()}`
      : a.getFullYear() === b.getFullYear()
        ? `${mo(a)} ${a.getDate()} – ${mo(b)} ${b.getDate()}, ${b.getFullYear()}`
        : `${mo(a)} ${a.getDate()}, ${a.getFullYear()} – ${mo(b)} ${b.getDate()}, ${b.getFullYear()}`;
    const label = PLANNER_MODES.find((m) => m.key === mode)!.label;
    return { title: t, sub: `${label} · Week ${isoWeek(a)}` };
  }, [mode, date, days]);

  // ←/→ page by the view's span, T jumps back to today.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      if (e.key === 'ArrowLeft') onDateChange(stepAnchor(mode, date, -1));
      else if (e.key === 'ArrowRight') onDateChange(stepAnchor(mode, date, 1));
      else if (e.key === 't' || e.key === 'T') onDateChange(today);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, date, today, onDateChange]);

  const unit = mode === 'month' ? 'month' : mode === '3day' ? '3 days' : 'week';

  return (
    <div className="dp-calendar dp-range" data-mode={mode}>
      <div className="dp-cal-head">
        <div className="dp-cal-title">
          <h2>
            {title}
            {inView && (
              <span className="dp-rel" data-today>
                {mode === 'month' ? 'This month' : mode === '3day' ? 'Includes today' : 'This week'}
              </span>
            )}
          </h2>
          <div className="sub">{sub}</div>
        </div>
        <div className="dp-cal-tools">
          {toolbar}
          <div className="dp-seg" role="group" aria-label={`Change ${unit}`}>
            <button type="button" className="nav-btn" onClick={() => onDateChange(stepAnchor(mode, date, -1))} title={`Previous ${unit} (←)`} aria-label={`Previous ${unit}`}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
            </button>
            <button type="button" className="nav-today" data-active={date === today || undefined} disabled={date === today} onClick={() => onDateChange(today)} title="Jump to today (T)">
              Today
            </button>
            <button type="button" className="nav-btn" onClick={() => onDateChange(stepAnchor(mode, date, 1))} title={`Next ${unit} (→)`} aria-label={`Next ${unit}`}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
            </button>
          </div>
        </div>
      </div>
      <div className="dp-range-body">
        {mode === 'month' ? (
          <MonthGrid
            monthAnchor={fromKey(date)}
            todayKey={today}
            tasks={monthTasks}
            weekStartsOn={weekStartsOn}
            onDropTask={(taskId, day) => updateTask.mutate({ id: taskId, work_date: dayToWorkDateISO(day) })}
            onOpenTask={setActiveTask}
            onOpenDay={(day) => onOpenDay(cellKey(day))}
          />
        ) : (
          <MultiDayCalendar days={days} todayKey={today} onOpenTask={setActiveTask} onOpenDay={onOpenDay} />
        )}
      </div>
    </div>
  );
}
