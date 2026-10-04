'use client';

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { KINDS, clipActivity, clock, dateLabel, dayKey, dayStart, duration, isAttendance, layoutActivities, shiftDay, weekStart, type Activity, type ActivityKind } from './activityModel';
import './time-activity.css';

type CalendarState = {
  date: string; setDate: (date: string) => void; view: 'day' | 'week'; setView: (view: 'day' | 'week') => void;
  now: number; from: number; to: number; days: string[];
};
const HOUR_HEIGHT = 60;
const CalendarContext = createContext<CalendarState | null>(null);
function Glyph({ name }: { name: 'clock' | 'close' | 'left' | 'right' | 'expand' | 'calendar' | 'arrow' }) {
  const paths = { clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3 2" /></>, close: <path d="m6 6 12 12M18 6 6 18" />, left: <path d="m14 5-7 7 7 7" />, right: <path d="m10 5 7 7-7 7" />, expand: <><path d="M8 3H3v5M16 21h5v-5M3 3l6 6m12 12-6-6" /></>, calendar: <><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M7 3v4m10-4v4M3 11h18" /></>, arrow: <path d="M5 12h14m-5-5 5 5-5 5" /> };
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{paths[name]}</svg>;
}

function TimeActivityCalendar({ onClose, renderData, demo = false, initialDate }: {
  onClose: () => void; renderData: (from: number, to: number, now: number) => ReactNode; demo?: boolean; initialDate?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [date, setDate] = useState(initialDate || dayKey());
  const [view, setView] = useState<'day' | 'week'>('day');
  const [now, setNow] = useState(Date.now());
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    dialog.current?.querySelector<HTMLButtonElement>('[aria-label="Close time overview"]')?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(id); document.body.style.overflow = overflow; previous?.focus(); };
  }, []);
  const first = view === 'day' ? date : weekStart(date);
  const days = Array.from({ length: view === 'day' ? 1 : 7 }, (_, i) => shiftDay(first, i));
  const from = dayStart(first), to = dayStart(shiftDay(first, days.length));
  if (typeof document === 'undefined') return null;
  return createPortal(
    <dialog ref={dialog} className={`ta-panel ${expanded ? 'ta-expanded' : ''}`} aria-labelledby="ta-title"
      onCancel={e => { e.preventDefault(); onClose(); }} onClick={e => { if (e.target === e.currentTarget) { const r = e.currentTarget.getBoundingClientRect(); if (e.clientX < r.left || e.clientY < r.top || e.clientX > r.right || e.clientY > r.bottom) onClose(); } }}>
      <div className="ta-header">
        <span className="ta-header-icon"><Glyph name="clock" /></span>
        <div><div className="ta-kicker">YOUR DAY, IN DETAIL</div><h2 id="ta-title">Time overview</h2></div>
        <span className="ta-sync"><i />{demo ? 'Sample data' : 'Live sync'}</span>
        <button className="ta-icon-btn ta-expand-btn" onClick={() => setExpanded(v => !v)} aria-label={expanded ? 'Restore panel size' : 'Expand calendar'} title="Expand calendar"><Glyph name="expand" /></button>
        <button className="ta-icon-btn" autoFocus onClick={onClose} aria-label="Close time overview"><Glyph name="close" /></button>
      </div>
      <CalendarContext.Provider value={{ date, setDate, view, setView, now, from, to, days }}>
        {renderData(from, to, now)}
      </CalendarContext.Provider>
    </dialog>, document.body);
}

