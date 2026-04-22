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
  submissionId: string;
  country: Country | null;
  countries: Country[];
  selected: ClientSubmissionSubscription[];
  disabled?: boolean;
};

export default function AdminLeadSubscriptionsSection({ submissionId, country, countries, selected, disabled }: Props) {
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['admin-submissions'] });
  };

  const countryMutation = useMutation({
    mutationFn: (country_id: string) =>
      api.patch(`/admin/clients/submissions/${submissionId}/country`, { country_id }),
    onSuccess: invalidate,
    onError: (err: any) => alert(err?.response?.data?.error || err.message || 'Failed to update country'),
  });

  const deleteMutation = useMutation({
    mutationFn: (rowId: string) =>
      api.delete(`/admin/clients/submissions/${submissionId}/subscriptions/${rowId}`),
    onSuccess: invalidate,
    onError: (err: any) => alert(err?.response?.data?.error || err.message || 'Failed to remove'),
  });

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-[#90A1B9]">Selected Subscriptions</h4>
        {!disabled && (
          <button
            type="button"
            onClick={() => setAddOpen((v) => !v)}
            className="text-xs font-medium text-[#2962FF] hover:underline"
          >
            {addOpen ? 'Close' : '+ Add subscription'}
          </button>
        )}
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-[#62748E]">Billing Country</label>
        <select
          value={country?.id || ''}
          onChange={(e) => countryMutation.mutate(e.target.value)}
          disabled={disabled || countryMutation.isPending}
          className="w-full rounded-md border border-[#E2E8F0] bg-white px-2 py-1.5 text-sm text-[#0F172B] disabled:opacity-60"
        >
          {!country && <option value="">Select a country</option>}
          {countries.map((c) => (
            <option key={c.id} value={c.id}>{c.name} ({c.currency})</option>
          ))}
        </select>
      </div>

      {addOpen && !disabled && (
        <AddSubscriptionInline
          submissionId={submissionId}
          country={country}
          alreadySelected={selected}
          onDone={() => {
            setAddOpen(false);
            invalidate();
          }}
        />
      )}

      {selected.length === 0 ? (
        <p className="py-3 text-center text-xs text-[#90A1B9]">
          {disabled ? 'No subscriptions selected.' : 'No subscriptions selected yet.'}
        </p>
      ) : (
        <ul className="divide-y divide-[#F1F5F9] rounded-lg border border-[#E2E8F0] bg-white">
          {selected.map((row) => (
            <li key={row.id} className="flex items-center justify-between px-3 py-2 text-sm">
              <div>
                <p className="font-medium text-[#0F172B]">{row.subscription?.name || '—'}</p>
                <p className="text-xs text-[#62748E]">
                  {row.plan ? `${row.plan.plan} · ${row.plan.tier}` : '—'}
                </p>
              </div>
              {!disabled && (
                <button
                  type="button"
                  onClick={() => deleteMutation.mutate(row.id)}
                  disabled={deleteMutation.isPending}
                  className="rounded-md px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
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
  submissionId, country, alreadySelected, onDone,
}: {
  submissionId: string;
  country: Country | null;
  alreadySelected: ClientSubmissionSubscription[];
  onDone: () => void;
}) {
  const [subscriptionId, setSubscriptionId] = useState<string>('');
  const [planId, setPlanId] = useState<string>('');

  const { data: catalogRes } = useQuery({
    queryKey: ['admin-subs-catalog'],
    queryFn: () => api.get('/admin/subscriptions').then((r) => r.data),
  });
  const catalog: Subscription[] = catalogRes?.data || [];

  const addMutation = useMutation({
    mutationFn: (payload: { subscription_id: string; plan_id: string }) =>
      api.post(`/admin/clients/submissions/${submissionId}/subscriptions`, payload),
    onSuccess: () => onDone(),
    onError: (err: any) => alert(err?.response?.data?.error || err.message || 'Failed to add'),
  });

  const takenPlanIds = new Set(alreadySelected.map((s) => s.plan_id));

  const activeSubs = useMemo(() => catalog.filter((s) => s.is_active), [catalog]);
  const selectedSub = catalog.find((s) => s.id === subscriptionId) || null;

  const availablePlans: SubscriptionPlanRow[] = useMemo(() => {
    if (!selectedSub || !country) return [];
    return (selectedSub.plans || [])
      .filter((p) =>
        p.is_active
        && !takenPlanIds.has(p.id)
        && (p.pricing || []).some((pr) => pr.country_id === country.id),
      )
      .sort((a, b) => PLAN_ORDER.indexOf(a.plan) - PLAN_ORDER.indexOf(b.plan));
  }, [selectedSub, country, alreadySelected]);

  const sym = country?.currency === 'USD' ? '$' : '\u20B9';
  const locale = country?.currency === 'USD' ? 'en-US' : 'en-IN';

  return (
    <div className="space-y-2 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-3">
      <div>
        <label className="mb-1 block text-xs font-medium text-[#62748E]">Subscription</label>
        <select
          value={subscriptionId}
          onChange={(e) => { setSubscriptionId(e.target.value); setPlanId(''); }}
          className="w-full rounded-md border border-[#E2E8F0] bg-white px-2 py-1.5 text-sm text-[#0F172B]"
        >
          <option value="">Select subscription…</option>
          {activeSubs.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          {activeSubs.length === 0 && <option value="" disabled>No subscriptions available</option>}
        </select>
      </div>

      {selectedSub && (
        <div>
          <label className="mb-1 block text-xs font-medium text-[#62748E]">
            Plan {country ? `(${country.currency} for ${country.name})` : ''}
          </label>
          {!country ? (
            <p className="rounded-md bg-white px-2 py-1.5 text-xs text-[#90A1B9]">Lead has no country.</p>
          ) : availablePlans.length === 0 ? (
            <p className="rounded-md bg-white px-2 py-1.5 text-xs text-[#90A1B9]">
              No plans priced for {country.name}.
            </p>
          ) : (
            <select
              value={planId}
              onChange={(e) => setPlanId(e.target.value)}
              className="w-full rounded-md border border-[#E2E8F0] bg-white px-2 py-1.5 text-sm text-[#0F172B]"
            >
              <option value="">Select plan…</option>
              {TIERS.map((tier) => {
                const inTier = availablePlans.filter((p) => p.tier === tier);
                if (inTier.length === 0) return null;
                return (
                  <optgroup key={tier} label={tier}>
                    {inTier.map((p) => {
                      const price = (p.pricing || []).find((pr) => pr.country_id === country?.id)?.price ?? 0;
                      return (
                        <option key={p.id} value={p.id}>
                          {p.plan} — {sym}{price.toLocaleString(locale)}/mo
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
        className="w-full rounded-md bg-[#0F172B] px-3 py-2 text-xs font-medium text-white hover:bg-[#1E293B] disabled:opacity-50"
      >
        {addMutation.isPending ? 'Adding…' : 'Add subscription'}
      </button>
    </div>
  );
}
