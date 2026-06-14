'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../../services/api';

type CurrencySummary = {
  currency: string;
  revenue: number;
  partner_cost: number;
  gross_profit: number;
  margin_pct: number;
  client_count: number;
};

type SubBreakdown = {
  client_subscription_id: string;
  status: string;
  subscription: { id: string; slug: string; name: string } | null;
  plan: { id: string; plan: string; tier: string } | null;
  customer_price: number;
  partner_price: number;
  gross_profit: number;
  missing_customer_price: boolean;
  missing_partner_price: boolean;
};

type ClientRow = {
  id: string;
  business_name: string;
  country: { id: string; name: string; currency: string };
  active_subscription_count: number;
  paused_subscription_count: number;
  monthly_revenue: number;
  monthly_partner_cost: number;
  gross_profit: number;
  margin_pct: number;
  has_missing_pricing: boolean;
  subscriptions: SubBreakdown[];
};

type AssignedPartner = {
  id: string;
  user_id: string;
  client_id: string;
  role: string | null;
  created_at: string;
  user: { id: string; email: string; display_name: string; avatar_url: string | null };
};

function formatMoney(cents: number, currency: string): string {
  const amount = (cents || 0) / 100;
  if (currency === 'INR') {
    return '₹' + amount.toLocaleString('en-IN', { maximumFractionDigits: 0 });
  }
  if (currency === 'USD') {
    return '$' + amount.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 0 });
  }
  return amount.toLocaleString();
}

function formatPct(pct: number): string {
  return pct.toFixed(1) + '%';
}

function tierBadge(tier: string | undefined): string {
  if (tier === 'Junior') return 'bg-canvas text-foreground-muted';
  if (tier === 'Pro') return 'bg-[#EEF2FF] text-[#4338CA]';
  if (tier === 'Elite' || tier === 'Top Talents') return 'bg-[#FEF3C7] text-[#A16207]';
  return 'bg-canvas text-foreground-muted';
}

