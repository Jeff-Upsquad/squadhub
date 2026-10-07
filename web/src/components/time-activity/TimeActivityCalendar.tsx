'use client';

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { TimerSession } from '@squadhub/shared';
import api from '../../services/api';
import { KINDS, clipActivity, combineTaskSegments, clock, dateLabel, dayKey, dayStart, duration, isAttendance, layoutActivities, shiftDay, weekStart, type Activity, type ActivityKind } from './activityModel';
import './time-activity.css';

type CalendarState = {
  date: string; setDate: (date: string) => void; view: 'day' | 'week'; setView: (view: 'day' | 'week') => void;
  now: number; from: number; to: number; days: string[];
};
const HOUR_HEIGHT = 60;
const MIN_EVENT_HEIGHT = 24;
const EVENT_GAP = 3;
const CalendarContext = createContext<CalendarState | null>(null);
function Glyph({ name }: { name: 'clock' | 'close' | 'left' | 'right' | 'expand' | 'calendar' | 'arrow' }) {
  const paths = { clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3 2" /></>, close: <path d="m6 6 12 12M18 6 6 18" />, left: <path d="m14 5-7 7 7 7" />, right: <path d="m10 5 7 7-7 7" />, expand: <><path d="M8 3H3v5M16 21h5v-5M3 3l6 6m12 12-6-6" /></>, calendar: <><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M7 3v4m10-4v4M3 11h18" /></>, arrow: <path d="M5 12h14m-5-5 5 5-5 5" /> };
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{paths[name]}</svg>;
}

function TimeActivityCalendar({ onClose, renderData, demo = false, initialDate }: {
  onClose: () => void; renderData: (from: number, to: number, now: number, days: string[]) => ReactNode; demo?: boolean; initialDate?: string;
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
        {renderData(from, to, now, days)}
      </CalendarContext.Provider>
    </dialog>, document.body);
}

function sessionIdOf(event: Activity): string | null {
  if (!isAttendance(event.kind)) return null;
  const idx = event.id.indexOf(':');
  if (idx <= 0) return null;
  const sid = event.id.slice(0, idx);
  if (sid.length < 32 || !sid.includes('-')) return null;
  return sid;
}

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(local: string): string {
  return new Date(local).toISOString();
}

function isWithinWindow(endIso: string | null, windowHours: number): boolean {
  if (windowHours <= 0) return true;
  if (!endIso) return false;
  return Date.now() - new Date(endIso).getTime() <= windowHours * 3600 * 1000;
}

