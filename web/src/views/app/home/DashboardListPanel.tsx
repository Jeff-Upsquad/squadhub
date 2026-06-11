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

const EMPTY_SUB: Record<'today' | 'overdue' | 'tomorrow' | 'all', string> = {
  today: 'Tasks scheduled or due today land here.',
  overdue: 'Anything past its due date shows up here.',
  tomorrow: 'Tasks due tomorrow land here.',
  all: 'Every open task assigned to you lives here.',
};

export default function DashboardListPanel() {
  const activeDashboardTab = usePMStore((s) => s.activeDashboardTab);
  const setActiveDashboardTab = usePMStore((s) => s.setActiveDashboardTab);
  const { data, isLoading } = useMyTasksSummary(!!activeDashboardTab);
  const [mounted, setMounted] = useState(false);
  const [scrolled, setScrolled] = useState(false);
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
    setScrolled(false);
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

  // Bucket context for the header eyebrow — a date for day buckets,
  // a plain-words scope for the rest.
  const eyebrow = useMemo(() => {
    if (!activeDashboardTab) return '';
    const fmt = (d: Date) =>
      d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).replace(',', ' ·');
    const now = new Date();
    if (activeDashboardTab === 'today') return fmt(now);
    if (activeDashboardTab === 'tomorrow') {
      const t = new Date(now);
      t.setDate(t.getDate() + 1);
      return fmt(t);
    }
    if (activeDashboardTab === 'overdue') return 'Before today';
    return 'Everything open';
  }, [activeDashboardTab]);

  // One-line shape of the bucket: count, urgent count, oldest overdue age.
  const summary = useMemo(() => {
    if (!activeDashboardTab || isLoading || tasks.length === 0) return null;
    const urgent = tasks.filter((t) => (t as any).priority === 'urgent').length;
    let oldest = 0;
    if (activeDashboardTab === 'overdue') {
      const todayMid = new Date();
      todayMid.setHours(0, 0, 0, 0);
      for (const t of tasks) {
        if (!t.due_date) continue;
        const d = new Date(t.due_date);
        d.setHours(0, 0, 0, 0);
        const days = Math.round((todayMid.getTime() - d.getTime()) / 86_400_000);
        if (days > oldest) oldest = days;
      }
    }
    return { count: tasks.length, urgent, oldest };
  }, [activeDashboardTab, isLoading, tasks]);

  if (!activeDashboardTab) return null;

  const label = TAB_LABELS[activeDashboardTab];
  const count = tasks.length;

  return (
    <div className="fixed inset-0 z-[90]">
      <div
        className="hmp-backdrop"
        style={{ opacity: mounted ? 1 : 0 }}
        onClick={() => setActiveDashboardTab(null)}
      />

      <aside
        onClick={(e) => e.stopPropagation()}
        className="hmp"
        style={{
          transform: mounted ? 'translateX(0)' : 'translateX(calc(100% + 24px))',
          transition: 'transform .42s cubic-bezier(0.23, 1, 0.32, 1), opacity .3s ease',
          opacity: mounted ? 1 : 0,
        }}
      >
        <div className="hmp-head">
          <button
            type="button"
            onClick={() => setActiveDashboardTab(null)}
            className="hmp-close"
            title="Close"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M13 17l5-5-5-5M6 17l5-5-5-5" />
            </svg>
          </button>
          <div className="hmp-head-text">
            <div className="hmp-eyebrow">{eyebrow}</div>
            <h3 className="hmp-title">{label}</h3>
            {summary && (
              <div className="hmp-summary">
                {summary.count} {summary.count === 1 ? 'task' : 'tasks'}
                {summary.urgent > 0 && (
                  <>
                    {' · '}
                    <span className="urgent">{summary.urgent} urgent</span>
                  </>
                )}
                {summary.oldest > 0 && ` · oldest ${summary.oldest}d`}
              </div>
            )}
          </div>
          <div className="hmp-head-actions">
            <kbd className="hmp-kbd" title="Press Escape to close">esc</kbd>
          </div>
        </div>

        <div className="hmp-groupby" data-scrolled={scrolled}>
          <span className="glbl">Group by</span>
          {GROUP_BY_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className="hm-pill"
              data-active={groupBy === opt.value}
              onClick={() => dashScopeKey && setScopedGroupBy(dashScopeKey, opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div
          className="hmp-scroll sh-view"
          onScroll={(e) => setScrolled((e.currentTarget as HTMLDivElement).scrollTop > 2)}
        >
          {isLoading ? (
            <div className="hmp-list" aria-hidden="true">
              <div className="hm-skel" />
              <div className="hm-skel" style={{ animationDelay: '0.15s' }} />
              <div className="hm-skel" style={{ animationDelay: '0.3s' }} />
            </div>
          ) : count === 0 ? (
            <div className="hmp-center">
              <div className="hm-empty">
                <div className="rule" />
                <div className="h">{EMPTY_COPY[activeDashboardTab]}</div>
                <div className="p">{EMPTY_SUB[activeDashboardTab]}</div>
              </div>
            </div>
          ) : groupBy === 'none' ? (
            <div className="hmp-list">
              {tasks.map((t) => (
                <DashboardTaskRow key={t.id} task={t} />
              ))}
            </div>
          ) : (
            groups.map((g) => (
              <div key={g.key} className="hm-group">
                <div className="hm-group-head">
                  <span>{g.label}</span>
                  <span className="count">· {g.tasks.length}</span>
                </div>
                <div className="hmp-list" style={{ paddingTop: 0 }}>
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
