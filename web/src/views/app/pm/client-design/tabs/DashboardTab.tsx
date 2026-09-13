import { useEffect, useMemo, useState } from 'react';
import type { SpaceStatus } from '@squadhub/shared';
import RequestRow, { type RequestRowData } from '../atoms/RequestRow';
import type { DesignPlan } from '../../../../../hooks/useClientDesignPlan';
import RequestsTab from './RequestsTab';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../../../../services/api';
import { isRequestStageDone, sortStages } from '../../../../../lib/designSpaceLists';
import { usePMStore } from '../../../../../stores/pmStore';

const KPI_ICON_PROPS = {
  width: 13,
  height: 13,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

const KPI_ICONS = {
  requests: (
    <svg {...KPI_ICON_PROPS}>
      <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
      <rect x="9" y="3" width="6" height="4" rx="1" />
      <path d="M9 12h6M9 16h4" />
    </svg>
  ),
  progress: (
    <svg {...KPI_ICON_PROPS}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5v5l3.25 2" />
    </svg>
  ),
  today: (
    <svg {...KPI_ICON_PROPS}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  ),
  week: (
    <svg {...KPI_ICON_PROPS}>
      <path d="M4 6h16M4 12h10M4 18h7" />
      <path d="m17 15 3 3-3 3" />
    </svg>
  ),
  month: (
    <svg {...KPI_ICON_PROPS}>
      <path d="M4 19V9M10 19V5M16 19v-7M22 19V3" />
    </svg>
  ),
} as const;

function KpiGoArrow() {
  return (
    <svg className="cd-kpi-go" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 17 17 7M7 7h10v10" />
    </svg>
  );
}

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

  const fmtH = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

  // Stage breakdown for the Requests card's stacked bar (every stage, in
  // pipeline order, including zero so the legend order is stable).
  const stageBreakdown = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of requests) if (r._stage?.id) counts[r._stage.id] = (counts[r._stage.id] || 0) + 1;
    return sortStages(statuses).map((s) => ({ id: s.id, name: s.name, color: s.color, count: counts[s.id] || 0 }));
  }, [requests, statuses]);

  // Hours cards: ring progress against the plan for each window.
  const hoursCards: {
    key: string;
    label: string;
    accent: string;
    icon: React.ReactNode;
    used: number;
    plan: number;
    pct: number;
    sub: string;
    items: RequestRowData[];
  }[] = [
    {
      key: 'today',
      label: 'Today',
      accent: '#8e98a4',
      icon: KPI_ICONS.today,
      used: plan.usedToday,
      plan: plan.dailyHours,
      pct: pctOfToday,
      sub: `${fmtH(remainingToday)}h left`,
      items: todayRequests,
    },
    {
      key: 'this-week',
      label: 'This week',
      accent: 'var(--cd-review)',
      icon: KPI_ICONS.week,
      used: plan.usedWeek,
      plan: plan.weeklyHours,
      pct: pctOfWeek,
      sub: `${fmtH(Math.max(0, plan.weeklyHours - plan.usedWeek))}h left`,
      items: weekRequests,
    },
    {
      key: 'this-month',
      label: 'This month',
      accent: 'var(--cd-done)',
      icon: KPI_ICONS.month,
      used: plan.usedMonth,
      plan: plan.monthlyHours,
      pct: pctOfMonth,
      sub: `${fmtH(Math.max(0, plan.monthlyHours - plan.usedMonth))}h left`,
      items: monthRequests,
    },
  ];

  // Everything the side drawer can list, keyed by card / sub-stat.
  const drawerCards: { key: string; label: string; dot: string; items: RequestRowData[] }[] = [
    { key: 'active', label: 'Active requests', dot: 'var(--cd-progress)', items: active },
    { key: 'in-progress', label: 'In progress', dot: 'var(--cd-progress)', items: inProgress },
    ...hoursCards.map((h) => ({ key: h.key, label: h.label, dot: h.accent, items: h.items })),
  ];
  const visibleKpis = hoursLinked ? drawerCards : drawerCards.filter((c) => c.key === 'active' || c.key === 'in-progress');

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
      <div className="cd-dock" data-hours={hoursLinked ? 'on' : 'off'}>
        {/* Requests: open / in-progress / working + stage breakdown. */}
        <div
          className="cd-dock-card cd-dock-requests"
          role="button"
          tabIndex={0}
          aria-label="Active requests — view tasks"
          onClick={() => setOpenCardKey('active')}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setOpenCardKey('active');
            }
          }}
          style={{ '--kpi-accent': 'var(--cd-progress)' } as React.CSSProperties}
        >
          <div className="cd-dock-head">
            <span className="cd-dock-icon" aria-hidden="true">{KPI_ICONS.requests}</span>
            <span className="cd-dock-label">Requests</span>
            <KpiGoArrow />
          </div>
          <div className="cd-dock-stats">
            <div className="cd-dock-stat is-primary">
              <b>{active.length}</b>
              <span>open</span>
            </div>
            <button
              type="button"
              className="cd-dock-stat is-link"
              onClick={(e) => {
                e.stopPropagation();
                setOpenCardKey('in-progress');
              }}
              title="View tasks in progress"
            >
              <b>{inProgress.length}</b>
              <span>in progress</span>
            </button>
            <div className="cd-dock-stat">
              <b>{designersWorking}</b>
              <span>working</span>
            </div>
          </div>
          <div className="cd-dock-stages">
            <div className="cd-dock-bar" aria-hidden="true">
              {requests.length === 0 ? (
                <span className="is-empty" />
              ) : (
                stageBreakdown
                  .filter((st) => st.count > 0)
                  .map((st) => (
                    <span key={st.id} style={{ flexGrow: st.count, background: st.color }} title={`${st.name} · ${st.count}`} />
                  ))
              )}
            </div>
            <div className="cd-dock-legend">
              {requests.length === 0 ? (
                <span className="cd-dock-legend-empty">No requests yet — press N to add one</span>
              ) : (
                stageBreakdown
                  .filter((st) => st.count > 0)
                  .slice(0, 5)
                  .map((st) => (
                    <span key={st.id} className="cd-dock-legend-item">
                      <i style={{ background: st.color }} />
                      {st.name}
                      <b>{st.count}</b>
                    </span>
                  ))
              )}
            </div>
          </div>
        </div>

        {hoursLinked ? (
          hoursCards.map((h) => {
            const C = 2 * Math.PI * 20;
            const clamped = Math.min(100, Math.max(0, h.pct));
            return (
              <div
                className="cd-dock-card cd-dock-hours"
                key={h.key}
                role="button"
                tabIndex={0}
                aria-label={`${h.label} — view tasks`}
                onClick={() => setOpenCardKey(h.key)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setOpenCardKey(h.key);
                  }
                }}
                style={{ '--kpi-accent': h.accent } as React.CSSProperties}
              >
                <div className="cd-dock-head">
                  <span className="cd-dock-icon" aria-hidden="true">{h.icon}</span>
                  <span className="cd-dock-label">{h.label}</span>
                  <KpiGoArrow />
                </div>
                <div className="cd-dock-ring-row">
                  <svg className="cd-ring" viewBox="0 0 48 48" aria-hidden="true">
                    <circle className="track" cx="24" cy="24" r="20" />
                    <circle
                      className="fill"
                      cx="24"
                      cy="24"
                      r="20"
                      strokeDasharray={C}
                      strokeDashoffset={C * (1 - clamped / 100)}
                    />
                    <text x="24" y="24" className="pct">{clamped}%</text>
                  </svg>
                  <div className="cd-dock-ring-copy">
                    <div className="cd-dock-big">
                      <b>{fmtH(h.used)}</b>
                      <span>/ {fmtH(h.plan)}h</span>
                    </div>
                    <div className="cd-dock-sub">{h.sub}</div>
                  </div>
                </div>
              </div>
            );
          })
        ) : (
          <div className="cd-dock-card cd-dock-link">
            <div className="cd-dock-head">
              <span className="cd-dock-icon" aria-hidden="true">{KPI_ICONS.today}</span>
              <span className="cd-dock-label">Hours</span>
            </div>
            {showLinkInput ? (
              <div className="cd-dock-link-form">
                <input
                  value={codeInput}
                  onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
                  placeholder="CARD-XXXXXX"
                  disabled={linkMutation.isPending}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && codeInput) linkMutation.mutate(codeInput);
                    if (e.key === 'Escape') { setShowLinkInput(false); setCodeInput(''); }
                  }}
                />
                <button
                  type="button"
                  className="cd-dock-btn is-primary"
                  onClick={() => codeInput && linkMutation.mutate(codeInput)}
                  disabled={!codeInput || linkMutation.isPending}
                >
                  {linkMutation.isPending ? 'Linking…' : 'Link'}
                </button>
                <button type="button" className="cd-dock-btn" onClick={() => { setShowLinkInput(false); setCodeInput(''); }}>
                  Cancel
                </button>
                {linkMutation.isError && (
                  <span className="cd-dock-link-err">
                    {(linkMutation.error as any)?.response?.data?.error || 'Link failed'}
                  </span>
                )}
              </div>
            ) : (
              <>
                <div className="cd-dock-sub">Time tracking is off. Link this workspace to a subscription card to see hours against plan.</div>
                <button type="button" className="cd-dock-btn is-primary" onClick={() => setShowLinkInput(true)}>
                  Link a card
                </button>
              </>
            )}
          </div>
        )}
      </div>

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
