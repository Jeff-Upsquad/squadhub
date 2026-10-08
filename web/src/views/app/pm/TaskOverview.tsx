import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { SpaceStatus, Task, TaskPriority, User } from '@squadhub/shared';
import { getTaskStatusCategory } from '@squadhub/shared';
import { usePMStore } from '../../../stores/pmStore';
import { useAuthStore } from '../../../stores/authStore';
import { useUpdateTask } from '../../../hooks/useTasks';
import { useTaskTypes } from '../../../hooks/useTaskTypes';
import { useStatusDirectory } from '../../../hooks/useStatusDirectory';
import { filterTasks, EMPTY_FILTER, type TaskFilterState } from '../../../lib/filters';
import { isTaskCompleted, type GroupBy } from '../../../lib/taskGrouping';
import { sectionize, statusSection } from '../../../lib/listSections';
import {
  PRIORITY_LANES,
  findStatus,
  groupTasksByStatusDirectory,
  isPlaceholderStatus,
  isTaskOverdue,
  originalStatusOf,
  sortByStageOrder,
  stageKeyOf,
} from '../../../lib/stageWorkflow';
import { formatWhen } from './taskHelpers';
import { GROUP_ORDER as TASK_TYPE_GROUP_ORDER, getTaskTypeGroup } from '../../../components/pm/TaskTypeDropdown';
import './task-overview.css';

// "List View v2" for Space and Folder pages: a header card with a one-line
// summary, a dark stats strip whose tiles filter the list, list chips +
// Group / Filter / view switch, then one big card per group (Stage, Status,
// Priority, Assignee, List or Task type) with status sub-heads that carry a
// progress ring. Clicking a row opens a compact inspector; completing a task
// strikes it through and slides it away.

export type OverviewGroup = 'stage' | 'status' | 'priority' | 'assignee' | 'list' | 'task_type';
type ViewMode = 'list' | 'board' | 'calendar';
type TileKey = 'all' | 'not_started' | 'active' | 'urgent' | 'due';

const GROUP_OPTIONS: { value: OverviewGroup; label: string }[] = [
  { value: 'stage', label: 'Stage' },
  { value: 'status', label: 'Status' },
  { value: 'priority', label: 'Priority' },
  { value: 'assignee', label: 'Assignee' },
  { value: 'list', label: 'List' },
  { value: 'task_type', label: 'Task type' },
];

const PRIORITY_PILL: Record<string, { label: string; dot: string; emergency?: boolean }> = {
  emergency: { label: 'Emergency', dot: '#FF453A', emergency: true },
  urgent: { label: 'Urgent', dot: '#FF453A' },
  high: { label: 'High', dot: '#FFB340' },
  normal: { label: 'Normal', dot: '#2962FF' },
  low: { label: 'Low', dot: '#A0A0A0' },
};

const FILTER_PRIORITIES: TaskPriority[] = ['emergency', 'urgent', 'high', 'normal', 'low', 'none'];

const RING = 2 * Math.PI * 6;

const AVATAR_HUES = [250, 20, 150, 300, 60, 200, 340, 110];
function avatarColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return `oklch(0.62 0.13 ${AVATAR_HUES[h % AVATAR_HUES.length]})`;
}
function initialsOf(u: Pick<User, 'display_name' | 'email'>): string {
  const name = (u.display_name || u.email || '?').trim();
  const parts = name.split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || name[0].toUpperCase();
}

function isDueToday(t: Task): boolean {
  if (!t.due_date) return false;
  return formatWhen(t.due_date).state === 'today';
}

type Sub = { key: string; name: string; color: string; tasks: Task[]; showHead: boolean };
type Card = { key: string; name: string; subs: Sub[] };

