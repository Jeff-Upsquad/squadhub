'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../../../services/api';
import FunnelBars from './FunnelBars';
import ProgressBar from './ProgressBar';
import MemberDrilldown from './MemberDrilldown';
import RecordsModal from './RecordsModal';
import {
  Funnel,
  MemberRow,
  MetricKey,
  Period,
  PeriodQuery,
  RecordMetric,
  Stats,
  TargetCell,
  displayName,
  formatMoney,
  periodQueryString,
  ratioCell,
  zeroStats,
} from './shared';

type SortKey = keyof Stats;

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'leads_created', label: 'Leads' },
  { key: 'calls_total', label: 'Calls' },
  { key: 'leads_to_deals', label: 'Lead → Deal' },
  { key: 'deals_converted', label: 'Converted' },
  { key: 'deals_closed', label: 'Closed' },
  { key: 'revenue_closed', label: 'Revenue' },
];

function hasActivity(s: Stats): boolean {
  return Object.values(s).some((v) => v !== 0);
}

/** Clickable totals card — opens the records list behind the number. */
function TotalsCard({
  label,
  sub,
  subNode,
  valueClass,
  onClick,
  children,
}: {
  label: string;
  sub?: string;
  subNode?: ReactNode;
  valueClass?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={`View the ${label.toLowerCase()} behind this number`}
      className="rounded-lg border border-divider bg-surface p-4 text-left transition hover:border-accent/50 hover:bg-surface-alt"
    >
      <p className="text-[11px] uppercase tracking-wider text-foreground-dim">{label}</p>
      <p className={`mt-0.5 text-base font-semibold ${valueClass || 'text-foreground'}`}>{children}</p>
      <p className="mt-0.5 text-[11px] text-foreground-dim">{subNode ?? sub}</p>
    </button>
  );
}

/** Count + optional target progress bar for one leaderboard cell. */
function MetricCell({
  value,
  sub,
  target,
  money,
}: {
  value: string;
  sub?: string;
  target?: TargetCell;
  money?: boolean;
}) {
  return (
    <div className="flex flex-col items-end gap-0.5">
      <span className="text-foreground">{value}</span>
      {sub && <span className="text-[10px] text-foreground-dim">{sub}</span>}
      {target && (
        <div className="w-20">
          <ProgressBar
            pct={target.pct}
            title={`Target ${money ? formatMoney(target.target) : target.target}: ${
              money ? formatMoney(target.actual) : target.actual
            } (${Math.round(target.pct)}%)`}
          />
        </div>
      )}
    </div>
  );
}

