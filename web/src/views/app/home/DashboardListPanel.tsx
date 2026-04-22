import { useEffect, useMemo, useState } from 'react';
import type { Task } from '@squadhub/shared';
import { usePMStore } from '../../../stores/pmStore';
import { useMyTasksSummary } from '../../../hooks/useMyTasksSummary';
import DashboardTaskRow from './DashboardTaskRow';

const TAB_LABELS: Record<'today' | 'overdue' | 'tomorrow' | 'all', string> = {
  today: 'Today',
  overdue: 'Overdue',
  tomorrow: 'Tomorrow',
  all: 'All tasks',
};

const EMPTY_COPY: Record<'today' | 'overdue' | 'tomorrow' | 'all', string> = {
  today: 'Nothing scheduled for today. Enjoy the quiet.',
  overdue: 'All clear — no overdue tasks.',
  tomorrow: 'Tomorrow is wide open.',
  all: 'No tasks assigned to you.',
};

type GroupBy = 'none' | 'work_date' | 'due_date' | 'priority' | 'space' | 'folder' | 'list';

const GROUP_BY_OPTIONS: { value: GroupBy; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'work_date', label: 'Work date' },
  { value: 'due_date', label: 'Due date' },
  { value: 'priority', label: 'Priority' },
  { value: 'space', label: 'Space' },
  { value: 'folder', label: 'Folder' },
  { value: 'list', label: 'List' },
];

const PRIORITY_ORDER: Record<string, number> = {
  emergency: 0,
  urgent: 1,
  high: 2,
  normal: 3,
  low: 4,
  none: 5,
};

const PRIORITY_LABELS: Record<string, string> = {
  emergency: 'Emergency',
  urgent: 'Urgent',
  high: 'High',
  normal: 'Normal',
  low: 'Low',
  none: 'No priority',
};

type Group = { key: string; label: string; sort: number | string; tasks: Task[] };

