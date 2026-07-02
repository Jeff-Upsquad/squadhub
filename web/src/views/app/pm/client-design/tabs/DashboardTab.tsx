import { useEffect, useMemo, useState } from 'react';
import type { SpaceStatus } from '@squadhub/shared';
import RequestRow, { type RequestRowData } from '../atoms/RequestRow';
import type { DesignPlan } from '../../../../../hooks/useClientDesignPlan';
import RequestsTab from './RequestsTab';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../../../../services/api';
import { isRequestStageDone } from '../../../../../lib/designSpaceLists';
import { usePMStore } from '../../../../../stores/pmStore';

// Local YYYY-MM-DD (matches work_date storage + useClientDesignPlan boundaries).
function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
// Monday-start week, mirroring useClientDesignPlan.startOfWeek.
function startOfWeek(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  out.setDate(out.getDate() - ((out.getDay() + 6) % 7));
  return out;
}

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
  const setActiveTask = usePMStore((s) => s.setActiveTask);
  const [codeInput, setCodeInput] = useState('');
  const [showLinkInput, setShowLinkInput] = useState(false);
  // Which KPI card's task list is open in the side drawer (null = closed).
  const [openCardKey, setOpenCardKey] = useState<string | null>(null);

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

  // Time-window buckets for the hours cards: requests scheduled (work_date) in
  // the current day / week / month, so each card's drawer lists the work it counts.
  const { todayRequests, weekRequests, monthRequests } = useMemo(() => {
    const now = new Date();
    const todayKey = toISODate(now);
    const weekStart = toISODate(startOfWeek(now));
    const weekEnd = toISODate(new Date(startOfWeek(now).getTime() + 6 * 864e5));
    const monthKey = todayKey.slice(0, 7);
    return {
      todayRequests: requests.filter((r) => r.work_date === todayKey),
      weekRequests: requests.filter(
        (r) => r.work_date != null && r.work_date >= weekStart && r.work_date <= weekEnd,
      ),
      monthRequests: requests.filter((r) => r.work_date?.slice(0, 7) === monthKey),
    };
  }, [requests]);

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
    key: string;
    label: string;
    dot: string;
    num: number;
    unit: string;
    delta: string;
    spark: number[];
    pct: number | null;
    // Tasks this card represents; shown in the side drawer when the card is clicked.
    items: RequestRowData[];
  }[] = [
    {
      key: 'active',
      label: 'Active requests',
      dot: 'var(--cd-progress)',
      num: active.length,
      unit: 'open',
      delta: `${inProgress.length} in progress`,
      spark: [3, 4, 3, 5, 4, 6, 5, active.length % 9 || 7],
      pct: active.length ? Math.round((inProgress.length / active.length) * 100) : null,
      items: active,
    },
    {
      key: 'in-progress',
      label: 'In progress',
      dot: 'var(--cd-progress)',
      num: inProgress.length,
      unit: 'tasks',
      delta: `${designersWorking} designer${designersWorking === 1 ? '' : 's'} working`,
      spark: [1, 2, 2, 1, 3, 2, 3, 2],
      pct: null,
      items: inProgress,
    },
    {
      key: 'today',
      label: 'Today',
      dot: 'var(--cd-acc)',
      num: plan.usedToday,
      unit: `/ ${plan.dailyHours}h`,
      delta: `${remainingToday.toFixed(1)}h remaining`,
      spark: [1, 3, 2, 4, 3, 2, 3, 2],
      pct: pctOfToday,
      items: todayRequests,
    },
    {
      key: 'this-week',
      label: 'This week',
      dot: 'var(--cd-review)',
      num: plan.usedWeek,
      unit: `/ ${plan.weeklyHours}h`,
      delta: `${pctOfWeek}% of plan`,
      spark: [2, 3, 4, 3, 4, 3, 4, 3],
      pct: pctOfWeek,
      items: weekRequests,
    },
    {
      key: 'this-month',
      label: 'This month',
      dot: 'var(--cd-done)',
      num: plan.usedMonth,
      unit: `/ ${plan.monthlyHours}h`,
      delta: `${pctOfMonth}% used`,
      spark: [8, 7, 6, 5, 4, 4, 3, 3],
      pct: pctOfMonth,
      items: monthRequests,
    },
  ];

  const visibleKpis = hoursLinked
    ? kpis
    : kpis.filter((k) => k.label === 'Active requests' || k.label === 'In progress');

  const openCard = openCardKey ? visibleKpis.find((k) => k.key === openCardKey) ?? null : null;

  // Close the drawer on Escape.
  useEffect(() => {
    if (!openCard) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpenCardKey(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openCard]);

  return (
    <>
      <div className="cd-kpi-row" data-count={visibleKpis.length}>
        {visibleKpis.map((k) => (
          <div
            className="cd-kpi cd-kpi-clickable"
            key={k.label}
            role="button"
            tabIndex={0}
            aria-label={`${k.label} — view tasks`}
            onClick={() => setOpenCardKey(k.key)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setOpenCardKey(k.key);
              }
            }}
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

      {openCard && (
        <>
          <div className="cd-drawer-backdrop" onClick={() => setOpenCardKey(null)} />
          <div className="cd-drawer" role="dialog" aria-label={`${openCard.label} tasks`}>
            <div className="cd-drawer-head">
              <span className="cd-kpi-dot" style={{ background: openCard.dot }} />
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--cd-fg-0)' }}>
                  {openCard.label}
                </div>
                <div className="id">
                  {openCard.items.length} task{openCard.items.length === 1 ? '' : 's'}
                </div>
              </div>
              <div className="spacer" />
              <button
                className="cd-topbar-btn"
                style={{ border: '1px solid var(--cd-br-0)', padding: 5 }}
                onClick={() => setOpenCardKey(null)}
                aria-label="Close"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="cd-drawer-body">
              {openCard.items.length === 0 ? (
                <div
                  style={{
                    padding: 40,
                    textAlign: 'center',
                    fontFamily: 'var(--cd-font-mono)',
                    fontSize: 11,
                    color: 'var(--cd-fg-3)',
                  }}
                >
                  No tasks in this bucket.
                </div>
              ) : (
                openCard.items.map((r) => (
                  <RequestRow
                    key={r.id}
                    request={r}
                    onClick={() => {
                      setActiveTask(r.id);
                      setOpenCardKey(null);
                    }}
                  />
                ))
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
