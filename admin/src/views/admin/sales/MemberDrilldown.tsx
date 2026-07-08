'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import api from '../../../services/api';
import FunnelBars from './FunnelBars';
import ProgressBar from './ProgressBar';
import RecordsModal from './RecordsModal';
import {
  METRIC_KEYS,
  METRIC_LABELS,
  Period,
  PeriodQuery,
  RecordMetric,
  Stats,
  TargetCell,
  MetricKey,
  UserLite,
  crmLeadUrl,
  displayName,
  fmtDate,
  fmtDateTime,
  formatMoney,
  periodQueryString,
  zeroStats,
} from './shared';

type RecentCall = {
  id: string;
  lead_id: string | null;
  lead_name: string | null;
  outcome: 'answered' | 'no_answer';
  note: string | null;
  called_at: string;
};

type RecentDeal = {
  id: string;
  name: string | null;
  deal_value: number | null;
  became_deal_at: string | null;
  converted_at: string | null;
  closed_at: string | null;
};

// Portal modal (same pattern as the GrossProfit drill-in — portaled to
// <body> so an ancestor's overflow can't clip it).
export default function MemberDrilldown({
  userId,
  periodQuery,
  fallbackLabel,
  onClose,
}: {
  userId: string;
  periodQuery: PeriodQuery;
  fallbackLabel: string;
  onClose: () => void;
}) {
  const { data: res, isLoading } = useQuery({
    queryKey: ['admin-sales-member', userId, periodQuery],
    queryFn: () =>
      api
        .get(`/admin/sales-dashboard/members/${userId}?${periodQueryString(periodQuery)}`)
        .then((r) => r.data),
  });
  // Records drill-through scoped to this member.
  const [recordsFor, setRecordsFor] = useState<{ metric: RecordMetric; title: string } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const period: Period | null = res?.data?.period || null;
  const user: UserLite | null = res?.data?.user || null;
  const stats: Stats = res?.data?.stats || zeroStats();
  const targets: Partial<Record<MetricKey, TargetCell>> | null = res?.data?.targets || null;
  const recentCalls: RecentCall[] = res?.data?.recent_calls || [];
  const recentDeals: RecentDeal[] = res?.data?.recent_deals || [];
  const crmBase: string = res?.data?.crm_base_url || 'https://crm.squadhub.in';
  const periodLabel = period?.label || fallbackLabel;

  const targetEntries = targets
    ? METRIC_KEYS.filter((k) => targets[k]).map((k) => ({ key: k, cell: targets[k] as TargetCell }))
    : [];

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`${displayName(user)} sales activity`}
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/50" aria-hidden="true" />
      <div
        className="relative z-10 max-h-[85vh] w-full max-w-[560px] overflow-y-auto rounded-xl border border-divider bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between border-b border-divider px-4 py-3">
          <div className="flex min-w-0 items-center gap-2.5">
            {user?.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={user.avatar_url} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" />
            ) : (
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#EEF2FF] text-xs font-semibold text-accent">
                {displayName(user).charAt(0).toUpperCase()}
              </span>
            )}
            <div className="min-w-0">
              <h3 className="truncate text-sm font-semibold text-foreground">{displayName(user)}</h3>
              <p className="truncate text-xs text-foreground-muted">
                {user?.email ? `${user.email} · ` : ''}
                {periodLabel}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-foreground-dim hover:bg-canvas hover:text-foreground"
            aria-label="Close drill-in"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {isLoading ? (
          <div className="py-12 text-center text-sm text-foreground-dim">Loading…</div>
        ) : (
          <>
            {/* Headline numbers — click to list this member's records */}
            <div className="grid grid-cols-3 gap-3 border-b border-divider px-4 py-3">
              <button
                type="button"
                onClick={() => setRecordsFor({ metric: 'calls', title: 'Calls logged' })}
                className="rounded-md p-1 -m-1 text-left transition hover:bg-surface-alt"
              >
                <p className="text-[10px] uppercase tracking-wider text-foreground-dim">Calls</p>
                <p className="mt-0.5 text-sm font-semibold text-foreground">{stats.calls_total}</p>
                <p className="text-[10px] text-foreground-dim">
                  {stats.calls_answered} ans · {stats.calls_no_answer} n/a
                </p>
              </button>
              <button
                type="button"
                onClick={() => setRecordsFor({ metric: 'deals_closed', title: 'Deals closed (paid)' })}
                className="rounded-md p-1 -m-1 text-left transition hover:bg-surface-alt"
              >
                <p className="text-[10px] uppercase tracking-wider text-foreground-dim">Closed</p>
                <p className="mt-0.5 text-sm font-semibold text-foreground">{stats.deals_closed}</p>
              </button>
              <button
                type="button"
                onClick={() => setRecordsFor({ metric: 'deals_closed', title: 'Revenue — closed deals' })}
                className="rounded-md p-1 -m-1 text-left transition hover:bg-surface-alt"
              >
                <p className="text-[10px] uppercase tracking-wider text-foreground-dim">Revenue</p>
                <p className="mt-0.5 text-sm font-semibold text-[#16A34A]">
                  {formatMoney(stats.revenue_closed)}
                </p>
              </button>
            </div>

            {/* Personal funnel */}
            <div className="border-b border-divider px-4 py-3">
              <h4 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-foreground-dim">
                Funnel
              </h4>
              <FunnelBars
                funnel={{
                  leads: stats.leads_created,
                  deals: stats.leads_to_deals,
                  converted: stats.deals_converted,
                  closed: stats.deals_closed,
                }}
              />
            </div>

            {/* Target progress */}
            {targetEntries.length > 0 && (
              <div className="border-b border-divider px-4 py-3">
                <h4 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-foreground-dim">
                  Target progress
                </h4>
                <div className="space-y-2">
                  {targetEntries.map(({ key, cell }) => (
                    <div key={key} className="flex items-center gap-3">
                      <span className="w-24 shrink-0 text-xs text-foreground-muted">
                        {METRIC_LABELS[key]}
                      </span>
                      <div className="flex-1">
                        <ProgressBar pct={cell.pct} />
                      </div>
                      <span className="w-32 shrink-0 text-right text-[11px] text-foreground">
                        {key === 'revenue'
                          ? `${formatMoney(cell.actual)} / ${formatMoney(cell.target)}`
                          : `${cell.actual} / ${cell.target}`}
                        <span className={`ml-1 ${cell.pct >= 100 ? 'text-[#16A34A]' : 'text-foreground-dim'}`}>
                          · {Math.round(cell.pct)}%
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Recent calls */}
            <div className="border-b border-divider px-4 py-3">
              <h4 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-foreground-dim">
                Recent calls ({recentCalls.length})
              </h4>
              {recentCalls.length === 0 ? (
                <p className="text-xs text-foreground-dim">No calls logged in {periodLabel}.</p>
              ) : (
                <div className="space-y-1.5">
                  {recentCalls.map((c) => (
                    <div key={c.id} className="flex items-start gap-2 rounded-md bg-surface-alt px-2.5 py-1.5">
                      <span
                        className={`mt-0.5 shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-medium ${
                          c.outcome === 'answered'
                            ? 'bg-[#DCFCE7] text-[#15803D]'
                            : 'bg-[#FEE2E2] text-[#B91C1C]'
                        }`}
                      >
                        {c.outcome === 'answered' ? 'Answered' : 'No answer'}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-foreground">
                          {c.lead_name || 'Unknown lead'}
                        </p>
                        {c.note && <p className="truncate text-[11px] text-foreground-muted">{c.note}</p>}
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <span className="text-[10px] text-foreground-dim">
                          {fmtDateTime(c.called_at)}
                        </span>
                        {c.lead_id && (
                          <a
                            href={crmLeadUrl(crmBase, c.lead_id)}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded-md border border-divider px-1.5 py-0.5 text-[10px] font-medium text-accent hover:bg-canvas"
                          >
                            Open in CRM ↗
                          </a>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Recent deal movements */}
            <div className="px-4 py-3">
              <h4 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-foreground-dim">
                Recent deals ({recentDeals.length})
              </h4>
              {recentDeals.length === 0 ? (
                <p className="text-xs text-foreground-dim">No deal movement in {periodLabel}.</p>
              ) : (
                <div className="space-y-1.5">
                  {recentDeals.map((d) => (
                    <div key={d.id} className="rounded-md bg-surface-alt px-2.5 py-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-xs font-medium text-foreground">
                          {d.name || 'Unnamed lead'}
                        </p>
                        <span className="flex shrink-0 items-center gap-2">
                          {d.deal_value != null && (
                            <span className="text-xs font-semibold text-foreground">
                              {formatMoney(d.deal_value)}
                            </span>
                          )}
                          <a
                            href={crmLeadUrl(crmBase, d.id)}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded-md border border-divider px-1.5 py-0.5 text-[10px] font-medium text-accent hover:bg-canvas"
                          >
                            Open in CRM ↗
                          </a>
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        {d.became_deal_at && (
                          <span className="rounded-md bg-surface px-1.5 py-0.5 text-[10px] font-medium text-foreground-muted ring-1 ring-divider">
                            Deal {fmtDate(d.became_deal_at)}
                          </span>
                        )}
                        {d.converted_at && (
                          <span className="rounded-md bg-[#EEF2FF] px-1.5 py-0.5 text-[10px] font-medium text-[#4338CA]">
                            Converted {fmtDate(d.converted_at)}
                          </span>
                        )}
                        {d.closed_at && (
                          <span className="rounded-md bg-[#DCFCE7] px-1.5 py-0.5 text-[10px] font-medium text-[#15803D]">
                            Closed {fmtDate(d.closed_at)}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {recordsFor && (
        <RecordsModal
          metric={recordsFor.metric}
          title={recordsFor.title}
          periodQuery={periodQuery}
          fallbackLabel={periodLabel}
          userId={userId}
          userLabel={displayName(user)}
          onClose={() => setRecordsFor(null)}
        />
      )}
    </div>,
    document.body,
  );
}
