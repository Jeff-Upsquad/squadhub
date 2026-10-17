import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { SpaceStatus, Task, TaskPriority, User } from '@squadhub/shared';
import { usePMStore } from '../../../stores/pmStore';
import { useAuthStore } from '../../../stores/authStore';
import { useUpdateTask } from '../../../hooks/useTasks';
import { useTaskTypes } from '../../../hooks/useTaskTypes';
import { useStatusDirectory } from '../../../hooks/useStatusDirectory';
import { filterTasks, EMPTY_FILTER, type TaskFilterState } from '../../../lib/filters';
import { isTaskCompleted, isTaskUpcoming, type GroupBy } from '../../../lib/taskGrouping';
import { stagesFromStatuses } from '../../../lib/stages';
import {
  PRIORITY_LANES,
  dedupeStatuses,
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
import FieldManagerPanel from '../../../components/pm/FieldManagerPanel';
import { useColumnPrefs } from '../../../hooks/useColumnPrefs';
import { visibleColumnIds, COLUMN_DEFS, gridTemplateFor, type ColumnControls } from '../../../lib/columns';
import type { ListViewColumnId } from '@squadhub/shared';
import TaskRow from './TaskRow';
import TaskOverviewHeader from './TaskOverviewHeader';
import { matchesOverviewTile, type OverviewTile } from '../../../lib/taskOverviewTiles';
import './task-overview.css';
import './stage-row.css';

// "List View v2" for Space and Folder pages: a header card with a one-line
// summary, a dark stats strip whose tiles filter the list, list chips +
// Group / Filter / view switch, then one big card per group (Stage, Status,
// Priority, Assignee, List or Task type) with status sub-heads that carry a
// progress ring. Clicking a row opens the full task detail panel; completing
// a task strikes it through and slides it away.

export type OverviewGroup = 'stage' | 'status' | 'priority' | 'assignee' | 'list' | 'task_type';
type ViewMode = 'list' | 'board' | 'calendar';

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

export const NO_FOLDER_KEY = '__none__';

type Sub = { key: string; name: string; color: string; tasks: Task[]; showHead: boolean };
type Card = {
  key: string;
  name: string;
  subs: Sub[];
  /** Stage grouping: accent, every status name, empty statuses (chips), the
   *  custom stage group it comes from, and whether it renders slim (no tasks). */
  color?: string;
  statusLine?: string;
  emptyStatuses?: SpaceStatus[];
  source?: string | null;
  slim?: boolean;
  addStatus?: string;
};

export default function TaskOverview({
  title,
  tasks,
  lists,
  listFilter,
  onListFilter,
  folders,
  folderFilter = 'all',
  onFolderFilter,
  scopeKey,
  statusFallback,
  loading,
  headerExtra,
}: {
  title: string;
  /** Every task in scope (subtasks included; only top-level rows render). */
  tasks: Task[];
  lists: { id: string; name: string; folderId?: string | null; is_private?: boolean; is_locked?: boolean }[];
  listFilter: string;
  onListFilter: (id: string) => void;
  /** Space pages: folder chips narrow the list chips + tasks below. */
  folders?: { id: string; name: string }[];
  /** `'all'`, a folder id, or NO_FOLDER_KEY for lists directly in the space. */
  folderFilter?: string;
  onFolderFilter?: (id: string) => void;
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
  const lookup = useMemo(() => dedupeStatuses([...statusDirectory, ...statusFallback]), [statusDirectory, statusFallback]);

  // Start the stage-card layout in Stage view once, including when an older
  // overview saved Status/Priority. Subsequent choices still persist and sync.
  const groupScopeKey = `${scopeKey}:stage-layout`;
  const stored = groupByScope[groupScopeKey] as string | undefined;
  const group: OverviewGroup = (GROUP_OPTIONS.some((o) => o.value === stored) ? stored : 'stage') as OverviewGroup;
  const groupDir = groupDirByScope[scopeKey] === 'desc' ? 'desc' : 'asc';
  const filters: TaskFilterState = filtersByScope[scopeKey] || EMPTY_FILTER;

  const [query, setQuery] = useState('');
  const [tile, setTile] = useState<OverviewTile>('all');
  const [view, setView] = useState<ViewMode>('list');
  const [menu, setMenu] = useState<'group' | 'filter' | 'fields' | 'emptyLists' | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [fieldsOpen, setFieldsOpen] = useState(false);
  // Field (column) visibility, same system as normal lists. Scope is per
  // space/folder overview (scopeKey like `space:<id>`), persisted per user.
  const {
    columns: columnStates,
    hasPersonalOverride: hasColumnOverride,
    setColumns: setScopeColumns,
    resetColumns: resetScopeColumns,
  } = useColumnPrefs(scopeKey);
  const visibleCols = useMemo(() => visibleColumnIds(columnStates), [columnStates]);
  const showCol = (id: ListViewColumnId) => visibleCols.includes(id);
  const columnControls: ColumnControls = useMemo(
    () => ({
      states: columnStates,
      onChange: setScopeColumns,
      onReset: resetScopeColumns,
      hasOverride: hasColumnOverride,
      onOpenManager: () => setFieldsOpen(true),
    }),
    [columnStates, setScopeColumns, resetScopeColumns, hasColumnOverride],
  );
  void columnControls;
  // Completion state comes from the server (isTaskCompleted) + the shared
  // fading map that TaskRow drives while its complete animation runs. The
  // previous local doneSnap/gone/removed slide-out is gone: rows are real
  // TaskRows now, identical to normal lists.
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest?.('[data-tov-menu]')) setMenu(null);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menu]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setMenu(null); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const tz = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', []);
  const fading = useMemo(() => new Map<string, string>(fadingTaskIds), [fadingTaskIds]);

  const isDone = (t: Task) => isTaskCompleted(t);

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

  const visibleLists = useMemo(
    () => (folderFilter === 'all' ? lists : lists.filter((l) => (l.folderId ?? NO_FOLDER_KEY) === folderFilter)),
    [lists, folderFilter],
  );
  const hasDirectLists = lists.some((l) => !l.folderId);
  const top = useMemo(() => tasks.filter((t) => !t.parent_task_id), [tasks]);
  // Tasks in the selected folder (or every task when no folder is picked).
  const scoped = useMemo(() => {
    if (folderFilter === 'all') return top;
    const ids = new Set(visibleLists.map((l) => l.id));
    return top.filter((t) => !!t.list?.id && ids.has(t.list.id));
  }, [top, folderFilter, visibleLists]);
  const pool = useMemo(
    () => scoped.filter((t) => listFilter === 'all' || t.list?.id === listFilter),
    [scoped, listFilter],
  );

  const isLoaded = !loading || tasks.length > 0;

  // Live per-list counts:
  // - count: open tasks in this list (excluding completed and subtasks)
  // - upcoming: open tasks whose work date or due date is in the future
  // - current: open tasks due today or earlier, or with no date (count - upcoming)
  // Lists with no open tasks (count === 0), OR whose open tasks are ALL upcoming
  // (current === 0), are grouped together under one dropdown.
  const enrichedLists = useMemo(() => {
    return visibleLists.map((list) => {
      const listOpen = top.filter((t) => t.list?.id === list.id && !isTaskCompleted(t));
      const count = listOpen.length;
      const upcoming = listOpen.filter((t) => isTaskUpcoming(t, tz)).length;
      const current = Math.max(0, count - upcoming);
      return {
        list,
        count,
        upcoming,
        current,
      };
    });
  }, [visibleLists, top, tz]);

  const withTasks = useMemo(
    () => (isLoaded ? enrichedLists.filter((e) => e.current > 0) : enrichedLists),
    [enrichedLists, isLoaded],
  );

  const emptyLists = useMemo(() => {
    if (!isLoaded) return [];
    // Lists holding snoozed work float to the top of the dropdown so upcoming
    // items are found first; relative order is otherwise preserved.
    const all = enrichedLists.filter((e) => e.current === 0);
    return [...all.filter((e) => e.upcoming > 0), ...all.filter((e) => e.upcoming === 0)];
  }, [enrichedLists, isLoaded]);

  const activeIsEmpty = listFilter !== 'all' && emptyLists.some((e) => e.list.id === listFilter);
  const activeEmpty = activeIsEmpty ? emptyLists.find((e) => e.list.id === listFilter) : null;
  const scopedOpenCount = useMemo(() => scoped.filter((t) => !isTaskCompleted(t)).length, [scoped]);

  // If the filtered list disappears (e.g. switching folders), fall back to All.
  useEffect(() => {
    if (visibleLists.length > 0 && listFilter !== 'all' && !visibleLists.some((l) => l.id === listFilter)) {
      onListFilter('all');
    }
  }, [visibleLists, listFilter, onListFilter]);
  const q = query.trim().toLowerCase();
  const matching = pool.filter((t) =>
    matchesOverviewTile(t, tile, tz)
    && filterTasks([t], filters, tz).length > 0
    && (!q || t.title.toLowerCase().includes(q)));
  const doneCount = matching.filter(isDone).length;
  const visible = matching.filter((t) => !isDone(t) || showDone);

  // ---- Grouping ---------------------------------------------------------
  const cards: Card[] = (() => {
    const listed = visible;
    const one = (key: string, name: string, color: string, ts: Task[]): Card => ({
      key, name, subs: [{ key, name, color, tasks: sortByStageOrder(ts), showHead: false }],
    });
    let out: Card[] = [];
    if (group === 'status') {
      const statusGroups = groupTasksByStatusDirectory(listed, statusDirectory, fading, statusFallback);
      out = statusGroups.map((g) => one(g.key, g.status?.name || g.label, g.color, g.tasks));
    } else if (group === 'stage') {
      // One card per stage, status sub-heads inside, in workflow order. The
      // workspace default stages always show (slim when empty); a custom
      // group's stages show when they hold tasks and say where they're from.
      const statusGroups = groupTasksByStatusDirectory(listed, statusDirectory, fading, statusFallback);
      const listNames = (ts: Task[]) => [...new Set(ts.map((t) => t.list?.name).filter(Boolean))].join(', ');
      const placed = new Set<string>();
      for (const st of stagesFromStatuses(lookup.filter((x) => !!x.group))) {
        const subs = st.statuses
          .map((x) => statusGroups.find((g) => g.status && g.status.id.toLowerCase() === x.id.toLowerCase()))
          .filter((g): g is NonNullable<typeof g> => !!g && g.tasks.length > 0);
        // Parked (placeholder) tasks group under their own status in this stage.
        for (const g of statusGroups) {
          if (g.status?.group === st.key && g.status.is_placeholder && g.tasks.length && !subs.includes(g)) subs.push(g);
        }
        const own = st.statuses.filter((x) => !x.groupSource);
        if (own.length === 0 && subs.length === 0) continue;
        subs.forEach((g) => placed.add(g.key));
        const used = new Set(subs.map((g) => g.status?.id));
        const emptyStatuses = own.filter((x) => !used.has(x.id) && x.category !== 'closed' && x.category !== 'done');
        const source = own.length === 0 ? st.statuses.find((x) => x.groupSource)?.groupSource || null : null;
        const allSubTasks = subs.flatMap((g) => g.tasks);
        out.push({
          key: st.key,
          name: st.label,
          color: st.color,
          statusLine: (own.length ? own : st.statuses).map((x) => x.name).join(' · '),
          emptyStatuses,
          source: source ? `${source}${allSubTasks.length ? ` · ${listNames(allSubTasks)}` : ''}` : null,
          slim: subs.length === 0,
          addStatus: (own[0] || st.statuses[0])?.id,
          subs: subs.map((g) => ({ key: g.key, name: g.status?.name || g.label, color: st.color, tasks: g.tasks, showHead: true })),
        });
      }
      // Statuses outside any stage (per-space custom statuses) still show.
      const rest = statusGroups.filter((g) => !placed.has(g.key) && g.tasks.length > 0);
      if (rest.length) {
        out.push({
          key: '__other__',
          name: 'Other statuses',
          subs: rest.map((g) => ({ key: g.key, name: g.status?.name || g.label, color: g.color, tasks: g.tasks, showHead: true })),
        });
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
      .filter((c) => c.slim || c.subs.length > 0);
    if (groupDir === 'desc') out = out.reverse().map((c) => ({ ...c, subs: [...c.subs].reverse() }));
    return out;
  })();

  // ---- Actions ------------------------------------------------------------
  const handleStatusChange = (taskId: string, statusId: string) => {
    updateTask.mutate({ id: taskId, status: statusId });
  };
  const openCreate = (status?: string) => window.dispatchEvent(new CustomEvent('sh:open-create-task', status ? { detail: { status } } : undefined));
  const setGroup = (g: OverviewGroup) => { setScopedGroupBy(groupScopeKey, g as GroupBy); setMenu(null); };
  const setFilters = (next: TaskFilterState) => setScopeFilters(scopeKey, next);
  const filterCount = (filters.priorities?.length ?? 0) + (filters.assigneeIds?.length ? 1 : 0) + (filters.hasDueDate ? 1 : 0);

  const listsInScope = listFilter === 'all' ? `${visibleLists.length} ${visibleLists.length === 1 ? 'list' : 'lists'}` : (lists.find((l) => l.id === listFilter)?.name || 'this list');

  // ---- Rendering helpers --------------------------------------------------
  const rowMeta = (t: Task) => {
    const { parked } = placeOf(t);
    const work = t.work_date ? formatWhen(t.work_date) : null;
    return [
      t.list?.name,
      showCol('workDate') && work && work.state !== 'none' ? `Work ${work.text.replace(/^(Today|Tomorrow|Overdue)/, (w) => w.toLowerCase())}` : null,
      parked ? parked.name.charAt(0) + parked.name.slice(1).toLowerCase() : null,
    ].filter(Boolean).join(' · ');
  };

  const renderPills = (t: Task) => {
    const p = PRIORITY_PILL[(t.priority as string) || 'none'];
    const due = t.due_date && !isDone(t) ? formatWhen(t.due_date) : null;
    const od = !!due && due.state === 'overdue';
    const work = t.work_date && !isDone(t) ? formatWhen(t.work_date) : null;
    const assignees = (t.assignees || []) as User[];
    const u = assignees[0];
    const { status } = placeOf(t);
    const tags = (t as Task).tags || [];
    const estimate = (t as Task).time_estimate;
    const tracked = (t as Task).time_tracked;
    const commentCount = (t as Task).comment_count ?? 0;
    const showPriority = showCol('priority');
    const showDue = showCol('dueDate');
    const showWork = showCol('workDate');
    const showAssignee = showCol('assignee');
    const showStatus = showCol('status');
    const showLabels = showCol('labels');
    const showEstimate = showCol('estimate');
    const showTracked = showCol('tracked');
    const showComments = showCol('comments');
    return (
      <div className="tov-pills">
        {showStatus && status && (
          <span className="tov-pill">
            <span className="tov-dot" style={{ background: status.color || '#A0A0A0' }} />{status.name}
          </span>
        )}
        {showPriority && p && (
          <span className="tov-pill" data-tone={p.emergency ? 'danger' : undefined}>
            <span className="tov-dot" style={{ background: p.dot }} />{p.label}
          </span>
        )}
        {showLabels && tags.slice(0, 2).map((tag) => (
          <span key={tag.id} className="tov-pill">
            <span className="tov-dot" style={{ background: tag.color || '#A0A0A0' }} />{tag.name}
          </span>
        ))}
        {showWork && work && <span className="tov-pill tov-num">Work {work.text}</span>}
        {showDue && due && <span className="tov-pill tov-num" data-tone={od ? 'danger' : undefined}>{od ? 'Overdue' : due.text}</span>}
        {showEstimate && !!estimate && <span className="tov-pill tov-num">{Math.round(estimate / 60)}m est</span>}
        {showTracked && !!tracked && <span className="tov-pill tov-num">{Math.round(tracked / 60)}m tracked</span>}
        {showComments && commentCount > 0 && <span className="tov-pill tov-num">{commentCount} comments</span>}
        {showAssignee && (u ? (
          u.avatar_url
            ? <img className="tov-avatar" src={u.avatar_url} alt="" title={u.display_name || u.email} />
            : <span className="tov-avatar" style={{ background: avatarColor(u.id) }} title={assignees.map((a) => a.display_name || a.email).join(', ')}>{initialsOf(u)}</span>
        ) : (
          <span className="tov-avatar" data-empty title="Unassigned" />
        ))}
      </div>
    );
  };

  const labelForCol = (id: ListViewColumnId) => COLUMN_DEFS.find((d) => d.id === id)?.label ?? id;

  const renderColHeader = () => {
    if (visibleCols.length === 0) return null;
    return (
      <div
        className="tov-colheader"
        aria-hidden="true"
        style={{ gridTemplateColumns: gridTemplateFor(visibleCols) }}
      >
        <div className="gh-left" />
        {visibleCols.map((id) => (
          <span key={id} className="gh-col">{labelForCol(id)}</span>
        ))}
        <span style={{ display: 'inline-flex', justifyContent: 'center' }}>
          <button
            type="button"
            className="lv-col-add"
            onClick={(e) => { e.stopPropagation(); setFieldsOpen(true); }}
            title="Add / manage fields in this view"
            aria-label="Add / manage fields in this view"
            aria-haspopup="dialog"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        </span>
      </div>
    );
  };

  // List rows are the exact same editable TaskRow used by normal lists: every
  // visible field column renders inline and updates from this view itself.
  const renderRow = (t: Task) => (
    <div key={t.id} className="tov-lvrow">
      <TaskRow
        task={t}
        statuses={lookup}
        onStatusChange={handleStatusChange}
        canEdit
        listId={t.list?.id || (t as unknown as { list_id?: string }).list_id || ''}
        columns={visibleCols}
      />
    </div>
  );

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
              <div key={t.id} className="tov-bcard" onClick={() => setActiveTask(t.id)}>
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
        <TaskOverviewHeader title={title} tasks={pool} timeZone={tz} scopeLabel={listsInScope}
          loading={loading} query={query} onQueryChange={setQuery} tile={tile} onTileChange={setTile}
          onCreate={() => openCreate()} actions={headerExtra}>
          {/* Folder chips (Space pages) — narrow the list chips + tasks */}
          {folders && folders.length > 0 && onFolderFilter && (
            <div className="tov-chips tov-folders">
              <span className="tov-folders-lbl">Folders</span>
              {[
                { id: 'all', name: 'All folders', count: top.length },
                ...folders.map((f) => {
                  const ids = new Set(lists.filter((l) => l.folderId === f.id).map((l) => l.id));
                  return { id: f.id, name: f.name, count: top.filter((t) => !!t.list?.id && ids.has(t.list.id)).length };
                }),
                ...(hasDirectLists ? [{
                  id: NO_FOLDER_KEY,
                  name: 'No folder',
                  count: (() => {
                    const ids = new Set(lists.filter((l) => !l.folderId).map((l) => l.id));
                    return top.filter((t) => !!t.list?.id && ids.has(t.list.id)).length;
                  })(),
                }] : []),
              ].map((f) => (
                <button key={f.id} type="button" className="tov-chip" data-on={folderFilter === f.id || undefined} onClick={() => onFolderFilter(f.id)}>
                  <span>{f.name}</span>
                  <span className="tov-chip-count">{f.count}</span>
                </button>
              ))}
            </div>
          )}

          {/* List chips + Group / Filter / view switch */}
          <div className="tov-toolbar">
            {visibleLists.length > 1 && <div className="tov-chips tov-list-chips">
              <button
                type="button"
                className="tov-chip"
                data-on={listFilter === 'all' || undefined}
                onClick={() => onListFilter('all')}
              >
                <span>All lists</span>
                <span className="tov-chip-count">{scopedOpenCount}</span>
              </button>
              {withTasks.map(({ list, count }) => (
                <button
                  key={list.id}
                  type="button"
                  className="tov-chip"
                  data-on={listFilter === list.id || undefined}
                  onClick={() => onListFilter(listFilter === list.id ? 'all' : list.id)}
                  title={list.name}
                >
                  <span className="max-w-[160px] truncate">{list.name}</span>
                  {list.is_private && !list.is_locked && <PrivateLock />}
                  {list.is_locked && <AdminLock />}
                  <span className="tov-chip-count">{count}</span>
                </button>
              ))}
              {(emptyLists.length > 0 || activeIsEmpty) && (
                <div className="tov-menu-root" data-tov-menu>
                  <button
                    type="button"
                    className="tov-chip tov-chip-empty"
                    data-on={activeIsEmpty || undefined}
                    aria-expanded={menu === 'emptyLists'}
                    aria-haspopup="menu"
                    title={activeEmpty ? activeEmpty.list.name : 'Lists with no open tasks'}
                    onClick={() => setMenu(menu === 'emptyLists' ? null : 'emptyLists')}
                  >
                    {activeEmpty ? (
                      <>
                        <span className="max-w-[160px] truncate">{activeEmpty.list.name}</span>
                        {activeEmpty.list.is_private && !activeEmpty.list.is_locked && <PrivateLock />}
                        {activeEmpty.list.is_locked && <AdminLock />}
                        <span
                          role="button"
                          tabIndex={0}
                          aria-label="Clear list filter"
                          className="tov-chip-clear"
                          onClick={(e) => {
                            e.stopPropagation();
                            onListFilter('all');
                            setMenu(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              e.stopPropagation();
                              onListFilter('all');
                              setMenu(null);
                            }
                          }}
                        >
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                            <path d="M18 6L6 18M6 6l12 12" />
                          </svg>
                        </span>
                      </>
                    ) : (
                      <>
                        <span>No open tasks</span>
                        <span className="tov-chip-count">{emptyLists.length}</span>
                        <svg
                          width="10"
                          height="10"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          style={{ transition: 'transform .15s', transform: menu === 'emptyLists' ? 'rotate(180deg)' : 'none' }}
                        >
                          <path d="m6 9 6 6 6-6" />
                        </svg>
                      </>
                    )}
                  </button>

                  {menu === 'emptyLists' && (
                    <div
                      className="tov-menu tov-empty-menu"
                      role="menu"
                      aria-label="Lists with no open tasks"
                      style={{ minWidth: 220, maxHeight: 280, overflowY: 'auto' }}
                    >
                      <span className="tov-menu-label">Lists with no open tasks</span>
                      {emptyLists.map(({ list, upcoming }) => {
                        const isSelected = listFilter === list.id;
                        return (
                          <button
                            key={list.id}
                            type="button"
                            role="menuitem"
                            className="tov-menu-item"
                            onClick={() => {
                              onListFilter(isSelected ? 'all' : list.id);
                              setMenu(null);
                            }}
                          >
                            <div className="flex items-center gap-1.5 flex-1 min-w-0 mr-2">
                              {list.is_private && !list.is_locked && <PrivateLock />}
                              {list.is_locked && <AdminLock />}
                              <span className="truncate">{list.name}</span>
                            </div>
                            {upcoming > 0 && (
                              <span
                                className="tov-upcoming-badge"
                                title={`${upcoming} upcoming task${upcoming === 1 ? '' : 's'}`}
                              >
                                {upcoming > 99 ? '99+' : upcoming}
                              </span>
                            )}
                            <svg
                              width="12"
                              height="12"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2.4"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              style={{ opacity: isSelected ? 1 : 0 }}
                            >
                              <path d="m5 12 5 5 9-10" />
                            </svg>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>}
            <div className="tov-toolbar-row">
              <div className="tov-views" role="group" aria-label="Task view">
                {(['list', 'board', 'calendar'] as const).map((v) => (
                  <button key={v} type="button" aria-pressed={view === v} data-on={view === v || undefined} onClick={() => setView(v)}>
                    {v.charAt(0).toUpperCase() + v.slice(1)}
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
              <button type="button" className="tov-ctl" data-on={hasColumnOverride || undefined} onClick={() => setFieldsOpen(true)} title="Show / hide fields">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6h16M4 12h16M4 18h16" /><circle cx="9" cy="6" r="2" fill="var(--tov-card)" /><circle cx="15" cy="12" r="2" fill="var(--tov-card)" /><circle cx="8" cy="18" r="2" fill="var(--tov-card)" /></svg>
                  Fields
                  {hasColumnOverride && <span className="tov-ctl-badge">{visibleCols.length}</span>}
                </button>
              </div>
            </div>
          </div>
        </TaskOverviewHeader>

        {/* Body */}
        <div className="tov-layout">
          <div className="tov-main">
            {view === 'list' && cards.map((c) => {
              if (c.slim) {
                return (
                  <div key={c.key} className="stg-slim tov-slim" style={{ ['--sec-color' as string]: c.color || '#A0A0A0' }}>
                    <span className="stg-slim-dot" />
                    <span className="stg-slim-name">{c.name}</span>
                    <span className="stg-slim-none">No tasks</span>
                    <span className="stg-slim-line">{c.statusLine}</span>
                    <button type="button" className="stg-slim-add" title={`Add a task in ${c.name}`} onClick={() => openCreate(c.addStatus)}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
                    </button>
                  </div>
                );
              }
              const collapseKey = `${scopeKey}:tov:${group}:${c.key}`;
              const open = !collapsedGroups[collapseKey];
              const openCount = c.subs.reduce((n, s) => n + s.tasks.filter((t) => !isDone(t)).length, 0);
              return (
                <div key={c.key} className="tov-card tov-group">
                  <button type="button" className="tov-group-head" onClick={() => setGroupCollapsed(collapseKey, open)}>
                    <span className="tov-group-title">
                      <span className="tov-group-name">{c.name}</span>
                      <span className="tov-group-meta">{openCount} open</span>
                      {c.source && <span className="tov-group-source">{c.source}</span>}
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
                                <button type="button" className="tov-sub-add" title="Add task" onClick={() => openCreate(group === 'stage' || group === 'status' ? s.key : undefined)}>
                                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
                                </button>
                              </div>
                            )}
                            {renderColHeader()}
                            {s.tasks.map(renderRow)}
                          </div>
                        );
                      })}
                      {!!c.emptyStatuses?.length && (
                        <div className="stg-empty-chips tov-empty-chips" style={{ ['--sec-color' as string]: c.color || '#A0A0A0' }}>
                          {c.emptyStatuses.map((x) => (
                            <button key={x.id} type="button" className="stg-empty-chip" title={`Add a task in ${x.name}`} onClick={() => openCreate(x.id)}>
                              <span className="stg-empty-dot" />{x.name}<span className="stg-empty-n">0</span>
                            </button>
                          ))}
                        </div>
                      )}
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
        </div>
      </div>
      <FieldManagerPanel
        open={fieldsOpen}
        onClose={() => setFieldsOpen(false)}
        columns={columnStates}
        onChange={setScopeColumns}
        onReset={resetScopeColumns}
        hasOverride={hasColumnOverride}
      />
    </div>
  );
}

function PrivateLock() {
  return (
    <svg className="h-3 w-3 shrink-0 text-[var(--tov-ink-4)]" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
    </svg>
  );
}

function AdminLock() {
  return (
    <svg className="h-3 w-3 shrink-0 text-amber-500" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
      <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
    </svg>
  );
}
