import { useMemo } from 'react';
import type { SpaceStatus } from '@squadhub/shared';
import type { RequestRowData } from '../atoms/RequestRow';
import { STATUS_LABELS } from '../atoms/StatusPill';
import type { RequestStatus } from '../atoms/StatusPill';
import type { DesignPlan } from '../../../../../hooks/useClientDesignPlan';
import TaskGroupCard from '../../TaskGroupCard';

const STATUS_ORDER: RequestStatus[] = ['progress', 'review', 'queued', 'done'];
const STATUS_COLOR: Record<RequestStatus, string> = {
  queued: 'var(--cd-queued)',
  progress: 'var(--cd-progress)',
  review: 'var(--cd-review)',
  done: 'var(--cd-done)',
};

export default function DashboardTab({
  requests,
  plan,
  statuses,
  listByStatus,
}: {
  requests: RequestRowData[];
  plan: DesignPlan;
  statuses: SpaceStatus[];
  listByStatus: Record<string, { id: string; name: string } | null>;
}) {
  const active = useMemo(() => requests.filter((r) => r._derivedStatus !== 'done'), [requests]);
  const inProgress = useMemo(() => requests.filter((r) => r._derivedStatus === 'progress'), [requests]);

  const remainingWeek = Math.max(0, plan.weeklyHours - plan.usedWeek);
  const pctOfPlan = plan.weeklyHours
    ? Math.round((plan.usedWeek / plan.weeklyHours) * 100)
    : 0;
  const remainingToday = Math.max(0, plan.dailyHours - plan.usedToday);

  const kpis = [
    {
      label: 'Active requests',
      dot: 'var(--cd-progress)',
      num: active.length,
      unit: 'open',
      delta: `${inProgress.length} in progress`,
      spark: [3, 4, 3, 5, 4, 6, 5, active.length % 9 || 7],
    },
    {
      label: 'In progress',
      dot: 'var(--cd-progress)',
      num: inProgress.length,
      unit: 'tasks',
      delta: `${new Set(inProgress.flatMap((r) => r.assignees?.map((a) => a.id) || [])).size} designers working`,
      spark: [1, 2, 2, 1, 3, 2, 3, 2],
    },
    {
      label: 'Hours used today',
      dot: 'var(--cd-acc)',
      num: plan.usedToday,
      unit: `/ ${plan.dailyHours}h`,
      delta: `${remainingToday.toFixed(1)}h remaining`,
      spark: [1, 3, 2, 4, 3, 2, 3, 2],
    },
    {
      label: 'Used this week',
      dot: 'var(--cd-review)',
      num: plan.usedWeek,
      unit: `/ ${plan.weeklyHours}h`,
      delta: `${pctOfPlan}% of plan`,
      spark: [2, 3, 4, 3, 4, 3, 4, 3],
    },
    {
      label: 'Remaining week',
      dot: 'var(--cd-done)',
      num: Math.round(remainingWeek * 10) / 10,
      unit: 'hours left',
      delta: "Unused doesn't roll over",
      spark: [8, 7, 6, 5, 4, 4, 3, 3],
    },
  ];

  const groups = useMemo(() => {
    const by: Record<string, RequestRowData[]> = {};
    for (const r of requests) {
      (by[r._derivedStatus] = by[r._derivedStatus] || []).push(r);
    }
    return STATUS_ORDER.filter((k) => by[k] && by[k].length > 0).map((k) => ({
      key: k,
      label: STATUS_LABELS[k],
      color: STATUS_COLOR[k],
      items: by[k],
      listId: listByStatus[k]?.id || null,
    }));
  }, [requests, listByStatus]);

  const noop = () => {};

  return (
    <>
      <div className="cd-kpi-row">
        {kpis.map((k) => (
          <div className="cd-kpi" key={k.label}>
            <div className="cd-kpi-label">
              <span className="cd-kpi-dot" style={{ background: k.dot }} />
              {k.label}
            </div>
            <div className="cd-spark">
              {k.spark.map((v, i) => (
                <span key={i} style={{ height: `${Math.max(4, v * 3)}px`, opacity: 0.3 + i * 0.08 }} />
              ))}
            </div>
            <div className="cd-kpi-value">
              <span className="cd-kpi-num">{k.num}</span>
              <span className="cd-kpi-unit">{k.unit}</span>
            </div>
            <div className="cd-kpi-delta">{k.delta}</div>
          </div>
        ))}
      </div>

      <div>
        {groups.length === 0 && (
          <div
            style={{
              padding: 24,
              fontFamily: 'var(--cd-font-mono)',
              fontSize: 11,
              color: 'var(--cd-fg-3)',
              border: '1px dashed var(--cd-br-1)',
              borderRadius: 6,
              textAlign: 'center',
              marginTop: 4,
            }}
          >
            No design requests yet. Press <b style={{ color: 'var(--cd-fg-1)' }}>N</b> to submit one.
          </div>
        )}

        {groups.map((g) => (
          <TaskGroupCard
            key={g.key}
            groupKey={`design-dashboard-${g.key}`}
            label={g.label}
            dotColor={g.color}
            tasks={g.items}
            allStatuses={statuses}
            listId={g.listId}
            onStatusChange={noop}
          />
        ))}
        <div style={{ height: 40 }} />
      </div>
    </>
  );
}
