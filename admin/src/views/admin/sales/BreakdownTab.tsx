'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../../../services/api';
import {
  Period,
  PeriodQuery,
  formatMoney,
  periodQueryString,
  ratioCell,
} from './shared';

type Dimension = 'product' | 'squad' | 'category' | 'source';

type BreakdownRow = {
  group_key: string;
  leads_created: number;
  leads_to_deals: number;
  deals_converted: number;
  deals_closed: number;
  revenue_closed: number;
};

const DIMENSIONS: { key: Dimension; label: string }[] = [
  { key: 'product', label: 'Product' },
  { key: 'squad', label: 'Squad' },
  { key: 'category', label: 'Category' },
  { key: 'source', label: 'Source' },
];

/** Number + thin share-of-total distribution bar. */
function ShareCell({ value, share, barClass }: { value: string; share: number; barClass: string }) {
  return (
    <div className="flex flex-col items-end gap-1">
      <span>{value}</span>
      <div className="h-1 w-24 overflow-hidden rounded-full bg-canvas ring-1 ring-divider">
        <div className={`h-full rounded-full ${barClass}`} style={{ width: `${Math.min(share, 100)}%` }} />
      </div>
    </div>
  );
}

export default function BreakdownTab({
  periodQuery,
  enabled,
  fallbackLabel,
}: {
  periodQuery: PeriodQuery;
  enabled: boolean;
  fallbackLabel: string;
}) {
  const [dimension, setDimension] = useState<Dimension>('product');

  const { data: res, isLoading } = useQuery({
    queryKey: ['admin-sales-breakdown', dimension, periodQuery],
    queryFn: () =>
      api
        .get(`/admin/sales-dashboard/breakdown?dimension=${dimension}&${periodQueryString(periodQuery)}`)
        .then((r) => r.data),
    enabled,
  });

  const period: Period | null = res?.data?.period || null;
  const rows: BreakdownRow[] = res?.data?.rows || [];
  const periodLabel = period?.label || fallbackLabel;
  const totalLeads = rows.reduce((sum, r) => sum + r.leads_created, 0);
  const totalRevenue = rows.reduce((sum, r) => sum + r.revenue_closed, 0);
  const dimLabel = DIMENSIONS.find((d) => d.key === dimension)?.label || 'Group';

  if (!enabled) {
    return (
      <div className="rounded-lg border border-divider bg-surface py-12 text-center text-sm text-foreground-dim">
        Pick a start and end date to load the custom period.
      </div>
    );
  }

  return (
    <div>
      {/* Dimension chips */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {DIMENSIONS.map((d) => (
          <button
            key={d.key}
            onClick={() => setDimension(d.key)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              dimension === d.key
                ? 'bg-[#EEF2FF] text-accent'
                : 'border border-divider bg-surface text-foreground-muted hover:text-foreground'
            }`}
          >
            {d.label}
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-lg border border-divider bg-surface">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-divider bg-surface-alt">
              <th className="px-4 py-2.5 text-left font-medium text-foreground-muted">{dimLabel}</th>
              <th className="px-4 py-2.5 text-right font-medium text-foreground-muted">Leads</th>
              <th className="px-4 py-2.5 text-right font-medium text-foreground-muted">Lead → Deal</th>
              <th className="px-4 py-2.5 text-right font-medium text-foreground-muted">Converted</th>
              <th className="px-4 py-2.5 text-right font-medium text-foreground-muted">Closed</th>
              <th className="px-4 py-2.5 text-right font-medium text-foreground-muted">Revenue</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={6} className="py-12 text-center text-foreground-dim">
                  Loading…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-12 text-center text-foreground-dim">
                  No sales activity in {periodLabel}.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.group_key} className="border-b border-divider hover:bg-surface-alt">
                  <td className="px-4 py-2.5">
                    {r.group_key === '(unset)' ? (
                      <span className="italic text-foreground-dim">(unset)</span>
                    ) : (
                      <span className="font-medium text-foreground">{r.group_key}</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right text-foreground">
                    <ShareCell
                      value={String(r.leads_created)}
                      share={totalLeads > 0 ? (r.leads_created / totalLeads) * 100 : 0}
                      barClass="bg-[#818CF8]"
                    />
                  </td>
                  <td className="px-4 py-2.5 text-right text-foreground-muted">
                    {ratioCell(r.leads_to_deals, r.leads_created)}
                  </td>
                  <td className="px-4 py-2.5 text-right text-foreground-muted">{r.deals_converted}</td>
                  <td className="px-4 py-2.5 text-right text-foreground-muted">
                    {ratioCell(r.deals_closed, r.deals_converted)}
                  </td>
                  <td className="px-4 py-2.5 text-right font-semibold text-foreground">
                    <ShareCell
                      value={formatMoney(r.revenue_closed)}
                      share={totalRevenue > 0 ? (r.revenue_closed / totalRevenue) * 100 : 0}
                      barClass="bg-[#16A34A]"
                    />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