export default function GrossProfitModule() {
  const [filters, setFilters] = useState({
    country_id: '',
    subscription_slug: '',
    include_paused: false,
  });
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);

  const queryParams = new URLSearchParams();
  if (filters.country_id) queryParams.set('country_id', filters.country_id);
  if (filters.subscription_slug) queryParams.set('subscription_slug', filters.subscription_slug);
  if (filters.include_paused) queryParams.set('include_paused', 'true');

  const { data: gpRes, isLoading } = useQuery({
    queryKey: ['admin-gross-profit', filters],
    queryFn: () =>
      api.get(`/admin/gross-profit/clients?${queryParams.toString()}`).then((r) => r.data),
  });

  const { data: countriesRes } = useQuery({
    queryKey: ['admin-countries'],
    queryFn: () => api.get('/admin/countries').then((r) => r.data),
  });

  const { data: partnersRes } = useQuery({
    queryKey: ['admin-partners-by-client', selectedClientId],
    queryFn: () =>
      api.get(`/admin/partners/by-client/${selectedClientId}`).then((r) => r.data),
    enabled: !!selectedClientId,
  });

  const summary: CurrencySummary[] = gpRes?.data?.summary_by_currency || [];
  const clients: ClientRow[] = gpRes?.data?.clients || [];
  const countries: Array<{ id: string; name: string; currency: string; is_active: boolean }> =
    countriesRes?.data || [];
  const assignedPartners: AssignedPartner[] = partnersRes?.data || [];

  const selectedClient = selectedClientId
    ? clients.find((c) => c.id === selectedClientId) || null
    : null;
  const anyMissing = clients.some((c) => c.has_missing_pricing);

  return (
    <div>
      {/* Header */}
      <div className="mb-5">
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-foreground">
          Gross Profit
        </h1>
        <p className="mt-1 text-sm text-foreground-muted">
          Monthly revenue, partner cost, and profit per client based on active subscription pricing.
        </p>
      </div>

      {/* Summary cards (one per currency) */}
      {summary.length > 0 && (
        <div className="mb-5 grid gap-3 sm:grid-cols-2">
          {summary.map((s) => (
            <div
              key={s.currency}
              className="rounded-lg border border-divider bg-surface p-4"
            >
              <div className="mb-3 flex items-center justify-between">
                <span className="font-[family-name:var(--font-mono)] rounded-md bg-[#EEF2FF] px-2 py-0.5 text-[11px] font-semibold text-accent">
                  {s.currency}
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
          value={filters.country_id}
          onChange={(e) => setFilters({ ...filters, country_id: e.target.value })}
          className="rounded-md border border-divider px-3 py-1.5 text-xs text-foreground"
        >
          <option value="">All Countries</option>
          {countries
            .filter((c) => c.is_active)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.currency})
              </option>
            ))}
        </select>
        <select
          value={filters.subscription_slug}
          onChange={(e) => setFilters({ ...filters, subscription_slug: e.target.value })}
          className="rounded-md border border-divider px-3 py-1.5 text-xs text-foreground"
        >
          <option value="">All Subscriptions</option>
          <option value="designer">Designer</option>
          <option value="video_editor">Video Editor</option>
        </select>
        <label className="flex items-center gap-1.5 rounded-md border border-divider bg-surface px-3 py-1.5 text-xs text-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={filters.include_paused}
            onChange={(e) => setFilters({ ...filters, include_paused: e.target.checked })}
            className="h-3.5 w-3.5"
          />
          Include paused
        </label>
      </div>

      {/* Missing pricing banner */}
      {anyMissing && (
        <div className="mb-3 flex items-start gap-2 rounded-md border border-[#FCD34D] bg-[#FFFBEB] px-3 py-2 text-xs text-[#A16207]">
          <svg className="mt-0.5 h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
          <span>
            Some clients are missing customer or partner pricing for their plan + country combination.
            Rows with missing pricing show an amber dot. Treat their numbers as incomplete.
          </span>
        </div>
      )}

      {/* Body: table + optional drill-in */}
      <div className="flex gap-4">
        {/* Clients table */}
        <div className="min-w-0 flex-1 overflow-hidden rounded-lg border border-divider bg-surface">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-divider bg-surface-alt">
                <th className="px-4 py-2.5 text-left font-medium text-foreground-muted">Client</th>
                <th className="px-4 py-2.5 text-left font-medium text-foreground-muted">Country</th>
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
                    Loading...
                  </td>
                </tr>
              ) : clients.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-foreground-dim">
                    No clients with active subscriptions match these filters.
                  </td>
                </tr>
              ) : (
                clients.map((c) => {
                  const isSelected = selectedClientId === c.id;
                  const subsLabel =
                    filters.include_paused && c.paused_subscription_count > 0
                      ? `${c.active_subscription_count} active · ${c.paused_subscription_count} paused`
                      : `${c.active_subscription_count}`;
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
                              title="Missing pricing for one or more subscriptions"
                              className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500"
                            />
                          )}
                          <span className="font-medium">{c.business_name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-foreground-muted">
                        {c.country.name || '—'}{' '}
                        <span className="text-foreground-dim">({c.country.currency || '—'})</span>
                      </td>
                      <td className="px-4 py-2.5 text-right text-foreground-muted">{subsLabel}</td>
                      <td className="px-4 py-2.5 text-right text-foreground">
                        {formatMoney(c.monthly_revenue, c.country.currency)}
                      </td>
                      <td className="px-4 py-2.5 text-right text-foreground">
                        {formatMoney(c.monthly_partner_cost, c.country.currency)}
                      </td>
                      <td
                        className={`px-4 py-2.5 text-right font-semibold ${
                          c.gross_profit >= 0 ? 'text-[#16A34A]' : 'text-[#DC2626]'
                        }`}
                      >
                        {formatMoney(c.gross_profit, c.country.currency)}
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

        {/* Drill-in panel */}
        {selectedClient && (
          <aside className="w-[420px] shrink-0 overflow-hidden rounded-lg border border-divider bg-surface">
            <div className="flex items-start justify-between border-b border-divider px-4 py-3">
              <div className="min-w-0">
                <h3 className="truncate text-sm font-semibold text-foreground">
                  {selectedClient.business_name}
                </h3>
                <p className="text-xs text-foreground-muted">
                  {selectedClient.country.name || '—'}{' '}
                  <span className="text-foreground-dim">
                    ({selectedClient.country.currency || '—'})
                  </span>
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

            {/* Per-subscription breakdown */}
            <div className="border-b border-divider px-4 py-3">
              <h4 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-foreground-dim">
                Subscriptions ({selectedClient.subscriptions.length})
              </h4>
              <div className="space-y-2">
                {selectedClient.subscriptions.map((s) => (
                  <div
                    key={s.client_subscription_id}
                    className="rounded-md border border-divider bg-surface-alt p-3"
                  >
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">
                          {s.subscription?.name || 'Unknown'}
                        </p>
                        <div className="mt-1 flex items-center gap-1.5">
                          <span className="rounded-md bg-surface px-1.5 py-0.5 text-[10px] font-medium text-foreground-muted ring-1 ring-divider">
                            {s.plan?.plan || '—'}
                          </span>
                          <span
                            className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium ${tierBadge(
                              s.plan?.tier,
                            )}`}
                          >
                            {s.plan?.tier || '—'}
                          </span>
                          {s.status === 'paused' && (
                            <span className="rounded-md bg-[#FEF9C3] px-1.5 py-0.5 text-[10px] font-medium text-[#A16207]">
                              Paused
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-foreground-dim">
                          Customer
                        </p>
                        <p className="mt-0.5 font-medium text-foreground">
                          {s.missing_customer_price ? (
                            <span className="text-amber-600">missing</span>
                          ) : (
                            formatMoney(s.customer_price, selectedClient.country.currency)
                          )}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-foreground-dim">
                          Partner
                        </p>
                        <p className="mt-0.5 font-medium text-foreground">
                          {s.missing_partner_price ? (
                            <span className="text-amber-600">missing</span>
                          ) : (
                            formatMoney(s.partner_price, selectedClient.country.currency)
                          )}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-foreground-dim">
                          Profit
                        </p>
                        <p
                          className={`mt-0.5 font-semibold ${
                            s.gross_profit >= 0 ? 'text-[#16A34A]' : 'text-[#DC2626]'
                          }`}
                        >
                          {formatMoney(s.gross_profit, selectedClient.country.currency)}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Assigned partners */}
            <div className="px-4 py-3">
              <h4 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-foreground-dim">
                Assigned Partners ({assignedPartners.length})
              </h4>
              {assignedPartners.length === 0 ? (
                <p className="text-xs text-foreground-dim">No partners assigned to this client.</p>
              ) : (
                <ul className="space-y-1.5">
                  {assignedPartners.map((a) => (
                    <li
                      key={a.id}
                      className="flex items-center justify-between gap-2 rounded-md bg-surface-alt px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-xs font-medium text-foreground">
                          {a.user.display_name || a.user.email}
                        </p>
                        <p className="truncate text-[11px] text-foreground-muted">{a.user.email}</p>
                      </div>
                      {a.role && (
                        <span className="shrink-0 rounded-md bg-surface px-2 py-0.5 text-[10px] font-medium text-foreground-muted ring-1 ring-divider">
                          {a.role}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
