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
import { formatPrice } from '@squadhub/shared';
import ConfirmRemoveDialog from '../../../components/ConfirmRemoveDialog';
import SubscriptionCardDrawer from './SubscriptionCardDrawer';

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
  const [confirmRowId, setConfirmRowId] = useState<string | null>(null);
  const [openCardSubId, setOpenCardSubId] = useState<string | null>(null);

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
    onSuccess: () => {
      invalidate();
      setConfirmRowId(null);
    },
    onError: (err: any) => alert(err?.response?.data?.error || err.message || 'Failed to remove'),
  });

  const rowBeingConfirmed = selected.find((r) => r.id === confirmRowId) || null;
  const activeCountry = countries.find((c) => c.id === countryId) || null;

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
            <SelectedSubscriptionRow
              key={row.id}
              row={row}
              countryId={countryId}
              countryName={activeCountry?.name || null}
              canRemove={!disabled}
              onRemove={() => setConfirmRowId(row.id)}
              onOpenCard={() => setOpenCardSubId(row.id)}
              removing={deleteMutation.isPending && confirmRowId === row.id}
            />
          ))}
        </ul>
      )}

      <ConfirmRemoveDialog
        open={!!rowBeingConfirmed}
        title="Remove subscription"
        description={rowBeingConfirmed
          ? `${rowBeingConfirmed.subscription?.name || 'Subscription'} · ${rowBeingConfirmed.plan?.plan || ''} · ${rowBeingConfirmed.plan?.tier || ''} will be removed from this lead.`
          : ''}
        loading={deleteMutation.isPending}
        onClose={() => setConfirmRowId(null)}
        onConfirm={() => rowBeingConfirmed && deleteMutation.mutate(rowBeingConfirmed.id)}
      />

      {openCardSubId && (() => {
        const staged = selected.find((r) => r.id === openCardSubId);
        if (!staged) return null;
        return (
          <SubscriptionCardDrawer
            submissionSubscriptionId={openCardSubId}
            stagedSub={staged}
            countryId={countryId}
            onClose={() => setOpenCardSubId(null)}
          />
        );
      })()}
    </div>
  );
}

function SelectedSubscriptionRow({
  row, countryId, countryName, canRemove, onRemove, onOpenCard, removing,
}: {
  row: ClientSubmissionSubscription;
  countryId: string | null;
  countryName: string | null;
  canRemove: boolean;
  onRemove: () => void;
  onOpenCard: () => void;
  removing: boolean;
}) {
  const plan = row.plan || null;
  const pricing = (plan?.pricing || []).find((pr) => pr.country_id === countryId);
  const priceLabel = pricing
    ? `${formatPrice(pricing.price, pricing.country?.currency || 'INR')}/mo`
    : null;
  const deliverables = plan?.deliverables || [];

  return (
    <li
      role="button"
      tabIndex={0}
      onClick={onOpenCard}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpenCard();
        }
      }}
      className="cursor-pointer px-3 py-2.5 text-sm transition hover:bg-[var(--sh-hair-3)]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <p className="font-medium text-[var(--sh-ink)]">{row.subscription?.name || '—'}</p>
            <p className="text-xs text-[var(--sh-ink-3)]">
              {plan ? `${plan.plan} · ${plan.tier}` : '—'}
            </p>
            {priceLabel ? (
              <p className="text-xs font-medium text-[var(--sh-ink)]">{priceLabel}</p>
            ) : (
              <p className="text-xs text-[var(--sh-ink-4)]">
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
            onClick={(e) => { e.stopPropagation(); onRemove(); }}
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
    <span className="inline-flex items-center gap-1.5 rounded-md bg-[var(--sh-hair-3)] px-2 py-0.5 text-[11px] text-[var(--sh-ink)]">
      <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${badgeClass}`}>{label}</span>
      <span className="text-[var(--sh-ink-3)]">
        {deliverable.per_day}/d · {deliverable.per_week}/w · {deliverable.per_month}/m
      </span>
    </span>
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

  const selectedSub = catalog.find((s) => s.id === subscriptionId) || null;
  const sortedPlans: SubscriptionPlanRow[] = useMemo(() => {
    if (!selectedSub) return [];
    return (selectedSub.plans || [])
      .filter((p) => p.is_active)
      .sort((a, b) => PLAN_ORDER.indexOf(a.plan) - PLAN_ORDER.indexOf(b.plan));
  }, [selectedSub]);

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
          {sortedPlans.length === 0 ? (
            <p className="rounded-md bg-[var(--surface)] px-2 py-1.5 text-xs text-[var(--sh-ink-4)]">
              No plans priced for this country.
            </p>
          ) : (
            <select
              value={planId}
              onChange={(e) => setPlanId(e.target.value)}
              className="w-full rounded-md border border-[var(--sh-hair)] bg-[var(--surface)] px-2 py-1.5 text-sm text-[var(--sh-ink)]"
            >
              <option value="">Select plan…</option>
              {TIERS.map((tier) => {
                const inTier = sortedPlans.filter((p) => p.tier === tier);
                if (inTier.length === 0) return null;
                return (
                  <optgroup key={tier} label={tier}>
                    {inTier.map((p) => {
                      const pr = (p.pricing || [])[0];
                      const priceLabel = pr
                        ? `${formatPrice(pr.price, pr.country?.currency || 'INR')}/mo`
                        : 'no price';
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
        className="w-full rounded-md bg-[var(--sh-ink)] px-3 py-2 text-xs font-medium text-white transition hover:opacity-90 disabled:opacity-50"
      >
        {addMutation.isPending ? 'Adding…' : 'Add subscription'}
      </button>
    </div>
  );
}
