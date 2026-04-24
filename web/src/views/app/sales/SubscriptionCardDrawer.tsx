import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  ClientSubmissionSubscription,
  Country,
  DeliverableKind,
  PartnerTier,
  SubscriptionCard,
  SubscriptionCardCustomDeliverable,
  SubscriptionDeliverableType,
  SubscriptionPlanDeliverable,
  WeekDay,
} from '@squadhub/shared';
import {
  PARTNER_TIERS,
  SUPPORTED_LANGUAGES,
  WEEK_DAYS,
  formatPrice,
} from '@squadhub/shared';
import api from '../../../services/api';
import ConfirmRemoveDialog from '../../../components/ConfirmRemoveDialog';

type Props = {
  submissionSubscriptionId: string;
  stagedSub: ClientSubmissionSubscription;
  countryId: string | null;
  onClose: () => void;
};

function randomId() {
  // Good enough for optimistic local IDs — server stores value as-is.
  return 'cd_' + Math.random().toString(36).slice(2, 10);
}

export default function SubscriptionCardDrawer({
  submissionSubscriptionId,
  stagedSub,
  countryId,
  onClose,
}: Props) {
  const queryClient = useQueryClient();

  const { data: cardRes, isLoading } = useQuery({
    queryKey: ['subscription-card', submissionSubscriptionId],
    queryFn: () =>
      api
        .get(`/subscription-cards/by-submission-sub/${submissionSubscriptionId}`)
        .then((r) => r.data),
  });
  const card: SubscriptionCard | null = cardRes?.data || null;

  const { data: countriesRes } = useQuery({
    queryKey: ['public-countries'],
    queryFn: () => api.get('/clients/countries').then((r) => r.data),
  });
  const countries: Country[] = countriesRes?.data || [];

  const { data: deliverableTypesRes } = useQuery({
    queryKey: ['sub-deliverable-types', stagedSub.subscription_id],
    queryFn: () =>
      api
        .get('/onboarding-links/subscriptions')
        .then((r) => r.data),
  });
  const deliverableTypes: SubscriptionDeliverableType[] = useMemo(() => {
    const list = deliverableTypesRes?.data || [];
    const sub = list.find((s: any) => s.id === stagedSub.subscription_id);
    return sub?.deliverable_types || [];
  }, [deliverableTypesRes, stagedSub.subscription_id]);

  const invalidate = () => {
    queryClient.invalidateQueries({
      queryKey: ['subscription-card', submissionSubscriptionId],
    });
    queryClient.invalidateQueries({ queryKey: ['sales-leads'] });
  };

  const patchCard = useMutation({
    mutationFn: (body: any) =>
      api.patch(`/subscription-cards/${card!.id}`, body),
    onSuccess: invalidate,
    onError: (err: any) => alert(err?.response?.data?.error || err.message || 'Save failed'),
  });

  const putTargets = useMutation({
    mutationFn: (body: any) =>
      api.put(`/subscription-cards/${card!.id}/targets`, body),
    onSuccess: invalidate,
    onError: (err: any) => alert(err?.response?.data?.error || err.message || 'Save failed'),
  });

  const publishMutation = useMutation({
    mutationFn: () => api.post(`/subscription-cards/${card!.id}/publish`),
    onSuccess: (res: any) => {
      invalidate();
      const n = res?.data?.matched_count ?? 0;
      alert(`Published. Sent to ${n} matching partner${n === 1 ? '' : 's'}.`);
    },
    onError: (err: any) => alert(err?.response?.data?.error || err.message || 'Publish failed'),
  });

  const recallMutation = useMutation({
    mutationFn: () => api.post(`/subscription-cards/${card!.id}/recall`),
    onSuccess: invalidate,
    onError: (err: any) => alert(err?.response?.data?.error || err.message || 'Recall failed'),
  });

  const closeMutation = useMutation({
    mutationFn: () => api.post(`/subscription-cards/${card!.id}/close`),
    onSuccess: invalidate,
    onError: (err: any) => alert(err?.response?.data?.error || err.message || 'Close failed'),
  });

  // Local editable state — initialised from server, flushed via Save/Publish.
  const [workingDays, setWorkingDays] = useState<WeekDay[]>([]);
  const [brandName, setBrandName] = useState('');
  const [businessNature, setBusinessNature] = useState('');
  const [notes, setNotes] = useState('');
  const [customDeliverables, setCustomDeliverables] = useState<SubscriptionCardCustomDeliverable[]>([]);

  const [targetTier, setTargetTier] = useState<PartnerTier | ''>('');
  const [minExp, setMinExp] = useState<string>('0');
  const [targetLanguages, setTargetLanguages] = useState<string[]>([]);
  const [targetCountryIds, setTargetCountryIds] = useState<string[]>([]);
  const [targetRegions, setTargetRegions] = useState<{ country_id: string; region: string }[]>([]);

  useEffect(() => {
    if (!card) return;
    setWorkingDays(card.working_days || []);
    setBrandName(card.brand_name || '');
    setBusinessNature(card.business_nature || '');
    setNotes(card.notes || '');
    setCustomDeliverables(card.custom_deliverables || []);
    setTargetTier(card.target_tier || '');
    setMinExp(String(card.min_experience_years ?? 0));
    setTargetLanguages(card.target_languages || []);
    setTargetCountryIds(card.target_country_ids || []);
    setTargetRegions(card.target_regions || []);
  }, [card]);

  const readOnly = !card || card.state !== 'draft';
  const plan = stagedSub.plan || null;
  const pricing = (plan?.pricing || []).find((pr) => pr.country_id === countryId);
  const priceLabel = pricing
    ? `${formatPrice(pricing.price, pricing.country?.currency || 'INR')}/mo`
    : null;
  const defaultDeliverables: SubscriptionPlanDeliverable[] = plan?.deliverables || [];

  const acceptedCount = card?.recipient_counts?.accepted ?? 0;
  const pendingCount = card?.recipient_counts?.pending ?? 0;
  const rejectedCount = card?.recipient_counts?.rejected ?? 0;

  const [confirmPublish, setConfirmPublish] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);

  function saveDraft() {
    if (!card) return;
    patchCard.mutate({
      working_days: workingDays,
      brand_name: brandName || null,
      business_nature: businessNature || null,
      notes: notes || null,
      custom_deliverables: customDeliverables,
    });
    putTargets.mutate({
      target_tier: targetTier || null,
      min_experience_years: parseInt(minExp || '0', 10) || 0,
      target_languages: targetLanguages,
      target_country_ids: targetCountryIds,
      target_regions: targetRegions.filter((r) => targetCountryIds.includes(r.country_id)),
    });
  }

  function handlePublish() {
    // Flush current edits, then publish.
    saveDraft();
    setTimeout(() => publishMutation.mutate(), 150);
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative flex h-full w-[620px] max-w-full flex-col bg-[var(--surface)] shadow-xl">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-[var(--sh-hair)] px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-[var(--sh-ink)]">Subscription Card</h2>
            <p className="mt-0.5 text-xs text-[var(--sh-ink-3)]">
              {card
                ? card.state === 'draft'
                  ? 'Draft — edit freely, publish to send to partners.'
                  : card.state === 'published'
                    ? `Published — ${pendingCount} pending · ${acceptedCount} accepted · ${rejectedCount} rejected`
                    : 'Closed.'
                : 'Loading…'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-[var(--sh-ink-3)] hover:bg-[var(--sh-hair-3)] hover:text-[var(--sh-ink)]"
            aria-label="Close"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {isLoading || !card ? (
          <div className="flex flex-1 items-center justify-center text-sm text-[var(--sh-ink-3)]">Loading…</div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">
              {/* Details */}
              <Section title="Details">
                <div className="rounded-lg border border-[var(--sh-hair)] bg-[var(--sh-hair-3)] p-3">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <p className="font-medium text-[var(--sh-ink)]">{stagedSub.subscription?.name || '—'}</p>
                    <p className="text-xs text-[var(--sh-ink-3)]">
                      {plan ? `${plan.plan} · ${plan.tier}` : '—'}
                    </p>
                    {priceLabel && <p className="text-xs font-medium text-[var(--sh-ink)]">{priceLabel}</p>}
                  </div>
                  {defaultDeliverables.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {defaultDeliverables.map((d) => (
                        <DefaultDeliverableChip key={d.id} deliverable={d} />
                      ))}
                    </div>
                  )}
                </div>
              </Section>

              {/* Custom deliverables */}
              <Section title="Custom Deliverables">
                <CustomDeliverablesEditor
                  value={customDeliverables}
                  onChange={setCustomDeliverables}
                  deliverableTypes={deliverableTypes}
                  disabled={readOnly}
                />
              </Section>

              {/* Working days */}
              <Section title="Working Days">
                <div className="flex flex-wrap gap-2">
                  {WEEK_DAYS.map((d) => {
                    const on = workingDays.includes(d);
                    return (
                      <button
                        key={d}
                        type="button"
                        disabled={readOnly}
                        onClick={() => setWorkingDays((prev) => on ? prev.filter((x) => x !== d) : [...prev, d])}
                        className={`rounded-md border px-3 py-1.5 text-xs font-medium transition ${
                          on
                            ? 'border-[var(--sh-ink)] bg-[var(--sh-ink)] text-[var(--surface)]'
                            : 'border-[var(--sh-hair)] bg-[var(--surface)] text-[var(--sh-ink-3)] hover:border-[var(--sh-ink-3)]'
                        } disabled:opacity-60 disabled:cursor-not-allowed`}
                      >
                        {d}
                      </button>
                    );
                  })}
                </div>
              </Section>

              {/* Client brief */}
              <Section title="Client Brief">
                <TextField label="Brand name" value={brandName} onChange={setBrandName} disabled={readOnly} />
                <TextField
                  label="Nature of business"
                  value={businessNature}
                  onChange={setBusinessNature}
                  disabled={readOnly}
                />
              </Section>

              {/* Notes */}
              <Section title="Notes">
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  disabled={readOnly}
                  rows={4}
                  className="w-full resize-none rounded-md border border-[var(--sh-hair)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--sh-ink)] outline-none focus:border-[var(--sh-ink-3)] disabled:opacity-60"
                  placeholder="Anything else the partner should know…"
                />
              </Section>

              {/* Publish to */}
              <Section title="Publish to">
                <div>
                  <label className="mb-1 block text-xs font-medium text-[var(--sh-ink-3)]">Tier</label>
                  <div className="flex flex-wrap gap-2">
                    {(['', ...PARTNER_TIERS] as const).map((t) => (
                      <button
                        key={t || 'any'}
                        type="button"
                        disabled={readOnly}
                        onClick={() => setTargetTier(t as PartnerTier | '')}
                        className={`rounded-md border px-3 py-1.5 text-xs font-medium transition ${
                          targetTier === t
                            ? 'border-[var(--sh-ink)] bg-[var(--sh-ink)] text-[var(--surface)]'
                            : 'border-[var(--sh-hair)] bg-[var(--surface)] text-[var(--sh-ink-3)] hover:border-[var(--sh-ink-3)]'
                        } disabled:opacity-60 disabled:cursor-not-allowed`}
                      >
                        {t || 'Any'}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-[var(--sh-ink-3)]">
                    Minimum experience (years)
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={minExp}
                    onChange={(e) => setMinExp(e.target.value)}
                    disabled={readOnly}
                    className="w-32 rounded-md border border-[var(--sh-hair)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--sh-ink)] outline-none focus:border-[var(--sh-ink-3)] disabled:opacity-60"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-[var(--sh-ink-3)]">Countries</label>
                  <div className="flex flex-wrap gap-2">
                    {countries.map((c) => {
                      const on = targetCountryIds.includes(c.id);
                      return (
                        <button
                          key={c.id}
                          type="button"
                          disabled={readOnly}
                          onClick={() =>
                            setTargetCountryIds((prev) => {
                              if (on) {
                                setTargetRegions((r) => r.filter((x) => x.country_id !== c.id));
                                return prev.filter((x) => x !== c.id);
                              }
                              return [...prev, c.id];
                            })
                          }
                          className={`rounded-md border px-2.5 py-1 text-xs font-medium transition ${
                            on
                              ? 'border-[var(--sh-ink)] bg-[var(--sh-ink)] text-[var(--surface)]'
                              : 'border-[var(--sh-hair)] bg-[var(--surface)] text-[var(--sh-ink-3)] hover:border-[var(--sh-ink-3)]'
                          } disabled:opacity-60 disabled:cursor-not-allowed`}
                        >
                          {c.name}
                        </button>
                      );
                    })}
                    {countries.length === 0 && (
                      <p className="text-xs text-[var(--sh-ink-4)]">No countries configured.</p>
                    )}
                  </div>
                </div>

                {targetCountryIds.length > 0 && (
                  <div>
                    <label className="mb-1 block text-xs font-medium text-[var(--sh-ink-3)]">
                      States / Regions (optional, per country)
                    </label>
                    <div className="space-y-2">
                      {targetCountryIds.map((cid) => {
                        const country = countries.find((c) => c.id === cid);
                        const regionsForCountry = targetRegions.filter((r) => r.country_id === cid);
                        return (
                          <RegionTagInput
                            key={cid}
                            label={country?.name || cid}
                            regions={regionsForCountry.map((r) => r.region)}
                            disabled={readOnly}
                            onAdd={(region) =>
                              setTargetRegions((prev) => [...prev, { country_id: cid, region }])
                            }
                            onRemove={(region) =>
                              setTargetRegions((prev) =>
                                prev.filter((r) => !(r.country_id === cid && r.region === region)),
                              )
                            }
                          />
                        );
                      })}
                    </div>
                  </div>
                )}

                <div>
                  <label className="mb-1 block text-xs font-medium text-[var(--sh-ink-3)]">Languages</label>
                  <div className="flex flex-wrap gap-1.5">
                    {SUPPORTED_LANGUAGES.map((l) => {
                      const on = targetLanguages.includes(l.code);
                      return (
                        <button
                          key={l.code}
                          type="button"
                          disabled={readOnly}
                          onClick={() =>
                            setTargetLanguages((prev) =>
                              on ? prev.filter((x) => x !== l.code) : [...prev, l.code],
                            )
                          }
                          className={`rounded-md border px-2.5 py-1 text-xs font-medium transition ${
                            on
                              ? 'border-[var(--sh-ink)] bg-[var(--sh-ink)] text-[var(--surface)]'
                              : 'border-[var(--sh-hair)] bg-[var(--surface)] text-[var(--sh-ink-3)] hover:border-[var(--sh-ink-3)]'
                          } disabled:opacity-60 disabled:cursor-not-allowed`}
                        >
                          {l.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </Section>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between border-t border-[var(--sh-hair)] px-5 py-3">
              <button
                onClick={onClose}
                className="rounded-md border border-[var(--sh-hair)] px-3 py-1.5 text-xs text-[var(--sh-ink-3)] hover:bg-[var(--sh-hair-3)] hover:text-[var(--sh-ink)]"
              >
                Close
              </button>
              <div className="flex items-center gap-2">
                {card.state === 'draft' && (
                  <>
                    <button
                      onClick={saveDraft}
                      disabled={patchCard.isPending || putTargets.isPending}
                      className="rounded-md border border-[var(--sh-hair)] px-3 py-1.5 text-xs font-medium text-[var(--sh-ink)] hover:bg-[var(--sh-hair-3)] disabled:opacity-50"
                    >
                      Save draft
                    </button>
                    <button
                      onClick={() => setConfirmPublish(true)}
                      disabled={publishMutation.isPending}
                      className="rounded-md bg-[var(--sh-ink)] px-3 py-1.5 text-xs font-medium text-[var(--surface)] hover:opacity-90 disabled:opacity-50"
                    >
                      Publish
                    </button>
                  </>
                )}
                {card.state === 'published' && (
                  <>
                    {acceptedCount === 0 && (
                      <button
                        onClick={() => recallMutation.mutate()}
                        disabled={recallMutation.isPending}
                        className="rounded-md border border-[var(--sh-hair)] px-3 py-1.5 text-xs font-medium text-[var(--sh-ink)] hover:bg-[var(--sh-hair-3)] disabled:opacity-50"
                      >
                        Recall to draft
                      </button>
                    )}
                    <button
                      onClick={() => setConfirmClose(true)}
                      disabled={closeMutation.isPending}
                      className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                    >
                      Close card
                    </button>
                  </>
                )}
              </div>
            </div>

            <ConfirmRemoveDialog
              open={confirmPublish}
              title="Publish subscription card"
              description={`This will send the card to all matching partners (tier ${targetTier || 'Any'}, min ${parseInt(minExp || '0', 10) || 0}y, ${targetCountryIds.length || 'all'} countries). You can recall it only before anyone accepts.`}
              confirmWord="PUBLISH"
              loading={publishMutation.isPending}
              onClose={() => setConfirmPublish(false)}
              onConfirm={() => {
                setConfirmPublish(false);
                handlePublish();
              }}
            />
            <ConfirmRemoveDialog
              open={confirmClose}
              title="Close subscription card"
              description="Partners will no longer be able to accept or reject this card. This cannot be undone."
              confirmWord="CLOSE"
              loading={closeMutation.isPending}
              onClose={() => setConfirmClose(false)}
              onConfirm={() => {
                setConfirmClose(false);
                closeMutation.mutate();
              }}
            />
          </>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--sh-ink-4)]">
        {title}
      </h3>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function TextField({
  label, value, onChange, disabled,
}: { label: string; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-[var(--sh-ink-3)]">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="w-full rounded-md border border-[var(--sh-hair)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--sh-ink)] outline-none focus:border-[var(--sh-ink-3)] disabled:opacity-60"
      />
    </div>
  );
}

function DefaultDeliverableChip({ deliverable }: { deliverable: SubscriptionPlanDeliverable }) {
  const label = deliverable.kind === 'hours' ? 'Hours' : (deliverable.deliverable_type?.name || 'Item');
  const badgeClass = deliverable.kind === 'hours'
    ? 'bg-indigo-100 text-indigo-700'
    : 'bg-purple-100 text-purple-700';
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md bg-[var(--surface)] px-2 py-0.5 text-[11px] text-[var(--sh-ink)]">
      <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${badgeClass}`}>{label}</span>
      <span className="text-[var(--sh-ink-3)]">
        {deliverable.per_day}/d · {deliverable.per_week}/w · {deliverable.per_month}/m
      </span>
    </span>
  );
}

// ------------------------------------------------------------
// Custom deliverable editor — adapted from admin's ClientDeliverablesEditor.
// Persists to the card's custom_deliverables JSONB rather than a separate table.
// ------------------------------------------------------------
function CustomDeliverablesEditor({
  value, onChange, deliverableTypes, disabled,
}: {
  value: SubscriptionCardCustomDeliverable[];
  onChange: (next: SubscriptionCardCustomDeliverable[]) => void;
  deliverableTypes: SubscriptionDeliverableType[];
  disabled?: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<DeliverableKind>('item');
  const [name, setName] = useState('');
  const [typeId, setTypeId] = useState('');
  const [perDay, setPerDay] = useState('');
  const [perWeek, setPerWeek] = useState('');
  const [perMonth, setPerMonth] = useState('');

  function reset() {
    setAdding(false);
    setKind('item');
    setName('');
    setTypeId('');
    setPerDay('');
    setPerWeek('');
    setPerMonth('');
  }

  function submit() {
    let resolvedName = name;
    if (kind === 'item' && !resolvedName) {
      resolvedName = deliverableTypes.find((t) => t.id === typeId)?.name || 'Custom item';
    }
    if (kind === 'hours' && !resolvedName) resolvedName = 'Hours';
    onChange([
      ...value,
      {
        id: randomId(),
        name: resolvedName,
        kind,
        per_day: parseFloat(perDay) || 0,
        per_week: parseFloat(perWeek) || 0,
        per_month: parseFloat(perMonth) || 0,
      },
    ]);
    reset();
  }

  return (
    <div className="space-y-2">
      {value.length === 0 && !adding && (
        <p className="text-xs text-[var(--sh-ink-4)]">No custom deliverables on this card.</p>
      )}
      {value.map((d) => (
        <div
          key={d.id}
          className="flex items-center justify-between rounded-md border border-[var(--sh-hair)] bg-[var(--surface)] px-3 py-2"
        >
          <div className="flex items-center gap-2">
            <span
              className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${
                d.kind === 'hours' ? 'bg-indigo-100 text-indigo-700' : 'bg-purple-100 text-purple-700'
              }`}
            >
              {d.kind === 'hours' ? 'Hours' : 'Item'}
            </span>
            <span className="text-sm text-[var(--sh-ink)]">{d.name}</span>
            <span className="text-xs text-[var(--sh-ink-3)]">
              {d.per_day}/d · {d.per_week}/w · {d.per_month}/m
            </span>
          </div>
          {!disabled && (
            <button
              type="button"
              onClick={() => onChange(value.filter((x) => x.id !== d.id))}
              className="rounded-md px-2 py-1 text-xs text-red-600 hover:bg-red-50"
            >
              Remove
            </button>
          )}
        </div>
      ))}
      {adding ? (
        <div className="space-y-2 rounded-md border border-dashed border-[var(--sh-hair)] bg-[var(--sh-hair-3)] p-3">
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-1.5 text-xs text-[var(--sh-ink-3)]">
              <input type="radio" checked={kind === 'hours'} onChange={() => setKind('hours')} />
              Hours
            </label>
            <label className="flex items-center gap-1.5 text-xs text-[var(--sh-ink-3)]">
              <input type="radio" checked={kind === 'item'} onChange={() => setKind('item')} />
              Item
            </label>
            {kind === 'item' && (
              <select
                value={typeId}
                onChange={(e) => setTypeId(e.target.value)}
                className="rounded-md border border-[var(--sh-hair)] bg-[var(--surface)] px-2 py-1 text-xs text-[var(--sh-ink)]"
              >
                <option value="">Pick type…</option>
                {deliverableTypes.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            )}
          </div>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Label (optional)"
            className="w-full rounded-md border border-[var(--sh-hair)] bg-[var(--surface)] px-2 py-1 text-xs text-[var(--sh-ink)]"
          />
          <div className="flex items-center gap-2">
            <NumField label="/d" value={perDay} onChange={setPerDay} />
            <NumField label="/w" value={perWeek} onChange={setPerWeek} />
            <NumField label="/m" value={perMonth} onChange={setPerMonth} />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={submit}
              className="rounded-md bg-[var(--sh-ink)] px-3 py-1 text-xs font-medium text-[var(--surface)] hover:opacity-90"
            >
              Add
            </button>
            <button
              type="button"
              onClick={reset}
              className="rounded-md border border-[var(--sh-hair)] px-3 py-1 text-xs text-[var(--sh-ink-3)] hover:bg-[var(--sh-hair-3)]"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : !disabled && (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="rounded-md border border-dashed border-[var(--sh-hair)] px-3 py-1.5 text-xs text-[var(--sh-ink-3)] hover:bg-[var(--sh-hair-3)] hover:text-[var(--sh-ink)]"
        >
          + Add custom deliverable
        </button>
      )}
    </div>
  );
}

function NumField({
  label, value, onChange,
}: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center gap-1 text-xs text-[var(--sh-ink-3)]">
      <input
        type="number"
        min={0}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-16 rounded-md border border-[var(--sh-hair)] bg-[var(--surface)] px-2 py-1 text-xs text-[var(--sh-ink)]"
      />
      {label}
    </label>
  );
}

function RegionTagInput({
  label, regions, onAdd, onRemove, disabled,
}: {
  label: string;
  regions: string[];
  onAdd: (region: string) => void;
  onRemove: (region: string) => void;
  disabled?: boolean;
}) {
  const [input, setInput] = useState('');
  function commit() {
    const v = input.trim();
    if (!v) return;
    if (!regions.includes(v)) onAdd(v);
    setInput('');
  }
  return (
    <div className="rounded-md border border-[var(--sh-hair)] bg-[var(--surface)] p-2">
      <p className="mb-1 text-xs font-medium text-[var(--sh-ink-3)]">{label}</p>
      <div className="flex flex-wrap items-center gap-1.5">
        {regions.map((r) => (
          <span
            key={r}
            className="inline-flex items-center gap-1 rounded-md bg-[var(--sh-hair-3)] px-2 py-0.5 text-xs text-[var(--sh-ink)]"
          >
            {r}
            {!disabled && (
              <button
                type="button"
                onClick={() => onRemove(r)}
                className="text-[var(--sh-ink-3)] hover:text-red-600"
              >
                ×
              </button>
            )}
          </span>
        ))}
        {!disabled && (
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault();
                commit();
              }
            }}
            onBlur={commit}
            placeholder="Add region and press Enter"
            className="min-w-[160px] flex-1 bg-transparent px-1 py-0.5 text-xs text-[var(--sh-ink)] outline-none placeholder:text-[var(--sh-ink-4)]"
          />
        )}
      </div>
    </div>
  );
}
