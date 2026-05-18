import { useEffect, useMemo, useState } from 'react';
import { usePMStore } from '../../../stores/pmStore';
import { useMyTasksSummary } from '../../../hooks/useMyTasksSummary';
import { GROUP_BY_OPTIONS, groupTasks, type GroupBy } from '../../../lib/taskGrouping';
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

export default function DashboardListPanel() {
  const activeDashboardTab = usePMStore((s) => s.activeDashboardTab);
  const setActiveDashboardTab = usePMStore((s) => s.setActiveDashboardTab);
  const { data, isLoading } = useMyTasksSummary(!!activeDashboardTab);
  const [mounted, setMounted] = useState(false);
  const groupByScope = usePMStore((s) => s.groupByScope);
  const setScopedGroupBy = usePMStore((s) => s.setScopedGroupBy);
  const fadingTaskIds = usePMStore((s) => s.fadingTaskIds);
  const dashScopeKey = activeDashboardTab ? `dashboard:${activeDashboardTab}` : '';
  const groupBy = (dashScopeKey && groupByScope[dashScopeKey]) || 'none';

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
    return groupTasks(tasks, groupBy, tz, fadingTaskIds);
  }, [tasks, groupBy, tz, fadingTaskIds]);

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
              onClick={() => dashScopeKey && setScopedGroupBy(dashScopeKey, opt.value)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  if (dashScopeKey) setScopedGroupBy(dashScopeKey, opt.value);
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
