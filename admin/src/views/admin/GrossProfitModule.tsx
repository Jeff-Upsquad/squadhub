'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import api from '../../services/api';

type Granularity = 'month' | 'quarter' | 'year';

type CurrencySummary = {
  currency: string;
  revenue: number;
  partner_cost: number;
  gross_profit: number;
  margin_pct: number;
  client_count: number;
};

type Line = {
  term_id: string;
  card_id: string | null;
  role: string | null;
  subscription_name: string | null;
  plan: string | null;
  tier: string | null;
  talent: string | null;
  work_start: string | null;
  work_end: string | null;
  active_days: number;
  status: 'active' | 'paused' | 'cancelled' | 'ended';
  revenue: number;
  partner_cost: number;
  gross_profit: number;
  missing_revenue: boolean;
  missing_partner_price: boolean;
  finalized: boolean;
};

type ClientRow = {
  id: string;
  business_name: string;
  currency: string;
  active_subscription_count: number;
  revenue: number;
  partner_cost: number;
  gross_profit: number;
  margin_pct: number;
  has_missing_pricing: boolean;
  lines: Line[];
};

type Period = {
  granularity: Granularity;
  anchor: string;
  label: string;
  start: string;
  end: string;
};

const MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

// Amounts are stored in whole currency units (matches the Active Subscriptions
// view, which renders the same term prices) — do NOT divide by 100.
function formatMoney(amount: number, currency: string | null): string {
  const cur = currency || '';
  if (cur === 'INR') return '₹' + (amount || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
  if (cur === 'USD') return '$' + (amount || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
  // Unresolved currency (un-finalized engagement): show the bare number, never
  // the literal "UNKNOWN" — the row is flagged as an estimate elsewhere.
  return (amount || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

function currencyLabel(currency: string): string {
  return currency && currency !== 'UNKNOWN' ? currency : 'Unknown';
}

function formatPct(pct: number): string {
  return pct.toFixed(1) + '%';
}

function fmtDate(iso: string | null): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return `${MONTHS_SHORT[m - 1]} ${d}, ${y}`;
}

function dateRange(start: string | null, end: string | null): string {
  if (!start) return '—';
  if (!end) return `Since ${fmtDate(start)}`;
  return `${fmtDate(start)} – ${fmtDate(end)}`;
}

function tierBadge(tier: string | null | undefined): string {
  if (tier === 'Junior') return 'bg-canvas text-foreground-muted';
  if (tier === 'Pro') return 'bg-[#EEF2FF] text-[#4338CA]';
  if (tier === 'Top Talents') return 'bg-[#FEF3C7] text-[#A16207]';
  return 'bg-canvas text-foreground-muted';
}

function statusBadge(status: string): { label: string; cls: string } {
  if (status === 'paused') return { label: 'Paused', cls: 'bg-[#FEF3C7] text-[#A16207]' };
  if (status === 'cancelled') return { label: 'Cancelled', cls: 'bg-[#FEE2E2] text-[#B91C1C]' };
  if (status === 'ended') return { label: 'Ended', cls: 'bg-canvas text-foreground-muted ring-1 ring-divider' };
  return { label: 'Active', cls: 'bg-[#DCFCE7] text-[#15803D]' };
}

function anchorFor(g: Granularity, year: number, month: number): string {
  if (g === 'year') return String(year);
  if (g === 'quarter') return `${year}-Q${Math.floor((month - 1) / 3) + 1}`;
  return `${year}-${String(month).padStart(2, '0')}`;
}

const GRAN_LABEL: Record<Granularity, string> = {
  month: 'Month',
  quarter: 'Quarter',
  year: 'Year',
};

export default function GrossProfitModule() {
  const now = useMemo(() => new Date(), []);
  const [granularity, setGranularity] = useState<Granularity>('month');
  const [cursor, setCursor] = useState({ year: now.getFullYear(), month: now.getMonth() + 1 });
  const [currency, setCurrency] = useState('');
  const [subscription, setSubscription] = useState('');
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);

  const anchor = anchorFor(granularity, cursor.year, cursor.month);

  function step(delta: number) {
    setCursor((prev) => {
      let { year, month } = prev;
      if (granularity === 'year') {
        year += delta;
      } else if (granularity === 'quarter') {
        const qStart = Math.floor((month - 1) / 3) * 3 + 1;
        let m = qStart + delta * 3;
        while (m < 1) { m += 12; year -= 1; }
        while (m > 12) { m -= 12; year += 1; }
        month = m;
      } else {
        let m = month + delta;
        while (m < 1) { m += 12; year -= 1; }
        while (m > 12) { m -= 12; year += 1; }
        month = m;
      }
      return { year, month };
    });
  }

  function resetToNow() {
    setCursor({ year: now.getFullYear(), month: now.getMonth() + 1 });
  }

  const queryParams = new URLSearchParams();
  queryParams.set('granularity', granularity);
  queryParams.set('anchor', anchor);
  if (currency) queryParams.set('currency', currency);
  if (subscription) queryParams.set('subscription', subscription);

  const { data: gpRes, isLoading } = useQuery({
    queryKey: ['admin-gross-profit', granularity, anchor, currency, subscription],
    queryFn: () =>
      api.get(`/admin/gross-profit/clients?${queryParams.toString()}`).then((r) => r.data),
  });

  const summary: CurrencySummary[] = gpRes?.data?.summary_by_currency || [];
  const clients: ClientRow[] = gpRes?.data?.clients || [];
  const period: Period | null = gpRes?.data?.period || null;
  const periodLabel = period?.label || anchor;

  const selectedClient = selectedClientId
    ? clients.find((c) => c.id === selectedClientId) || null
    : null;
  const anyMissing = clients.some((c) => c.has_missing_pricing);

  // Close the drill-in modal on Escape.
  useEffect(() => {
    if (!selectedClientId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedClientId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedClientId]);

  const resetLabel =
    granularity === 'month' ? 'This month' : granularity === 'quarter' ? 'This quarter' : 'This year';

  return (
    <div>
      {/* Header */}
      <div className="mb-5">
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-foreground">
          Gross Profit
        </h1>
        <p className="mt-1 text-sm text-foreground-muted">
          Revenue, partner cost, and profit per client for the selected period, from finalized
          subscription billing.
        </p>
      </div>

      {/* Period controls: granularity toggle + stepper */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-lg border border-divider bg-surface p-0.5">
          {(['month', 'quarter', 'year'] as Granularity[]).map((g) => (
            <button
              key={g}
              onClick={() => setGranularity(g)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                granularity === g
                  ? 'bg-[#EEF2FF] text-accent'
                  : 'text-foreground-muted hover:text-foreground'
              }`}
            >
              {GRAN_LABEL[g]}
            </button>
          ))}
        </div>

        <div className="inline-flex items-center gap-1 rounded-lg border border-divider bg-surface px-1 py-0.5">
          <button
            onClick={() => step(-1)}
            className="rounded-md p-1.5 text-foreground-dim hover:bg-surface-alt hover:text-foreground"
            aria-label="Previous period"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <span className="min-w-[7.5rem] text-center text-sm font-semibold text-foreground">
            {periodLabel}
          </span>
          <button
            onClick={() => step(1)}
            className="rounded-md p-1.5 text-foreground-dim hover:bg-surface-alt hover:text-foreground"
            aria-label="Next period"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>

        <button
          onClick={resetToNow}
          className="rounded-md border border-divider bg-surface px-3 py-1.5 text-xs text-foreground-muted hover:text-foreground"
        >
          {resetLabel}
        </button>
      </div>

      {/* Summary cards (one per currency) */}
      {summary.length > 0 && (
        <div className="mb-5 grid gap-3 sm:grid-cols-2">
          {summary.map((s) => (
            <div key={s.currency} className="rounded-lg border border-divider bg-surface p-4">
              <div className="mb-3 flex items-center justify-between">
                <span
                  className={`font-[family-name:var(--font-mono)] rounded-md px-2 py-0.5 text-[11px] font-semibold ${
                    s.currency === 'UNKNOWN'
                      ? 'bg-[#FEF3C7] text-[#A16207]'
                      : 'bg-[#EEF2FF] text-accent'
                  }`}
                  title={s.currency === 'UNKNOWN' ? 'Currency not set — figures are estimates' : undefined}
                >
                  {currencyLabel(s.currency)}
                </span>
                <span className="text-xs text-foreground-muted">
                  {s.client_count} client{s.client_count === 1 ? '' : 's'}
                </span>
              </div>
              <div className="grid grid-cols-4 gap-3">
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-foreground-dim">Revenue</p>
                  <p className="mt-0.5 text-base font-semibold text-foreground">
                    {formatMoney(s.revenue, s.currency)}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-foreground-dim">Partner Cost</p>
                  <p className="mt-0.5 text-base font-semibold text-foreground">
                    {formatMoney(s.partner_cost, s.currency)}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-foreground-dim">Gross Profit</p>
                  <p
                    className={`mt-0.5 text-base font-semibold ${
                      s.gross_profit >= 0 ? 'text-[#16A34A]' : 'text-[#DC2626]'
                    }`}
                  >
                    {formatMoney(s.gross_profit, s.currency)}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-foreground-dim">Margin</p>
                  <p className="mt-0.5 text-base font-semibold text-foreground">
                    {formatPct(s.margin_pct)}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select
          value={currency}
          onChange={(e) => setCurrency(e.target.value)}
          className="rounded-md border border-divider px-3 py-1.5 text-xs text-foreground"
        >
          <option value="">All Currencies</option>
          <option value="INR">INR (₹)</option>
          <option value="USD">USD ($)</option>
        </select>
        <select
          value={subscription}
          onChange={(e) => setSubscription(e.target.value)}
          className="rounded-md border border-divider px-3 py-1.5 text-xs text-foreground"
        >
          <option value="">All Subscriptions</option>
          <option value="designer">Designer</option>
          <option value="video_editor">Video Editor</option>
        </select>
      </div>

      {/* Missing pricing banner */}
      {anyMissing && (
        <div className="mb-3 flex items-start gap-2 rounded-md border border-[#FCD34D] bg-[#FFFBEB] px-3 py-2 text-xs text-[#A16207]">
          <svg className="mt-0.5 h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
          <span>
            Some subscriptions active this period aren&apos;t finalized yet — their figures are
            estimated from card/catalog pricing and their currency may be unset (shown as
            &ldquo;Unknown&rdquo;). Those clients show an amber dot; finalize the engagements to lock
            the numbers.
          </span>
        </div>
      )}

      {/* Body: table + optional drill-in */}
      {/* Clients table (full width; drill-in opens as a modal) */}
      <div className="overflow-hidden rounded-lg border border-divider bg-surface">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-divider bg-surface-alt">
                <th className="px-4 py-2.5 text-left font-medium text-foreground-muted">Client</th>
                <th className="px-4 py-2.5 text-left font-medium text-foreground-muted">Currency</th>
                <th className="px-4 py-2.5 text-right font-medium text-foreground-muted">Subs</th>
                <th className="px-4 py-2.5 text-right font-medium text-foreground-muted">Revenue</th>
                <th className="px-4 py-2.5 text-right font-medium text-foreground-muted">Partner Cost</th>
                <th className="px-4 py-2.5 text-right font-medium text-foreground-muted">Gross Profit</th>
                <th className="px-4 py-2.5 text-right font-medium text-foreground-muted">Margin</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-foreground-dim">
                    Loading…
                  </td>
                </tr>
              ) : clients.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-foreground-dim">
                    No subscriptions were active in {periodLabel}.
                  </td>
                </tr>
              ) : (
                clients.map((c) => {
                  const isSelected = selectedClientId === c.id;
                  return (
                    <tr
                      key={c.id}
                      onClick={() => setSelectedClientId(isSelected ? null : c.id)}
                      className={`cursor-pointer border-b border-divider hover:bg-surface-alt ${
                        isSelected ? 'bg-[#EEF2FF]' : ''
                      }`}
                    >
                      <td className="px-4 py-2.5 text-foreground">
                        <div className="flex items-center gap-2">
                          {c.has_missing_pricing && (
                            <span
                              title="Includes not-finalized subscriptions — figures are estimates"
                              className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500"
                            />
                          )}
                          <span className="font-medium">{c.business_name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-foreground-muted">
                        {c.currency === 'UNKNOWN' ? '—' : c.currency}
                      </td>
                      <td className="px-4 py-2.5 text-right text-foreground-muted">
                        {c.active_subscription_count}
                      </td>
                      <td className="px-4 py-2.5 text-right text-foreground">
                        {formatMoney(c.revenue, c.currency)}
                      </td>
                      <td className="px-4 py-2.5 text-right text-foreground">
                        {formatMoney(c.partner_cost, c.currency)}
                      </td>
                      <td
                        className={`px-4 py-2.5 text-right font-semibold ${
                          c.gross_profit >= 0 ? 'text-[#16A34A]' : 'text-[#DC2626]'
                        }`}
                      >
                        {formatMoney(c.gross_profit, c.currency)}
                      </td>
                      <td className="px-4 py-2.5 text-right text-foreground-muted">
                        {formatPct(c.margin_pct)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Drill-in modal — portaled to <body> so an ancestor's overflow can't clip it */}
        {selectedClient &&
          createPortal(
            <div
              className="fixed inset-0 z-50 flex items-center justify-center p-4"
              role="dialog"
              aria-modal="true"
              aria-label={`${selectedClient.business_name} subscriptions`}
              onClick={() => setSelectedClientId(null)}
            >
              <div className="absolute inset-0 bg-black/50" aria-hidden="true" />
              <div
                className="relative z-10 max-h-[85vh] w-full max-w-[520px] overflow-y-auto rounded-xl border border-divider bg-surface shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              >
            <div className="flex items-start justify-between border-b border-divider px-4 py-3">
              <div className="min-w-0">
                <h3 className="truncate text-sm font-semibold text-foreground">
                  {selectedClient.business_name}
                </h3>
                <p className="text-xs text-foreground-muted">
                  {periodLabel} · {currencyLabel(selectedClient.currency)}
                </p>
              </div>
              <button
                onClick={() => setSelectedClientId(null)}
                className="rounded-md p-1 text-foreground-dim hover:bg-canvas hover:text-foreground"
                aria-label="Close drill-in"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Totals for the period */}
            <div className="grid grid-cols-3 gap-3 border-b border-divider px-4 py-3">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-foreground-dim">Revenue</p>
                <p className="mt-0.5 text-sm font-semibold text-foreground">
                  {formatMoney(selectedClient.revenue, selectedClient.currency)}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-foreground-dim">Partner Cost</p>
                <p className="mt-0.5 text-sm font-semibold text-foreground">
                  {formatMoney(selectedClient.partner_cost, selectedClient.currency)}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-foreground-dim">Profit</p>
                <p
                  className={`mt-0.5 text-sm font-semibold ${
                    selectedClient.gross_profit >= 0 ? 'text-[#16A34A]' : 'text-[#DC2626]'
                  }`}
                >
                  {formatMoney(selectedClient.gross_profit, selectedClient.currency)}
                </p>
              </div>
            </div>

            {/* Per-subscription lines active in the period */}
            <div className="px-4 py-3">
              <h4 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-foreground-dim">
                Subscriptions active in {periodLabel} ({selectedClient.lines.length})
              </h4>
              <div className="space-y-2">
                {selectedClient.lines.map((s) => (
                  <div
                    key={s.term_id}
                    className="rounded-md border border-divider bg-surface-alt p-3"
                  >
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">
                          {s.role || s.subscription_name || 'Subscription'}
                        </p>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium ${statusBadge(s.status).cls}`}>
                            {statusBadge(s.status).label}
                          </span>
                          {s.plan && (
                            <span className="rounded-md bg-surface px-1.5 py-0.5 text-[10px] font-medium text-foreground-muted ring-1 ring-divider">
                              {s.plan}
                            </span>
                          )}
                          {s.tier && (
                            <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium ${tierBadge(s.tier)}`}>
                              {s.tier}
                            </span>
                          )}
                          {!s.finalized && (
                            <span
                              title="Estimated from card/catalog pricing — this engagement isn't finalized"
                              className="rounded-md bg-[#FFFBEB] px-1.5 py-0.5 text-[10px] font-medium text-[#A16207] ring-1 ring-[#FCD34D]"
                            >
                              Estimated
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <p className="mb-2 text-[11px] text-foreground-muted">
                      {s.talent ? <span className="text-foreground">{s.talent}</span> : 'Unassigned'}
                      <span className="text-foreground-dim"> · {dateRange(s.work_start, s.work_end)}</span>
                      <span className="text-foreground-dim">
                        {' '}· {s.active_days} day{s.active_days === 1 ? '' : 's'} in {periodLabel}
                      </span>
                    </p>

                    <div className="grid grid-cols-3 gap-2 text-xs">
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-foreground-dim">Revenue</p>
                        <p className="mt-0.5 font-medium text-foreground">
                          {s.missing_revenue ? (
                            <span className="text-amber-600">not set</span>
                          ) : (
                            formatMoney(s.revenue, selectedClient.currency)
                          )}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-foreground-dim">Partner</p>
                        <p className="mt-0.5 font-medium text-foreground">
                          {s.missing_partner_price ? (
                            <span className="text-amber-600">not set</span>
                          ) : (
                            formatMoney(s.partner_cost, selectedClient.currency)
                          )}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-foreground-dim">Profit</p>
                        <p
                          className={`mt-0.5 font-semibold ${
                            s.gross_profit >= 0 ? 'text-[#16A34A]' : 'text-[#DC2626]'
                          }`}
                        >
                          {formatMoney(s.gross_profit, selectedClient.currency)}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
              </div>
            </div>,
            document.body,
          )}
    </div>
  );
}