export default function OverviewTab({
  periodQuery,
  enabled,
  fallbackLabel,
}: {
  periodQuery: PeriodQuery;
  enabled: boolean;
  fallbackLabel: string;
}) {
  const [sortKey, setSortKey] = useState<SortKey>('revenue_closed');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  // Records drill-through: which metric's underlying leads/deals/calls to list.
  const [recordsFor, setRecordsFor] = useState<{ metric: RecordMetric; title: string } | null>(null);

  const { data: res, isLoading } = useQuery({
    queryKey: ['admin-sales-summary', periodQuery],
    queryFn: () =>
      api
        .get(`/admin/sales-dashboard/summary?${periodQueryString(periodQuery)}`)
        .then((r) => r.data),
    enabled,
  });

  const period: Period | null = res?.data?.period || null;
  const periodLabel = period?.label || fallbackLabel;
  const totals: Stats = res?.data?.totals || zeroStats();
  const funnel: Funnel = res?.data?.funnel || { leads: 0, deals: 0, converted: 0, closed: 0 };
  const members: MemberRow[] = useMemo(() => res?.data?.members || [], [res]);
  const others: Stats = res?.data?.others || zeroStats();
  const othersActive = hasActivity(others);

  const sorted = useMemo(() => {
    const list = [...members];
    list.sort((a, b) => {
      const av = a.stats[sortKey];
      const bv = b.stats[sortKey];
      return sortDir === 'desc' ? bv - av : av - bv;
    });
    return list;
  }, [members, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  }

  if (!enabled) {
    return (
      <div className="rounded-lg border border-divider bg-surface py-12 text-center text-sm text-foreground-dim">
        Pick a start and end date to load the custom period.
      </div>
    );
  }

  const targetFor = (m: MemberRow, key: MetricKey): TargetCell | undefined =>
    m.targets?.[key] ?? undefined;

  return (
    <div>
      {/* Totals cards — click any card to list the records behind the number */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <TotalsCard
          label="Leads"
          sub="created in period"
          onClick={() => setRecordsFor({ metric: 'leads_created', title: 'Leads created' })}
        >
          {totals.leads_created.toLocaleString('en-IN')}
        </TotalsCard>
        <TotalsCard
          label="Calls"
          subNode={
            <>
              <span className="text-[#15803D]">{totals.calls_answered} answered</span>
              {' · '}
              <span className="text-[#B91C1C]">{totals.calls_no_answer} no answer</span>
            </>
          }
          onClick={() => setRecordsFor({ metric: 'calls', title: 'Calls logged' })}
        >
          {totals.calls_total.toLocaleString('en-IN')}
        </TotalsCard>
        <TotalsCard
          label="Lead → Deal"
          sub="deals / leads created"
          onClick={() => setRecordsFor({ metric: 'leads_to_deals', title: 'Leads that became deals' })}
        >
          {ratioCell(totals.leads_to_deals, totals.leads_created)}
        </TotalsCard>
        <TotalsCard
          label="Converted"
          sub="deals converted"
          onClick={() => setRecordsFor({ metric: 'deals_converted', title: 'Deals converted (agreed to pay)' })}
        >
          {totals.deals_converted.toLocaleString('en-IN')}
        </TotalsCard>
        <TotalsCard
          label="Closed"
          sub="closed / converted"
          onClick={() => setRecordsFor({ metric: 'deals_closed', title: 'Deals closed (paid)' })}
        >
          {ratioCell(totals.deals_closed, totals.deals_converted)}
        </TotalsCard>
        <TotalsCard
          label="Revenue"
          sub="from closed deals"
          valueClass="text-[#16A34A]"
          onClick={() => setRecordsFor({ metric: 'deals_closed', title: 'Revenue — closed deals' })}
        >
          {formatMoney(totals.revenue_closed)}
        </TotalsCard>
      </div>

      {/* Funnel */}
      <div className="mb-5 rounded-lg border border-divider bg-surface p-4">
        <h3 className="mb-3 text-[11px] font-medium uppercase tracking-wider text-foreground-dim">
          Funnel · {periodLabel}
        </h3>
        <FunnelBars funnel={funnel} />
      </div>

      {/* Leaderboard */}
      <div className="overflow-hidden rounded-lg border border-divider bg-surface">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-divider bg-surface-alt">
              <th className="px-4 py-2.5 text-left font-medium text-foreground-muted">Member</th>
              {COLUMNS.map((col) => (
                <th key={col.key} className="px-4 py-2.5 text-right font-medium text-foreground-muted">
                  <button
                    onClick={() => toggleSort(col.key)}
                    className="inline-flex items-center gap-1 hover:text-foreground"
                  >
                    {col.label}
                    {sortKey === col.key && (
                      <span className="text-[9px]">{sortDir === 'desc' ? '▼' : '▲'}</span>
                    )}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={7} className="py-12 text-center text-foreground-dim">
                  Loading…
                </td>
              </tr>
            ) : sorted.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-12 text-center text-foreground-dim">
                  No one is on the sales team yet — add members in the Team tab.
                </td>
              </tr>
            ) : (
              <>
                {sorted.map((m) => (
                  <tr
                    key={m.user.id}
                    onClick={() => setSelectedUserId(m.user.id)}
                    className="cursor-pointer border-b border-divider hover:bg-surface-alt"
                  >
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        {m.user.avatar_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={m.user.avatar_url}
                            alt=""
                            className="h-6 w-6 shrink-0 rounded-full object-cover"
                          />
                        ) : (
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#EEF2FF] text-[10px] font-semibold text-accent">
                            {displayName(m.user).charAt(0).toUpperCase()}
                          </span>
                        )}
                        <span className="font-medium text-foreground">{displayName(m.user)}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <MetricCell value={String(m.stats.leads_created)} />
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <MetricCell
                        value={String(m.stats.calls_total)}
                        sub={`${m.stats.calls_answered} ans · ${m.stats.calls_no_answer} n/a`}
                        target={targetFor(m, 'calls_made')}
                      />
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <MetricCell
                        value={ratioCell(m.stats.leads_to_deals, m.stats.leads_created)}
                        target={targetFor(m, 'leads_converted')}
                      />
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <MetricCell
                        value={String(m.stats.deals_converted)}
                        target={targetFor(m, 'deals_converted')}
                      />
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <MetricCell
                        value={ratioCell(m.stats.deals_closed, m.stats.deals_converted)}
                        target={targetFor(m, 'deals_closed')}
                      />
                    </td>
                    <td className="px-4 py-2.5 text-right font-semibold">
                      <MetricCell
                        value={formatMoney(m.stats.revenue_closed)}
                        target={targetFor(m, 'revenue')}
                        money
                      />
                    </td>
                  </tr>
                ))}
                {/* Activity by non-team users (and unattributed events) so the
                    leaderboard reconciles with the totals above. */}
                {othersActive && (
                  <tr className="border-b border-divider text-foreground-dim">
                    <td className="px-4 py-2.5 italic">Others (not on sales team)</td>
                    <td className="px-4 py-2.5 text-right">{others.leads_created}</td>
                    <td className="px-4 py-2.5 text-right">
                      {others.calls_total}
                      <span className="block text-[10px]">
                        {others.calls_answered} ans · {others.calls_no_answer} n/a
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {ratioCell(others.leads_to_deals, others.leads_created)}
                    </td>
                    <td className="px-4 py-2.5 text-right">{others.deals_converted}</td>
                    <td className="px-4 py-2.5 text-right">
                      {ratioCell(others.deals_closed, others.deals_converted)}
                    </td>
                    <td className="px-4 py-2.5 text-right">{formatMoney(others.revenue_closed)}</td>
                  </tr>
                )}
              </>
            )}
          </tbody>
        </table>
      </div>

      {selectedUserId && (
        <MemberDrilldown
          userId={selectedUserId}
          periodQuery={periodQuery}
          fallbackLabel={periodLabel}
          onClose={() => setSelectedUserId(null)}
        />
      )}

      {recordsFor && (
        <RecordsModal
          metric={recordsFor.metric}
          title={recordsFor.title}
          periodQuery={periodQuery}
          fallbackLabel={periodLabel}
          onClose={() => setRecordsFor(null)}
        />
      )}
    </div>
  );
}
