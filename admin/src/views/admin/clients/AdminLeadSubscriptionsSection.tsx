import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../../services/api';
import type {
  ClientSubmissionSubscription,
  Country,
  Subscription,
  SubscriptionPlan,
  SubscriptionPlanDeliverable,
  SubscriptionPlanRow,
  SubscriptionTier,
} from '@squadhub/shared';
import { formatPrice, formatDeliverableCadence } from '@squadhub/shared';
import ConfirmRemoveDialog from '../../../components/ConfirmRemoveDialog';

const PLAN_ORDER: SubscriptionPlan[] = ['Starter', 'Basic', 'Plus', 'Pro', 'Personal'];
const TIERS: SubscriptionTier[] = ['Junior', 'Pro', 'Top Talents'];

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
  const [confirmRowId, setConfirmRowId] = useState<string | null>(null);

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
    onSuccess: () => {
      invalidate();
      setConfirmRowId(null);
    },
    onError: (err: any) => alert(err?.response?.data?.error || err.message || 'Failed to remove'),
  });

  const rowBeingConfirmed = selected.find((r) => r.id === confirmRowId) || null;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-foreground-dim">Selected Subscriptions</h4>
        {!disabled && (
          <button
            type="button"
            onClick={() => setAddOpen((v) => !v)}
            className="text-xs font-medium text-accent hover:underline"
          >
            {addOpen ? 'Close' : '+ Add subscription'}
          </button>
        )}
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-foreground-muted">Billing Country</label>
        <select
          value={country?.id || ''}
          onChange={(e) => countryMutation.mutate(e.target.value)}
          disabled={disabled || countryMutation.isPending}
          className="w-full rounded-md border border-divider bg-surface px-2 py-1.5 text-sm text-foreground disabled:opacity-60"
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
        <p className="py-3 text-center text-xs text-foreground-dim">
          {disabled ? 'No subscriptions selected.' : 'No subscriptions selected yet.'}
        </p>
      ) : (
        <ul className="divide-y divide-[#F1F5F9] rounded-lg border border-divider bg-surface">
          {selected.map((row) => (
            <SelectedSubscriptionRow
              key={row.id}
              row={row}
              countryId={country?.id || null}
              countryName={country?.name || null}
              canRemove={!disabled}
              onRemove={() => setConfirmRowId(row.id)}
              removing={deleteMutation.isPending && confirmRowId === row.id}
            />
          ))}
        </ul>
      )}

      <ConfirmRemoveDialog
        open={!!rowBeingConfirmed}
        title="Remove subscription"
        description={rowBeingConfirmed
          ? `${rowBeingConfirmed.subscription?.name || 'Subscription'} · ${rowBeingConfirmed.plan?.plan || ''} · ${rowBeingConfirmed.plan?.tier || ''} will be removed from this contact.`
          : ''}
        loading={deleteMutation.isPending}
        onClose={() => setConfirmRowId(null)}
        onConfirm={() => rowBeingConfirmed && deleteMutation.mutate(rowBeingConfirmed.id)}
      />
    </div>
  );
}

function SelectedSubscriptionRow({
  row, countryId, countryName, canRemove, onRemove, removing,
}: {
  row: ClientSubmissionSubscription;
  countryId: string | null;
  countryName: string | null;
  canRemove: boolean;
  onRemove: () => void;
  removing: boolean;
}) {
  const plan = row.plan || null;
  const pricing = (plan?.pricing || []).find((pr) => pr.country_id === countryId);
  const priceLabel = pricing
    ? `${formatPrice(pricing.price, pricing.country?.currency || 'INR')}/mo`
    : null;
  const deliverables = plan?.deliverables || [];

  return (
    <li className="px-3 py-2.5 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <p className="font-medium text-foreground">{row.subscription?.name || '—'}</p>
            <p className="text-xs text-foreground-muted">
              {plan ? `${plan.plan} · ${plan.tier}` : '—'}
            </p>
            {priceLabel ? (
              <p className="text-xs font-medium text-foreground">{priceLabel}</p>
            ) : (
              <p className="text-xs text-foreground-dim">
                — no price set{countryName ? ` for ${countryName}` : ''}
              </p>
            )}
          </div>

          {deliverables.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {deliverables.map((d) => <DeliverableChip key={d.id} deliverable={d} />)}
            </div>
          )}
        </div>
        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            disabled={removing}
            className="shrink-0 rounded-md px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
          >
            Remove
          </button>
        )}
      </div>
    </li>
  );
}

