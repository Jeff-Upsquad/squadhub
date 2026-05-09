import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  RecipientStatus,
  SubscriptionCardRecipient,
  SubscriptionPlanDeliverable,
  WeekDay,
} from '@squadhub/shared';
import { formatPrice, formatDeliverableCadence } from '@squadhub/shared';
import api from '../../../services/api';

const TABS: { key: RecipientStatus; label: string }[] = [
  { key: 'pending', label: 'Pending' },
  { key: 'accepted', label: 'Accepted' },
  { key: 'rejected', label: 'Rejected' },
];

export default function PartnerOpportunities() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<RecipientStatus>('pending');

  const { data, isLoading } = useQuery({
    queryKey: ['partner-opportunities', tab],
    queryFn: () =>
      api.get(`/partner/opportunities?status=${tab}`).then((r) => r.data),
  });
  const recipients: SubscriptionCardRecipient[] = data?.data || [];

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['partner-opportunities'] });
    queryClient.invalidateQueries({ queryKey: ['partner-opportunities-pending'] });
  };

  const accept = useMutation({
    mutationFn: (id: string) => api.post(`/partner/opportunities/${id}/accept`),
    onSuccess: invalidate,
    onError: (err: any) => alert(err?.response?.data?.error || 'Failed to accept'),
  });
  const reject = useMutation({
    mutationFn: (id: string) => api.post(`/partner/opportunities/${id}/reject`),
    onSuccess: invalidate,
    onError: (err: any) => alert(err?.response?.data?.error || 'Failed to reject'),
  });

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center gap-3 border-b border-[var(--sh-hair)] px-6 py-4">
        <h2
          className="text-[28px] font-semibold text-[var(--sh-ink)]"
          style={{ fontFamily: 'var(--font-serif, Instrument Serif, serif)', letterSpacing: '-0.01em' }}
        >
          Opportunities
        </h2>
      </div>

      <div className="flex gap-2 border-b border-[var(--sh-hair)] px-6 py-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
              tab === t.key
                ? 'bg-[var(--sh-ink)] text-[var(--surface)]'
                : 'text-[var(--sh-ink-3)] hover:bg-[var(--sh-hair-3)] hover:text-[var(--sh-ink)]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {isLoading ? (
          <p className="text-sm text-[var(--sh-ink-3)]">Loading…</p>
        ) : recipients.length === 0 ? (
          <p className="mt-8 text-center text-sm text-[var(--sh-ink-4)]">
            {tab === 'pending'
              ? 'No open opportunities right now. Check back soon.'
              : tab === 'accepted'
                ? 'You haven\u2019t accepted any cards yet.'
                : 'No rejected cards.'}
          </p>
        ) : (
          <ul className="space-y-3">
            {recipients.map((r) => (
              <OpportunityCard
                key={r.id}
                recipient={r}
                isPending={tab === 'pending'}
                onAccept={() => accept.mutate(r.id)}
                onReject={() => reject.mutate(r.id)}
                busy={accept.isPending || reject.isPending}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function OpportunityCard({
  recipient, isPending, onAccept, onReject, busy,
}: {
  recipient: SubscriptionCardRecipient;
  isPending: boolean;
  onAccept: () => void;
  onReject: () => void;
  busy: boolean;
}) {
  const card = recipient.card;
  if (!card) return null;
  const staged = card.submission_subscription;
  const plan = staged?.plan || null;
  const submissionCountryId = card.submission?.country_id || null;
  const pricing = (plan?.pricing || []).find((pr) => pr.country_id === submissionCountryId);
  const priceLabel = pricing
    ? `${formatPrice(pricing.price, pricing.country?.currency || 'INR')}/mo`
    : null;
  const allDefaultDeliverables: SubscriptionPlanDeliverable[] = plan?.deliverables || [];
  const disabledDefaultIds = card.disabled_default_deliverable_ids || [];
  const defaultDeliverables = allDefaultDeliverables.filter(
    (d) => !disabledDefaultIds.includes(d.id),
  );
  const customDeliverables = card.custom_deliverables || [];
  // "No hourly commitment" copy when this client opted out of every hours-kind
  // default. Only show it if the plan actually has hours defaults — if the
  // plan never had any, silence is more accurate than the explicit message.
  const planHasHoursDefault = allDefaultDeliverables.some((d) => d.kind === 'hours');
  const enabledHasHoursDefault = defaultDeliverables.some((d) => d.kind === 'hours');
  const showNoHourlyCommitment = planHasHoursDefault && !enabledHasHoursDefault;
  const workingDays = (card.working_days || []) as WeekDay[];
  const isCancelled = !!(card as { cancelled_at?: string | null }).cancelled_at;
  const isRecalled = !!(card as { recalled_at?: string | null }).recalled_at && !isCancelled;

  return (
    <li className={`rounded-xl border bg-[var(--surface)] p-4 ${
      isCancelled ? 'border-red-300'
      : isRecalled ? 'border-orange-300'
      : 'border-[var(--sh-hair)]'
    }`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <p className="text-base font-semibold text-[var(--sh-ink)]">
              {staged?.subscription?.name || 'Subscription card'}
            </p>
            {isCancelled && (
              <span
                className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-800"
                title="This card was cancelled by the client. Your acceptance is still on record."
              >
                Cancelled
              </span>
            )}
            {isRecalled && (
              <span
                className="rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-semibold text-orange-800"
                title="This card was recalled by the client. Your acceptance is still on record."
              >
                Recalled
              </span>
            )}
          </div>
          <p className="text-xs text-[var(--sh-ink-3)]">
            {plan ? `${plan.plan} · ${plan.tier}` : '—'}
            {priceLabel ? ` · ${priceLabel}` : ''}
          </p>
        </div>
        {card.submission && (
          <p className="text-xs text-[var(--sh-ink-3)]">
            {card.submission.business_name}
            {card.submission.country?.name ? ` · ${card.submission.country.name}` : ''}
          </p>
        )}
      </div>

      {showNoHourlyCommitment && (
        <p className="mt-3 text-xs italic text-[var(--sh-ink-3)]">No hourly commitment.</p>
      )}

      {(defaultDeliverables.length > 0 || customDeliverables.length > 0) && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {defaultDeliverables.map((d) => (
            <DeliverableChipDefault key={d.id} deliverable={d} />
          ))}
          {customDeliverables.map((d) => (
            <span
              key={d.id}
              className="inline-flex items-center gap-1.5 rounded-md bg-[var(--sh-hair-3)] px-2 py-0.5 text-[11px] text-[var(--sh-ink)]"
            >
              <span
                className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${
                  d.kind === 'hours' ? 'bg-indigo-100 text-indigo-700' : 'bg-purple-100 text-purple-700'
                }`}
              >
                {d.kind === 'hours' ? 'Hours' : 'Item'}
              </span>
              <span>{d.name}</span>
              <span className="text-[var(--sh-ink-3)]">
                {formatDeliverableCadence(
                  d.per_day,
                  d.per_week,
                  d.per_month,
                  d.kind === 'hours' ? 'hrs' : (d.name || 'items'),
                )}
              </span>
            </span>
          ))}
        </div>
      )}

      {workingDays.length > 0 && (
        <p className="mt-3 text-xs text-[var(--sh-ink-3)]">
          <span className="font-medium text-[var(--sh-ink)]">Working days:</span> {workingDays.join(', ')}
        </p>
      )}

      {card.brand_name && (
        <p className="mt-1 text-xs text-[var(--sh-ink-3)]">
          <span className="font-medium text-[var(--sh-ink)]">Brand:</span> {card.brand_name}
        </p>
      )}
      {card.business_nature && (
        <p className="mt-1 text-xs text-[var(--sh-ink-3)]">
          <span className="font-medium text-[var(--sh-ink)]">Business:</span> {card.business_nature}
        </p>
      )}
      {card.notes && (
        <p className="mt-2 whitespace-pre-wrap rounded-md bg-[var(--sh-hair-3)] p-2 text-xs text-[var(--sh-ink-2)]">
          {card.notes}
        </p>
      )}

      {isPending && (
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onReject}
            disabled={busy}
            className="rounded-md border border-[var(--sh-hair)] px-3 py-1.5 text-xs font-medium text-[var(--sh-ink-3)] hover:bg-[var(--sh-hair-3)] hover:text-[var(--sh-ink)] disabled:opacity-50"
          >
            Reject
          </button>
          <button
            onClick={onAccept}
            disabled={busy}
            className="rounded-md bg-[var(--sh-ink)] px-3 py-1.5 text-xs font-medium text-[var(--surface)] hover:opacity-90 disabled:opacity-50"
          >
            Accept
          </button>
        </div>
      )}
      {!isPending && recipient.responded_at && (
        <p className="mt-3 text-right text-[11px] text-[var(--sh-ink-4)]">
          {recipient.status === 'accepted' ? 'Accepted' : 'Rejected'} on{' '}
          {new Date(recipient.responded_at).toLocaleString()}
        </p>
      )}
    </li>
  );
}

function DeliverableChipDefault({ deliverable }: { deliverable: SubscriptionPlanDeliverable }) {
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