function groupByDate(tasks: Task[], field: 'work_date' | 'due_date', tz: string, emptyLabel: string): Group[] {
  const fmtKey = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  const fmtLabel = new Intl.DateTimeFormat(undefined, { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' });
  const now = new Date();
  const todayKey = fmtKey.format(now);
  const tomorrowKey = fmtKey.format(new Date(now.getTime() + 86_400_000));

  const map = new Map<string, Group>();
  for (const t of tasks) {
    const raw = (t as unknown as Record<string, string | null>)[field];
    if (!raw) {
      const k = '__none__';
      if (!map.has(k)) map.set(k, { key: k, label: emptyLabel, sort: Number.MAX_SAFE_INTEGER, tasks: [] });
      map.get(k)!.tasks.push(t);
      continue;
    }
    const d = new Date(raw);
    const key = fmtKey.format(d);
    if (!map.has(key)) {
      let label: string;
      if (key === todayKey) label = 'Today';
      else if (key === tomorrowKey) label = 'Tomorrow';
      else if (key < todayKey) label = `Overdue · ${fmtLabel.format(d)}`;
      else label = fmtLabel.format(d);
      map.set(key, { key, label, sort: key, tasks: [] });
    }
    map.get(key)!.tasks.push(t);
  }
  return [...map.values()].sort((a, b) => {
    if (typeof a.sort === 'number' && typeof b.sort === 'number') return a.sort - b.sort;
    if (typeof a.sort === 'number') return 1;
    if (typeof b.sort === 'number') return -1;
    return (a.sort as string).localeCompare(b.sort as string);
  });
}

function groupByPriority(tasks: Task[]): Group[] {
  const map = new Map<string, Group>();
  for (const t of tasks) {
    const p = (t.priority as string) || 'none';
    if (!map.has(p)) {
      map.set(p, {
        key: p,
        label: PRIORITY_LABELS[p] || p,
        sort: PRIORITY_ORDER[p] ?? 99,
        tasks: [],
      });
    }
    map.get(p)!.tasks.push(t);
  }
  return [...map.values()].sort((a, b) => (a.sort as number) - (b.sort as number));
}

function groupByNamedRef(
  tasks: Task[],
  pick: (t: Task) => { id: string; name: string } | null | undefined,
  emptyLabel: string,
): Group[] {
  const map = new Map<string, Group>();
  for (const t of tasks) {
    const ref = pick(t);
    const key = ref?.id || '__none__';
    if (!map.has(key)) {
      map.set(key, {
        key,
        label: ref?.name || emptyLabel,
        sort: ref ? (ref.name || '').toLowerCase() : '\uffff',
        tasks: [],
      });
    }
    map.get(key)!.tasks.push(t);
  }
  return [...map.values()].sort((a, b) => (a.sort as string).localeCompare(b.sort as string));
}

function groupTasks(tasks: Task[], by: GroupBy, tz: string): Group[] {
  switch (by) {
    case 'work_date':
      return groupByDate(tasks, 'work_date', tz, 'No work date');
    case 'due_date':
      return groupByDate(tasks, 'due_date', tz, 'No due date');
    case 'priority':
      return groupByPriority(tasks);
    case 'space':
      return groupByNamedRef(tasks, (t) => t.space ?? null, 'No space');
    case 'folder':
      return groupByNamedRef(
        tasks,
        (t) => (t as unknown as { folder?: { id: string; name: string } | null }).folder ?? null,
        'No folder',
      );
    case 'list':
      return groupByNamedRef(tasks, (t) => t.list ?? null, 'No list');
    default:
      return [];
  }
}

export default function DashboardListPanel() {
  const activeDashboardTab = usePMStore((s) => s.activeDashboardTab);
  const setActiveDashboardTab = usePMStore((s) => s.setActiveDashboardTab);
  const { data, isLoading } = useMyTasksSummary(!!activeDashboardTab);
  const [mounted, setMounted] = useState(false);
  const [groupBy, setGroupBy] = useState<GroupBy>('none');

  useEffect(() => {
    if (activeDashboardTab) {
      const id = requestAnimationFrame(() => setMounted(true));
      return () => cancelAnimationFrame(id);
    }
    setMounted(false);
    return undefined;
  }, [activeDashboardTab]);

  useEffect(() => {
    if (!activeDashboardTab) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return;
      setActiveDashboardTab(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeDashboardTab, setActiveDashboardTab]);

  const tasks = useMemo(() => {
    if (!data || !activeDashboardTab) return [];
    if (activeDashboardTab === 'all') {
      return [...data.overdue, ...data.today, ...data.tomorrow, ...data.upcoming, ...data.later];
    }
    return data[activeDashboardTab] || [];
  }, [data, activeDashboardTab]);

  const tz = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', []);

  const groups = useMemo(() => {
    if (groupBy === 'none') return [];
    return groupTasks(tasks, groupBy, tz);
  }, [tasks, groupBy, tz]);

  if (!activeDashboardTab) return null;

  const label = TAB_LABELS[activeDashboardTab];
  const count = tasks.length;

  return (
    <div className="fixed inset-0 z-[90]">
      <div
        className="absolute inset-0 transition-opacity duration-300"
        style={{ opacity: mounted ? 1 : 0, background: 'rgba(10,10,10,0.18)' }}
        onClick={() => setActiveDashboardTab(null)}
      />

      <aside
        onClick={(e) => e.stopPropagation()}
        className="td-panel td-panel-luma apple absolute flex flex-col"
        style={{
          background: 'var(--surface)',
          transform: mounted ? 'translateX(0)' : 'translateX(calc(100% + 24px))',
          transition: 'transform .42s cubic-bezier(0.23, 1, 0.32, 1), opacity .3s ease',
          opacity: mounted ? 1 : 0,
        }}
      >
        <div className="td-head td-head-luma flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setActiveDashboardTab(null)}
            className="td-nav-btn"
            title="Close"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M13 17l5-5-5-5M6 17l5-5-5-5" />
            </svg>
          </button>
          <div className="td-pill-btn" style={{ pointerEvents: 'none' }}>
            {label}
            <span style={{ color: 'var(--sh-ink-3)', marginLeft: 4 }}>{count}</span>
          </div>
        </div>

        <div className="sh-view dl-groupby shrink-0">
          <span className="dl-groupby-lbl">Group by</span>
          {GROUP_BY_OPTIONS.map((opt) => (
            <div
              key={opt.value}
              className="pill"
              data-active={groupBy === opt.value}
              onClick={() => setGroupBy(opt.value)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setGroupBy(opt.value);
                }
              }}
            >
              {opt.label}
            </div>
          ))}
        </div>

        <div className="td-scroll sh-view" style={{ flex: 1, overflowY: 'auto' }}>
          {isLoading ? (
            <div style={{ padding: 24, fontSize: 12, color: 'var(--sh-ink-3)' }}>Loading…</div>
          ) : count === 0 ? (
            <div style={{ padding: '28px 20px', fontSize: 13, color: 'var(--sh-ink-3)' }}>
              {EMPTY_COPY[activeDashboardTab]}
            </div>
          ) : groupBy === 'none' ? (
            <div className="today-list">
              {tasks.map((t) => (
                <DashboardTaskRow key={t.id} task={t} />
              ))}
            </div>
          ) : (
            groups.map((g) => (
              <div key={g.key} className="today-group">
                <div className="today-group-head">
                  <span>{g.label}</span>
                  <span className="count">· {g.tasks.length}</span>
                </div>
                <div className="today-list">
                  {g.tasks.map((t) => (
                    <DashboardTaskRow key={t.id} task={t} />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </aside>
    </div>
  );
}