function DeliverableChip({ deliverable }: { deliverable: SubscriptionPlanDeliverable }) {
  const label = deliverable.kind === 'hours'
    ? 'Hours'
    : (deliverable.deliverable_type?.name || 'Item');
  const badgeClass = deliverable.kind === 'hours'
    ? 'bg-indigo-100 text-indigo-700'
    : 'bg-purple-100 text-purple-700';
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md bg-canvas px-2 py-0.5 text-[11px] text-foreground">
      <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${badgeClass}`}>{label}</span>
      <span className="text-foreground-muted">
        {formatDeliverableCadence(
          deliverable.per_day,
          deliverable.per_week,
          deliverable.per_month,
          deliverable.kind === 'hours' ? 'hrs' : (deliverable.deliverable_type?.name || 'items'),
        )}
      </span>
    </span>
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

  const activeSubs = useMemo(() => catalog.filter((s) => s.is_active), [catalog]);
  const selectedSub = catalog.find((s) => s.id === subscriptionId) || null;

  // Include taken plans (disabled) so users can see what's been added.
  const sortedPlans: SubscriptionPlanRow[] = useMemo(() => {
    if (!selectedSub || !country) return [];
    return (selectedSub.plans || [])
      .filter((p) =>
        p.is_active
        && (p.pricing || []).some((pr) => pr.country_id === country.id),
      )
      .sort((a, b) => PLAN_ORDER.indexOf(a.plan) - PLAN_ORDER.indexOf(b.plan));
  }, [selectedSub, country]);

  return (
    <div className="space-y-2 rounded-lg border border-divider bg-surface-alt p-3">
      <div>
        <label className="mb-1 block text-xs font-medium text-foreground-muted">Subscription</label>
        <select
          value={subscriptionId}
          onChange={(e) => { setSubscriptionId(e.target.value); setPlanId(''); }}
          className="w-full rounded-md border border-divider bg-surface px-2 py-1.5 text-sm text-foreground"
        >
          <option value="">Select subscription…</option>
          {activeSubs.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          {activeSubs.length === 0 && <option value="" disabled>No subscriptions available</option>}
        </select>
      </div>

      {selectedSub && (
        <div>
          <label className="mb-1 block text-xs font-medium text-foreground-muted">
            Plan {country ? `(${country.currency} for ${country.name})` : ''}
          </label>
          {!country ? (
            <p className="rounded-md bg-surface px-2 py-1.5 text-xs text-foreground-dim">Contact has no country.</p>
          ) : sortedPlans.length === 0 ? (
            <p className="rounded-md bg-surface px-2 py-1.5 text-xs text-foreground-dim">
              No plans priced for {country.name}.
            </p>
          ) : (
            <select
              value={planId}
              onChange={(e) => setPlanId(e.target.value)}
              className="w-full rounded-md border border-divider bg-surface px-2 py-1.5 text-sm text-foreground"
            >
              <option value="">Select plan…</option>
              {TIERS.map((tier) => {
                const inTier = sortedPlans.filter((p) => p.tier === tier);
                if (inTier.length === 0) return null;
                return (
                  <optgroup key={tier} label={tier}>
                    {inTier.map((p) => {
                      const price = (p.pricing || []).find((pr) => pr.country_id === country?.id)?.price ?? 0;
                      const priceLabel = `${formatPrice(price, country?.currency || 'INR')}/mo`;
                      return (
                        <option key={p.id} value={p.id}>
                          {p.plan} — {priceLabel}
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
        className="w-full rounded-md bg-ink px-3 py-2 text-xs font-medium text-white hover:bg-ink-hover disabled:opacity-50"
      >
        {addMutation.isPending ? 'Adding…' : 'Add subscription'}
      </button>
    </div>
  );
}
