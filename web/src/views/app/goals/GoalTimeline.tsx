import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { Goal, GoalDependency, GoalEndpoint, GoalTask } from '@squadhub/shared';
import GoalIcon, { AvatarStack, type MemberLike } from './GoalIcons';
import { DateRangeField, Popover } from './GoalFields';
import type { GoalActions } from './goalsApi';
import {
  daysBetween, formatDay, formatRange, moveTaskDate, shiftDay, spaceColor, taskPath, taskRange, todayKey, toDayKey, weekday,
  type DayRange, type RangeKind,
} from './goalUtils';

const ROW = 54;
const ZOOMS = { day: 46, week: 22, month: 8 } as const;
type Zoom = keyof typeof ZOOMS;
type RangeFilter = 'both' | 'work' | 'plan';

const readPref = <T extends string>(key: string, allowed: readonly T[], fallback: T): T => {
  try {
    const v = localStorage.getItem(key) as T | null;
    return v && allowed.includes(v) ? v : fallback;
  } catch { return fallback; }
};
const writePref = (key: string, v: string) => { try { localStorage.setItem(key, v); } catch { /* private mode */ } };

type BarDrag = { kind: 'bar'; mode: 'move' | 'start' | 'end'; task: GoalTask; range: RangeKind; origin: DayRange; x0: number; scroll0: number; moved: boolean; readonly?: boolean };
type ConnectDrag = { kind: 'connect'; task: GoalTask; endpoint: GoalEndpoint };
type TrayDrag = { kind: 'tray'; task: GoalTask; x0: number; y0: number; started: boolean; length: number };
type Drag = BarDrag | ConnectDrag | TrayDrag;

interface Preview { taskId: string; range: RangeKind; start: string; end: string }
interface ConnectState { x: number; y: number; target: { taskId: string; endpoint: GoalEndpoint } | null }