function CalendarData({ events, commitment, loading = false, error = false, onRetry, onOpenTask }: {
  events: Activity[]; commitment: number; loading?: boolean; error?: boolean; onRetry?: () => void; onOpenTask?: (id: string) => void;
}) {
  const { date, setDate, view, setView, now, from, to, days } = useContext(CalendarContext)!;
  const [filters, setFilters] = useState<ActivityKind[]>(KINDS.map(k => k.kind));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [picker, setPicker] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const visibleEvents = useMemo(() => events.map(e => clipActivity(e, from, to)).filter((e): e is Activity => !!e), [events, from, to]);
  const selected = visibleEvents.find(e => e.id === selectedId);
  const totals = Object.fromEntries(KINDS.map(k => [k.kind, visibleEvents.filter(e => e.kind === k.kind).reduce((sum, e) => sum + e.seconds, 0)])) as Record<ActivityKind, number>;
  const work = totals.work + totals.overtime;
  const trackedDays = new Set(visibleEvents.filter(e => e.kind === 'work' || e.kind === 'overtime').map(e => dayKey(e.start))).size;
  const denominator = commitment * (view === 'day' ? 1 : trackedDays);
  const pct = denominator ? Math.round(work / denominator * 100) : null;
  useEffect(() => {
    const firstEvent = visibleEvents.filter(e => filters.includes(e.kind)).sort((a, b) => a.start - b.start)[0];
    const hour = firstEvent ? (firstEvent.start - dayStart(dayKey(firstEvent.start))) / 3600000 : 9;
    if (scroller.current) scroller.current.scrollTop = Math.max(0, hour - .45) * HOUR_HEIGHT;
    setSelectedId(null);
  }, [from, to, loading]);
  const display = (event: Activity, top: number, height: number, left: string, width: string) => (
    <button key={event.id} className="ta-event" data-kind={event.kind} data-selected={event.id === selectedId} data-short={height < 43}
      style={{ top, height: Math.max(19, height - 3), left, width, '--event-color': KINDS.find(k => k.kind === event.kind)!.color } as CSSProperties}
      onClick={() => setSelectedId(event.id === selectedId ? null : event.id)}
      aria-label={`${event.title}, ${clock(event.start)} to ${event.live ? 'now' : clock(event.end)}, ${duration(event.seconds)}`}
      title={`${event.title} · ${clock(event.start)}–${event.live ? 'now' : clock(event.end)} · ${duration(event.seconds)}`}>
      <span className="ta-event-title">{event.live && <i className="ta-live-dot" />}{event.title}</span>
      {height >= 43 && <span className="ta-event-time">{clock(event.start)} – {event.live ? 'now' : clock(event.end)}<b>{duration(event.seconds)}</b></span>}
      {height >= 78 && event.project && <span className="ta-event-project">{event.project}</span>}
      {height >= 105 && event.kind === 'block' && <span className="ta-event-badge">{event.children?.length || 0} tasks in this block</span>}
    </button>
  );
  return <>
    <div className="ta-summary">
      <div className="ta-summary-main"><span>{view === 'day' ? 'Work tracked' : 'Work this week'}</span><strong>{duration(work)}</strong>
        <div className="ta-commitment">{commitment ? `${pct ?? 0}% of ${duration(denominator)} commitment` : 'No daily commitment set'}</div>
        <div className="ta-progress"><i style={{ width: `${Math.min(100, pct || 0)}%` }} /></div>
      </div>
      <div className="ta-metrics">{(['break', 'overtime', 'block', 'task'] as const).map(kind => <div key={kind}>
        <span><i style={{ background: KINDS.find(k => k.kind === kind)!.color }} />{kind === 'task' ? 'Task time' : KINDS.find(k => k.kind === kind)!.label}</span><strong>{duration(totals[kind])}</strong>
      </div>)}</div>
    </div>
    <div className="ta-toolbar">
      <div className="ta-date-control"><button className="ta-icon-btn" aria-label={`Previous ${view}`} onClick={() => setDate(shiftDay(date, view === 'day' ? -1 : -7))}><Glyph name="left" /></button>
        <button className="ta-date-title" aria-expanded={picker} onClick={() => setPicker(v => !v)}><Glyph name="calendar" />{view === 'day' ? dateLabel(dayStart(date), { month: 'long', day: 'numeric', year: 'numeric' }) : `${dateLabel(from, { month: 'short', day: 'numeric' })} – ${dateLabel(to - 1, { month: 'short', day: 'numeric', year: 'numeric' })}`}</button>
        <button className="ta-icon-btn" aria-label={`Next ${view}`} onClick={() => setDate(shiftDay(date, view === 'day' ? 1 : 7))}><Glyph name="right" /></button>
        {picker && <DatePicker date={date} onPick={key => { setDate(key); setPicker(false); }} onClose={() => setPicker(false)} />}
      </div>
      <button className="ta-today" onClick={() => setDate(dayKey(now))}>Today</button>
      <div className="ta-view-switch" aria-label="Calendar view">{(['day', 'week'] as const).map(v => <button key={v} aria-pressed={view === v} onClick={() => setView(v)}>{v === 'day' ? 'Day' : 'Week'}</button>)}</div>
    </div>
    <div className="ta-filters" aria-label="Time type filters">{KINDS.map(k => <button key={k.kind} aria-pressed={filters.includes(k.kind)} onClick={() => setFilters(f => f.includes(k.kind) ? f.filter(v => v !== k.kind) : [...f, k.kind])}><i style={{ background: k.color }} />{k.label}</button>)}<span>IST · GMT+5:30</span></div>
    <div className="ta-calendar" data-view={view}>
      <div className="ta-grid-head"><div className="ta-zone">IST</div>{days.map(key => <div key={key} className="ta-day-head" data-today={key === dayKey(now)}>
        <button onClick={() => { setDate(key); setView('day'); }}><span>{dateLabel(dayStart(key), { weekday: view === 'day' ? 'long' : 'short' })}</span><b>{dateLabel(dayStart(key), { day: '2-digit' })}</b></button>
        {view === 'day' ? <div className="ta-lane-labels"><span>ATTENDANCE</span><span>TASKS & WORK BLOCKS</span></div> : <small>{duration(visibleEvents.filter(e => dayKey(e.start) === key && (e.kind === 'work' || e.kind === 'overtime')).reduce((s, e) => s + e.seconds, 0))} worked</small>}
      </div>)}</div>
      {loading ? <div className="ta-state" role="status"><Glyph name="clock" /><strong>Loading your timeline…</strong><span>Gathering attendance, tasks and work blocks.</span></div>
        : error ? <div className="ta-state" role="alert"><strong>We couldn’t load all your time</strong><span>Please try again to see the complete timeline.</span><button className="ta-today" onClick={onRetry}>Try again</button></div>
        : <div className="ta-grid-scroll" ref={scroller}>
          <div className="ta-grid-body"><div className="ta-hours">{Array.from({ length: 24 }, (_, h) => <span key={h} style={{ top: h * HOUR_HEIGHT }}>{h === 0 ? '12 AM' : h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h - 12} PM`}</span>)}</div>
            {days.map(key => {
              const start = dayStart(key);
              const items = visibleEvents.filter(e => filters.includes(e.kind)).map(e => clipActivity(e, start, start + 86400000)).filter((e): e is Activity => !!e);
              const lanes = view === 'day' ? [items.filter(e => isAttendance(e.kind)), items.filter(e => !isAttendance(e.kind))] : [items];
              return <div className="ta-day-column" key={key}>
                {lanes.map((lane, i) => <div className="ta-lane" key={i}>{layoutActivities(lane).map(({ event, column, columns }) => display(event,
                  (event.start - start) / 3600000 * HOUR_HEIGHT, (event.end - event.start) / 3600000 * HOUR_HEIGHT,
                  `calc(${column / columns * 100}% + 5px)`, `calc(${100 / columns}% - 10px)`))}</div>)}
                {key === dayKey(now) && <div className="ta-now" style={{ top: (now - start) / 3600000 * HOUR_HEIGHT }}><span>{clock(now)}</span><i /></div>}
                {!items.length && <div className="ta-empty-day" style={{ top: 9 * HOUR_HEIGHT + 12 }}><Glyph name="clock" /><strong>{visibleEvents.length ? 'Nothing matches' : 'No time tracked'}</strong><span>{filters.length ? 'Your tracked sessions appear here.' : 'Select a time type above.'}</span></div>}
              </div>;
            })}
          </div>
        </div>}
    </div>
    {selected && <div className="ta-detail" aria-live="polite">
      <><div className="ta-detail-top"><i style={{ background: KINDS.find(k => k.kind === selected.kind)!.color }} /><strong>{selected.title}</strong><span>{duration(selected.seconds)}</span><button className="ta-icon-btn" onClick={() => setSelectedId(null)} aria-label="Dismiss session details"><Glyph name="close" /></button></div>
        <p>{clock(selected.start)} – {selected.live ? 'Now · tracking' : clock(selected.end)}<span>·</span>{selected.source}{selected.project && <><span>·</span>{selected.project}</>}</p>
        {selected.note && <p>{selected.note}</p>}
        {!!selected.children?.length && <div className="ta-children">{selected.children.map(c => <div key={c.task_id}><span>{c.completed ? '✓ ' : '↳ '}{c.title}</span><b>{duration(c.seconds)}</b></div>)}</div>}
        {selected.taskId && onOpenTask && <button className="ta-open-task" onClick={() => onOpenTask(selected.taskId!)}>Open task<Glyph name="arrow" /></button>}
      </>
    </div>}
    <footer className="ta-footer"><span>Task and block time can overlap with attendance.</span><span>Overtime = work beyond daily commitment</span></footer>
  </>;
}

function DatePicker({ date, onPick, onClose }: { date: string; onPick: (date: string) => void; onClose: () => void }) {
  const [month, setMonth] = useState(date.slice(0, 7));
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);
  const first = `${month}-01`, start = weekStart(first);
  const changeMonth = (amount: number) => { const d = new Date(`${month}-15T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + amount); setMonth(d.toISOString().slice(0, 7)); };
  return <div className="ta-picker" ref={ref} role="group" aria-label="Choose a date"><div className="ta-picker-head"><button className="ta-icon-btn" aria-label="Previous month" onClick={() => changeMonth(-1)}><Glyph name="left" /></button><strong>{dateLabel(dayStart(first), { month: 'long', year: 'numeric' })}</strong><button className="ta-icon-btn" aria-label="Next month" onClick={() => changeMonth(1)}><Glyph name="right" /></button></div><div className="ta-month-grid">{['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <small key={i}>{d}</small>)}{Array.from({ length: 42 }, (_, i) => { const key = shiftDay(start, i); return <button key={key} aria-label={dateLabel(dayStart(key), { dateStyle: 'full' })} aria-pressed={key === date} data-outside={!key.startsWith(month)} onClick={() => onPick(key)}>{Number(key.slice(-2))}</button>; })}</div></div>;
}
TimeActivityCalendar.Data = CalendarData;
export default TimeActivityCalendar;
