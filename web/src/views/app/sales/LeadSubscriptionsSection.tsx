import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../../services/api';
import type {
  ClientSubmissionSubscription,
  Country,
  Subscription,
  SubscriptionPlan,
  SubscriptionPlanRow,
  SubscriptionTier,
} from '@squadhub/shared';

const PLAN_ORDER: SubscriptionPlan[] = ['Starter', 'Basic', 'Plus', 'Pro', 'Personal'];
const TIERS: SubscriptionTier[] = ['Junior', 'Pro', 'Elite'];

type Props = {
  leadId: string;
  countryId: string | null;
  selected: ClientSubmissionSubscription[];
  disabled?: boolean;
};

export default function LeadSubscriptionsSection({ leadId, countryId, selected, disabled }: Props) {
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);

  const { data: countriesRes } = useQuery({
    queryKey: ['public-countries'],
    queryFn: () => api.get('/clients/countries').then((r) => r.data),
  });
  const countries: Country[] = countriesRes?.data || [];

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['sales-leads'] });
  };

  const countryMutation = useMutation({
    mutationFn: (country_id: string) =>
      api.patch(`/onboarding-links/leads/${leadId}/country`, { country_id }),
    onSuccess: invalidate,
    onError: (err: any) => alert(err?.response?.data?.error || err.message || 'Failed to update country'),
  });

  const deleteMutation = useMutation({
    mutationFn: (rowId: string) => api.delete(`/onboarding-links/leads/${leadId}/subscriptions/${rowId}`),
    onSuccess: invalidate,
    onError: (err: any) => alert(err?.response?.data?.error || err.message || 'Failed to remove'),
  });

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--sh-ink-4)]">
          Selected Subscriptions
        </h4>
        {!disabled && (
          <button
            type="button"
            onClick={() => setAddOpen((v) => !v)}
            className="text-xs font-medium text-[var(--sh-ink)] hover:underline"
          >
            {addOpen ? 'Close' : '+ Add subscription'}
          </button>
        )}
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-[var(--sh-ink-3)]">Billing Country</label>
        <select
          value={countryId || ''}
          onChange={(e) => countryMutation.mutate(e.target.value)}
          disabled={disabled || countryMutation.isPending}
          className="w-full rounded-md border border-[var(--sh-hair)] bg-[var(--surface)] px-2 py-1.5 text-sm text-[var(--sh-ink)] disabled:opacity-60"
        >
          {!countryId && <option value="">Select a country</option>}
          {countries.map((c) => (
            <option key={c.id} value={c.id}>{c.name} ({c.currency})</option>
          ))}
        </select>
      </div>

      {addOpen && !disabled && (
        <AddSubscriptionInline
          leadId={leadId}
          countryId={countryId}
          alreadySelected={selected}
          onDone={() => {
            setAddOpen(false);
            invalidate();
          }}
        />
      )}

      {selected.length === 0 ? (
        <p className="py-3 text-center text-xs text-[var(--sh-ink-4)]">
          {disabled ? 'No subscriptions selected.' : 'No subscriptions selected yet.'}
        </p>
      ) : (
        <ul className="divide-y divide-[var(--sh-hair)] rounded-lg border border-[var(--sh-hair)]">
          {selected.map((row) => (
            <li key={row.id} className="flex items-center justify-between px-3 py-2 text-sm">
              <div>
                <p className="font-medium text-[var(--sh-ink)]">{row.subscription?.name || '—'}</p>
                <p className="text-xs text-[var(--sh-ink-3)]">
                  {row.plan ? `${row.plan.plan} · ${row.plan.tier}` : '—'}
                </p>
              </div>
              {!disabled && (
                <button
                  type="button"
                  onClick={() => deleteMutation.mutate(row.id)}
                  disabled={deleteMutation.isPending}
                  className="rounded-md px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
                  aria-label="Remove"
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AddSubscriptionInline({
  leadId, countryId, alreadySelected, onDone,
}: {
  leadId: string;
  countryId: string | null;
  alreadySelected: ClientSubmissionSubscription[];
  onDone: () => void;
}) {
  const [subscriptionId, setSubscriptionId] = useState<string>('');
  const [planId, setPlanId] = useState<string>('');

  const { data: catalogRes } = useQuery({
    queryKey: ['sales-subs-catalog', countryId],
    queryFn: () =>
      api
        .get('/onboarding-links/subscriptions', { params: countryId ? { country_id: countryId } : {} })
        .then((r) => r.data),
  });
  const catalog: Subscription[] = catalogRes?.data || [];

  const addMutation = useMutation({
    mutationFn: (payload: { subscription_id: string; plan_id: string }) =>
      api.post(`/onboarding-links/leads/${leadId}/subscriptions`, payload),
    onSuccess: () => onDone(),
    onError: (err: any) => alert(err?.response?.data?.error || err.message || 'Failed to add'),
  });

  const takenPlanIds = new Set(alreadySelected.map((s) => s.plan_id));

  const selectedSub = catalog.find((s) => s.id === subscriptionId) || null;
  const availablePlans: SubscriptionPlanRow[] = useMemo(() => {
    if (!selectedSub) return [];
    return (selectedSub.plans || [])
      .filter((p) => p.is_active && !takenPlanIds.has(p.id))
      .sort((a, b) => PLAN_ORDER.indexOf(a.plan) - PLAN_ORDER.indexOf(b.plan));
  }, [selectedSub, alreadySelected]);

  return (
    <div className="space-y-2 rounded-lg border border-[var(--sh-hair)] bg-[var(--sh-hair-3)] p-3">
      <div>
        <label className="mb-1 block text-xs font-medium text-[var(--sh-ink-3)]">Subscription</label>
        <select
          value={subscriptionId}
          onChange={(e) => { setSubscriptionId(e.target.value); setPlanId(''); }}
          className="w-full rounded-md border border-[var(--sh-hair)] bg-[var(--surface)] px-2 py-1.5 text-sm text-[var(--sh-ink)]"
        >
          <option value="">Select subscription…</option>
          {catalog.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          {catalog.length === 0 && <option value="" disabled>No subscriptions available</option>}
        </select>
      </div>

      {selectedSub && (
        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--sh-ink-3)]">Plan</label>
          {availablePlans.length === 0 ? (
            <p className="rounded-md bg-[var(--surface)] px-2 py-1.5 text-xs text-[var(--sh-ink-4)]">
              No plans available for this country.
            </p>
          ) : (
            <select
              value={planId}
              onChange={(e) => setPlanId(e.target.value)}
              className="w-full rounded-md border border-[var(--sh-hair)] bg-[var(--surface)] px-2 py-1.5 text-sm text-[var(--sh-ink)]"
            >
              <option value="">Select plan…</option>
              {TIERS.map((tier) => {
                const inTier = availablePlans.filter((p) => p.tier === tier);
                if (inTier.length === 0) return null;
                return (
                  <optgroup key={tier} label={tier}>
                    {inTier.map((p) => {
                      const pr = (p.pricing || [])[0];
                      const price = pr?.price ?? 0;
                      const sym = pr?.country?.currency === 'USD' ? '$' : '\u20B9';
                      return (
                        <option key={p.id} value={p.id}>
                          {p.plan} — {sym}{price.toLocaleString()}/mo
                        </option>
                      );
                    })}
                  </optgroup>
                );
              })}
            </select>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={() => planId && addMutation.mutate({ subscription_id: subscriptionId, plan_id: planId })}
        disabled={!planId || addMutation.isPending}
        className="w-full rounded-md bg-[var(--sh-ink)] px-3 py-2 text-xs font-medium text-white transition hover:opacity-90 disabled:opacity-50"
      >
        {addMutation.isPending ? 'Adding…' : 'Add subscription'}
      </button>
    </div>
  );
}
