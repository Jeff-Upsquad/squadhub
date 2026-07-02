import { useMemo, useState } from 'react';
import type { SpaceStatus } from '@squadhub/shared';
import type { RequestRowData } from '../atoms/RequestRow';
import type { DesignPlan } from '../../../../../hooks/useClientDesignPlan';
import RequestsTab from './RequestsTab';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../../../../services/api';
import { isRequestStageDone } from '../../../../../lib/designSpaceLists';

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
  // "Open" = not yet finished — the active pipeline New Request … Changes.
  // "For Review" and "Closed" are done, so they drop out (see isRequestStageDone).
  // "in progress" = the active category (Line-up / Assigned / Work in Progress).
  const active = useMemo(() => requests.filter((r) => !isRequestStageDone(r._stage)), [requests]);
  const inProgress = useMemo(() => requests.filter((r) => r._stage?.category === 'active'), [requests]);

  const remainingToday = Math.max(0, plan.dailyHours - plan.usedToday);
  const pctOfToday = plan.dailyHours
    ? Math.round((plan.usedToday / plan.dailyHours) * 100)
    : 0;
  const pctOfWeek = plan.weeklyHours
    ? Math.round((plan.usedWeek / plan.weeklyHours) * 100)
    : 0;
  const pctOfMonth = plan.monthlyHours
    ? Math.round((plan.usedMonth / plan.monthlyHours) * 100)
    : 0;
  const designersWorking = new Set(
    inProgress.flatMap((r) => r.assignees?.map((a) => a.id) || []),
  ).size;

  const kpis: {
    label: string;
    dot: string;
    num: number;
    unit: string;
    delta: string;
    spark: number[];
    pct: number | null;
  }[] = [
    {
      label: 'Active requests',
      dot: 'var(--cd-progress)',
      num: active.length,
      unit: 'open',
      delta: `${inProgress.length} in progress`,
      spark: [3, 4, 3, 5, 4, 6, 5, active.length % 9 || 7],
      pct: active.length ? Math.round((inProgress.length / active.length) * 100) : null,
    },
    {
      label: 'In progress',
      dot: 'var(--cd-progress)',
      num: inProgress.length,
      unit: 'tasks',
      delta: `${designersWorking} designer${designersWorking === 1 ? '' : 's'} working`,
      spark: [1, 2, 2, 1, 3, 2, 3, 2],
      pct: null,
    },
    {
      label: 'Today',
      dot: 'var(--cd-acc)',
      num: plan.usedToday,
      unit: `/ ${plan.dailyHours}h`,
      delta: `${remainingToday.toFixed(1)}h remaining`,
      spark: [1, 3, 2, 4, 3, 2, 3, 2],
      pct: pctOfToday,
    },
    {
      label: 'This week',
      dot: 'var(--cd-review)',
      num: plan.usedWeek,
      unit: `/ ${plan.weeklyHours}h`,
      delta: `${pctOfWeek}% of plan`,
      spark: [2, 3, 4, 3, 4, 3, 4, 3],
      pct: pctOfWeek,
    },
    {
      label: 'This month',
      dot: 'var(--cd-done)',
      num: plan.usedMonth,
      unit: `/ ${plan.monthlyHours}h`,
      delta: `${pctOfMonth}% used`,
      spark: [8, 7, 6, 5, 4, 4, 3, 3],
      pct: pctOfMonth,
    },
  ];

  const visibleKpis = hoursLinked
    ? kpis
    : kpis.filter((k) => k.label === 'Active requests' || k.label === 'In progress');

  return (
    <>
      <div className="cd-kpi-row" data-count={visibleKpis.length}>
        {visibleKpis.map((k) => (
          <div
            className="cd-kpi"
            key={k.label}
            style={{ '--kpi-accent': k.dot } as React.CSSProperties}
          >
            <div className="cd-kpi-top">
              <div className="cd-kpi-label">
                <span className="cd-kpi-dot" />
                {k.label}
              </div>
              <div className="cd-spark" aria-hidden="true">
                {k.spark.map((v, i) => (
                  <span key={i} style={{ height: `${Math.max(3, v * 2.4)}px` }} />
                ))}
              </div>
            </div>
            <div className="cd-kpi-value">
              <span className="cd-kpi-num">{k.num}</span>
              <span className="cd-kpi-unit">{k.unit}</span>
            </div>
            <div className="cd-kpi-foot">
              {k.pct != null && (
                <div className="cd-kpi-progress">
                  <span style={{ width: `${Math.min(100, Math.max(0, k.pct))}%` }} />
                </div>
              )}
              <div className="cd-kpi-delta">{k.delta}</div>
            </div>
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

      {/* Interactive request list (Filter / Sort / Group toolbar + grouped rows),
          merged in from the former "Requests" tab so this Dashboard carries both
          the KPI overview and the full request management UI. */}
      <RequestsTab
        requests={requests}
        statuses={statuses}
        listByStatus={listByStatus}
        collapseCompletedByDefault
        emptyHint={
          <>
            No design requests yet. Press <b style={{ color: 'var(--cd-fg-1)' }}>N</b> to submit one.
          </>
        }
      />
    </>
  );
}
