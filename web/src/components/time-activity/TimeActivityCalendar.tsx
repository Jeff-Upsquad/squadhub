'use client';

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { TaskTimeEntry, TimerSession } from '@squadhub/shared';
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

// True original bounds before the first trim (NULL = never trimmed).
// Reduce-only is enforced against these, so time can be re-adjusted back up
// to the original — but never past it.
function boundsOf(session: TimerSession): { startMs: number; endMs: number; seconds: number } {
  const startIso = session.original_start_time ?? session.start_time;
  const endIso = session.original_end_time ?? session.end_time;
  const startMs = Date.parse(startIso);
  const endMs = endIso ? Date.parse(endIso) : NaN;
  const seconds = session.original_duration_seconds
    ?? session.duration_seconds
    ?? (Number.isFinite(startMs) && Number.isFinite(endMs) ? Math.round((endMs - startMs) / 1000) : 0);
  return { startMs, endMs, seconds };
}

function CalendarData({ events, commitment, loading = false, error = false, onRetry, onOpenTask, sessions = [], entries = [], canEdit = false, editWindowHours = 0, workspaceId, context }: {
  events: Activity[]; commitment: number; loading?: boolean; error?: boolean; onRetry?: () => void; onOpenTask?: (id: string) => void;
  sessions?: TimerSession[]; entries?: TaskTimeEntry[]; canEdit?: boolean; editWindowHours?: number; workspaceId?: string; context?: string;
}) {
  const { date, setDate, view, setView, now, from, to, days } = useContext(CalendarContext)!;
  const qc = useQueryClient();
  const [filters, setFilters] = useState<ActivityKind[]>(KINDS.map(k => k.kind));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [picker, setPicker] = useState(false);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [dragError, setDragError] = useState<string | null>(null);
  const [drag, setDrag] = useState<null | { sessionId: string; edge: 'start' | 'end'; origStart: number; origEnd: number; boundStart: number; boundEnd: number; curMs: number; startY: number }>(null);
  // Drag-to-move / resize for TIME TRACKER blocks (task + time-block entries).
  // Move preserves every entry's duration and only shifts started_at; resize
  // changes duration via the top/bottom handles. Multi-segment groups (one
  // task, several entries that day) support move-only.
  const [entryDrag, setEntryDrag] = useState<null | {
    key: string; mode: 'move' | 'start' | 'end';
    items: { taskId: string; entryId: string; origStartMs: number; durationSec: number }[];
    origBlockStart: number; origBlockEnd: number; curMs: number; deltaMs: number; startY: number; dayStartMs: number; moved: boolean;
  }>(null);
  const suppressClick = useRef(false);
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
  const entryById = useMemo(() => new Map((entries || []).map(e => [e.id, e])), [entries]);
  const entryItemsOf = (event: Activity): { taskId: string; entryId: string; origStartMs: number; durationSec: number }[] | null => {
    if (event.live) return null;
    if (event.kind !== 'task' && event.kind !== 'block') return null;
    // Require the backing DB row: demo/sample cards without entries stay static.
    const collect = (id: string) => {
      if (!id.startsWith('entry:')) return null;
      const entryId = id.slice(6);
      const row = entryById.get(entryId);
      if (!row) return null;
      const origStartMs = Date.parse(row.started_at);
      const durationSec = row.duration_seconds;
      if (!Number.isFinite(origStartMs) || !Number.isFinite(durationSec) || durationSec <= 0) return null;
      return { taskId: row.task_id, entryId, origStartMs, durationSec };
    };
    if (event.id.startsWith('entry:')) {
      const single = collect(event.id);
      return single ? [single] : null;
    }
    if (event.id.startsWith('task-day:')) {
      // Singleton groups drop their segments (see combineTaskSegments), so
      // resolve the one backing entry by task + IST day + manual/timer
      // class. Only when exactly one entry sits fully inside the day —
      // midnight-spanning entries stay static rather than move wrongly.
      const parts = event.id.split(':');
      const taskId = parts[1], date = parts[2], manualKey = parts[3];
      if (taskId && date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
        const ds = dayStart(date), de = ds + 86400000;
        const cands = (entries || []).filter(e => {
          if (e.task_id !== taskId || e.source === 'work_block') return false;
          if ((e.source === 'manual') !== (manualKey === 'manual')) return false;
          const s = Date.parse(e.started_at), t = Date.parse(e.stopped_at);
          return Number.isFinite(s) && Number.isFinite(t) && t > s && s >= ds && t <= de;
        });
        if (cands.length === 1) {
          const row = cands[0];
          if (Number.isFinite(row.duration_seconds) && row.duration_seconds > 0) {
            return [{ taskId: row.task_id, entryId: row.id, origStartMs: Date.parse(row.started_at), durationSec: row.duration_seconds }];
          }
        }
      }
      // Fall through to the multi-segment path below (segments carry entry: ids).
    }
    // Combined task-day group: move every underlying entry by the same delta.
    const segs = event.segments?.length ? event.segments : null;
    if (!segs) return null;
    const items: { taskId: string; entryId: string; origStartMs: number; durationSec: number }[] = [];
    for (const s of segs) {
      const item = collect(s.id);
      if (!item) return null;
      items.push(item);
    }
    return items.length ? items : null;
  };
  const canMoveEntry = (event: Activity) => !!entryItemsOf(event);
  useEffect(() => { setEditingSessionId(null); setDragError(null); }, [selectedId]);
  const invalidateTime = () => {
    qc.invalidateQueries({ queryKey: ['timer-sessions'] });
    qc.invalidateQueries({ queryKey: ['timer-stats'] });
    qc.invalidateQueries({ queryKey: ['timer-active'] });
    qc.invalidateQueries({ queryKey: ['task-time-entries'] });
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
  const saveEntryDrag = async (
    items: { taskId: string; entryId: string; origStartMs: number; durationSec: number }[],
    mode: 'move' | 'start' | 'end',
    origBlockStart: number, origBlockEnd: number, finalMs: number, deltaMs: number,
    eventId: string,
  ) => {
    try {
      if (mode === 'move') {
        if (deltaMs === 0) return;
        await Promise.all(items.map(item =>
          api.patch(`/pm/tasks/${item.taskId}/time-entries/${item.entryId}`, {
            started_at: new Date(item.origStartMs + deltaMs).toISOString(),
            duration_seconds: item.durationSec,
          }),
        ));
      } else if (items.length === 1) {
        const item = items[0];
        const newStartMs = mode === 'start' ? finalMs : origBlockStart;
        const newEndMs = mode === 'end' ? finalMs : origBlockEnd;
        const newSecs = Math.round((newEndMs - newStartMs) / 1000);
        if (!(newEndMs > newStartMs) || newSecs < 60) {
          setSelectedId(eventId);
          setDragError('Sessions must keep at least 1 minute');
          return;
        }
        await api.patch(`/pm/tasks/${item.taskId}/time-entries/${item.entryId}`, {
          started_at: new Date(newStartMs).toISOString(),
          duration_seconds: newSecs,
        });
      } else {
        return;
      }
      invalidateTime();
      setDragError(null);
    } catch (err: any) {
      setSelectedId(eventId);
      setDragError(err?.response?.data?.error || 'Could not save that change');
    }
  };
  // Drag-to-trim: pointermove/up listeners while a resize handle is held.
  // Reduce-only against the TRUE original bounds: an edge clamps inside the
  // pre-trim range, so time can be trimmed and re-adjusted back up to the
  // original — but never extended past it.
  const dragRef = useRef<typeof drag>(null);
  dragRef.current = drag;
  useEffect(() => {
    if (!drag) return;
    const { sessionId, edge, origStart, origEnd, boundStart, boundEnd, startY } = drag;
    const move = (e: PointerEvent) => {
      const deltaMs = Math.round((e.clientY - startY) / HOUR_HEIGHT * 3600000 / 60000) * 60000;
      if (edge === 'start') {
        const clamped = Math.min(Math.max(origStart + deltaMs, boundStart), origEnd - 60000);
        setDrag(d => (d && d.curMs !== clamped ? { ...d, curMs: clamped } : d));
      } else {
        const clamped = Math.max(Math.min(origEnd + deltaMs, boundEnd), origStart + 60000);
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
  // Drag-to-move / resize for task + time-block entries. Move shifts every
  // underlying entry by the same delta so duration never changes; resize moves
  // one edge and recomputes duration. Snaps to 1 minute, clamps inside the
  // visible IST day and never past ~now.
  const entryDragRef = useRef<typeof entryDrag>(null);
  entryDragRef.current = entryDrag;
  useEffect(() => {
    if (!entryDrag) return;
    const { key, mode, origBlockStart, origBlockEnd, startY, dayStartMs, items } = entryDrag;
    const dayEndMs = dayStartMs + 86400000;
    const futureCap = Date.now() + 60000;
    const move = (e: PointerEvent) => {
      const raw = Math.round((e.clientY - startY) / HOUR_HEIGHT * 3600000 / 60000) * 60000;
      if (Math.abs(e.clientY - startY) < 4 && Math.abs(raw) < 60000) {
        setEntryDrag(d => (d && d.moved ? { ...d, moved: false } : d));
        return;
      }
      if (mode === 'move') {
        const minDelta = dayStartMs - origBlockStart;
        const maxDelta = Math.min(dayEndMs, futureCap) - origBlockEnd;
        const clamped = Math.min(Math.max(raw, minDelta), maxDelta);
        setEntryDrag(d => (d && (d.deltaMs !== clamped || !d.moved) ? { ...d, deltaMs: clamped, moved: true } : d));
      } else if (mode === 'start') {
        const clamped = Math.min(Math.max(origBlockStart + raw, dayStartMs), origBlockEnd - 60000);
        setEntryDrag(d => (d && (d.curMs !== clamped || !d.moved) ? { ...d, curMs: clamped, moved: true } : d));
      } else {
        const clamped = Math.max(Math.min(origBlockEnd + raw, Math.min(dayEndMs, futureCap)), origBlockStart + 60000);
        setEntryDrag(d => (d && (d.curMs !== clamped || !d.moved) ? { ...d, curMs: clamped, moved: true } : d));
      }
    };
    const up = () => {
      const d = entryDragRef.current;
      setEntryDrag(null);
      if (!d || d.key !== key) return;
      if (!d.moved) return;
      if (mode === 'move') {
        if (d.deltaMs === 0) return;
        suppressClick.current = true;
        window.setTimeout(() => { suppressClick.current = false; }, 50);
        void saveEntryDrag(items, mode, origBlockStart, origBlockEnd, origBlockStart + d.deltaMs, d.deltaMs, key);
      } else {
        const changed = d.curMs !== (mode === 'start' ? origBlockStart : origBlockEnd);
        if (!changed || items.length !== 1) return;
        suppressClick.current = true;
        window.setTimeout(() => { suppressClick.current = false; }, 50);
        void saveEntryDrag(items, mode, origBlockStart, origBlockEnd, d.curMs, 0, key);
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
    window.addEventListener('pointercancel', () => { setEntryDrag(null); }, { once: true });
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, [entryDrag ? `${entryDrag.key}:${entryDrag.mode}:${entryDrag.startY}` : null]);
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
    const bounds = boundsOf(session);
    const boundStart = Number.isFinite(bounds.startMs) ? bounds.startMs : origStart;
    const boundEnd = Number.isFinite(bounds.endMs) ? bounds.endMs : origEnd;
    setSelectedId(null);
    setDrag({ sessionId: session.id, edge, origStart, origEnd, boundStart, boundEnd, curMs: edge === 'start' ? origStart : origEnd, startY: e.clientY });
  };
  const beginEntryResize = (e: React.PointerEvent, event: Activity, edge: 'start' | 'end', dayStartMs: number) => {
    e.preventDefault();
    e.stopPropagation();
    const items = entryItemsOf(event);
    if (!items || items.length !== 1) return;
    setSelectedId(null);
    setDragError(null);
    setEntryDrag({
      key: event.id, mode: edge, items,
      origBlockStart: event.start, origBlockEnd: event.end,
      curMs: edge === 'start' ? event.start : event.end, deltaMs: 0,
      startY: e.clientY, dayStartMs, moved: false,
    });
  };
  const beginEntryMove = (e: React.PointerEvent, event: Activity, dayStartMs: number) => {
    // Only primary-button drags; let right-click / multi-touch behave normally.
    if (e.button !== 0 || e.ctrlKey || e.metaKey) return;
    const items = entryItemsOf(event);
    if (!items) return;
    setEntryDrag({
      key: event.id, mode: 'move', items,
      origBlockStart: event.start, origBlockEnd: event.end,
      curMs: event.start, deltaMs: 0,
      startY: e.clientY, dayStartMs, moved: false,
    });
  };
  const display = (event: Activity, top: number, height: number, left: string, width: string, isNarrow?: boolean, isTight?: boolean, dayStartMs?: number) => {
    const sid = sessionIdOf(event);
    const session = sid ? sessionById.get(sid) : undefined;
    const editable = !!(sid && session?.end_time && !event.live && canEdit && isWithinWindow(session.end_time, editWindowHours));
    // Only the outer edges of a session are trimmable. A work session split
    // into work + overtime shares a middle boundary (the commitment split)
    // that must not move, so it gets no handle.
    let topHandle = false, bottomHandle = false;
    if (editable && session?.end_time && dayStartMs != null) {
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
    // TIME TRACKER blocks: the whole card drags to a new start (duration
    // preserved); single-entry cards also get top/bottom handles to adjust.
    const entryItems = (event.kind === 'task' || event.kind === 'block') && dayStartMs != null ? entryItemsOf(event) : null;
    const entryMovable = !!entryItems;
    const entryResizable = !!entryItems && entryItems.length === 1;
    const isEntryDragging = !!entryDrag && entryDrag.key === event.id;
    let adjTop = top, adjHeight = height;
    if (drag && sid && drag.sessionId === sid && session) {
      const pieces = piecesBySession.get(sid) || [];
      const isFirst = pieces.length ? pieces[0].id === event.id : true;
      const isLast = pieces.length ? pieces[pieces.length - 1].id === event.id : true;
      if (drag.edge === 'start' && isFirst && dayStartMs != null) {
        const ns = Math.min(Math.max(drag.curMs, drag.boundStart), drag.origEnd - 60000);
        adjTop = (ns - dayStartMs) / 3600000 * HOUR_HEIGHT;
        adjHeight = (event.end - ns) / 3600000 * HOUR_HEIGHT;
      } else if (drag.edge === 'end' && isLast) {
        const ne = Math.max(Math.min(drag.curMs, drag.boundEnd), drag.origStart + 60000);
        adjHeight = (ne - event.start) / 3600000 * HOUR_HEIGHT;
      }
    }
    if (entryDrag && entryDrag.key === event.id && dayStartMs != null) {
      if (entryDrag.mode === 'move') {
        const ns = entryDrag.origBlockStart + entryDrag.deltaMs;
        adjTop = (ns - dayStartMs) / 3600000 * HOUR_HEIGHT;
        adjHeight = (entryDrag.origBlockEnd - entryDrag.origBlockStart) / 3600000 * HOUR_HEIGHT;
      } else if (entryDrag.mode === 'start') {
        const ns = Math.min(Math.max(entryDrag.curMs, dayStartMs), entryDrag.origBlockEnd - 60000);
        adjTop = (ns - dayStartMs) / 3600000 * HOUR_HEIGHT;
        adjHeight = (entryDrag.origBlockEnd - ns) / 3600000 * HOUR_HEIGHT;
      } else {
        adjHeight = (entryDrag.curMs - entryDrag.origBlockStart) / 3600000 * HOUR_HEIGHT;
      }
    }
    const previewStart = entryDrag && entryDrag.key === event.id && entryDrag.mode !== 'end'
      ? (entryDrag.mode === 'move' ? entryDrag.origBlockStart + entryDrag.deltaMs : entryDrag.curMs)
      : (drag?.sessionId === sid && drag.edge === 'start' ? drag.curMs : event.start);
    const previewEnd = entryDrag && entryDrag.key === event.id && entryDrag.mode !== 'start'
      ? (entryDrag.mode === 'move' ? entryDrag.origBlockEnd + entryDrag.deltaMs : entryDrag.curMs)
      : event.end;
    const handleClick = () => {
      if (suppressClick.current) { suppressClick.current = false; return; }
      if (entryDrag?.moved) return;
      setSelectedId(event.id === selectedId ? null : event.id);
    };
    return (
    <button key={event.id} className="ta-event" data-kind={event.kind} data-selected={event.id === selectedId} data-short={adjHeight < 43} data-narrow={isNarrow} data-tight={isTight} data-dragging={isEntryDragging} data-movable={entryMovable}
      style={{ top: adjTop, height: Math.max(MIN_EVENT_HEIGHT, adjHeight - EVENT_GAP), left, width, '--event-color': KINDS.find(k => k.kind === event.kind)?.color || '#38bdf8' } as CSSProperties}
      onClick={handleClick}
      onPointerDown={entryMovable && dayStartMs != null ? e => beginEntryMove(e, event, dayStartMs) : undefined}
      aria-label={`${event.title}, ${clock(event.start)} to ${event.live ? 'now' : clock(event.end)}, ${duration(event.seconds)}${event.isManual ? ', manually entered' : ''}${editable ? ', editable: open details to trim time or drag the edges' : ''}${entryMovable ? ', draggable: drag to move without changing duration' : ''}`}
      title={`${event.title} · ${clock(event.start)}–${event.live ? 'now' : clock(event.end)} · ${duration(event.seconds)}${event.isManual ? ' · Manually entered' : ''}${editable ? ' · Drag edges to trim (reduce only)' : ''}${entryMovable ? ' · Drag to move (duration preserved)' : ''}${entryResizable ? ' · Drag edges to adjust' : ''}`}>
      {topHandle && session && <span className="ta-resize ta-resize-top" role="slider" aria-label={`Trim ${event.title} start (reduce only)`} aria-valuemin={boundsOf(session).startMs} aria-valuemax={Date.parse(session.end_time!)} aria-valuenow={drag?.sessionId === sid && drag.edge === 'start' ? drag.curMs : Date.parse(session.start_time)}
        onPointerDown={e => beginResize(e, session, 'start')} onClick={e => e.stopPropagation()} />}
      {entryResizable && dayStartMs != null && <span className="ta-resize ta-resize-top" role="slider" aria-label={`Adjust ${event.title} start`} aria-valuemin={dayStartMs} aria-valuemax={event.end - 60000} aria-valuenow={entryDrag?.key === event.id && entryDrag.mode === 'start' ? entryDrag.curMs : event.start}
        onPointerDown={e => beginEntryResize(e, event, 'start', dayStartMs)} onClick={e => e.stopPropagation()} />}
      <span className="ta-event-title">
        <span className="ta-event-name">
          {event.live && <i className="ta-live-dot" />}
          <span className="ta-event-text">{event.title}</span>
          {event.isManual && <span className="ta-manual-tag">manual</span>}
        </span>
        <b title="Logged time">{duration(event.seconds)}</b>
      </span>
      {adjHeight >= 43 && <span className="ta-event-time">{clock(previewStart)} – {event.live && !(entryDrag && entryDrag.key === event.id) ? 'now' : clock(previewEnd)}</span>}
      {adjHeight >= 78 && event.project && <span className="ta-event-project">{event.project}</span>}
      {adjHeight >= 105 && event.kind === 'block' && <span className="ta-event-badge">{event.children?.length || 0} tasks in this block</span>}
      {bottomHandle && session && <span className="ta-resize ta-resize-bottom" role="slider" aria-label={`Trim ${event.title} end (reduce only)`} aria-valuemin={Date.parse(session.start_time)} aria-valuemax={boundsOf(session).endMs} aria-valuenow={drag?.sessionId === sid && drag.edge === 'end' ? drag.curMs : Date.parse(session.end_time!)}
        onPointerDown={e => beginResize(e, session, 'end')} onClick={e => e.stopPropagation()} />}
      {entryResizable && dayStartMs != null && <span className="ta-resize ta-resize-bottom" role="slider" aria-label={`Adjust ${event.title} end`} aria-valuemin={event.start + 60000} aria-valuemax={Math.min(dayStartMs + 86400000, Date.now() + 60000)} aria-valuenow={entryDrag?.key === event.id && entryDrag.mode === 'end' ? entryDrag.curMs : event.end}
        onPointerDown={e => beginEntryResize(e, event, 'end', dayStartMs)} onClick={e => e.stopPropagation()} />}
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
      {loading ? <div className="ta-state" role="status"><Glyph name="clock" /><strong>Loading your timeline…</strong><span>Gathering attendance, tasks and time blocks.</span></div>
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
        {!selected.live && (selected.kind === 'task' || selected.kind === 'block') && canMoveEntry(selected) && (
          <p className="ta-edit-hint">Drag the block to move it — duration stays the same{entryItemsOf(selected)?.length === 1 ? ' · drag edges to adjust' : ''}</p>
        )}
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
  const curStart = Date.parse(session.start_time);
  const curEnd = session.end_time ? Date.parse(session.end_time) : NaN;
  const bounds = boundsOf(session);
  const boundStart = Number.isFinite(bounds.startMs) ? bounds.startMs : curStart;
  const boundEnd = Number.isFinite(bounds.endMs) ? bounds.endMs : curEnd;
  const boundSeconds = bounds.seconds;
  const boundStartIso = new Date(boundStart).toISOString();
  const boundEndIso = new Date(boundEnd).toISOString();
  const [startLocal, setStartLocal] = useState(toLocalInput(session.start_time));
  const [endLocal, setEndLocal] = useState(session.end_time ? toLocalInput(session.end_time) : '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const startMs = Date.parse(fromLocalInput(startLocal));
  const endMs = endLocal ? Date.parse(fromLocalInput(endLocal)) : NaN;
  const validRange = Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs;
  const newSeconds = validRange ? Math.round((endMs - startMs) / 1000) : 0;
  const expands = validRange && (startMs < boundStart || endMs > boundEnd || newSeconds > boundSeconds);
  const tooShort = validRange && newSeconds < 60;
  const blocked = expands || tooShort || !validRange;
  const trimmed = validRange ? Math.max(0, boundSeconds - newSeconds) : 0;
  const save = async () => {
    if (saving) return;
    if (!validRange) { setError('Pick a valid start and end'); return; }
    if (expands) { setError('Time can only be reduced, not increased'); return; }
    if (tooShort) { setError('Sessions must keep at least 1 minute'); return; }
    if (startMs === curStart && endMs === curEnd) { onClose(); return; }
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
        <label>Start<input type="datetime-local" value={startLocal} min={toLocalInput(boundStartIso)} max={endLocal || undefined}
          onChange={e => { setStartLocal(e.target.value); setError(null); }} /></label>
        <label>End<input type="datetime-local" value={endLocal} min={startLocal || undefined} max={toLocalInput(boundEndIso)}
          onChange={e => { setEndLocal(e.target.value); setError(null); }} /></label>
      </div>
      <div className="ta-edit-foot">
        <span className={`ta-foot-hint${error || blocked ? ' is-bad' : ''}`}>
          {error || (expands ? 'Time can only be reduced, not increased'
            : tooShort ? 'Sessions must keep at least 1 minute'
            : trimmed > 0 ? `−${duration(trimmed)} · ${duration(newSeconds)} remaining`
            : `Reduce only · up to ${duration(boundSeconds)}`)}
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
