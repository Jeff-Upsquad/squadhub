import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  ClientSubmissionSubscription,
  Country,
  DeliverableKind,
  PartnerTier,
  SquadHireCategory,
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
  formatDeliverableCadence,
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
    mutationFn: (distribution: 'broadcast' | 'manual') =>
      api.post(`/subscription-cards/${card!.id}/publish`, { distribution }),
    onSuccess: (res: any, distribution: 'broadcast' | 'manual') => {
      invalidate();
      if (distribution === 'manual') {
        alert('Published. Add partners or talents from the recipients panel.');
      } else {
        const n = res?.data?.matched_count ?? 0;
        alert(`Broadcast to ${n} matching partner${n === 1 ? '' : 's'}.`);
      }
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
  const [disabledDefaultIds, setDisabledDefaultIds] = useState<string[]>([]);

  const [targetTiers, setTargetTiers] = useState<PartnerTier[]>([]);
  const [minExp, setMinExp] = useState<string>('0');
  const [targetLanguages, setTargetLanguages] = useState<string[]>([]);
  const [targetCountryIds, setTargetCountryIds] = useState<string[]>([]);
  const [targetRegions, setTargetRegions] = useState<{ country_id: string; region: string }[]>([]);
  const [squadhireCategoryIds, setSquadhireCategoryIds] = useState<string[]>([]);
  // '' means "no override — use plan default". A numeric string overrides.
  const [partnerPriceOverride, setPartnerPriceOverride] = useState<string>('');

  // Read-through fetch: SquadHire categories, cached 10 min on the server.
  // Runs once per drawer open. Errors are surfaced inline so the admin knows
  // the picker is unavailable without blocking the rest of the drawer.
  const { data: squadhireCategoriesRes, error: squadhireCategoriesError } = useQuery({
    queryKey: ['squadhire-categories'],
    queryFn: () =>
      api.get('/admin/integrations/squadhire/categories').then((r) => r.data),
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });
  const squadhireCategories: SquadHireCategory[] = squadhireCategoriesRes?.data || [];

  useEffect(() => {
    if (!card) return;
    setWorkingDays(card.working_days || []);
    setBrandName(card.brand_name || '');
    setBusinessNature(card.business_nature || '');
    setNotes(card.notes || '');
    setCustomDeliverables(card.custom_deliverables || []);
    setDisabledDefaultIds(card.disabled_default_deliverable_ids || []);
    setTargetTiers(card.target_tiers || []);
    setMinExp(String(card.min_experience_years ?? 0));
    setTargetLanguages(card.target_languages || []);
    setTargetCountryIds(card.target_country_ids || []);
    setTargetRegions(card.target_regions || []);
    setSquadhireCategoryIds(card.squadhire_category_ids || []);
    setPartnerPriceOverride(
      card.partner_price_override == null ? '' : String(card.partner_price_override),
    );
  }, [card]);

  const readOnly = !card || card.state !== 'draft';
  const plan = stagedSub.plan || null;
  const pricing = (plan?.pricing || []).find((pr) => pr.country_id === countryId);
  const priceLabel = pricing
    ? `${formatPrice(pricing.price, pricing.country?.currency || 'INR')}/mo`
    : null;
  const defaultDeliverables: SubscriptionPlanDeliverable[] = plan?.deliverables || [];

  // Partner price: resolves against the card's selected target country when
  // set, else falls back to the lead's country. Server-side resolution in
  // squadhireWebhook.ts uses the same precedence, so the drawer preview
  // matches what the talent eventually sees.
  const partnerPricingCountryId =
    targetCountryIds.length === 1 ? targetCountryIds[0] : countryId;
  const partnerPricingCountry = countries.find((c) => c.id === partnerPricingCountryId) || null;
  const defaultPartnerPriceRow = partnerPricingCountryId
    ? (plan?.partner_pricing || []).find((pr) => pr.country_id === partnerPricingCountryId)
    : undefined;
  const defaultPartnerPrice = defaultPartnerPriceRow?.price ?? null;
  const partnerCurrency =
    defaultPartnerPriceRow?.country?.currency || partnerPricingCountry?.currency || 'INR';
  const partnerOverrideNum =
    partnerPriceOverride.trim() === '' ? null : parseInt(partnerPriceOverride, 10);
  const effectivePartnerPrice =
    partnerOverrideNum != null && !Number.isNaN(partnerOverrideNum) && partnerOverrideNum >= 0
      ? partnerOverrideNum
      : defaultPartnerPrice;
  const grossProfit =
    pricing && effectivePartnerPrice != null ? pricing.price - effectivePartnerPrice : null;

  const partnerCounts = card?.recipient_counts?.partners;
  const talentCounts = card?.recipient_counts?.talents;
  const acceptedCount = (partnerCounts?.accepted ?? 0) + (talentCounts?.accepted ?? 0);
  const pendingCount = partnerCounts?.pending ?? 0;
  const rejectedCount = (partnerCounts?.rejected ?? 0) + (talentCounts?.rejected ?? 0);

  const [pendingPublishMode, setPendingPublishMode] = useState<'broadcast' | 'manual' | null>(null);
  const [publishMenuOpen, setPublishMenuOpen] = useState(false);
  const publishMenuRef = useRef<HTMLDivElement>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  // Close the publish menu on outside click / Escape — same pattern used by
  // SalesPersonSelect and ListPickerCombobox elsewhere in the app.
  useEffect(() => {
    if (!publishMenuOpen) return;
    function onDoc(e: MouseEvent) {
      if (!publishMenuRef.current) return;
      if (!publishMenuRef.current.contains(e.target as Node)) {
        setPublishMenuOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setPublishMenuOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [publishMenuOpen]);

  function saveDraft() {
    if (!card) return;
    const overrideNum = partnerPriceOverride.trim() === '' ? null : parseInt(partnerPriceOverride, 10);
    const cleanOverride =
      overrideNum != null && !Number.isNaN(overrideNum) && overrideNum >= 0 ? overrideNum : null;
    patchCard.mutate({
      working_days: workingDays,
      brand_name: brandName || null,
      business_nature: businessNature || null,
      notes: notes || null,
      custom_deliverables: customDeliverables,
      partner_price_override: cleanOverride,
      disabled_default_deliverable_ids: disabledDefaultIds,
    });
    putTargets.mutate({
      target_tiers: targetTiers,
      min_experience_years: parseInt(minExp || '0', 10) || 0,
      target_languages: targetLanguages,
      target_country_ids: targetCountryIds,
      target_regions: targetRegions.filter((r) => targetCountryIds.includes(r.country_id)),
      squadhire_category_ids: squadhireCategoryIds,
    });
  }

  function handlePublish(distribution: 'broadcast' | 'manual') {
    // Flush current edits, then publish.
    saveDraft();
    setTimeout(() => publishMutation.mutate(distribution), 150);
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
                    {priceLabel && (
                      <p className="text-xs font-medium text-[var(--sh-ink)]">Customer: {priceLabel}</p>
                    )}
                    {effectivePartnerPrice != null && (
                      <p className="text-xs font-medium text-[var(--sh-ink)]">
                        Partner: {formatPrice(effectivePartnerPrice, partnerCurrency)}/mo
                      </p>
                    )}
                    {grossProfit != null && (
                      <p
                        className={`text-xs font-medium ${grossProfit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}
                        title="Gross profit = customer − partner"
                      >
                        GP: {formatPrice(grossProfit, partnerCurrency)}
                      </p>
                    )}
                  </div>
                </div>
              </Section>

              {/* Default deliverables — sourced from the plan, with a per-card
                  toggle so the talent doesn't see the ones we've turned off. */}
              {defaultDeliverables.length > 0 && (
                <Section title="Default Deliverables">
                  <ul className="divide-y divide-[var(--sh-hair)] rounded-lg border border-[var(--sh-hair)]">
                    {defaultDeliverables.map((d) => {
                      const disabled = disabledDefaultIds.includes(d.id);
                      return (
                        <DefaultDeliverableRow
                          key={d.id}
                          deliverable={d}
                          enabled={!disabled}
                          onToggle={() => {
                            if (readOnly) return;
                            setDisabledDefaultIds((prev) =>
                              disabled ? prev.filter((x) => x !== d.id) : [...prev, d.id],
                            );
                          }}
                          readOnly={readOnly}
                        />
                      );
                    })}
                  </ul>
                  <p className="mt-1.5 text-[11px] text-[var(--sh-ink-4)]">
                    Toggle off to hide a default from the talent. If hours are off, the talent sees "No hourly commitment".
                  </p>
                </Section>
              )}

              {/* Partner price (override the plan default) */}
              <Section title="Partner Price">
                <div className="space-y-2">
                  <p className="text-xs text-[var(--sh-ink-3)]">
                    {defaultPartnerPrice != null
                      ? `Plan default for ${partnerPricingCountry?.name ?? 'this country'}: ${formatPrice(defaultPartnerPrice, partnerCurrency)}/mo`
                      : partnerPricingCountryId
                        ? 'No plan default set for this country. Set one in Subscriptions admin, or enter an override below.'
                        : 'Select a target country to see the plan default.'}
                  </p>
                  <div className="flex items-center gap-2">
                    <label className="text-xs font-medium text-[var(--sh-ink-3)]">Custom price</label>
                    <input
                      type="number"
                      min={0}
                      value={partnerPriceOverride}
                      onChange={(e) => setPartnerPriceOverride(e.target.value)}
                      disabled={readOnly}
                      placeholder={defaultPartnerPrice != null ? String(defaultPartnerPrice) : '—'}
                      className="w-32 rounded-md border border-[var(--sh-hair)] bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--sh-ink)] outline-none focus:border-[var(--sh-ink-3)] disabled:opacity-60"
                    />
                    <span className="text-xs text-[var(--sh-ink-4)]">
                      {partnerCurrency} / month
                    </span>
                    {partnerPriceOverride.trim() !== '' && !readOnly && (
                      <button
                        type="button"
                        onClick={() => setPartnerPriceOverride('')}
                        className="text-xs text-[var(--sh-ink-3)] underline hover:text-[var(--sh-ink)]"
                      >
                        Use default
                      </button>
                    )}
                  </div>
                  <p className="text-[11px] text-[var(--sh-ink-4)]">
                    Leave blank to use the plan default. This is what the partner sees on SquadHire as their monthly pay.
                  </p>
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
                  <label className="mb-1 block text-xs font-medium text-[var(--sh-ink-3)]">
                    Tiers <span className="text-[var(--sh-ink-4)]">(select one or more; leave empty for any tier)</span>
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {PARTNER_TIERS.map((t) => {
                      const on = targetTiers.includes(t);
                      return (
                        <button
                          key={t}
                          type="button"
                          disabled={readOnly}
                          onClick={() =>
                            setTargetTiers((prev) =>
                              on ? prev.filter((x) => x !== t) : [...prev, t],
                            )
                          }
                          className={`rounded-md border px-3 py-1.5 text-xs font-medium transition ${
                            on
                              ? 'border-[var(--sh-ink)] bg-[var(--sh-ink)] text-[var(--surface)]'
                              : 'border-[var(--sh-hair)] bg-[var(--surface)] text-[var(--sh-ink-3)] hover:border-[var(--sh-ink-3)]'
                          } disabled:opacity-60 disabled:cursor-not-allowed`}
                        >
                          {t}
                        </button>
                      );
                    })}
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
                  <label className="mb-1 block text-xs font-medium text-[var(--sh-ink-3)]">
                    Country <span className="text-[var(--sh-ink-4)]">(pick exactly one — drives partner pricing)</span>
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {countries.map((c) => {
                      const on = targetCountryIds.includes(c.id);
                      return (
                        <button
                          key={c.id}
                          type="button"
                          disabled={readOnly}
                          onClick={() => {
                            if (on) {
                              // Deselect — clear country + its regions.
                              setTargetRegions((r) => r.filter((x) => x.country_id !== c.id));
                              setTargetCountryIds([]);
                            } else {
                              // Select — replace (single-select); drop regions from other countries.
                              setTargetRegions((r) => r.filter((x) => x.country_id === c.id));
                              setTargetCountryIds([c.id]);
                            }
                          }}
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

                <div>
                  <label className="mb-1 block text-xs font-medium text-[var(--sh-ink-3)]">
                    SquadHire categories
                  </label>
                  <p className="mb-2 text-[11px] text-[var(--sh-ink-3)]">
                    Leave empty to skip publishing to SquadHire.
                  </p>
                  {squadhireCategoriesError ? (
                    <p className="text-[11px] text-red-600">
                      Could not load SquadHire categories. Publishing to SquadHire
                      is disabled for this session.
                    </p>
                  ) : squadhireCategories.length === 0 ? (
                    <p className="text-[11px] text-[var(--sh-ink-3)]">Loading…</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {squadhireCategories.map((cat) => {
                        const on = squadhireCategoryIds.includes(cat.id);
                        return (
                          <button
                            key={cat.id}
                            type="button"
                            disabled={readOnly}
                            title={cat.description || cat.slug}
                            onClick={() =>
                              setSquadhireCategoryIds((prev) =>
                                on ? prev.filter((x) => x !== cat.id) : [...prev, cat.id],
                              )
                            }
                            className={`rounded-md border px-2.5 py-1 text-xs font-medium transition ${
                              on
                                ? 'border-[var(--sh-ink)] bg-[var(--sh-ink)] text-[var(--surface)]'
                                : 'border-[var(--sh-hair)] bg-[var(--surface)] text-[var(--sh-ink-3)] hover:border-[var(--sh-ink-3)]'
                            } disabled:opacity-60 disabled:cursor-not-allowed`}
                          >
                            {cat.name}
                          </button>
                        );
                      })}
                    </div>
                  )}
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
                    {/*
                     * Split button: primary "Publish" (manual distribution) +
                     * chevron that opens a menu for "Broadcast". Publish makes
                     * the card available without fan-out — admins hand-pick
                     * recipients. Broadcast auto-sends to all matching users.
                     */}
                    <div ref={publishMenuRef} className="relative inline-flex">
                      <button
                        onClick={() => setPendingPublishMode('manual')}
                        disabled={publishMutation.isPending}
                        className="rounded-l-md bg-[var(--sh-ink)] px-3 py-1.5 text-xs font-medium text-[var(--surface)] hover:opacity-90 disabled:opacity-50"
                      >
                        Publish
                      </button>
                      <button
                        type="button"
                        onClick={() => setPublishMenuOpen((v) => !v)}
                        disabled={publishMutation.isPending}
                        aria-label="More publish options"
                        aria-haspopup="menu"
                        aria-expanded={publishMenuOpen}
                        className="rounded-r-md border-l border-white/20 bg-[var(--sh-ink)] px-1.5 py-1.5 text-[var(--surface)] hover:opacity-90 disabled:opacity-50"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                      {publishMenuOpen && (
                        <div
                          role="menu"
                          className="absolute bottom-full right-0 mb-1 w-56 overflow-hidden rounded-md border border-[var(--sh-hair)] bg-[var(--surface)] shadow-lg"
                        >
                          <button
                            role="menuitem"
                            onClick={() => {
                              setPublishMenuOpen(false);
                              setPendingPublishMode('broadcast');
                            }}
                            className="block w-full px-3 py-2 text-left text-xs hover:bg-[var(--sh-hair-3)]"
                          >
                            <div className="font-medium text-[var(--sh-ink)]">Broadcast</div>
                            <div className="text-[var(--sh-ink-3)]">Publish to all matching partners and talents</div>
                          </button>
                        </div>
                      )}
                    </div>
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
              open={pendingPublishMode !== null}
              title={
                pendingPublishMode === 'manual'
                  ? 'Publish subscription card'
                  : 'Broadcast subscription card'
              }
              description={(() => {
                const baseDescription =
                  pendingPublishMode === 'manual'
                    ? "The card will appear in the Subscription Cards list and on SquadHire's admin, but partners and talents won't see it until you hand-pick them from the recipients panel. You can recall it only before anyone accepts."
                    : `This will send the card to all matching partners (tiers ${targetTiers.length === 0 ? 'Any' : targetTiers.join(', ')}, min ${parseInt(minExp || '0', 10) || 0}y, ${targetCountryIds.length || 'all'} countries). You can recall it only before anyone accepts.`;
                // Loud-on-purpose warning when no SquadHire categories are
                // selected — silent skip is the bug we're guarding against.
                if (squadhireCategoryIds.length === 0) {
                  return `⚠ This card will NOT be sent to SquadHire (no SquadHire categories selected) — talents won't see it. Cancel and pick a category if that's not intentional. ${baseDescription}`;
                }
                return baseDescription;
              })()}
              confirmWord={pendingPublishMode === 'manual' ? 'PUBLISH' : 'BROADCAST'}
              loading={publishMutation.isPending}
              onClose={() => setPendingPublishMode(null)}
              onConfirm={() => {
                const mode = pendingPublishMode;
                setPendingPublishMode(null);
                if (mode) handlePublish(mode);
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

function DefaultDeliverableRow({
  deliverable, enabled, onToggle, readOnly,
}: {
  deliverable: SubscriptionPlanDeliverable;
  enabled: boolean;
  onToggle: () => void;
  readOnly: boolean;
}) {
  const label = deliverable.kind === 'hours' ? 'Hours' : (deliverable.deliverable_type?.name || 'Item');
  const badgeClass = deliverable.kind === 'hours'
    ? 'bg-indigo-100 text-indigo-700'
    : 'bg-purple-100 text-purple-700';
  const cadence = formatDeliverableCadence(
    deliverable.per_day,
    deliverable.per_week,
    deliverable.per_month,
    deliverable.kind === 'hours' ? 'hrs' : (deliverable.deliverable_type?.name || 'items'),
  );
  return (
    <li
      className={`flex items-center justify-between gap-3 px-3 py-2.5 transition ${enabled ? '' : 'opacity-50'}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${badgeClass}`}>{label}</span>
        <span className={`text-sm ${enabled ? 'text-[var(--sh-ink)]' : 'line-through text-[var(--sh-ink-3)]'}`}>
          {cadence}
        </span>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        onClick={onToggle}
        disabled={readOnly}
        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition disabled:cursor-not-allowed disabled:opacity-60 ${
          enabled ? 'bg-emerald-500' : 'bg-slate-300'
        }`}
      >
        <span
          className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition ${
            enabled ? 'translate-x-4' : 'translate-x-0'
          }`}
        />
      </button>
    </li>
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
        deliverable_type_id: kind === 'item' && typeId ? typeId : null,
      },
    ]);
    reset();
  }

  return (
    <div className="space-y-2">
      {value.length === 0 && !adding && (
        <p className="text-xs text-[var(--sh-ink-4)]">No custom deliverables on this card.</p>
      )}
      {value.map((d) => {
        const typeName = d.kind === 'item' && d.deliverable_type_id
          ? deliverableTypes.find((t) => t.id === d.deliverable_type_id)?.name || null
          : null;
        // Title prefers the deliverable-type name (what the admin picked from
        // the dropdown). Falls back to legacy `name` for rows saved before
        // deliverable_type_id existed.
        const title = d.kind === 'hours' ? 'Hours' : (typeName || d.name || 'Item');
        const labelDifferent = d.kind === 'item' && d.name && d.name !== title;
        const cadenceUnit = d.kind === 'hours' ? 'hrs' : (typeName || 'items');
        return (
          <div
            key={d.id}
            className="flex items-center justify-between rounded-md border border-[var(--sh-hair)] bg-[var(--surface)] px-3 py-2"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${
                  d.kind === 'hours' ? 'bg-indigo-100 text-indigo-700' : 'bg-purple-100 text-purple-700'
                }`}
              >
                {d.kind === 'hours' ? 'Hours' : 'Item'}
              </span>
              <span className="text-sm font-medium text-[var(--sh-ink)]">{title}</span>
              {labelDifferent && (
                <span className="text-xs text-[var(--sh-ink-3)]">"{d.name}"</span>
              )}
              <span className="text-xs text-[var(--sh-ink-3)]">
                {formatDeliverableCadence(d.per_day, d.per_week, d.per_month, cadenceUnit)}
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
        );
      })}
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
