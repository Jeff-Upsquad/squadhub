import { useMemo, useState } from 'react';
import type { SpaceStatus } from '@squadhub/shared';
import type { RequestRowData } from '../atoms/RequestRow';
import { STATUS_LABELS } from '../atoms/StatusPill';
import type { RequestStatus } from '../atoms/StatusPill';
import type { DesignPlan } from '../../../../../hooks/useClientDesignPlan';
import TaskGroupCard from '../../TaskGroupCard';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../../../../services/api';

function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

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
  folderId,
}: {
  requests: RequestRowData[];
  plan: DesignPlan;
  statuses: SpaceStatus[];
  listByStatus: Record<string, { id: string; name: string } | null>;
  folderId: string;
}) {
  const qc = useQueryClient();
  const [codeInput, setCodeInput] = useState('');
  const [showLinkInput, setShowLinkInput] = useState(false);

  const { data: linkStatus } = useQuery({
    queryKey: ['folder-link-status', folderId],
    queryFn: () => api.get(`/pm/folders/${folderId}/link-status`).then((r) => r.data?.data),
  });

  const hoursLinked = linkStatus?.linked ?? false;

  const linkMutation = useMutation({
    mutationFn: (card_code: string) => api.post(`/pm/folders/${folderId}/link-to-card`, { card_code }).then((r) => r.data),
    onSuccess: () => {
      setShowLinkInput(false);
      setCodeInput('');
      qc.invalidateQueries({ queryKey: ['folder-link-status', folderId] });
    },
  });
  const active = useMemo(() => requests.filter((r) => r._derivedStatus !== 'done'), [requests]);
  const inProgress = useMemo(() => requests.filter((r) => r._derivedStatus === 'progress'), [requests]);

  const remainingToday = Math.max(0, plan.dailyHours - plan.usedToday);
  const remainingWeek = Math.max(0, plan.weeklyHours - plan.usedWeek);
  const remainingMonth = Math.max(0, plan.monthlyHours - plan.usedMonth);
  const pctOfWeek = plan.weeklyHours
    ? Math.round((plan.usedWeek / plan.weeklyHours) * 100)
    : 0;
  const pctOfMonth = plan.monthlyHours
    ? Math.round((plan.usedMonth / plan.monthlyHours) * 100)
    : 0;

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
      label: 'Today',
      dot: 'var(--cd-acc)',
      num: plan.usedToday,
      unit: `/ ${plan.dailyHours}h`,
      delta: `${remainingToday.toFixed(1)}h remaining`,
      spark: [1, 3, 2, 4, 3, 2, 3, 2],
    },
    {
      label: 'This week',
      dot: 'var(--cd-review)',
      num: plan.usedWeek,
      unit: `/ ${plan.weeklyHours}h`,
      delta: `${pctOfWeek}% of plan`,
      spark: [2, 3, 4, 3, 4, 3, 4, 3],
    },
    {
      label: 'This month',
      dot: 'var(--cd-done)',
      num: plan.usedMonth,
      unit: `/ ${plan.monthlyHours}h`,
      delta: `${pctOfMonth}% used`,
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
        {(!hoursLinked ? kpis.filter((k) =>
          k.label === 'Active requests' || k.label === 'In progress'
        ) : kpis).map((k) => (
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
      {!hoursLinked && (
        <div
          style={{
            padding: 16,
            fontSize: 11,
            color: 'var(--cd-fg-2)',
            background: 'var(--cd-bg-2)',
            border: '1px dashed var(--cd-br-1)',
            borderRadius: 6,
            marginTop: 4,
            marginBottom: 16,
          }}
        >
          <div style={{ textAlign: 'center', marginBottom: showLinkInput ? 12 : 0 }}>
            Hours tracking is disabled.
          </div>
          {showLinkInput ? (
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', alignItems: 'center' }}>
              <input
                value={codeInput}
                onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
                placeholder="Paste CARD-XXXXXX code"
                disabled={linkMutation.isPending}
                style={{
                  padding: '6px 10px',
                  fontSize: 12,
                  fontFamily: 'var(--cd-font-mono)',
                  border: '1px solid var(--cd-br-1)',
                  borderRadius: 4,
                  background: 'var(--cd-bg-1)',
                  color: 'var(--cd-fg-1)',
                  width: 200,
                  outline: 'none',
                }}
                onKeyDown={(e) => e.key === 'Enter' && codeInput && linkMutation.mutate(codeInput)}
              />
              <button
                onClick={() => codeInput && linkMutation.mutate(codeInput)}
                disabled={!codeInput || linkMutation.isPending}
                style={{
                  padding: '6px 14px',
                  fontSize: 11,
                  fontWeight: 600,
                  border: 'none',
                  borderRadius: 4,
                  background: 'var(--cd-accent, #2962FF)',
                  color: '#fff',
                  cursor: linkMutation.isPending ? 'wait' : 'pointer',
                  opacity: !codeInput ? 0.5 : 1,
                }}
              >
                {linkMutation.isPending ? 'Linking…' : 'Link'}
              </button>
              <button
                onClick={() => { setShowLinkInput(false); setCodeInput(''); }}
                style={{
                  padding: '6px 10px',
                  fontSize: 11,
                  border: '1px solid var(--cd-br-1)',
                  borderRadius: 4,
                  background: 'transparent',
                  color: 'var(--cd-fg-2)',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              {linkMutation.isError && (
                <span style={{ color: 'var(--cd-red, #E53E3E)', fontSize: 10, marginLeft: 4 }}>
                  {(linkMutation.error as any)?.response?.data?.error || 'Link failed'}
                </span>
              )}
            </div>
          ) : (
            <div style={{ textAlign: 'center', marginTop: 8 }}>
              <button
                onClick={() => setShowLinkInput(true)}
                style={{
                  padding: '6px 14px',
                  fontSize: 11,
                  fontWeight: 600,
                  border: 'none',
                  borderRadius: 4,
                  background: 'var(--cd-accent, #2962FF)',
                  color: '#fff',
                  cursor: 'pointer',
                }}
              >
                Link to Card
              </button>
            </div>
          )}
        </div>
      )}

      {hoursLinked && linkStatus && (
        <div
          style={{
            padding: '10px 16px',
            fontSize: 11,
            color: 'var(--cd-fg-2)',
            background: 'var(--cd-bg-2)',
            border: '1px dashed var(--cd-br-1)',
            borderRadius: 6,
            marginTop: 4,
            marginBottom: 16,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <span style={{ whiteSpace: 'nowrap' }}>Starting date</span>
          <input
            type="date"
            value={linkStatus.billing_start_date ?? ''}
            onChange={(e) => {
              const val = e.target.value || null;
              api.post(`/pm/folders/${folderId}/billing-start-date`, { billing_start_date: val }).then(() => {
                qc.invalidateQueries({ queryKey: ['folder-link-status', folderId] });
              });
            }}
            style={{
              padding: '4px 8px',
              fontSize: 11,
              fontFamily: 'var(--cd-font-mono)',
              border: '1px solid var(--cd-br-1)',
              borderRadius: 4,
              background: 'var(--cd-bg-1)',
              color: 'var(--cd-fg-1)',
              outline: 'none',
            }}
          />
          {linkStatus.billing_start_date && (
            <span style={{ fontSize: 10, color: 'var(--cd-fg-3)' }}>
              First month prorated to {Math.round(plan.monthlyHours * 10) / 10}h
            </span>
          )}
        </div>
      )}

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
