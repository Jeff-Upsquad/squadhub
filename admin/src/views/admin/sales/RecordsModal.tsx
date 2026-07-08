'use client';

import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import api from '../../../services/api';
import {
  MetricRecord,
  Period,
  PeriodQuery,
  RecordMetric,
  crmLeadUrl,
  fmtDate,
  fmtDateTime,
  formatMoney,
  periodQueryString,
} from './shared';

// Drill-through list behind a metric number: the actual leads / deals /
// calls in the period, each with an "Open in CRM" link. Optionally scoped
// to one salesperson (leaderboard / member drill-in). Portal modal, same
// shell as MemberDrilldown.
export default function RecordsModal({
  metric,
  title,
  periodQuery,
  fallbackLabel,
  userId,
  userLabel,
  onClose,
}: {
  metric: RecordMetric;
  title: string;
  periodQuery: PeriodQuery;
  fallbackLabel: string;
  userId?: string;
  userLabel?: string;
  onClose: () => void;
}) {
  const { data: res, isLoading } = useQuery({
    queryKey: ['admin-sales-records', metric, userId ?? null, periodQuery],
    queryFn: () =>
      api
        .get(
          `/admin/sales-dashboard/records?metric=${metric}&${periodQueryString(periodQuery)}${
            userId ? `&user_id=${userId}` : ''
          }`,
        )
        .then((r) => r.data),
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const period: Period | null = res?.data?.period || null;
  const records: MetricRecord[] = res?.data?.records || [];
  const total: number = res?.data?.total ?? records.length;
  const crmBase: string = res?.data?.crm_base_url || 'https://crm.squadhub.in';
  const periodLabel = period?.label || fallbackLabel;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`${title} records`}
      // stopPropagation: when opened from inside MemberDrilldown, clicks
      // bubble through the React (portal) tree and would close it too.
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
    >
      <div className="absolute inset-0 bg-black/50" aria-hidden="true" />
      <div
        className="relative z-10 max-h-[85vh] w-full max-w-[620px] overflow-y-auto rounded-xl border border-divider bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 flex items-start justify-between border-b border-divider bg-surface px-4 py-3">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-foreground">{title}</h3>
            <p className="truncate text-xs text-foreground-muted">
              {userLabel ? `${userLabel} · ` : ''}
              {periodLabel}
              {total > records.length ? ` · showing ${records.length} of ${total}` : ` · ${total}`}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-foreground-dim hover:bg-canvas hover:text-foreground"
            aria-label="Close records"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {isLoading ? (
          <div className="py-12 text-center text-sm text-foreground-dim">Loading…</div>
        ) : records.length === 0 ? (
          <div className="py-12 text-center text-sm text-foreground-dim">
            Nothing here for {periodLabel}.
          </div>
        ) : (
          <div className="space-y-1.5 px-4 py-3">
            {records.map((r) => (
              <div key={r.id} className="flex items-start gap-2 rounded-md bg-surface-alt px-2.5 py-2">
                {r.kind === 'call' && (
                  <span
                    className={`mt-0.5 shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-medium ${
                      r.outcome === 'answered'
                        ? 'bg-[#DCFCE7] text-[#15803D]'
                        : 'bg-[#FEE2E2] text-[#B91C1C]'
                    }`}
                  >
                    {r.outcome === 'answered' ? 'Answered' : 'No answer'}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-xs font-medium text-foreground">
                      {r.name || r.phone || 'Unnamed lead'}
                    </p>
                    {r.deal_value != null && (
                      <span className="shrink-0 text-xs font-semibold text-foreground">
                        {formatMoney(r.deal_value)}
                      </span>
                    )}
                  </div>
                  <p className="truncate text-[11px] text-foreground-muted">
                    {r.name && r.phone ? `${r.phone} · ` : ''}
                    {r.kind === 'call'
                      ? r.note || (r.user_name ? `by ${r.user_name}` : '')
                      : [r.product, r.user_name && `${r.user_name}`].filter(Boolean).join(' · ')}
                  </p>
                  {r.kind === 'lead' && (
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      {r.became_deal_at && (
                        <span className="rounded-md bg-surface px-1.5 py-0.5 text-[10px] font-medium text-foreground-muted ring-1 ring-divider">
                          Deal {fmtDate(r.became_deal_at)}
                        </span>
                      )}
                      {r.converted_at && (
                        <span className="rounded-md bg-[#EEF2FF] px-1.5 py-0.5 text-[10px] font-medium text-[#4338CA]">
                          Converted {fmtDate(r.converted_at)}
                        </span>
                      )}
                      {r.closed_at && (
                        <span className="rounded-md bg-[#DCFCE7] px-1.5 py-0.5 text-[10px] font-medium text-[#15803D]">
                          Closed {fmtDate(r.closed_at)}
                        </span>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="text-[10px] text-foreground-dim">{fmtDateTime(r.event_at)}</span>
                  <a
                    href={crmLeadUrl(crmBase, r.lead_id)}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="rounded-md border border-divider px-2 py-0.5 text-[10px] font-medium text-accent hover:bg-canvas"
                  >
                    Open in CRM ↗
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
