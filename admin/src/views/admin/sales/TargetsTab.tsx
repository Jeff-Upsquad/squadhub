'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../../services/api';
import {
  METRIC_KEYS,
  METRIC_LABELS,
  MetricKey,
  UserLite,
  displayName,
} from './shared';

type TeamMember = { id: string; user_id: string; created_at: string; user: UserLite | null };
type TargetRow = {
  user_id: string;
  metric: MetricKey;
  period_type: 'weekly' | 'monthly';
  target_value: number;
  effective_from: string;
};

export default function TargetsTab() {
  const queryClient = useQueryClient();
  const [periodType, setPeriodType] = useState<'weekly' | 'monthly'>('weekly');
  // Draft inputs keyed `${user_id}|${metric}`; absent key = untouched.
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const { data: teamRes, isLoading: teamLoading } = useQuery({
    queryKey: ['admin-sales-team'],
    queryFn: () => api.get('/admin/sales-dashboard/team').then((r) => r.data),
  });
  const { data: targetsRes, isLoading: targetsLoading } = useQuery({
    queryKey: ['admin-sales-targets', periodType],
    queryFn: () =>
      api.get(`/admin/sales-dashboard/targets?period_type=${periodType}`).then((r) => r.data),
  });

  const members: TeamMember[] = teamRes?.data || [];
  const targetRows: TargetRow[] = targetsRes?.data || [];
  const isLoading = teamLoading || targetsLoading;

  const serverValue = (userId: string, metric: MetricKey): number | null => {
    const row = targetRows.find((t) => t.user_id === userId && t.metric === metric);
    return row ? row.target_value : null;
  };

  const cellKey = (userId: string, metric: MetricKey) => `${userId}|${metric}`;

  const inputValue = (userId: string, metric: MetricKey): string => {
    const key = cellKey(userId, metric);
    if (key in edits) return edits[key];
    const sv = serverValue(userId, metric);
    return sv === null ? '' : String(sv);
  };

  /** Metrics whose draft differs from the saved value. */
  const dirtyMetrics = (userId: string): Partial<Record<MetricKey, number>> => {
    const out: Partial<Record<MetricKey, number>> = {};
    for (const metric of METRIC_KEYS) {
      const key = cellKey(userId, metric);
      if (!(key in edits)) continue;
      const raw = edits[key].trim();
      if (raw === '') continue; // blank = leave as-is (no way to delete a target)
      const parsed = Number(raw);
      if (!Number.isFinite(parsed) || parsed < 0) continue;
      if (parsed !== serverValue(userId, metric)) out[metric] = parsed;
    }
    return out;
  };

  const saveMutation = useMutation({
    mutationFn: (payload: {
      user_id: string;
      period_type: 'weekly' | 'monthly';
      targets: Partial<Record<MetricKey, number>>;
    }) => api.put('/admin/sales-dashboard/targets', payload),
    onSuccess: (_res, vars) => {
      setEdits((prev) => {
        const next = { ...prev };
        METRIC_KEYS.forEach((m) => delete next[cellKey(vars.user_id, m)]);
        return next;
      });
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['admin-sales-targets'] });
      queryClient.invalidateQueries({ queryKey: ['admin-sales-summary'] });
      queryClient.invalidateQueries({ queryKey: ['admin-sales-member'] });
    },
    onError: (err: any) => {
      setError(err?.response?.data?.error || 'Failed to save targets');
    },
  });

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-lg border border-divider bg-surface p-0.5">
          {(['weekly', 'monthly'] as const).map((t) => (
            <button
              key={t}
              onClick={() => {
                setPeriodType(t);
                setEdits({}); // drafts are per weekly/monthly grid
              }}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                periodType === t
                  ? 'bg-[#EEF2FF] text-accent'
                  : 'text-foreground-muted hover:text-foreground'
              }`}
            >
              {t === 'weekly' ? 'Weekly' : 'Monthly'}
            </button>
          ))}
        </div>
        <p className="text-xs text-foreground-muted">
          Targets take effect from the current {periodType === 'weekly' ? 'week' : 'month'} onward —
          past periods keep the targets they had.
        </p>
      </div>

      {error && (
        <div className="mb-3 rounded-md border border-[#FCA5A5] bg-[#FEF2F2] px-3 py-2 text-xs text-[#B91C1C]">
          {error}
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-divider bg-surface">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-divider bg-surface-alt">
              <th className="px-4 py-2.5 text-left font-medium text-foreground-muted">Member</th>
              {METRIC_KEYS.map((m) => (
                <th key={m} className="px-3 py-2.5 text-right font-medium text-foreground-muted">
                  {METRIC_LABELS[m]}
                  {m === 'revenue' && <span className="ml-1 font-normal text-foreground-dim">(₹)</span>}
                </th>
              ))}
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={7} className="py-12 text-center text-foreground-dim">
                  Loading…
                </td>
              </tr>
            ) : members.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-12 text-center text-foreground-dim">
                  No one is on the sales team yet — add members in the Team tab.
                </td>
              </tr>
            ) : (
              members.map((m) => {
                const dirty = dirtyMetrics(m.user_id);
                const isDirty = Object.keys(dirty).length > 0;
                return (
                  <tr key={m.user_id} className="border-b border-divider">
                    <td className="px-4 py-2.5">
                      <span className="font-medium text-foreground">{displayName(m.user)}</span>
                    </td>
                    {METRIC_KEYS.map((metric) => (
                      <td key={metric} className="px-3 py-2 text-right">
                        <input
                          type="number"
                          min={0}
                          value={inputValue(m.user_id, metric)}
                          placeholder="—"
                          onChange={(e) =>
                            setEdits((prev) => ({
                              ...prev,
                              [cellKey(m.user_id, metric)]: e.target.value,
                            }))
                          }
                          className="w-24 rounded-md border border-divider bg-surface px-2 py-1 text-right text-xs text-foreground"
                        />
                      </td>
                    ))}
                    <td className="px-4 py-2 text-right">
                      {isDirty && (
                        <button
                          onClick={() =>
                            saveMutation.mutate({
                              user_id: m.user_id,
                              period_type: periodType,
                              targets: dirty,
                            })
                          }
                          disabled={saveMutation.isPending}
                          className="rounded-md bg-ink px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                        >
                          {saveMutation.isPending ? 'Saving…' : 'Save'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
