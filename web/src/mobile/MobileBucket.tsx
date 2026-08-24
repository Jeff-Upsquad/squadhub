'use client';

/**
 * Phone bucket view — Partner app BucketScreen.kt. Opened from Home tiles
 * (Today / Overdue / Tomorrow / All open): date eyebrow, title, "N tasks",
 * Group-by pills, and dashboard rows. Not the My Tasks bucket list.
 */

import { useMemo } from 'react';
import type { Task } from '@squadhub/shared';
import { usePMStore, type DashboardTab } from '../stores/pmStore';
import { useMyTasksSummary } from '../hooks/useMyTasksSummary';
import { GROUP_BY_OPTIONS, groupTasks } from '../lib/taskGrouping';
import DashboardTaskRow from '../views/app/home/DashboardTaskRow';
import { MEmpty, MLoading } from './MobileKit';

const TAB_LABELS: Record<DashboardTab, string> = {
  today: 'Today',
  overdue: 'Overdue',
  tomorrow: 'Tomorrow',
  all: 'All tasks',
};

const EMPTY_COPY: Record<DashboardTab, { title: string; body: string }> = {
  today: { title: 'Nothing scheduled for today.', body: 'Tasks scheduled or due today land here.' },
  overdue: { title: 'All clear — no overdue tasks.', body: 'Anything past its due date shows up here.' },
  tomorrow: { title: 'Tomorrow is wide open.', body: 'Tasks due tomorrow land here.' },
  all: { title: 'No open tasks.', body: 'Every open task assigned to you lives here.' },
};

function eyebrowFor(tab: DashboardTab): string {
  const fmt = (d: Date) =>
    d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).replace(',', ' ·');
  const now = new Date();
  if (tab === 'today') return fmt(now);
  if (tab === 'tomorrow') {
    const t = new Date(now);
    t.setDate(t.getDate() + 1);
    return fmt(t);
  }
  if (tab === 'overdue') return 'Before today';
  return 'Everything open';
}

export default function MobileBucket() {
  const tab = usePMStore((s) => s.activeDashboardTab);
  const groupByScope = usePMStore((s) => s.groupByScope);
  const setScopedGroupBy = usePMStore((s) => s.setScopedGroupBy);
  const fadingTaskIds = usePMStore((s) => s.fadingTaskIds);
  const { data, isLoading } = useMyTasksSummary(!!tab);

  const dashScopeKey = tab ? `dashboard:${tab}` : '';
  const groupBy = (dashScopeKey && groupByScope[dashScopeKey]) || 'none';

  const tasks = useMemo<Task[]>(() => {
    if (!data || !tab) return [];
    if (tab === 'all') return [...data.overdue, ...data.today, ...data.tomorrow, ...data.upcoming, ...data.later];
    return data[tab] || [];
  }, [data, tab]);

  const tz = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', []);
  const groups = useMemo(() => {
    if (groupBy === 'none') return [];
    return groupTasks(tasks, groupBy, tz, fadingTaskIds);
  }, [tasks, groupBy, tz, fadingTaskIds]);

  const summary = useMemo(() => {
    if (!tab || isLoading || tasks.length === 0) return null;
    const urgent = tasks.filter((t) => t.priority === 'urgent').length;
    let oldest = 0;
    if (tab === 'overdue') {
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
  }, [tab, isLoading, tasks]);

  if (!tab) return null;

  const label = TAB_LABELS[tab];
  const empty = EMPTY_COPY[tab];

  return (
    <div className="mbk sh-view">
      <div className="mtk-phone-head">
        <p className="mbk-eyebrow">{eyebrowFor(tab)}</p>
        <h1>{label}</h1>
        {summary && (
          <p>
            {summary.count} {summary.count === 1 ? 'task' : 'tasks'}
            {summary.urgent > 0 && (
              <>
                {' · '}
                <span className="mbk-urgent">{summary.urgent} urgent</span>
              </>
            )}
            {summary.oldest > 0 && ` · oldest ${summary.oldest}d`}
          </p>
        )}
      </div>

      <div className="mbk-groupby">
        <span>Group by</span>
        {GROUP_BY_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            className="mbk-pill"
            data-on={groupBy === opt.value || undefined}
            onClick={() => dashScopeKey && setScopedGroupBy(dashScopeKey, opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <div className="mbk-scroll">
        {isLoading && tasks.length === 0 && <MLoading />}
        {!isLoading && tasks.length === 0 && <MEmpty title={empty.title} body={empty.body} />}
        {tasks.length > 0 && groupBy === 'none' && (
          <div className="mbk-list">
            {tasks.map((t) => (
              <DashboardTaskRow key={t.id} task={t} />
            ))}
          </div>
        )}
        {tasks.length > 0 && groupBy !== 'none' &&
          groups.map((g) => (
            <div key={g.key}>
              <div className="mbk-group-head">
                <b>{g.label}</b>
                <span>{g.tasks.length}</span>
              </div>
              <div className="mbk-list">
                {g.tasks.map((t) => (
                  <DashboardTaskRow key={t.id} task={t} />
                ))}
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}