/** Rounded orthogonal path through points. */
function roundedPath(pts: [number, number][], r = 7): string {
  if (pts.length < 2) return '';
  let d = `M${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i - 1];
    const [cx, cy] = pts[i];
    const [nx, ny] = pts[i + 1];
    const inLen = Math.hypot(cx - px, cy - py);
    const outLen = Math.hypot(nx - cx, ny - cy);
    const rr = Math.min(r, inLen / 2, outLen / 2);
    const ax = cx - ((cx - px) / (inLen || 1)) * rr;
    const ay = cy - ((cy - py) / (inLen || 1)) * rr;
    const bx = cx + ((nx - cx) / (outLen || 1)) * rr;
    const by = cy + ((ny - cy) / (outLen || 1)) * rr;
    d += ` L${ax} ${ay} Q${cx} ${cy} ${bx} ${by}`;
  }
  const last = pts[pts.length - 1];
  return `${d} L${last[0]} ${last[1]}`;
}

/** On the timeline = placed there AND has something to draw. */
export const onTimeline = (t: GoalTask) => t.scheduled && !!(taskRange(t, 'work') || taskRange(t, 'plan'));

/** Vertical layout of a row's ranges for the current filter. */
function rowGeometry(t: GoalTask, filter: RangeFilter, preview: Preview | null) {
  const pick = (kind: RangeKind) => (preview && preview.taskId === t.id && preview.range === kind
    ? { start: preview.start, end: preview.end }
    : taskRange(t, kind));
  const work = filter !== 'plan' ? pick('work') : null;
  const plan = filter !== 'work' ? pick('plan') : null;
  const both = !!work && !!plan;
  return {
    work,
    plan,
    workTop: both ? 8 : 15,
    planY: both ? 42 : ROW / 2,
    /** The range dependencies attach to, and its vertical anchor. */
    anchor: work ? { range: work, y: (both ? 8 : 15) + 12 } : plan ? { range: plan, y: both ? 42 : ROW / 2 } : null,
  };
}

export default function GoalTimeline({ goal, color, members, actions, onOpenTask, onLinkTasks, onAddSource }: {
  goal: Goal;
  color: string;
  members: MemberLike[];
  actions: GoalActions;
  onOpenTask: (t: GoalTask) => void;
  onLinkTasks: () => void;
  onAddSource: () => void;
}) {
  const [compact, setCompact] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches);
  const LABEL_W = compact ? 180 : 300;
  useEffect(() => {
    const media = window.matchMedia('(max-width: 767px)');
    const update = () => setCompact(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  const [zoom, setZoomState] = useState<Zoom>(() => readPref('gl-zoom', ['day', 'week', 'month'] as const, 'day'));
  const [filter, setFilterState] = useState<RangeFilter>(() => readPref('gl-ranges', ['both', 'work', 'plan'] as const, 'both'));
  const [trayOpen, setTrayOpen] = useState(() => !compact);
  const [traySearch, setTraySearch] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [overTray, setOverTray] = useState(false);
  const [connect, setConnect] = useState<ConnectState | null>(null);
  const [ghost, setGhost] = useState<{ task: GoalTask; x: number; y: number; day: string | null; length: number } | null>(null);
  const [selectedDep, setSelectedDep] = useState<{ dep: GoalDependency; rect: DOMRect } | null>(null);
  const [rowMenu, setRowMenu] = useState<{ task: GoalTask; rect: DOMRect; dates?: boolean } | null>(null);
  const dw = ZOOMS[zoom];
  const today = todayKey();

  const scrollRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const trayRef = useRef<HTMLElement>(null);
  const drag = useRef<Drag | null>(null);
  const edge = useRef({ dir: 0, raf: 0 });

  const setZoom = (z: Zoom) => {
    const el = scrollRef.current;
    const centerDay = el ? (el.scrollLeft + (el.clientWidth - LABEL_W) / 2) / dw : 0;
    setZoomState(z);
    writePref('gl-zoom', z);
    requestAnimationFrame(() => {
      if (el) el.scrollLeft = Math.max(0, centerDay * ZOOMS[z] - (el.clientWidth - LABEL_W) / 2);
    });
  };
  const setFilter = (f: RangeFilter) => { setFilterState(f); writePref('gl-ranges', f); };

  // Scheduled rows, ordered by when they start (stable while dragging).
  const scheduled = useMemo(() => {
    const start = (t: GoalTask) => taskRange(t, 'work')?.start || taskRange(t, 'plan')?.start || '9999';
    return goal.tasks.filter(onTimeline).sort((a, b) => start(a).localeCompare(start(b)) || a.title.localeCompare(b.title));
  }, [goal.tasks]);
  const unscheduled = useMemo(() => {
    const q = traySearch.trim().toLowerCase();
    return goal.tasks
      .filter((t) => !onTimeline(t) && (!q || `${t.title} ${taskPath(t)}`.toLowerCase().includes(q)))
      .sort((a, b) => Number(a.completed) - Number(b.completed));
  }, [goal.tasks, traySearch]);
  const trayCount = goal.tasks.filter((t) => !onTimeline(t)).length;

  // Visible window: generous padding around everything dated, Monday-aligned.
  const { anchor, dayCount } = useMemo(() => {
    const days = [today, goal.work_start_date, goal.work_end_date, goal.start_date, goal.due_date,
      ...scheduled.flatMap((t) => [taskRange(t, 'work'), taskRange(t, 'plan')].flatMap((r) => (r ? [r.start, r.end] : [])))]
      .filter(Boolean) as string[];
    days.sort();
    let first = shiftDay(days[0] < shiftDay(today, -14) ? days[0] : shiftDay(today, -14), -7);
    first = shiftDay(first, -((weekday(first) + 6) % 7));
    const last = shiftDay(days[days.length - 1] > shiftDay(today, 56) ? days[days.length - 1] : shiftDay(today, 56), 28);
    return { anchor: first, dayCount: Math.min(1100, daysBetween(first, last) + 1) };
  }, [today, goal.work_start_date, goal.work_end_date, goal.start_date, goal.due_date, scheduled]);
  const width = dayCount * dw;
  const xOf = useCallback((day: string) => daysBetween(anchor, day) * dw, [anchor, dw]);

  // Open on today (or the first task if the plan starts later).
  const didScroll = useRef(false);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || didScroll.current) return;
    didScroll.current = true;
    const firstStart = scheduled.map((t) => taskRange(t, 'work')?.start || taskRange(t, 'plan')?.start).filter(Boolean).sort()[0];
    const focus = firstStart && firstStart > today ? firstStart : today;
    el.scrollLeft = Math.max(0, xOf(focus) - dw * (zoom === 'day' ? 3 : 7));
  }, [scheduled, today, xOf, dw, zoom]);

  const scrollToToday = () => {
    scrollRef.current?.scrollTo({ left: Math.max(0, xOf(today) - (scrollRef.current.clientWidth - LABEL_W) / 3), behavior: 'smooth' });
  };

  // ── Pointer interactions ────────────────────────────────────────────────

  const pointToDay = (clientX: number) => {
    const rect = bodyRef.current!.getBoundingClientRect();
    const idx = Math.floor((clientX - rect.left - LABEL_W) / dw);
    return shiftDay(anchor, Math.max(0, Math.min(dayCount - 1, idx)));
  };
  const inTray = (x: number, y: number) => {
    const r = trayRef.current?.getBoundingClientRect();
    return !!r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  };
  const inGantt = (x: number, y: number) => {
    const r = scrollRef.current?.getBoundingClientRect();
    return !!r && x >= r.left + LABEL_W && x <= r.right && y >= r.top && y <= r.bottom;
  };

  // Auto-scroll while dragging near the timeline's left/right edge.
  const updateEdge = (clientX: number) => {
    const r = scrollRef.current?.getBoundingClientRect();
    if (!r) return;
    const dir = clientX < r.left + LABEL_W + 36 && clientX > r.left + LABEL_W - 40 ? -1 : clientX > r.right - 40 ? 1 : 0;
    edge.current.dir = dir;
    if (dir && !edge.current.raf) {
      const tick = () => {
        if (!edge.current.dir || !scrollRef.current) { edge.current.raf = 0; return; }
        scrollRef.current.scrollLeft += edge.current.dir * 12;
        edge.current.raf = requestAnimationFrame(tick);
      };
      edge.current.raf = requestAnimationFrame(tick);
    }
  };
  const stopEdge = () => { edge.current.dir = 0; };

  const barPreview = (d: BarDrag, clientX: number): Preview => {
    const delta = Math.round((clientX - d.x0 + (scrollRef.current?.scrollLeft || 0) - d.scroll0) / dw);
    let { start, end } = d.origin;
    if (d.mode === 'move') { start = shiftDay(start, delta); end = shiftDay(end, delta); }
    else if (d.mode === 'start') { start = shiftDay(start, delta); if (start > end) start = end; }
    else { end = shiftDay(end, delta); if (end < start) end = start; }
    return { taskId: d.task.id, range: d.range, start, end };
  };

  const commitBar = (d: BarDrag, p: Preview) => {
    const t = d.task;
    if (p.start === d.origin.start && p.end === d.origin.end) return;
    const [startField, endField] = d.range === 'work' ? ['work_date', 'work_end_date'] as const : ['start_date', 'due_date'] as const;
    const hadStart = !!t[startField];
    const hadEnd = !!t[endField];
    const patch: Record<string, string> = {};
    const setStart = () => { patch[startField] = moveTaskDate(t[startField], p.start); };
    const setEnd = () => { patch[endField] = moveTaskDate(t[endField], p.end); };
    if (d.mode === 'move') {
      if (hadStart) setStart();
      if (hadEnd) setEnd();
    } else if (d.mode === 'start') {
      // Stretching a single date turns it into a real range.
      setStart();
      if (!hadEnd) setEnd();
    } else {
      setEnd();
      if (!hadStart) setStart();
    }
    void actions.schedule(goal.id, t.id, patch).catch(() => undefined);
  };

  const hitTarget = (clientX: number, clientY: number, fromId: string): ConnectState['target'] => {
    const rect = bodyRef.current!.getBoundingClientRect();
    const row = Math.floor((clientY - rect.top) / ROW);
    const t = scheduled[row];
    if (!t || t.id === fromId) return null;
    const geo = rowGeometry(t, filter, null);
    if (!geo.anchor) return null;
    const x = clientX - rect.left - LABEL_W;
    const mid = (xOf(geo.anchor.range.start) + xOf(geo.anchor.range.end) + dw) / 2;
    return { taskId: t.id, endpoint: x < mid ? 'start' : 'end' };
  };

  const onMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (d.kind === 'bar') {
      if (d.readonly || (!d.moved && Math.abs(e.clientX - d.x0) < 4)) return;
      d.moved = true;
      const over = d.mode === 'move' && inTray(e.clientX, e.clientY);
      setOverTray(over);
      setPreview(over ? null : barPreview(d, e.clientX));
      updateEdge(e.clientX);
    } else if (d.kind === 'connect') {
      const rect = bodyRef.current!.getBoundingClientRect();
      setConnect({ x: e.clientX - rect.left - LABEL_W, y: e.clientY - rect.top, target: hitTarget(e.clientX, e.clientY, d.task.id) });
      updateEdge(e.clientX);
    } else {
      if (!d.started && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 5) return;
      if (!d.started) document.body.classList.add('gl-noselect');
      d.started = true;
      const day = inGantt(e.clientX, e.clientY) ? pointToDay(e.clientX - (d.length > 1 ? dw * 0.5 : 0)) : null;
      setGhost({ task: d.task, x: e.clientX, y: e.clientY, day, length: d.length });
      if (day) updateEdge(e.clientX); else stopEdge();
    }
  };
  const onUp = (e: PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    stopEdge();
    document.body.classList.remove('gl-noselect');
    if (!d) return;
    if (d.kind === 'bar') {
      setOverTray(false);
      if (!d.moved) { setPreview(null); if (d.mode === 'move') onOpenTask(d.task); return; }
      if (d.mode === 'move' && inTray(e.clientX, e.clientY)) {
        setPreview(null);
        void actions.schedule(goal.id, d.task.id, { scheduled: false }).catch(() => undefined);
        return;
      }
      if (d.readonly) { setPreview(null); return; }
      commitBar(d, barPreview(d, e.clientX));
      setPreview(null);
    } else if (d.kind === 'connect') {
      const target = hitTarget(e.clientX, e.clientY, d.task.id);
      setConnect(null);
      if (target) {
        void actions.addDependency(goal, {
          from_task_id: d.task.id, from_endpoint: d.endpoint, to_task_id: target.taskId, to_endpoint: target.endpoint,
        })?.catch(() => undefined);
      }
    } else {
      setGhost(null);
      if (!d.started) return;
      if (inGantt(e.clientX, e.clientY)) {
        const start = pointToDay(e.clientX - (d.length > 1 ? dw * 0.5 : 0));
        placeTask(d.task, start, d.length);
      }
    }
  };
  const onCancel = () => {
    drag.current = null;
    stopEdge();
    document.body.classList.remove('gl-noselect');
    setPreview(null);
    setConnect(null);
    setGhost(null);
    setOverTray(false);
  };
  const live = useRef({ onMove, onUp, onCancel });
  live.current = { onMove, onUp, onCancel };
  useEffect(() => {
    const move = (e: PointerEvent) => live.current.onMove(e);
    const up = (e: PointerEvent) => live.current.onUp(e);
    const cancel = () => live.current.onCancel();
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && drag.current) { e.stopPropagation(); cancel(); } };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', key, true);
      edge.current.dir = 0;
      cancelAnimationFrame(edge.current.raf);
      document.body.classList.remove('gl-noselect');
    };
  }, []);

  /** Put a tray task on the timeline at `start` (keeps an existing work length). */
  function placeTask(t: GoalTask, start: string, length: number) {
    if (!t.can_edit) {
      void actions.schedule(goal.id, t.id, { scheduled: true }).catch(() => undefined);
      return;
    }
    void actions.schedule(goal.id, t.id, {
      scheduled: true,
      work_date: moveTaskDate(t.work_date, start),
      work_end_date: shiftDay(start, Math.max(0, length - 1)),
    }).catch(() => undefined);
  }

  /** Arrow on a tray card: keep its own dates if it has any, else start today. */
  function quickPlace(t: GoalTask) {
    void actions.place(goal.id, t).catch(() => undefined);
    const r = taskRange(t, 'work') || taskRange(t, 'plan');
    const target = r?.start || today;
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ left: Math.max(0, xOf(target) - 160), behavior: 'smooth' }));
  }

  const startBarDrag = (e: React.PointerEvent, task: GoalTask, range: RangeKind, mode: BarDrag['mode']) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const origin = taskRange(task, range);
    if (!origin) return;
    if (!task.can_edit) {
      // View-only: a click still opens the task, but nothing moves.
      if (mode === 'move') drag.current = { kind: 'bar', mode, task, range, origin, x0: e.clientX, scroll0: scrollRef.current?.scrollLeft || 0, moved: false, readonly: true };
      return;
    }
    e.preventDefault();
    document.body.classList.add('gl-noselect');
    drag.current = { kind: 'bar', mode, task, range, origin, x0: e.clientX, scroll0: scrollRef.current?.scrollLeft || 0, moved: false };
  };

  const startConnect = (e: React.PointerEvent, task: GoalTask, endpoint: GoalEndpoint) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    document.body.classList.add('gl-noselect');
    drag.current = { kind: 'connect', task, endpoint };
    const rect = bodyRef.current!.getBoundingClientRect();
    setConnect({ x: e.clientX - rect.left - LABEL_W, y: e.clientY - rect.top, target: null });
  };

  const startTrayDrag = (e: React.PointerEvent, task: GoalTask) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
    if (!task.can_edit && !taskRange(task, 'work') && !taskRange(task, 'plan')) return;
    const work = taskRange(task, 'work');
    drag.current = { kind: 'tray', task, x0: e.clientX, y0: e.clientY, started: false, length: work ? daysBetween(work.start, work.end) + 1 : 3 };
  };

  const nudge = (t: GoalTask, range: RangeKind, delta: number, resize: boolean) => {
    const origin = taskRange(t, range);
    if (!origin || !t.can_edit) return;
    const d: BarDrag = { kind: 'bar', mode: resize ? 'end' : 'move', task: t, range, origin, x0: 0, scroll0: scrollRef.current?.scrollLeft || 0, moved: true };
    commitBar(d, barPreview(d, delta * dw));
  };

  // Rows are memoized; hand them stable callbacks that always see fresh state.
  const rowFns = useRef({ startBarDrag, startConnect, nudge, onOpenTask, actions, setRowMenu });
  rowFns.current = { startBarDrag, startConnect, nudge, onOpenTask, actions, setRowMenu };
  const rowHandlers = useMemo(() => ({
    onBarDown: (e: React.PointerEvent, t: GoalTask, r: RangeKind, m: BarDrag['mode']) => rowFns.current.startBarDrag(e, t, r, m),
    onConnectDown: (e: React.PointerEvent, t: GoalTask, ep: GoalEndpoint) => rowFns.current.startConnect(e, t, ep),
    onNudge: (t: GoalTask, r: RangeKind, delta: number, resize: boolean) => rowFns.current.nudge(t, r, delta, resize),
    onOpen: (t: GoalTask) => rowFns.current.onOpenTask(t),
    onToggle: (t: GoalTask) => { void rowFns.current.actions.setTaskCompleted(t, !t.completed).catch(() => undefined); },
    onMenu: (t: GoalTask, rect: DOMRect) => rowFns.current.setRowMenu({ task: t, rect }),
  }), []);

  // ── Geometry for dependencies ───────────────────────────────────────────

  const rowIndex = useMemo(() => new Map(scheduled.map((t, i) => [t.id, i])), [scheduled]);
  const endpointPoint = (t: GoalTask, endpoint: GoalEndpoint): [number, number] | null => {
    const i = rowIndex.get(t.id);
    if (i == null) return null;
    const geo = rowGeometry(t, filter, preview);
    if (!geo.anchor) return null;
    const x = endpoint === 'start' ? xOf(geo.anchor.range.start) : xOf(geo.anchor.range.end) + dw;
    return [x, i * ROW + geo.anchor.y];
  };

  const depPaths = goal.dependencies.map((dep) => {
    const from = scheduled.find((t) => t.id === dep.from_task_id);
    const to = scheduled.find((t) => t.id === dep.to_task_id);
    if (!from || !to) return null;
    const a = endpointPoint(from, dep.from_endpoint);
    const b = endpointPoint(to, dep.to_endpoint);
    if (!a || !b) return null;
    const out = dep.from_endpoint === 'end' ? 1 : -1;
    const inn = dep.to_endpoint === 'start' ? -1 : 1;
    const p1: [number, number] = [a[0] + out * 12, a[1]];
    const p2: [number, number] = [b[0] + inn * 12, b[1]];
    const forward = out === 1 && inn === -1 ? p2[0] >= p1[0] : out === -1 && inn === 1 ? p2[0] <= p1[0] : false;
    const ia = Math.floor(a[1] / ROW);
    // Backwards links travel along the gap between rows instead of through bars.
    const laneY = b[1] > a[1] ? (ia + 1) * ROW : ia * ROW;
    const midX = p1[0] + (p2[0] - p1[0]) / 2;
    const pts: [number, number][] = forward
      ? [a, [midX, a[1]], [midX, b[1]], b]
      : [a, p1, [p1[0], laneY], [p2[0], laneY], p2, b];
    const fr = taskRange(from, 'work') || taskRange(from, 'plan');
    const tr = taskRange(to, 'work') || taskRange(to, 'plan');
    const late = !!fr && !!tr && dep.from_endpoint === 'end' && dep.to_endpoint === 'start' && tr.start < fr.end;
    return { dep, d: roundedPath(pts), late };
  }).filter(Boolean) as { dep: GoalDependency; d: string; late: boolean }[];

  const connectFrom = drag.current?.kind === 'connect' ? drag.current : null;
  const connectStart = connect && connectFrom ? endpointPoint(connectFrom.task, connectFrom.endpoint) : null;

  // ── Header scale ────────────────────────────────────────────────────────

  const months = useMemo(() => {
    const out: { key: string; label: string; left: number; width: number }[] = [];
    let i = 0;
    while (i < dayCount) {
      const day = shiftDay(anchor, i);
      const y = +day.slice(0, 4), m = +day.slice(5, 7);
      const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
      const span = Math.min(dayCount - i, daysInMonth - +day.slice(8, 10) + 1);
      const label = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { month: span * dw > 110 ? 'long' : 'short', year: span * dw > 150 ? 'numeric' : undefined, timeZone: 'UTC' });
      out.push({ key: day.slice(0, 7), label, left: i * dw, width: span * dw });
      i += span;
    }
    return out;
  }, [anchor, dayCount, dw]);

  const ticks = useMemo(() => {
    const out: { day: string; left: number; label: string; sub?: string; weekend: boolean; today: boolean; width: number }[] = [];
    for (let i = 0; i < dayCount; i++) {
      const day = shiftDay(anchor, i);
      const wd = weekday(day);
      const isToday = day === today;
      if (zoom === 'month') {
        if (wd === 1) out.push({ day, left: i * dw, label: String(+day.slice(8, 10)), weekend: false, today: false, width: dw * 7 });
      } else {
        out.push({
          day, left: i * dw, width: dw, weekend: wd === 0 || wd === 6, today: isToday,
          label: String(+day.slice(8, 10)),
          sub: zoom === 'day' ? 'SMTWTFS'[wd] : undefined,
        });
      }
    }
    return out;
  }, [anchor, dayCount, dw, zoom, today]);

  const gridStyle: CSSProperties = {
    width,
    backgroundSize: `${dw * 7}px 100%${zoom !== 'month' ? `, ${dw}px 100%` : ''}`,
    backgroundImage: zoom === 'month'
      ? `linear-gradient(to right, var(--gl-grid-strong) 1px, transparent 1px)`
      : `linear-gradient(to right, transparent ${dw * 5}px, var(--gl-weekend) ${dw * 5}px), linear-gradient(to right, var(--gl-grid) 1px, transparent 1px)`,
  };

  const goalWork = goal.work_start_date && goal.work_end_date ? { start: goal.work_start_date, end: goal.work_end_date } : null;
  const showTray = trayOpen;
  const height = Math.max(scheduled.length + (ghost?.day ? 1 : 0), 1) * ROW;

  return (
    <div className="gl-tl" data-dragging={(preview || connect || ghost) ? 'true' : undefined} style={{ '--dw': `${dw}px`, '--gl-label-w': `${LABEL_W}px` } as CSSProperties}>
      {showTray && (
        <aside className="gl-tray" ref={trayRef} data-drop={overTray || undefined}>
          <div className="gl-tray-head">
            <div>
              <strong>Task tray</strong>
              <span className="gl-count">{trayCount}</span>
            </div>
            <button type="button" className="gl-icon-btn" onClick={onLinkTasks} title="Link tasks" aria-label="Link tasks">
              <GoalIcon name="plus" size={16} />
            </button>
          </div>
          <p className="gl-tray-hint">Drag onto the timeline to schedule work dates.</p>
          {trayCount > 4 && (
            <label className="gl-tray-search">
              <GoalIcon name="search" size={14} />
              <input value={traySearch} onChange={(e) => setTraySearch(e.target.value)} placeholder="Filter tasks" />
            </label>
          )}
          <div className="gl-tray-list">
            {unscheduled.map((t) => (
              <div
                key={t.id}
                className="gl-tray-card"
                data-done={t.completed || undefined}
                data-ghosting={ghost?.task.id === t.id || undefined}
                style={{ '--bar': spaceColor(t) } as CSSProperties}
                onPointerDown={(e) => startTrayDrag(e, t)}
                onDoubleClick={() => onOpenTask(t)}
              >
                <GoalIcon name="grip" size={14} className="gl-tray-grip" />
                <div className="gl-tray-text">
                  <strong>{t.title}</strong>
                  <small><i />{t.list_name}{t.due_date ? ` · due ${formatDay(toDayKey(t.due_date))}` : ''}</small>
                </div>
                <button type="button" className="gl-icon-btn gl-tray-add" onClick={() => quickPlace(t)}
                  disabled={!t.can_edit && !taskRange(t, 'work') && !taskRange(t, 'plan')}
                  title={!t.can_edit && !taskRange(t, 'work') && !taskRange(t, 'plan') ? 'Edit access is needed to set work dates' : taskRange(t, 'work') || taskRange(t, 'plan') ? 'Add to timeline' : 'Schedule from today'} aria-label={`Add ${t.title} to the timeline`}>
                  <GoalIcon name="arrow" size={14} />
                </button>
              </div>
            ))}
            {!unscheduled.length && (
              <div className="gl-tray-empty">
                {trayCount ? <span>No tasks match</span> : goal.tasks.length ? (
                  <><GoalIcon name="check" size={20} /><strong>All on the timeline</strong><span>Drag a bar back here to unschedule it.</span></>
                ) : (
                  <><GoalIcon name="link" size={20} /><strong>No tasks yet</strong><span>Link tasks from anywhere in your workspace.</span></>
                )}
              </div>
            )}
          </div>
          {overTray && <div className="gl-tray-drop"><GoalIcon name="tray" size={20} />Drop to move back to the tray</div>}
          <div className="gl-tray-foot">
            <button type="button" className="gl-btn gl-btn-block" onClick={onLinkTasks}><GoalIcon name="link" size={14} />Link tasks</button>
            <button type="button" className="gl-text-btn" onClick={onAddSource}><GoalIcon name="folder" size={13} />Auto-include a folder or list</button>
            {goal.hidden_task_count > 0 && (
              <p className="gl-tray-note">{goal.hidden_task_count} task{goal.hidden_task_count === 1 ? '' : 's'} you can’t open also count{goal.hidden_task_count === 1 ? 's' : ''} toward progress.</p>
            )}
          </div>
        </aside>
      )}

      <div className="gl-gantt-wrap">
        <div className="gl-gantt-toolbar">
          <button type="button" className="gl-chip-btn" data-active={trayOpen || undefined} onClick={() => setTrayOpen(!trayOpen)}>
            <GoalIcon name="tray" size={14} />Tray{trayCount ? <span className="gl-count">{trayCount}</span> : null}
          </button>
          <div className="gl-seg" role="radiogroup" aria-label="Date ranges">
            {([['both', 'All dates'], ['work', 'Work'], ['plan', 'Start & due']] as const).map(([k, l]) => (
              <button key={k} type="button" role="radio" aria-checked={filter === k} data-active={filter === k || undefined} onClick={() => setFilter(k)}>
                {k === 'work' && <i className="gl-key-work" />}{k === 'plan' && <i className="gl-key-plan" />}{l}
              </button>
            ))}
          </div>
          <div className="gl-grow" />
          <button type="button" className="gl-chip-btn" onClick={scrollToToday}><GoalIcon name="today" size={14} />Today</button>
          <div className="gl-seg" role="radiogroup" aria-label="Zoom">
            {(['day', 'week', 'month'] as const).map((z) => (
              <button key={z} type="button" role="radio" aria-checked={zoom === z} data-active={zoom === z || undefined} onClick={() => setZoom(z)}>
                {z === 'day' ? 'Days' : z === 'week' ? 'Weeks' : 'Months'}
              </button>
            ))}
          </div>
        </div>

        <div className="gl-gantt" ref={scrollRef}>
          <div className="gl-gantt-inner" style={{ width: LABEL_W + width }}>
            <div className="gl-gantt-head">
              <div className="gl-gantt-corner">
                <span>Timeline</span>
                <span className="gl-count">{scheduled.length}</span>
              </div>
              <div className="gl-scale" style={{ width }}>
                <div className="gl-scale-months">
                  {months.map((m) => <span key={m.key} style={{ left: m.left, width: m.width }}><b>{m.label}</b></span>)}
                </div>
                <div className="gl-scale-days" data-zoom={zoom}>
                  {ticks.map((t) => (
                    <span key={t.day} style={{ left: t.left, width: t.width }} data-weekend={t.weekend || undefined} data-today={t.today || undefined}>
                      {t.sub && <small>{t.sub}</small>}
                      <b>{t.label}</b>
                    </span>
                  ))}
                </div>
                {goalWork && (
                  <div className="gl-scale-goalwork" style={{ left: xOf(goalWork.start), width: (daysBetween(goalWork.start, goalWork.end) + 1) * dw, '--gc': color } as CSSProperties}
                    title={`Goal work window · ${formatRange(goalWork.start, goalWork.end)}`} />
                )}
                {goal.due_date && (
                  <div className="gl-scale-due" style={{ left: xOf(goal.due_date) + dw, '--gc': color } as CSSProperties} title={`Goal due ${formatDay(goal.due_date)}`}>
                    <span>Goal due</span>
                  </div>
                )}
              </div>
            </div>

            <div className="gl-gantt-body" ref={bodyRef} style={{ height: Math.max(height, 260) }}>
              <div className="gl-grid" style={{ ...gridStyle, height: '100%', left: LABEL_W }} />
              {goalWork && (
                <div className="gl-goalwork-band" style={{ left: LABEL_W + xOf(goalWork.start), width: (daysBetween(goalWork.start, goalWork.end) + 1) * dw, '--gc': color } as CSSProperties} />
              )}
              {daysBetween(anchor, today) >= 0 && (
                <div className="gl-today-line" style={{ left: LABEL_W + xOf(today) + dw / 2 }}><span /></div>
              )}
              {goal.due_date && <div className="gl-due-line" style={{ left: LABEL_W + xOf(goal.due_date) + dw, '--gc': color } as CSSProperties} />}

              {scheduled.map((t, i) => (
                <GanttRow
                  key={t.id}
                  task={t}
                  index={i}
                  filter={filter}
                  preview={preview?.taskId === t.id ? preview : null}
                  xOf={xOf}
                  dw={dw}
                  members={members}
                  connectTarget={connect?.target?.taskId === t.id ? connect.target.endpoint : null}
                  connecting={!!connect}
                  {...rowHandlers}
                />
              ))}

              {ghost?.day && (
                <div className="gl-row gl-row-ghost" style={{ height: ROW }}>
                  <div className="gl-row-label"><span className="gl-ghost-label">{ghost.task.title}</span></div>
                  <div className="gl-row-track" style={{ width }}>
                    <div className="gl-bar gl-bar-work gl-bar-drop" style={{ left: xOf(ghost.day), width: ghost.length * dw, top: 15, '--bar': spaceColor(ghost.task) } as CSSProperties}>
                      <span className="gl-bar-tip">{formatRange(ghost.day, shiftDay(ghost.day, ghost.length - 1))}</span>
                    </div>
                  </div>
                </div>
              )}

              <svg className="gl-deps" width={width} height={Math.max(height, 260)} style={{ left: LABEL_W }}>
                <defs>
                  <marker id={`gl-arrow-${goal.id}`} viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                    <path d="M1 1.5 8.5 5 1 8.5" fill="none" stroke="context-stroke" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </marker>
                </defs>
                {depPaths.map(({ dep, d, late }) => (
                  <g key={dep.id} className="gl-dep" data-late={late || undefined} data-selected={selectedDep?.dep.id === dep.id || undefined}>
                    <path d={d} className="gl-dep-hit" onClick={(e) => setSelectedDep({ dep, rect: new DOMRect(e.clientX - 4, e.clientY - 4, 8, 8) })} />
                    <path d={d} className="gl-dep-line" markerEnd={`url(#gl-arrow-${goal.id})`} />
                  </g>
                ))}
                {connect && connectStart && (
                  <path className="gl-dep-draft" d={`M${connectStart[0]} ${connectStart[1]} C${connectStart[0] + 60} ${connectStart[1]} ${connect.x - 60} ${connect.y} ${connect.x} ${connect.y}`} />
                )}
              </svg>

              {!scheduled.length && !ghost?.day && (
                <div className="gl-tl-empty">
                  <div className="gl-tl-empty-art" aria-hidden="true">
                    <span style={{ width: '46%', marginLeft: '6%' }} />
                    <span style={{ width: '34%', marginLeft: '30%' }} />
                    <span style={{ width: '40%', marginLeft: '52%' }} />
                  </div>
                  <strong>{goal.tasks.length ? 'Drag tasks from the tray onto a day' : 'Link the tasks that make this goal happen'}</strong>
                  <span>{goal.tasks.length ? 'Their work start and end dates are set automatically. Drag the ends to adjust.' : 'Search across every list you can access — subtasks too.'}</span>
                  {!goal.tasks.length && <button type="button" className="gl-btn gl-btn-primary" onClick={onLinkTasks}><GoalIcon name="link" size={14} />Link tasks</button>}
                </div>
              )}
            </div>
          </div>
        </div>

        <footer className="gl-legend">
          <span><i className="gl-key-work" />Work dates</span>
          <span><i className="gl-key-plan" />Start → due</span>
          <span><i className="gl-key-dep" />Dependency</span>
          <span className="gl-grow" />
          <span className="gl-legend-hint">Drag bars to move · drag edges to resize · drag a dot to another task to connect</span>
        </footer>
      </div>

      {ghost && createPortal(
        <div className="gl-drag-ghost" style={{ left: ghost.x + 12, top: ghost.y + 10, '--bar': spaceColor(ghost.task) } as CSSProperties}>
          <i />{ghost.task.title}
          {ghost.day && <small>{formatRange(ghost.day, shiftDay(ghost.day, ghost.length - 1))}</small>}
        </div>,
        document.body,
      )}

      {selectedDep && (
        <Popover anchor={selectedDep.rect} onClose={() => setSelectedDep(null)} width={260}>
          {(() => {
            const from = goal.tasks.find((t) => t.id === selectedDep.dep.from_task_id);
            const to = goal.tasks.find((t) => t.id === selectedDep.dep.to_task_id);
            return (
              <div className="gl-dep-pop">
                <div className="gl-pop-title">Dependency</div>
                <p><b>{to?.title}</b> {selectedDep.dep.to_endpoint === 'start' ? 'starts' : 'finishes'} after <b>{from?.title}</b> {selectedDep.dep.from_endpoint === 'end' ? 'finishes' : 'starts'}.</p>
                <button type="button" className="gl-pop-item gl-danger" onClick={() => {
                  void actions.removeDependency(goal.id, selectedDep.dep.id).catch(() => undefined);
                  setSelectedDep(null);
                }}>
                  <GoalIcon name="unlink" size={14} />Remove dependency
                </button>
              </div>
            );
          })()}
        </Popover>
      )}

      {rowMenu && (
        <Popover anchor={rowMenu.rect} onClose={() => setRowMenu(null)} width={rowMenu.dates ? 330 : 230}>
          {rowMenu.dates ? (
            <TaskDatesEditor task={goal.tasks.find((t) => t.id === rowMenu.task.id) || rowMenu.task} goalId={goal.id} actions={actions} />
          ) : (
            <>
              <button type="button" className="gl-pop-item" onClick={() => { setRowMenu(null); onOpenTask(rowMenu.task); }}>
                <GoalIcon name="external" size={14} />Open task
              </button>
              <button type="button" className="gl-pop-item" disabled={!rowMenu.task.can_edit} onClick={() => setRowMenu({ ...rowMenu, dates: true })}>
                <GoalIcon name="calendar" size={14} />Edit dates
              </button>
              <button type="button" className="gl-pop-item" onClick={() => {
                setRowMenu(null);
                void actions.schedule(goal.id, rowMenu.task.id, { scheduled: false }).catch(() => undefined);
              }}>
                <GoalIcon name="tray" size={14} />Move back to tray
              </button>
              {rowMenu.task.direct && (
                <button type="button" className="gl-pop-item gl-danger" onClick={() => {
                  setRowMenu(null);
                  void actions.unlinkTask(goal.id, rowMenu.task).catch(() => undefined);
                }}>
                  <GoalIcon name="unlink" size={14} />Remove from goal
                </button>
              )}
            </>
          )}
        </Popover>
      )}
    </div>
  );
}

