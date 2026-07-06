'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import { showToast } from '@/components/Toast';

// Upgrade/downgrade an assigned module. Soft-cancels the current card and spins
// up a NEW card on the chosen plan in New Deals (carrying the details + former
// assignees + the linked space). The admin reviews/publishes it there and
// re-assigns on the new plan.

interface PlanOption {
  id: string;
  plan: string | null;
  tier: string | null;
  daily_hours: number | null;
  weekly_hours: number | null;
}

export default function UpgradeDowngradeModal({
  cardId,
  onClose,
}: {
  cardId: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [planId, setPlanId] = useState('');
  const [newPrice, setNewPrice] = useState('');
  const [error, setError] = useState<string | null>(null);

  const planOptionsQ = useQuery({
    queryKey: ['admin-card-plan-options', cardId],
    queryFn: () =>
      api
        .get(`/admin/subscription-cards/${cardId}/plan-options`)
        .then((r) => r.data?.data as { current_plan_id: string | null; plans: PlanOption[] }),
  });
  const plans = planOptionsQ.data?.plans ?? [];
  const currentPlanId = planOptionsQ.data?.current_plan_id ?? null;
  const planLabel = (p: PlanOption) => [p.plan, p.tier].filter(Boolean).join(' · ') || 'Plan';
  const currentPlanLabel = useMemo(() => {
    const cur = plans.find((p) => p.id === currentPlanId);
    return cur ? planLabel(cur) : null;
  }, [plans, currentPlanId]);

  const submit = useMutation({
    mutationFn: () =>
      api.post(`/admin/subscription-cards/${cardId}/upgrade-downgrade`, {
        plan_id: planId,
        ...(newPrice.trim() ? { subscription_price: Number(newPrice) } : {}),
      }),
    onSuccess: (r: any) => {
      const warning = r?.data?.warning as string | undefined;
      if (warning) showToast(warning, 'error');
      qc.invalidateQueries({ queryKey: ['admin-published-cards'] });
      qc.invalidateQueries({ queryKey: ['admin-card-recipients', cardId] });
      qc.invalidateQueries({ queryKey: ['admin-subscription-requests'] });
      qc.invalidateQueries({ queryKey: ['admin-internal-brief-submissions'] });
      if (!warning) showToast('Plan changed — the old card was soft-cancelled and a new one is waiting in New Deals.', 'success');
      onClose();
    },
    onError: (err: any) => setError(err?.response?.data?.error || err.message || 'Failed to change plan'),
  });

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative flex w-[480px] max-w-[95vw] flex-col overflow-hidden rounded-[16px] border border-[var(--color-sh-warm-border)] bg-[var(--color-sh-cream)] shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-[var(--color-sh-warm-border)] bg-surface px-5 py-4">
          <div className="space-y-1.5 min-w-0">
            <span className="sh-eyebrow"><span className="sh-eyebrow-dot" />Upgrade / downgrade</span>
            <h3 className="sh-display text-xl">Change the plan</h3>
          </div>
          <button onClick={onClose} aria-label="Close" className="shrink-0 rounded-md p-1 text-[var(--color-sh-ink-muted)] hover:bg-[var(--color-sh-cream)] hover:text-[var(--color-sh-ink)] transition">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="space-y-4 p-5">
          {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            This soft-cancels the current card and creates a <span className="font-semibold">new card in New Deals</span> on the chosen plan — carrying the same details, the linked space, and the previous assignees. Review pricing there, then publish &amp; re-assign (billing starts on the new plan when you do).
          </div>

          {currentPlanLabel && (
            <p className="text-xs text-[var(--color-sh-ink-muted)]">Current plan: <span className="font-semibold text-[var(--color-sh-ink)]">{currentPlanLabel}</span></p>
          )}

          <label className="block">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-sh-ink-faint)]">New plan</span>
            <select value={planId} onChange={(e) => setPlanId(e.target.value)} className="sh-input mt-1">
              <option value="">{planOptionsQ.isLoading ? 'Loading plans…' : 'Select a plan…'}</option>
              {plans.map((p) => (
                <option key={p.id} value={p.id} disabled={p.id === currentPlanId}>
                  {planLabel(p)}{p.daily_hours != null ? ` — ${p.daily_hours}h/day` : ''}{p.id === currentPlanId ? ' (current)' : ''}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-sh-ink-faint)]">New monthly price (optional)</span>
            <input type="number" value={newPrice} onChange={(e) => setNewPrice(e.target.value)} placeholder="Keep current price" className="sh-input mt-1" />
          </label>

          <button
            onClick={() => submit.mutate()}
            disabled={!planId || submit.isPending}
            className="sh-btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submit.isPending ? 'Applying…' : 'Upgrade / downgrade → New Deals'}
          </button>
        </div>
      </div>
    </div>
  );
}