export default function TaskOverview({
  title,
  tasks,
  lists,
  listFilter,
  onListFilter,
  scopeKey,
  statusFallback,
  loading,
  headerExtra,
}: {
  title: string;
  /** Every task in scope (subtasks included; only top-level rows render). */
  tasks: Task[];
  lists: { id: string; name: string }[];
  listFilter: string;
  onListFilter: (id: string) => void;
  /** Persists group / order / filters / collapsed cards, e.g. `space:<id>`. */
  scopeKey: string;
  statusFallback: SpaceStatus[];
  loading: boolean;
  headerExtra?: ReactNode;
}) {
  const me = useAuthStore((s) => s.user?.id);
  const setActiveTask = usePMStore((s) => s.setActiveTask);
  const fadingTaskIds = usePMStore((s) => s.fadingTaskIds);
  const groupByScope = usePMStore((s) => s.groupByScope);
  const setScopedGroupBy = usePMStore((s) => s.setScopedGroupBy);
  const groupDirByScope = usePMStore((s) => s.groupDirByScope);
  const setScopedGroupDir = usePMStore((s) => s.setScopedGroupDir);
  const filtersByScope = usePMStore((s) => s.filtersByScope);
  const setScopeFilters = usePMStore((s) => s.setScopeFilters);
  const collapsedGroups = usePMStore((s) => s.collapsedGroups);
  const setGroupCollapsed = usePMStore((s) => s.setGroupCollapsed);
  const updateTask = useUpdateTask(null);
  // Include every type in use so tasks on a type outside the default set
  // still resolve their name + section.
  const typeIds = useMemo(
    () => [...new Set(tasks.map((t) => t.task_type_id).filter(Boolean) as string[])],
    [tasks],
  );
  const { data: taskTypes } = useTaskTypes({ includeIds: typeIds });
  const statusDirectory = useStatusDirectory();
  const lookup = useMemo(() => [...statusDirectory, ...statusFallback], [statusDirectory, statusFallback]);

  const stored = groupByScope[scopeKey] as string | undefined;
  const group: OverviewGroup = (GROUP_OPTIONS.some((o) => o.value === stored) ? stored : 'stage') as OverviewGroup;
  const groupDir = groupDirByScope[scopeKey] === 'desc' ? 'desc' : 'asc';
  const filters: TaskFilterState = filtersByScope[scopeKey] || EMPTY_FILTER;

  const [query, setQuery] = useState('');
  const [tile, setTile] = useState<TileKey>('all');
  const [view, setView] = useState<ViewMode>('list');
  const [menu, setMenu] = useState<'group' | 'filter' | null>(null);
  const [selId, setSelId] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  // Tasks completed here: remembered with their pre-completion status so they
  // strike through in place, then slide away (450ms) unless "show" is on.
  const [doneSnap, setDoneSnap] = useState<Map<string, string>>(new Map());
  const [gone, setGone] = useState<Set<string>>(new Set());
  const timers = useRef<number[]>([]);

  useEffect(() => () => { timers.current.forEach((id) => window.clearTimeout(id)); }, []);
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest?.('[data-tov-menu]')) setMenu(null);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menu]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setMenu(null); setSelId(null); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const tz = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', []);
  const fading = useMemo(() => {
    const m = new Map<string, string>(fadingTaskIds);
    doneSnap.forEach((v, k) => m.set(k, v));
    return m;
  }, [fadingTaskIds, doneSnap]);

  const isDone = (t: Task) => doneSnap.has(t.id) || isTaskCompleted(t);

  // Where a task really sits: its stage (original stage while parked in a
  // placeholder) and, when parked, the placeholder itself.
  const placeOf = (t: Task): { status: SpaceStatus | null; parked: SpaceStatus | null } => {
    const raw = stageKeyOf(t, fading);
    if (isPlaceholderStatus(lookup, raw)) {
      const orig = originalStatusOf(t);
      const parked = findStatus(lookup, raw);
      if (orig && !isPlaceholderStatus(lookup, orig)) return { status: findStatus(lookup, orig), parked };
      return { status: parked, parked: null };
    }
    return { status: findStatus(lookup, raw), parked: null };
  };
  const sectionOf = (t: Task) => placeOf(t).status?.group || null;

  const top = useMemo(() => tasks.filter((t) => !t.parent_task_id), [tasks]);
  const pool = useMemo(
    () => top.filter((t) => listFilter === 'all' || t.list?.id === listFilter),
    [top, listFilter],
  );
  const openPool = pool.filter((t) => !isDone(t));
  const urgent = openPool.filter((t) => t.priority === 'emergency' || t.priority === 'urgent');
  const overdue = openPool.filter((t) => isTaskOverdue(t));
  const dueNow = openPool.filter((t) => isTaskOverdue(t) || isDueToday(t));

  const matchTile = (t: Task) => {
    switch (tile) {
      case 'not_started': return sectionOf(t) === 'not_started';
      case 'active': return sectionOf(t) === 'in_motion';
      case 'urgent': return t.priority === 'emergency' || t.priority === 'urgent';
      case 'due': return isTaskOverdue(t) || isDueToday(t);
      default: return true;
    }
  };

  const q = query.trim().toLowerCase();
  const matching = pool.filter((t) =>
    matchTile(t)
    && filterTasks([t], filters, tz).length > 0
    && (!q || t.title.toLowerCase().includes(q)));
  const doneCount = matching.filter(isDone).length;
  // Completed rows stay out unless shown — except ones completed here, which
  // strike through in place and then collapse away (data-hidden).
  const visible = matching.filter((t) => !isDone(t) || showDone || doneSnap.has(t.id));
  const hiddenRow = (t: Task) => isDone(t) && !showDone && gone.has(t.id);

  // ---- Grouping ---------------------------------------------------------
  const cards: Card[] = (() => {
    const listed = visible;
    const one = (key: string, name: string, color: string, ts: Task[]): Card => ({
      key, name, subs: [{ key, name, color, tasks: sortByStageOrder(ts), showHead: false }],
    });
    let out: Card[] = [];
    if (group === 'stage' || group === 'status') {
      const statusGroups = groupTasksByStatusDirectory(listed, statusDirectory, fading, statusFallback);
      if (group === 'status') {
        out = statusGroups.map((g) => one(g.key, g.status?.name || g.label, g.color, g.tasks));
      } else {
        const sections = sectionize(statusGroups, (g) => (g.status ? statusSection(g.status) : null)) || [
          { section: { key: '__all__', label: 'Tasks' }, items: statusGroups },
        ];
        out = sections.map(({ section, items }) => ({
          key: section.key,
          name: section.label,
          subs: items.map((g) => ({ key: g.key, name: g.status?.name || g.label, color: g.color, tasks: g.tasks, showHead: true })),
        }));
      }
    } else if (group === 'priority') {
      out = PRIORITY_LANES.map((p) => one(p.key, p.label, p.color, listed.filter((t) => (t.priority || 'none') === p.key)));
    } else if (group === 'assignee') {
      const people = new Map<string, { user: User; tasks: Task[] }>();
      const none: Task[] = [];
      for (const t of listed) {
        const as = (t.assignees || []) as User[];
        if (as.length === 0) none.push(t);
        for (const u of as) {
          if (!people.has(u.id)) people.set(u.id, { user: u, tasks: [] });
          people.get(u.id)!.tasks.push(t);
        }
      }
      out = [...people.values()]
        .sort((a, b) => (a.user.display_name || '').localeCompare(b.user.display_name || ''))
        .map(({ user, tasks: ts }) => one(user.id, user.display_name || user.email || 'Someone', avatarColor(user.id), ts));
      out.push(one('__none__', 'Unassigned', '#A0A0A0', none));
    } else if (group === 'list') {
      out = lists.map((l) => one(l.id, l.name, '#A0A0A0', listed.filter((t) => t.list?.id === l.id)));
    } else {
      const typeOf = (t: Task) => (taskTypes || []).find((tt) => tt.id === t.task_type_id) || null;
      const bySection = new Map<string, Map<string, { name: string; color: string; tasks: Task[] }>>();
      for (const t of listed) {
        const tt = typeOf(t);
        const sec = tt ? getTaskTypeGroup(tt) : 'No task type';
        const key = tt?.id || '__none__';
        if (!bySection.has(sec)) bySection.set(sec, new Map());
        const m = bySection.get(sec)!;
        if (!m.has(key)) m.set(key, { name: tt?.name || 'No task type', color: tt?.color || '#A0A0A0', tasks: [] });
        m.get(key)!.tasks.push(t);
      }
      const rank = (s: string) => { const i = TASK_TYPE_GROUP_ORDER.indexOf(s); return i === -1 ? (s === 'No task type' ? 1e9 : 1e6) : i; };
      out = [...bySection.entries()].sort((a, b) => rank(a[0]) - rank(b[0])).map(([sec, m]) => ({
        key: sec,
        name: sec,
        subs: [...m.entries()].map(([key, v]) => ({ key, name: v.name, color: v.color, tasks: sortByStageOrder(v.tasks), showHead: sec !== 'No task type' })),
      }));
    }
    out = out
      .map((c) => ({ ...c, subs: c.subs.filter((s) => s.tasks.length > 0) }))
      .filter((c) => c.subs.length > 0);
    if (groupDir === 'desc') out = out.reverse().map((c) => ({ ...c, subs: [...c.subs].reverse() }));
    return out;
  })();

  // ---- Actions ------------------------------------------------------------
  const toggleDone = (t: Task) => {
    if (isDone(t)) {
      // Undo of a completion made here restores the exact stage; otherwise
      // the server maps 'open' to the list's starting stage.
      const prev = doneSnap.get(t.id);
      setDoneSnap((m) => { const n = new Map(m); n.delete(t.id); return n; });
      setGone((g) => { const n = new Set(g); n.delete(t.id); return n; });
      const prevCat = prev ? getTaskStatusCategory(prev) : null;
      updateTask.mutate({ id: t.id, status: prev && prevCat !== 'closed' && prevCat !== 'done' ? prev : 'open' });
      return;
    }
    setDoneSnap((m) => new Map(m).set(t.id, (t as any).status || ''));
    updateTask.mutate({ id: t.id, status: 'closed' });
    timers.current.push(window.setTimeout(() => setGone((g) => new Set(g).add(t.id)), 450));
  };
  const openCreate = () => window.dispatchEvent(new CustomEvent('sh:open-create-task'));
  const setGroup = (g: OverviewGroup) => { setScopedGroupBy(scopeKey, g as GroupBy); setMenu(null); };
  const setFilters = (next: TaskFilterState) => setScopeFilters(scopeKey, next);
  const filterCount = (filters.priorities?.length ?? 0) + (filters.assigneeIds?.length ? 1 : 0) + (filters.hasDueDate ? 1 : 0);

  // ---- Summary ------------------------------------------------------------
  const listsInScope = listFilter === 'all' ? `${lists.length} ${lists.length === 1 ? 'list' : 'lists'}` : (lists.find((l) => l.id === listFilter)?.name || 'this list');
  const lead = overdue[0] || urgent[0];
  const summary = `You have ${openPool.length} open ${openPool.length === 1 ? 'task' : 'tasks'} across ${listsInScope}`
    + (urgent.length ? `, ${urgent.length} marked urgent.` : '.')
    + (lead ? ` ${lead.title} is ${isTaskOverdue(lead) ? 'overdue' : 'due today'}.` : '');

  const tiles: { key: TileKey; name: string; value: number; sub: string; dot: string }[] = [
    { key: 'all', name: 'All open', value: openPool.length, sub: 'tasks', dot: '#B7BCC0' },
    { key: 'not_started', name: 'Not started', value: openPool.filter((t) => sectionOf(t) === 'not_started').length, sub: 'tasks', dot: '#B7BCC0' },
    { key: 'active', name: 'Active', value: openPool.filter((t) => sectionOf(t) === 'in_motion').length, sub: 'in progress', dot: '#39C66B' },
    { key: 'urgent', name: 'Urgent', value: urgent.length, sub: 'need you', dot: '#FF453A' },
    { key: 'due', name: 'Due today', value: dueNow.length, sub: `${overdue.length} overdue`, dot: '#FFB340' },
  ];

  const sel = selId ? top.find((t) => t.id === selId) || null : null;

  // ---- Rendering helpers --------------------------------------------------
  const rowMeta = (t: Task) => {
    const { parked } = placeOf(t);
    const work = t.work_date ? formatWhen(t.work_date) : null;
    return [
      t.list?.name,
      work && work.state !== 'none' ? `Work ${work.text.replace(/^(Today|Tomorrow|Overdue)/, (w) => w.toLowerCase())}` : null,
      parked ? parked.name.charAt(0) + parked.name.slice(1).toLowerCase() : null,
    ].filter(Boolean).join(' · ');
  };

  const renderPills = (t: Task) => {
    const p = PRIORITY_PILL[(t.priority as string) || 'none'];
    const due = t.due_date && !isDone(t) ? formatWhen(t.due_date) : null;
    const od = !!due && due.state === 'overdue';
    const assignees = (t.assignees || []) as User[];
    const u = assignees[0];
    return (
      <div className="tov-pills">
        {p && (
          <span className="tov-pill" data-tone={p.emergency ? 'danger' : undefined}>
            <span className="tov-dot" style={{ background: p.dot }} />{p.label}
          </span>
        )}
        {due && <span className="tov-pill tov-num" data-tone={od ? 'danger' : undefined}>{od ? 'Overdue' : due.text}</span>}
        {u ? (
          u.avatar_url
            ? <img className="tov-avatar" src={u.avatar_url} alt="" title={u.display_name || u.email} />
            : <span className="tov-avatar" style={{ background: avatarColor(u.id) }} title={assignees.map((a) => a.display_name || a.email).join(', ')}>{initialsOf(u)}</span>
        ) : (
          <span className="tov-avatar" data-empty title="Unassigned" />
        )}
      </div>
    );
  };

  const renderRow = (t: Task) => {
    const done = isDone(t);
    const hide = hiddenRow(t);
    return (
      <div
        key={t.id}
        className="tov-row"
        data-selected={selId === t.id || undefined}
        data-hidden={hide || undefined}
        onClick={() => setSelId((id) => (id === t.id ? null : t.id))}
      >
        <button
          type="button"
          className="tov-check"
          data-done={done || undefined}
          aria-label={done ? 'Mark as open' : 'Complete'}
          onClick={(e) => { e.stopPropagation(); toggleDone(t); }}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5 9-10" /></svg>
        </button>
        <div className="tov-row-text">
          <span className="tov-row-title" data-done={done || undefined}>{t.title}</span>
          <span className="tov-row-sub">{rowMeta(t)}</span>
        </div>
        {renderPills(t)}
      </div>
    );
  };

  const renderColumns = (cols: { key: string; name: string; color: string; tasks: Task[] }[]) => (
    <div className="tov-board">
      {cols.map((c) => (
        <div key={c.key} className="tov-col">
          <div className="tov-col-head">
            <span className="tov-dot" style={{ background: c.color }} />
            <span className="tov-col-name">{c.name}</span>
            <span className="tov-col-count">{c.tasks.length}</span>
          </div>
          <div className="tov-col-body">
            {c.tasks.map((t) => (
              <div key={t.id} className="tov-bcard" data-selected={selId === t.id || undefined} onClick={() => setSelId((id) => (id === t.id ? null : t.id))}>
                <span className="tov-row-title" data-done={isDone(t) || undefined}>{t.title}</span>
                <span className="tov-row-sub">{rowMeta(t)}</span>
                {renderPills(t)}
              </div>
            ))}
            {c.tasks.length === 0 && <div className="tov-col-empty">Nothing here</div>}
          </div>
        </div>
      ))}
    </div>
  );

  const calendarCols = (() => {
    const open = visible.filter((t) => !isDone(t));
    const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const monday = new Date(today); monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
    const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(monday); d.setDate(monday.getDate() + i); return d; });
    const cols = [
      { key: 'missed', name: 'Earlier', color: '#FF453A', tasks: [] as Task[] },
      ...days.map((d) => ({
        key: dayKey(d),
        name: d.toLocaleDateString([], { weekday: 'short', day: 'numeric' }) + (dayKey(d) === dayKey(today) ? ' · Today' : ''),
        color: dayKey(d) === dayKey(today) ? '#2962FF' : '#A0A0A0',
        tasks: [] as Task[],
      })),
      { key: 'later', name: 'Later', color: '#A0A0A0', tasks: [] as Task[] },
      { key: 'none', name: 'No work date', color: '#D3D0CD', tasks: [] as Task[] },
    ];
    for (const t of open) {
      if (!t.work_date) { cols[cols.length - 1].tasks.push(t); continue; }
      const d = new Date(t.work_date); d.setHours(0, 0, 0, 0);
      if (d < monday) cols[0].tasks.push(t);
      else {
        const col = cols.find((c) => c.key === dayKey(d));
        (col || cols[cols.length - 2]).tasks.push(t);
      }
    }
    return cols.map((c) => ({ ...c, tasks: sortByStageOrder(c.tasks) }));
  })();

  return (
    <div className="tov">
      <div className="tov-inner">
        {/* Header card */}
        <div className="tov-card tov-head">
          <div className="tov-head-row">
            <div className="tov-title-wrap">
              <h1 className="tov-title">{title}<span className="tov-title-dot">.</span></h1>
              <p className="tov-summary">{loading && top.length === 0 ? 'Loading tasks…' : summary}</p>
            </div>
            <div className="tov-head-actions">
              <label className="tov-search">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
                <input placeholder="Search tasks" value={query} onChange={(e) => setQuery(e.target.value)} />
              </label>
              <button type="button" className="tov-new" onClick={openCreate}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
                New task
              </button>
              {headerExtra}
            </div>
          </div>

          {/* Stats strip — tiles filter the list; click again to clear */}
          <div className="tov-tiles">
            {tiles.map((x) => (
              <button
                key={x.key}
                type="button"
                className="tov-tile"
                data-on={tile === x.key || undefined}
                onClick={() => setTile(tile === x.key && x.key !== 'all' ? 'all' : x.key)}
              >
                <span className="tov-tile-top">
                  <span className="tov-tile-name">{x.name}</span>
                  <span className="tov-dot" style={{ background: x.dot }} />
                </span>
                <span className="tov-tile-val">
                  <span className="tov-tile-num">{x.value}</span>
                  <span className="tov-tile-sub">{x.sub}</span>
                </span>
              </button>
            ))}
          </div>

          {/* List chips + Group / Filter / view switch */}
          <div className="tov-toolbar">
            <div className="tov-chips">
              {[{ id: 'all', name: 'All lists', count: top.length }, ...lists.map((l) => ({ id: l.id, name: l.name, count: top.filter((t) => t.list?.id === l.id).length }))].map((l) => (
                <button key={l.id} type="button" className="tov-chip" data-on={listFilter === l.id || undefined} onClick={() => onListFilter(l.id)}>
                  <span>{l.name}</span>
                  <span className="tov-chip-count">{l.count}</span>
                </button>
              ))}
            </div>
            <div className="tov-controls">
              <div className="tov-menu-root" data-tov-menu>
                <button type="button" className="tov-ctl" onClick={() => setMenu(menu === 'group' ? null : 'group')}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="4" width="16" height="6" rx="2" /><rect x="4" y="14" width="16" height="6" rx="2" /></svg>
                  <span className="tov-ctl-muted">Group</span>{GROUP_OPTIONS.find((o) => o.value === group)?.label}
                  {groupDir === 'desc' && <span aria-label="descending">↓</span>}
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
                </button>
                {menu === 'group' && (
                  <div className="tov-menu" style={{ minWidth: 190 }}>
                    {GROUP_OPTIONS.map((o) => (
                      <button key={o.value} type="button" className="tov-menu-item" onClick={() => setGroup(o.value)}>
                        {o.label}
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: o.value === group ? 1 : 0 }}><path d="m5 12 5 5 9-10" /></svg>
                      </button>
                    ))}
                    <span className="tov-menu-label">Order</span>
                    <div className="tov-seg">
                      {(['asc', 'desc'] as const).map((d) => (
                        <button key={d} type="button" data-on={groupDir === d || undefined} onClick={() => setScopedGroupDir(scopeKey, d)}>
                          {d === 'asc' ? '↑ Ascending' : '↓ Descending'}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <div className="tov-menu-root" data-tov-menu>
                <button type="button" className="tov-ctl" data-on={filterCount > 0 || undefined} onClick={() => setMenu(menu === 'filter' ? null : 'filter')}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M4 6h16M7 12h10M10 18h4" /></svg>
                  Filter
                  {filterCount > 0 && <span className="tov-ctl-badge">{filterCount}</span>}
                </button>
                {menu === 'filter' && (
                  <div className="tov-menu" style={{ width: 230 }}>
                    <span className="tov-menu-label">Priority</span>
                    {FILTER_PRIORITIES.map((p) => {
                      const on = !!filters.priorities?.includes(p);
                      const meta = PRIORITY_PILL[p];
                      return (
                        <button key={p} type="button" className="tov-menu-item tov-menu-check" onClick={() => {
                          const cur = filters.priorities || [];
                          setFilters({ ...filters, priorities: on ? cur.filter((x) => x !== p) : [...cur, p] });
                        }}>
                          <span className="tov-box" data-on={on || undefined}><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5 9-10" /></svg></span>
                          <span className="tov-dot" style={{ background: meta?.dot || '#D3D0CD' }} />{meta?.label || 'None'}
                        </button>
                      );
                    })}
                    <span className="tov-menu-sep" />
                    {[
                      { label: 'Assigned to me', on: !!(me && filters.assigneeIds?.includes(me)), toggle: () => setFilters({ ...filters, assigneeIds: me && !filters.assigneeIds?.includes(me) ? [me] : [] }) },
                      { label: 'Has a due date', on: !!filters.hasDueDate, toggle: () => setFilters({ ...filters, hasDueDate: !filters.hasDueDate }) },
                    ].map((o) => (
                      <button key={o.label} type="button" className="tov-menu-item tov-menu-check" onClick={o.toggle}>
                        <span className="tov-box" data-on={o.on || undefined}><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5 9-10" /></svg></span>
                        {o.label}
                      </button>
                    ))}
                    {filterCount > 0 && (
                      <button type="button" className="tov-menu-clear" onClick={() => setFilters({})}>Clear filters</button>
                    )}
                  </div>
                )}
              </div>
              <div className="tov-views">
                {(['list', 'board', 'calendar'] as const).map((v) => (
                  <button key={v} type="button" data-on={view === v || undefined} onClick={() => setView(v)}>
                    {v.charAt(0).toUpperCase() + v.slice(1)}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Body + inspector */}
        <div className="tov-layout" data-inspector={!!sel || undefined}>
          <div className="tov-main">
            {view === 'list' && cards.map((c) => {
              const collapseKey = `${scopeKey}:tov:${group}:${c.key}`;
              const open = !collapsedGroups[collapseKey];
              const openCount = c.subs.reduce((n, s) => n + s.tasks.filter((t) => !isDone(t)).length, 0);
              return (
                <div key={c.key} className="tov-card tov-group">
                  <button type="button" className="tov-group-head" onClick={() => setGroupCollapsed(collapseKey, open)}>
                    <span className="tov-group-title">
                      <span className="tov-group-name">{c.name}</span>
                      <span className="tov-group-meta">{openCount} open</span>
                    </span>
                    <span className="tov-chev" data-closed={!open || undefined}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
                    </span>
                  </button>
                  {open && (
                    <div className="tov-subs">
                      {c.subs.map((s) => {
                        const d = s.tasks.filter(isDone).length;
                        const frac = s.tasks.length ? d / s.tasks.length : 0;
                        return (
                          <div key={s.key} className="tov-sub">
                            {s.showHead && (
                              <div className="tov-sub-head">
                                <svg width="16" height="16" viewBox="0 0 16 16" style={{ flex: 'none', transform: 'rotate(-90deg)' }}>
                                  <circle cx="8" cy="8" r="6" fill="none" stroke="var(--tov-ring)" strokeWidth="2.4" />
                                  <circle cx="8" cy="8" r="6" fill="none" stroke={s.color} strokeWidth="2.4" strokeLinecap="round" strokeDasharray={`${frac * RING} ${RING}`} style={{ transition: 'stroke-dasharray .4s' }} />
                                </svg>
                                <span className="tov-sub-name">{s.name}</span>
                                <span className="tov-sub-progress">{d} of {s.tasks.length}</span>
                                <span className="tov-sub-rule" />
                                <button type="button" className="tov-sub-add" title="Add task" onClick={openCreate}>
                                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
                                </button>
                              </div>
                            )}
                            {s.tasks.map(renderRow)}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
            {view === 'list' && cards.length === 0 && !loading && (
              <div className="tov-card tov-empty">{q || filterCount || tile !== 'all' ? 'No tasks match.' : 'No open tasks here.'}</div>
            )}
            {view === 'board' && (
              renderColumns(cards.flatMap((c) => c.subs.map((s) => ({ key: `${c.key}:${s.key}`, name: s.name, color: s.color, tasks: s.tasks }))))
            )}
            {view === 'calendar' && renderColumns(calendarCols)}
            {view === 'list' && doneCount > 0 && (
              <button type="button" className="tov-done-toggle" onClick={() => setShowDone((v) => !v)}>
                <span className="tov-done-box"><svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5 9-10" /></svg></span>
                {showDone ? `Hide ${doneCount} completed` : `${doneCount} completed · show`}
              </button>
            )}
          </div>

          {sel && (() => {
            const { status, parked } = placeOf(sel);
            const sec = status ? statusSection(status) : null;
            const done = isDone(sel);
            const assignees = (sel.assignees || []) as User[];
            const work = sel.work_date ? formatWhen(sel.work_date) : null;
            const due = sel.due_date ? formatWhen(sel.due_date) : null;
            const p = PRIORITY_PILL[(sel.priority as string) || 'none'];
            const fields: { k: string; v: string; tone?: 'muted' | 'danger' }[] = [
              { k: 'List', v: sel.list?.name || '—' },
              { k: 'Priority', v: p?.label || 'None', tone: p?.emergency ? 'danger' : p ? undefined : 'muted' },
              { k: 'Assignee', v: assignees.length ? assignees.map((a) => a.display_name || a.email).join(', ') : 'Unassigned', tone: assignees.length ? undefined : 'muted' },
              { k: 'Work date', v: work?.text || 'Not set', tone: work ? undefined : 'muted' },
              { k: 'Due date', v: due?.text || 'Not set', tone: !due ? 'muted' : due.state === 'overdue' && !done ? 'danger' : undefined },
            ];
            return (
              <aside className="tov-card tov-inspector">
                <div className="tov-insp-top">
                  <span className="tov-insp-status">
                    <span className="tov-dot" style={{ background: status?.color || '#A0A0A0' }} />
                    {[sec?.label, status?.name].filter(Boolean).join(' · ') || 'No status'}
                    {parked && <span className="tov-insp-parked">· {parked.name.charAt(0) + parked.name.slice(1).toLowerCase()}</span>}
                  </span>
                  <button type="button" className="tov-round" aria-label="Close" onClick={() => setSelId(null)}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
                  </button>
                </div>
                <h4 className="tov-insp-title">{sel.title}</h4>
                <div className="tov-insp-fields">
                  {fields.map((f) => (
                    <div key={f.k} className="tov-insp-field">
                      <span className="k">{f.k}</span>
                      <span className="v" data-tone={f.tone}>{f.v}</span>
                    </div>
                  ))}
                </div>
                <button type="button" className="tov-insp-primary" data-done={done || undefined} onClick={() => toggleDone(sel)}>
                  {done ? 'Mark as open' : 'Mark complete'}
                </button>
                <button type="button" className="tov-insp-secondary" onClick={() => setActiveTask(sel.id)}>
                  Open full task ↗
                </button>
              </aside>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