function TaskDatesEditor({ task, goalId, actions }: { task: GoalTask; goalId: string; actions: GoalActions }) {
  const work = taskRange(task, 'work');
  const plan = taskRange(task, 'plan');
  return (
    <div className="gl-dates-editor">
      <div className="gl-pop-title">{task.title}</div>
      <div className="gl-prop"><span>Work dates</span>
        <DateRangeField kind="work" start={work ? toDayKey(task.work_date) : null} end={work ? toDayKey(task.work_end_date) : null}
          startLabel="Work start" endLabel="Work end"
          onChange={(s, e) => void actions.schedule(goalId, task.id, { work_date: s ? moveTaskDate(task.work_date, s) : null, work_end_date: e }).catch(() => undefined)} />
      </div>
      <div className="gl-prop"><span>Start &amp; due</span>
        <DateRangeField kind="plan" start={plan ? toDayKey(task.start_date) : null} end={plan ? toDayKey(task.due_date) : null}
          startLabel="Start" endLabel="Due"
          onChange={(s, e) => void actions.schedule(goalId, task.id, {
            start_date: s ? moveTaskDate(task.start_date, s) : null,
            due_date: e ? moveTaskDate(task.due_date, e) : null,
          }).catch(() => undefined)} />
      </div>
      <p className="gl-pop-note">Dates change on the task itself, everywhere it appears.</p>
    </div>
  );
}

