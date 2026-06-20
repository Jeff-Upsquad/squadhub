import { useEffect, useMemo, useRef, useState } from 'react';
import { useMyTasks, useUpdateTask } from '../../../hooks/useTasks';
import { usePMStore } from '../../../stores/pmStore';
import { planDateKey, useDayPlansRange } from '../../../hooks/useDayPlanner';
import CalendarTaskPalette from './CalendarTaskPalette';
import MonthGrid from './MonthGrid';
import MultiDayCalendar from './MultiDayCalendar';
import {
  addDays,
  addMonths,
  buildWeekCells,
  cellKey,
  dayToWorkDateISO,
  flattenMyTasks,
  WEEKDAY_FULL,
} from './calendarUtils';

type Mode = 'month' | 'week' | '5day' | '4day' | 'day';

const MODES: { key: Mode; label: string }[] = [
  { key: 'month', label: 'Month' },
  { key: 'week', label: 'Week' },
  { key: '5day', label: '5 Day' },
  { key: '4day', label: '4 Day' },
  { key: 'day', label: 'Day' },
];

// How many days a timed mode spans (month is handled separately).
const SPAN: Record<Exclude<Mode, 'month'>, number> = { week: 7, '5day': 5, '4day': 4, day: 1 };

function fromKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export default function CalendarView() {
  const { data, isLoading } = useMyTasks();
  const updateTask = useUpdateTask(null);
  const setActiveTask = usePMStore((s) => s.setActiveTask);

  const todayKey = useMemo(() => planDateKey(), []);
  // View mode + start-of-week live in pmStore so they sync across devices
  // (view-preferences payload) and survive refresh.
  const mode = usePMStore((s) => s.calendarMode) as Mode;
  const setMode = usePMStore((s) => s.setCalendarMode);
  const weekStartsOn = usePMStore((s) => s.calendarWeekStart);
  const setWeekStartsOn = usePMStore((s) => s.setCalendarWeekStart);
  const [anchorKey, setAnchorKey] = useState<string>(todayKey);
  const anchor = useMemo(() => fromKey(anchorKey), [anchorKey]);

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [menuOpen]);

  const allTasks = useMemo(() => flattenMyTasks(data), [data]);

  // The week-aligned first day to land on by default for a grid mode: the
  // start-of-week day of today's week, but rolled to next week when today sits
  // in a sub-week window's faded tail (e.g. the weekend of a Mon–Fri view) so
  // the default view is current/actionable rather than entirely in the past.
  const defaultGridStartKey = (span: number): string => {
    const start = buildWeekCells(fromKey(todayKey), weekStartsOn)[0];
    const last = cellKey(addDays(start, span - 1));
    return cellKey(span < 7 && last < todayKey ? addDays(start, 7) : start);
  };

  // Normalize the anchor for grid modes: whenever it's at "today" (initial load,
  // or after pressing Today), snap it to the week-aligned start day so columns
  // begin on the configured start-of-week day and nav (±1 week) stays aligned.
  useEffect(() => {
    if (mode === 'month' || mode === 'day') return;
    if (anchorKey !== todayKey) return; // only the default position is normalized
    const next = defaultGridStartKey(SPAN[mode]);
    if (next !== anchorKey) setAnchorKey(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, weekStartsOn, anchorKey]);

  // Visible day keys for a grid mode: the anchor's week (Week = all 7; 5/4-day =
  // first 5/4 from the start-of-week day). Day shows just the anchor.
  const dayKeys = useMemo<string[]>(() => {
    if (mode === 'month') return [];
    if (mode === 'day') return [cellKey(anchor)];
    const week = buildWeekCells(anchor, weekStartsOn).map(cellKey);
    return mode === 'week' ? week : week.slice(0, SPAN[mode]);
  }, [mode, anchor, weekStartsOn]);

  // A task is "scheduled" (and so drops out of the palette) once it's placed on
  // the calendar: a work_date (month-day / all-day drop) OR a real day_plan on
  // a currently-visible day (timed-slot drop). Virtual rows — occurrences the
  // server derives from a task's due/start date — don't count; only explicit
  // placements do. Reuses the cached ['day-plans', date] queries the grid fetches.
  const plansByDate = useDayPlansRange(dayKeys);
  const scheduledIds = useMemo(() => {
    const ids = new Set<string>();
    for (const t of allTasks) if (t.work_date) ids.add(t.id);
    for (const day of dayKeys) {
      for (const p of plansByDate[day] ?? []) {
        if (!(p as { virtual?: boolean }).virtual) ids.add(p.task_id);
      }
    }
    return ids;
  }, [allTasks, plansByDate, dayKeys]);

  const scheduleOnDay = (taskId: string, day: Date) =>
    updateTask.mutate({ id: taskId, work_date: dayToWorkDateISO(day) });

  const openTask = (id: string) => setActiveTask(id);
  const openDayKey = (key: string) => { setAnchorKey(key); setMode('day'); };
  const openDay = (day: Date) => openDayKey(cellKey(day));

  // Switching to Month/Day re-centers on today; switching between grid modes
  // keeps the navigated week (the normalization effect aligns it when at today).
  const changeMode = (m: Mode) => {
    if (m === 'month' || m === 'day') setAnchorKey(todayKey);
    setMode(m);
  };

  const { title, sub } = useMemo(() => {
    const mo = (d: Date) => new Intl.DateTimeFormat(undefined, { month: 'short' }).format(d);
    if (mode === 'month') {
      return { title: new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(anchor), sub: 'Month' };
    }
    if (mode === 'day') {
      return { title: new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(anchor), sub: 'Day' };
    }
    const a = fromKey(dayKeys[0]);
    const b = fromKey(dayKeys[dayKeys.length - 1]);
    let t: string;
    if (a.getFullYear() !== b.getFullYear()) t = `${mo(a)} ${a.getDate()}, ${a.getFullYear()} – ${mo(b)} ${b.getDate()}, ${b.getFullYear()}`;
    else if (a.getMonth() === b.getMonth()) t = `${mo(a)} ${a.getDate()} – ${b.getDate()}, ${b.getFullYear()}`;
    else t = `${mo(a)} ${a.getDate()} – ${mo(b)} ${b.getDate()}, ${b.getFullYear()}`;
    return { title: t, sub: mode === 'week' ? 'Week' : `${SPAN[mode]} days` };
  }, [mode, anchor, dayKeys]);

  const step = (dir: -1 | 1) => {
    if (mode === 'month') setAnchorKey(cellKey(addMonths(anchor, dir)));
    else if (mode === 'day') setAnchorKey(cellKey(addDays(anchor, dir)));
    // Week / 5-day / 4-day windows are week-aligned, so page a whole week to
    // keep the start-of-week day in the first column.
    else setAnchorKey(cellKey(addDays(anchor, dir * 7)));
  };

  const scheduledCount = useMemo(() => allTasks.filter((t) => t.work_date).length, [allTasks]);

  return (
    <div className="sh-view cal-view">
      <CalendarTaskPalette tasks={allTasks} isLoading={isLoading} scheduledIds={scheduledIds} />

      <div className="cal-main">
        <div className="cal-head">
          <div className="cal-head-left">
            <div className="cal-nav">
              <button type="button" className="cal-nav-btn" onClick={() => step(-1)} aria-label="Previous" title="Previous">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
              </button>
              <button type="button" className="cal-nav-btn" onClick={() => step(1)} aria-label="Next" title="Next">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
              </button>
              {anchorKey !== todayKey && (
                <button type="button" className="cal-today-btn" onClick={() => setAnchorKey(todayKey)}>Today</button>
              )}
            </div>
            <div className="cal-head-title">
              <h2>{title}</h2>
              <span className="cal-head-sub">{sub} · {scheduledCount} scheduled</span>
            </div>
          </div>

          <div className="cal-head-tools">
            <div className="cal-modes" role="tablist" aria-label="Calendar view">
              {MODES.map((m) => (
                <button key={m.key} type="button" role="tab" aria-selected={mode === m.key} data-active={mode === m.key} onClick={() => changeMode(m.key)}>
                  {m.label}
                </button>
              ))}
            </div>
            <div className="cal-settings" ref={menuRef}>
              <button
                type="button"
                className="cal-settings-btn"
                data-open={menuOpen || undefined}
                onClick={() => setMenuOpen((v) => !v)}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                aria-label="Calendar settings"
                title="Calendar settings"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <circle cx="5" cy="12" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="19" cy="12" r="1.7" />
                </svg>
              </button>
              {menuOpen && (
                <div className="cal-menu" role="menu">
                  <div className="cal-menu-head">Start week on</div>
                  {WEEKDAY_FULL.map((name, i) => (
                    <button
                      key={i}
                      type="button"
                      role="menuitemradio"
                      aria-checked={weekStartsOn === i}
                      className="cal-menu-item"
                      data-active={weekStartsOn === i}
                      onClick={() => { setWeekStartsOn(i); setMenuOpen(false); }}
                    >
                      <span>{name}</span>
                      {weekStartsOn === i && (
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4L19 7" /></svg>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="cal-body">
          {mode === 'month' ? (
            <MonthGrid
              monthAnchor={anchor}
              todayKey={todayKey}
              tasks={allTasks}
              weekStartsOn={weekStartsOn}
              onDropTask={scheduleOnDay}
              onOpenTask={openTask}
              onOpenDay={openDay}
            />
          ) : (
            <MultiDayCalendar
              days={dayKeys}
              todayKey={todayKey}
              onOpenTask={openTask}
              onOpenDay={openDayKey}
            />
          )}
        </div>
      </div>
    </div>
  );
}