function CalendarData({ events, commitment, loading = false, error = false, onRetry, onOpenTask, sessions = [], canEdit = false, editWindowHours = 0, workspaceId, context }: {
  events: Activity[]; commitment: number; loading?: boolean; error?: boolean; onRetry?: () => void; onOpenTask?: (id: string) => void;
  sessions?: TimerSession[]; canEdit?: boolean; editWindowHours?: number; workspaceId?: string; context?: string;
}) {
  const { date, setDate, view, setView, now, from, to, days } = useContext(CalendarContext)!;
  const qc = useQueryClient();
  const [filters, setFilters] = useState<ActivityKind[]>(KINDS.map(k => k.kind));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [picker, setPicker] = useState(false);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [dragError, setDragError] = useState<string | null>(null);
  const [drag, setDrag] = useState<null | { sessionId: string; edge: 'start' | 'end'; origStart: number; origEnd: number; curMs: number; startY: number }>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [calendarWidth, setCalendarWidth] = useState(850);
  useEffect(() => {
    if (!scroller.current) return;
    const observer = new ResizeObserver(([entry]) => setCalendarWidth(entry.contentRect.width));
    observer.observe(scroller.current);
    return () => observer.disconnect();
  }, [loading, error]);
  const visibleEvents = useMemo(() => combineTaskSegments(events.map(e => clipActivity(e, from, to)).filter((e): e is Activity => !!e)), [events, from, to]);
  const selected = visibleEvents.find(e => e.id === selectedId);
  const sessionById = useMemo(() => new Map((sessions || []).map(s => [s.id, s])), [sessions]);
  // All attendance pieces per underlying timer session (work may split into work + overtime).
  const piecesBySession = useMemo(() => {
    const map = new Map<string, Activity[]>();
    for (const e of visibleEvents) {
      const sid = sessionIdOf(e);
      if (!sid) continue;
      const list = map.get(sid) || [];
      list.push(e);
      map.set(sid, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.start - b.start);
    return map;
  }, [visibleEvents]);
  const selectedSessionId = selected ? sessionIdOf(selected) : null;
  const selectedSession = selectedSessionId ? sessionById.get(selectedSessionId) || null : null;
  const selectedEditable = !!(
    selected && selectedSession && selectedSession.end_time && !selected.live &&
    canEdit && isWithinWindow(selectedSession.end_time, editWindowHours) &&
    (selected.kind === 'work' || selected.kind === 'break' || selected.kind === 'overtime' || selected.kind === 'no_work')
  );
  useEffect(() => { setEditingSessionId(null); setDragError(null); }, [selectedId]);
  const invalidateTime = () => {
    qc.invalidateQueries({ queryKey: ['timer-sessions'] });
    qc.invalidateQueries({ queryKey: ['timer-stats'] });
    qc.invalidateQueries({ queryKey: ['timer-active'] });
  };
  const saveSessionResize = async (sessionId: string, patch: { start_time?: string; end_time?: string }) => {
    try {
      await api.patch(`/timer/sessions/${sessionId}`, patch);
      invalidateTime();
      setDragError(null);
    } catch (err: any) {
      setDragError(err?.response?.data?.error || 'Could not save that change');
    }
  };
  // Drag-to-trim: pointermove/up listeners while a resize handle is held.
  // Reduce-only by construction: the dragged edge clamps inside the original
  // session range, so time can be trimmed but never extended.
  const dragRef = useRef<typeof drag>(null);
  dragRef.current = drag;
  useEffect(() => {
    if (!drag) return;
    const { sessionId, edge, origStart, origEnd, startY } = drag;
    const move = (e: PointerEvent) => {
      const deltaMs = Math.round((e.clientY - startY) / HOUR_HEIGHT * 3600000 / 60000) * 60000;
      if (edge === 'start') {
        const clamped = Math.min(Math.max(origStart + deltaMs, origStart), origEnd - 60000);
        setDrag(d => (d && d.curMs !== clamped ? { ...d, curMs: clamped } : d));
      } else {
        const clamped = Math.max(Math.min(origEnd + deltaMs, origEnd), origStart + 60000);
        setDrag(d => (d && d.curMs !== clamped ? { ...d, curMs: clamped } : d));
      }
    };
    const up = () => {
      const d = dragRef.current;
      setDrag(null);
      if (!d || d.sessionId !== sessionId) return;
      const changed = edge === 'start' ? d.curMs !== origStart : d.curMs !== origEnd;
      if (!changed) return;
      const iso = new Date(d.curMs).toISOString();
      void saveSessionResize(sessionId, edge === 'start' ? { start_time: iso } : { end_time: iso });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
    window.addEventListener('pointercancel', up, { once: true });
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); };
  }, [drag ? `${drag.sessionId}:${drag.edge}:${drag.startY}` : null]);
  const totals = Object.fromEntries(KINDS.map(k => [k.kind, visibleEvents.filter(e => e.kind === k.kind).reduce((sum, e) => sum + e.seconds, 0)])) as Record<ActivityKind, number>;
  const work = totals.work + totals.overtime;
  const trackedDays = new Set(visibleEvents.filter(e => e.kind === 'work' || e.kind === 'overtime').map(e => dayKey(e.start))).size;
  const denominator = commitment * (view === 'day' ? 1 : trackedDays);
  const pct = denominator ? Math.round(work / denominator * 100) : null;
  useEffect(() => {
    const scrollToTarget = () => {
      if (!scroller.current) return;
      const viewportHeight = scroller.current.clientHeight || 500;
      let targetHour = 9;
      if (days.includes(dayKey(now))) {
        targetHour = (now - dayStart(dayKey(now))) / 3600000;
      } else {
        const firstEvent = visibleEvents.filter(e => filters.includes(e.kind)).sort((a, b) => a.start - b.start)[0];
        targetHour = firstEvent ? (firstEvent.start - dayStart(dayKey(firstEvent.start))) / 3600000 : 9;
      }
      scroller.current.scrollTop = Math.max(0, targetHour * HOUR_HEIGHT - viewportHeight / 2);
    };

    const raf = requestAnimationFrame(() => {
      scrollToTarget();
      const timer = setTimeout(scrollToTarget, 60);
      return () => clearTimeout(timer);
    });
    setSelectedId(null);
    return () => cancelAnimationFrame(raf);
  }, [from, to, loading, view]);
  useEffect(() => { setSelectedId(null); }, [filters]);
  const gutterWidth = typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches ? 48 : 64;
  const availableWidth = Math.max(0, calendarWidth - gutterWidth);
  const dayLayouts = days.map(key => {
    const start = dayStart(key);
    const items = visibleEvents.filter(e => filters.includes(e.kind)).map(e => clipActivity(e, start, start + 86400000)).filter((e): e is Activity => !!e);
    // Three sections in day view:
    // 1. Work and break section (compact)
    // 2. Day planner section (less wide)
    // 3. Time tracker section (priority / widest)
    const lanes = view === 'day'
      ? [
          items.filter(e => isAttendance(e.kind)),
          items.filter(e => e.kind === 'day_plan'),
          items.filter(e => !isAttendance(e.kind) && e.kind !== 'day_plan'),
        ]
      : [items];
    const layout = lanes.map((lane, i) =>
      layoutActivities(lane, view === 'day' && i === 0 ? 0 : (MIN_EVENT_HEIGHT + EVENT_GAP) / HOUR_HEIGHT * 3600000)
    );
    const columnCount = (lane: typeof layout[number]) => Math.max(1, ...lane.map(e => e.columns));

    // Section 1: Work & Break (compact status column)
    const section1Base = Math.max(92, Math.min(115, Math.round(availableWidth * 0.13)));
    const section1Width = Math.max(section1Base, columnCount(layout[0]) * 55);

    // Section 2: Day Planner (less wide)
    const section2Base = Math.max(140, Math.min(220, Math.round(availableWidth * 0.25)));
    const section2Width = Math.max(section2Base, columnCount(layout[1]) * 120);

    // Section 3: Time Tracker (priority, takes the remainder)
    const section3Base = Math.max(280, availableWidth - section1Width - section2Width);
    const section3Width = Math.max(section3Base, columnCount(layout[2]) * 150);

    const widths = view === 'day'
      ? [section1Width, section2Width, section3Width]
      : [Math.max(availableWidth / 7, columnCount(layout[0]) * 140)];
    return { key, start, items, layout, widths, width: widths.reduce((sum, width) => sum + width, 0) };
  });
  const gridWidth = Math.max(calendarWidth, gutterWidth + dayLayouts.reduce((sum, day) => sum + day.width, 0));
  const beginResize = (e: React.PointerEvent, session: TimerSession, edge: 'start' | 'end') => {
    e.preventDefault();
    e.stopPropagation();
    const origStart = Date.parse(session.start_time);
    const origEnd = session.end_time ? Date.parse(session.end_time) : NaN;
    if (!Number.isFinite(origStart) || !Number.isFinite(origEnd)) return;
    setSelectedId(null);
    setDrag({ sessionId: session.id, edge, origStart, origEnd, curMs: edge === 'start' ? origStart : origEnd, startY: e.clientY });
  };
  const display = (event: Activity, top: number, height: number, left: string, width: string, isNarrow?: boolean, isTight?: boolean, dayStartMs?: number) => {
    const sid = sessionIdOf(event);
    const session = sid ? sessionById.get(sid) : undefined;
    const editable = !!(sid && session?.end_time && !event.live && canEdit && isWithinWindow(session.end_time, editWindowHours));
    // Only the outer edges of a session are trimmable. A work session split
    // into work + overtime shares a middle boundary (the commitment split)
    // that must not move, so it gets no handle.
    let topHandle = false, bottomHandle = false;
    if (editable && session?.end_time && dayStartMs != null && height >= 40) {
      const sStart = Date.parse(session.start_time), sEnd = Date.parse(session.end_time);
      const insideDay = sStart >= dayStartMs - 1000 && sEnd <= dayStartMs + 86400000 + 1000;
      if (insideDay) {
        const pieces = piecesBySession.get(sid!) || [];
        const isFirst = pieces.length ? pieces[0].id === event.id : true;
        const isLast = pieces.length ? pieces[pieces.length - 1].id === event.id : true;
        topHandle = isFirst;
        bottomHandle = isLast;
      }
    }
    let adjTop = top, adjHeight = height;
    if (drag && sid && drag.sessionId === sid && session) {
      const pieces = piecesBySession.get(sid) || [];
      const isFirst = pieces.length ? pieces[0].id === event.id : true;
      const isLast = pieces.length ? pieces[pieces.length - 1].id === event.id : true;
      if (drag.edge === 'start' && isFirst && dayStartMs != null) {
        const ns = Math.min(Math.max(drag.curMs, drag.origStart), drag.origEnd - 60000);
        adjTop = (ns - dayStartMs) / 3600000 * HOUR_HEIGHT;
        adjHeight = (event.end - ns) / 3600000 * HOUR_HEIGHT;
      } else if (drag.edge === 'end' && isLast) {
        const ne = Math.max(Math.min(drag.curMs, drag.origEnd), drag.origStart + 60000);
        adjHeight = (ne - event.start) / 3600000 * HOUR_HEIGHT;
      }
    }
    return (
    <button key={event.id} className="ta-event" data-kind={event.kind} data-selected={event.id === selectedId} data-short={adjHeight < 43} data-narrow={isNarrow} data-tight={isTight}
      style={{ top: adjTop, height: Math.max(MIN_EVENT_HEIGHT, adjHeight - EVENT_GAP), left, width, '--event-color': KINDS.find(k => k.kind === event.kind)?.color || '#38bdf8' } as CSSProperties}
      onClick={() => setSelectedId(event.id === selectedId ? null : event.id)}
      aria-label={`${event.title}, ${clock(event.start)} to ${event.live ? 'now' : clock(event.end)}, ${duration(event.seconds)}${event.isManual ? ', manually entered' : ''}${editable ? ', editable: open details to trim time or drag the edges' : ''}`}
      title={`${event.title} · ${clock(event.start)}–${event.live ? 'now' : clock(event.end)} · ${duration(event.seconds)}${event.isManual ? ' · Manually entered' : ''}${editable ? ' · Drag edges to trim (reduce only)' : ''}`}>
      {topHandle && session && <span className="ta-resize ta-resize-top" role="slider" aria-label={`Trim ${event.title} start (reduce only)`} aria-valuemin={Date.parse(session.start_time)} aria-valuemax={Date.parse(session.end_time!)} aria-valuenow={drag?.sessionId === sid && drag.edge === 'start' ? drag.curMs : Date.parse(session.start_time)}
        onPointerDown={e => beginResize(e, session, 'start')} onClick={e => e.stopPropagation()} />}
      <span className="ta-event-title">
        <span className="ta-event-name">
          {event.live && <i className="ta-live-dot" />}
          <span className="ta-event-text">{event.title}</span>
          {event.isManual && <span className="ta-manual-tag">manual</span>}
        </span>
        <b title="Logged time">{duration(event.seconds)}</b>
      </span>
      {adjHeight >= 43 && <span className="ta-event-time">{clock(drag?.sessionId === sid && drag.edge === 'start' ? drag.curMs : event.start)} – {event.live ? 'now' : clock(event.end)}</span>}
      {adjHeight >= 78 && event.project && <span className="ta-event-project">{event.project}</span>}
      {adjHeight >= 105 && event.kind === 'block' && <span className="ta-event-badge">{event.children?.length || 0} tasks in this block</span>}
      {bottomHandle && session && <span className="ta-resize ta-resize-bottom" role="slider" aria-label={`Trim ${event.title} end (reduce only)`} aria-valuemin={Date.parse(session.start_time)} aria-valuemax={Date.parse(session.end_time!)} aria-valuenow={drag?.sessionId === sid && drag.edge === 'end' ? drag.curMs : Date.parse(session.end_time!)}
        onPointerDown={e => beginResize(e, session, 'end')} onClick={e => e.stopPropagation()} />}
    </button>
    );
  };
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
      {gridWidth > calendarWidth + 1 && <div className="ta-scroll-hint">↔ Scroll sideways to see all tasks</div>}
      {loading ? <div className="ta-state" role="status"><Glyph name="clock" /><strong>Loading your timeline…</strong><span>Gathering attendance, tasks and work blocks.</span></div>
        : error ? <div className="ta-state" role="alert"><strong>We couldn’t load all your time</strong><span>Please try again to see the complete timeline.</span><button className="ta-today" onClick={onRetry}>Try again</button></div>
        : <div className="ta-grid-scroll" ref={scroller} tabIndex={0} aria-label="Time calendar. Scroll sideways to see overlapping tasks.">
      <div className="ta-grid-head" style={{ width: gridWidth }}><div className="ta-zone">IST</div>{dayLayouts.map(({ key, width, widths }) => <div key={key} style={{ flex: `0 0 ${width}px` }} className="ta-day-head" data-today={key === dayKey(now)}>
        <button onClick={() => { setDate(key); setView('day'); }}><span>{dateLabel(dayStart(key), { weekday: view === 'day' ? 'long' : 'short' })}</span><b>{dateLabel(dayStart(key), { day: '2-digit' })}</b></button>
        {view === 'day' ? <div className="ta-lane-labels"><span style={{ width: widths[0] }}>WORK & BREAK</span><span style={{ width: widths[1] }}>DAY PLANNER</span><span style={{ width: widths[2], flex: 1 }}>TIME TRACKER</span></div> : <small>{duration(visibleEvents.filter(e => dayKey(e.start) === key && (e.kind === 'work' || e.kind === 'overtime')).reduce((s, e) => s + e.seconds, 0))} worked</small>}
      </div>)}</div>

          <div className="ta-grid-body" style={{ width: gridWidth }}><div className="ta-hours">{Array.from({ length: 24 }, (_, h) => <span key={h} style={{ top: h * HOUR_HEIGHT }}>{h === 0 ? '12 AM' : h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h - 12} PM`}</span>)}</div>
            {dayLayouts.map(({ key, start, items, layout, widths, width }) => {
              return <div className="ta-day-column" key={key} style={{ flex: `0 0 ${width}px` }}>
                {layout.map((lane, i) => <div className="ta-lane" key={i} style={{ flex: `0 0 ${widths[i]}px` }}>{lane.map(({ event, column, columns }) => {
                  const laneWidth = widths[i];
                  const columnWidth = view === 'week' ? 140 : laneWidth / columns;
                  const isNarrow = view === 'day' && i === 0;
                  const cardWidth = columns === 1
                    ? (isNarrow ? laneWidth - 6 : laneWidth - 10)
                    : Math.max(38, columnWidth - 4);
                  const left = `${column * columnWidth + (isNarrow ? 3 : 5)}px`;
                  return display(event, (event.start - start) / 3600000 * HOUR_HEIGHT, (event.end - event.start) / 3600000 * HOUR_HEIGHT,
                    left, `${cardWidth}px`, isNarrow, cardWidth < 68, start);
                })}</div>)}
                {key === dayKey(now) && <div className="ta-now" style={{ top: (now - start) / 3600000 * HOUR_HEIGHT }}><span>{clock(now)}</span><i /></div>}
                {!items.length && <div className="ta-empty-day" style={{ top: 9 * HOUR_HEIGHT + 12 }}><Glyph name="clock" /><strong>{visibleEvents.length ? 'Nothing matches' : 'No time tracked'}</strong><span>{filters.length ? 'Your tracked sessions appear here.' : 'Select a time type above.'}</span></div>}
              </div>;
            })}
          </div>
        </div>}
    </div>
    {selected && <div className="ta-detail" aria-live="polite">
      <><div className="ta-detail-top"><i style={{ background: KINDS.find(k => k.kind === selected.kind)!.color }} /><strong>{selected.title}</strong>{selected.isManual && <span className="ta-manual-tag">manual</span>}<span>{duration(selected.seconds)}</span><button className="ta-icon-btn" onClick={() => setSelectedId(null)} aria-label="Dismiss session details"><Glyph name="close" /></button></div>
        <p>{clock(selected.start)} – {selected.live ? 'Now · tracking' : clock(selected.end)}<span>·</span>{selected.source}{selected.project && <><span>·</span>{selected.project}</>}</p>
        {dragError && <p className="ta-edit-error" role="alert">{dragError}</p>}
        {selectedEditable && selectedSession && (
          <div className="ta-edit-row">
            <button className="ta-open-task" onClick={() => setEditingSessionId(editingSessionId === selectedSession.id ? null : selectedSession.id)}>
              {editingSessionId === selectedSession.id ? 'Close editor' : 'Edit time'}<Glyph name="arrow" />
            </button>
            <span className="ta-edit-hint">Reduce only · drag edges or trim below</span>
          </div>
        )}
        {selectedEditable && selectedSession && editingSessionId === selectedSession.id && (
          <AttendanceEditForm session={selectedSession} onClose={() => setEditingSessionId(null)} onSaved={() => { setEditingSessionId(null); invalidateTime(); }} />
        )}
        {selected.note && <p>{selected.note}</p>}
        {!!selected.segments?.length && <details className="ta-segments"><summary>{selected.segments.length} time segments · {duration(selected.seconds)} tracked</summary>
          {selected.segments.map(segment => <div key={`${segment.id}:${segment.start}`}><span>{clock(segment.start)} – {segment.live ? 'Now · tracking' : clock(segment.end)}<small>{segment.source}{segment.isManual ? ' · manual' : ''}{segment.note ? ` · ${segment.note}` : ''}</small></span><b>{duration(segment.seconds)}</b></div>)}
        </details>}
        {!!selected.children?.length && <div className="ta-children">{selected.children.map(c => <div key={c.task_id}><span>{c.completed ? '✓ ' : '↳ '}{c.title}</span><b>{duration(c.seconds)}</b></div>)}</div>}
        {selected.taskId && onOpenTask && <button className="ta-open-task" onClick={() => onOpenTask(selected.taskId!)}>Open task<Glyph name="arrow" /></button>}
      </>
    </div>}
    <footer className="ta-footer"><span>Task and block time can overlap with attendance.</span><span>Overtime = work beyond daily commitment</span></footer>
  </>;
}

function AttendanceEditForm({ session, onClose, onSaved }: { session: TimerSession; onClose: () => void; onSaved: () => void }) {
  const origStart = Date.parse(session.start_time);
  const origEnd = session.end_time ? Date.parse(session.end_time) : NaN;
  const origSeconds = session.duration_seconds ?? Math.round((origEnd - origStart) / 1000);
  const [startLocal, setStartLocal] = useState(toLocalInput(session.start_time));
  const [endLocal, setEndLocal] = useState(session.end_time ? toLocalInput(session.end_time) : '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const startMs = Date.parse(fromLocalInput(startLocal));
  const endMs = endLocal ? Date.parse(fromLocalInput(endLocal)) : NaN;
  const validRange = Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs;
  const newSeconds = validRange ? Math.round((endMs - startMs) / 1000) : 0;
  const expands = validRange && (startMs < origStart || endMs > origEnd || newSeconds > origSeconds);
  const tooShort = validRange && newSeconds < 60;
  const blocked = expands || tooShort || !validRange;
  const trimmed = validRange ? Math.max(0, origSeconds - newSeconds) : 0;
  const save = async () => {
    if (saving) return;
    if (!validRange) { setError('Pick a valid start and end'); return; }
    if (expands) { setError('Time can only be reduced, not increased'); return; }
    if (tooShort) { setError('Sessions must keep at least 1 minute'); return; }
    if (startMs === origStart && endMs === origEnd) { onClose(); return; }
    setSaving(true);
    setError(null);
    try {
      await api.patch(`/timer/sessions/${session.id}`, {
        start_time: new Date(startMs).toISOString(),
        end_time: new Date(endMs).toISOString(),
      });
      onSaved();
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Could not save that change');
      setSaving(false);
    }
  };
  return (
    <div className="ta-edit" onKeyDown={e => { if (e.key === 'Enter') void save(); if (e.key === 'Escape') onClose(); }}>
      <div className="ta-edit-grid">
        <label>Start<input type="datetime-local" value={startLocal} min={toLocalInput(session.start_time)} max={endLocal || undefined}
          onChange={e => { setStartLocal(e.target.value); setError(null); }} /></label>
        <label>End<input type="datetime-local" value={endLocal} min={startLocal || undefined} max={session.end_time ? toLocalInput(session.end_time) : undefined}
          onChange={e => { setEndLocal(e.target.value); setError(null); }} /></label>
      </div>
      <div className="ta-edit-foot">
        <span className={`ta-foot-hint${error || blocked ? ' is-bad' : ''}`}>
          {error || (expands ? 'Time can only be reduced, not increased'
            : tooShort ? 'Sessions must keep at least 1 minute'
            : trimmed > 0 ? `−${duration(trimmed)} · ${duration(newSeconds)} remaining`
            : `Reduce only · up to ${duration(origSeconds)}`)}
        </span>
        <button type="button" className="ta-today" onClick={onClose}>Cancel</button>
        <button type="button" className="ta-save" disabled={blocked || saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save'}</button>
      </div>
    </div>
  );
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