interface RowProps {
  task: GoalTask;
  index: number;
  filter: RangeFilter;
  preview: Preview | null;
  xOf: (day: string) => number;
  dw: number;
  members: MemberLike[];
  connectTarget: GoalEndpoint | null;
  connecting: boolean;
  onBarDown: (e: React.PointerEvent, t: GoalTask, range: RangeKind, mode: BarDrag['mode']) => void;
  onConnectDown: (e: React.PointerEvent, t: GoalTask, endpoint: GoalEndpoint) => void;
  onNudge: (t: GoalTask, range: RangeKind, delta: number, resize: boolean) => void;
  onOpen: (t: GoalTask) => void;
  onToggle: (t: GoalTask) => void;
  onMenu: (t: GoalTask, rect: DOMRect) => void;
}

const GanttRow = memo(function GanttRow({
  task: t, filter, preview, xOf, dw, members, connectTarget, connecting, onBarDown, onConnectDown, onNudge, onOpen, onToggle, onMenu,
}: RowProps) {
  const geo = rowGeometry(t, filter, preview);
  const today = todayKey();
  const assignees = t.assignee_ids.map((id) => members.find((m) => m.id === id)).filter(Boolean) as MemberLike[];
  const color = spaceColor(t);
  const overdue = !t.completed && !!geo.work && geo.work.end < today;
  const dueLate = !t.completed && !!geo.plan && geo.plan.end < today && !!t.due_date;
  const keyNav = (range: RangeKind) => (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); onOpen(t); return; }
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    onNudge(t, range, e.key === 'ArrowLeft' ? -1 : 1, e.shiftKey);
  };
  const connectors = (side: 'work' | 'plan') => (geo.anchor && ((side === 'work' && geo.work) || (side === 'plan' && !geo.work)) ? (
    (['start', 'end'] as const).map((ep) => (
      <span key={ep} className={`gl-handle gl-handle-${ep}`} data-target={connectTarget === ep || undefined}
        onPointerDown={(e) => onConnectDown(e, t, ep)} title="Drag to another task to connect" />
    ))
  ) : null);

  return (
    <div className="gl-row" data-done={t.completed || undefined} data-target={connectTarget ? 'true' : undefined} data-connecting={connecting || undefined}
      style={{ height: ROW, '--bar': color } as CSSProperties}>
      <div className="gl-row-label">
        <button type="button" className="gl-check" data-on={t.completed || undefined} disabled={!t.can_edit}
          aria-label={t.completed ? `Reopen ${t.title}` : `Complete ${t.title}`} onClick={() => onToggle(t)}>
          <GoalIcon name="check" size={11} strokeWidth={3} />
        </button>
        <button type="button" className="gl-row-text" onClick={() => onOpen(t)}>
          <strong>{t.title}</strong>
          <small><i />{t.list_name}{!t.direct && t.source_ids.length ? ' · auto' : ''}</small>
        </button>
        <AvatarStack members={assignees} size={20} max={2} />
        <button type="button" className="gl-icon-btn gl-row-more" aria-label={`More for ${t.title}`}
          onClick={(e) => onMenu(t, (e.currentTarget as HTMLElement).getBoundingClientRect())}>
          <GoalIcon name="more" size={16} />
        </button>
      </div>
      <div className="gl-row-track">
        {geo.work && (
          <div
            className="gl-bar gl-bar-work"
            data-preview={preview?.range === 'work' || undefined}
            data-late={overdue || undefined}
            data-readonly={!t.can_edit || undefined}
            role="button"
            tabIndex={0}
            aria-label={`${t.title}: work ${formatRange(geo.work.start, geo.work.end)}. Arrow keys move, Shift+arrows resize.`}
            style={{ left: xOf(geo.work.start), width: (daysBetween(geo.work.start, geo.work.end) + 1) * dw, top: geo.workTop }}
            onPointerDown={(e) => onBarDown(e, t, 'work', 'move')}
            onKeyDown={keyNav('work')}
          >
            {t.can_edit && <span className="gl-resize gl-resize-start" onPointerDown={(e) => onBarDown(e, t, 'work', 'start')} />}
            <span className="gl-bar-label">{t.completed && <GoalIcon name="check" size={11} strokeWidth={3} />}{t.title}</span>
            {t.can_edit && <span className="gl-resize gl-resize-end" onPointerDown={(e) => onBarDown(e, t, 'work', 'end')} />}
            {connectors('work')}
            {preview?.range === 'work' && (
              <span className="gl-bar-tip">{formatRange(preview.start, preview.end)} · {daysBetween(preview.start, preview.end) + 1}d</span>
            )}
          </div>
        )}
        {geo.work && (daysBetween(geo.work.start, geo.work.end) + 1) * dw < 120 && (
          <span className="gl-bar-outside" style={{ left: xOf(geo.work.end) + dw + 8, top: geo.workTop + 4 }}>{t.title}</span>
        )}
        {geo.plan && (
          <div
            className="gl-plan"
            data-preview={preview?.range === 'plan' || undefined}
            data-late={dueLate || undefined}
            data-point={geo.plan.start === geo.plan.end || undefined}
            data-readonly={!t.can_edit || undefined}
            role="button"
            tabIndex={0}
            aria-label={`${t.title}: start ${formatDay(geo.plan.start)}, due ${formatDay(geo.plan.end)}`}
            style={{ left: xOf(geo.plan.start) + dw / 2 - 5, width: daysBetween(geo.plan.start, geo.plan.end) * dw + 10, top: geo.planY - 8 }}
            onPointerDown={(e) => onBarDown(e, t, 'plan', 'move')}
            onKeyDown={keyNav('plan')}
          >
            <span className="gl-plan-line" />
            <span className="gl-plan-dot gl-plan-start" onPointerDown={(e) => t.can_edit && onBarDown(e, t, 'plan', 'start')} title={`Start ${formatDay(geo.plan.start)}`} />
            <span className="gl-plan-dot gl-plan-end" onPointerDown={(e) => t.can_edit && onBarDown(e, t, 'plan', 'end')} title={`Due ${formatDay(geo.plan.end)}`} />
            {connectors('plan')}
            {preview?.range === 'plan' && <span className="gl-bar-tip">{formatRange(preview.start, preview.end)}</span>}
          </div>
        )}
      </div>
    </div>
  );
});
