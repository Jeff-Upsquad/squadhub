'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import { STATES_BY_COUNTRY_NAME, LANGUAGE_OPTIONS } from './locationLanguageOptions';

// Map the upsquad-style service_type label to the subscriptions catalog slug.
const SERVICE_TYPE_TO_SLUG: Record<string, string> = {
  Designers: 'designer',
  Editors: 'video_editor',
  'Designer plus Editor': 'designer_video_editor',
};

const PLAN_TO_CANONICAL: Record<string, string> = {
  starter: 'Starter', basic: 'Basic', plus: 'Plus', pro: 'Pro', personal: 'Personal',
};

interface PlanLookupRow {
  plan: {
    id: string;
    daily_hours: number | null;
    weekly_hours: number | null;
    plan: string;
    tier: string;
  };
  pricing: Array<{
    plan_id: string;
    country_id: string;
    price: number;
    margin_value: number;
    margin_type: 'fixed' | 'percent';
    country?: { id: string; name: string; currency: string };
  }>;
}

function workingDaysThisMonth(workingDays: string[]): number {
  if (workingDays.length === 0) return 0;
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const dayMap: Record<number, string> = { 0: 'Sun', 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat' };
  let count = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const wd = new Date(year, month, d).getDay();
    if (workingDays.includes(dayMap[wd])) count++;
  }
  return count;
}

function computePartnerPrice(proposed: number, marginValue: number, marginType: 'fixed' | 'percent'): number {
  if (proposed <= 0) return 0;
  if (marginType === 'percent') return Math.max(0, Math.round(proposed - (proposed * marginValue) / 100));
  return Math.max(0, proposed - marginValue);
}

interface CardData {
  id: string;
  state: string;
  source: string;
  distribution: string;
  working_days: string[];
  brand_name: string | null;
  business_nature: string | null;
  notes: string | null;
  requirement_note: string | null;
  target_tiers: string[];
  min_experience_years: number;
  target_languages: string[];
  custom_deliverables: Deliverable[];
  proposed_price: number | null;
  markup: number;
  publish_targets: string[];
  customer_name: string | null;
  customer_email: string | null;
  customer_company: string | null;
  customer_phone: string | null;
  customer_location: string | null;
  service_type: string | null;
  plan_name: string | null;
  subscription_request_id: number | null;
  squadhire_category_ids: string[] | null;
  target_country_ids: string[];
  target_regions: { country_id: string; region: string }[];
}

interface Deliverable {
  id: string;
  name: string;
  kind: 'hours' | 'item';
  per_day: number;
  per_week: number;
  per_month: number;
}

const VALID_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const VALID_TIERS = ['Junior', 'Pro', 'Elite', 'Custom'];
const VALID_PLANS = ['starter', 'basic', 'plus', 'pro', 'personal'];
const SERVICE_TYPES = ['Designers', 'Editors', 'Designer plus Editor'];

export default function AdminCardEditor({
  cardId,
  onClose,
}: {
  cardId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();

  const { data: cardRes, isLoading } = useQuery({
    queryKey: ['admin-card-editor', cardId],
    queryFn: async () => {
      for (const state of ['draft', 'published', 'closed']) {
        const r = await api.get('/admin/subscription-cards', { params: { state } });
        const found = (r.data?.data || []).find((c: any) => c.id === cardId);
        if (found) return found;
      }
      return null;
    },
    enabled: !!cardId,
  });

  const card: CardData | null = cardRes || null;

  // Local form state
  const [serviceType, setServiceType] = useState('');
  const [planName, setPlanName] = useState('');
  const [originalProposedPrice, setOriginalProposedPrice] = useState<number | null>(null);
  const [tiers, setTiers] = useState<string[]>([]);
  const [workingDays, setWorkingDays] = useState<string[]>([]);
  const [customerCompany, setCustomerCompany] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerLocation, setCustomerLocation] = useState('');
  const [emailEditable, setEmailEditable] = useState(false);
  const [phoneEditable, setPhoneEditable] = useState(false);
  const [proposedPrice, setProposedPrice] = useState<number>(0);
  const [markup, setMarkup] = useState<number>(0);
  const [publishTargets, setPublishTargets] = useState<string[]>(['partner', 'talent']);
  const [distribution, setDistribution] = useState<string>('broadcast');
  const [brandName, setBrandName] = useState('');
  const [businessNature, setBusinessNature] = useState('');
  const [notes, setNotes] = useState('');
  const [requirementNote, setRequirementNote] = useState('');
  const [deliverables, setDeliverables] = useState<Deliverable[]>([]);
  const [targetCountryIds, setTargetCountryIds] = useState<string[]>([]);
  const [targetRegions, setTargetRegions] = useState<{ country_id: string; region: string }[]>([]);
  const [targetLanguages, setTargetLanguages] = useState<string[]>([]);
  const [squadhireCategoryIds, setSquadhireCategoryIds] = useState<string[]>([]);

  // Populate form from loaded card
  useEffect(() => {
    if (!card) return;
    setServiceType(card.service_type || '');
    setPlanName(card.plan_name || '');
    setTiers(card.target_tiers || []);
    setWorkingDays(card.working_days || []);
    setCustomerCompany(card.customer_company || '');
    setCustomerName(card.customer_name || '');
    setCustomerEmail(card.customer_email || '');
    setCustomerPhone(card.customer_phone || '');
    setCustomerLocation(card.customer_location || '');
    setEmailEditable(false);
    setPhoneEditable(false);
    setProposedPrice(card.proposed_price || 0);
    setOriginalProposedPrice(card.proposed_price);
    setMarkup(card.markup || 0);
    setPublishTargets(card.publish_targets || ['partner', 'talent']);
    setDistribution(card.distribution || 'broadcast');
    setBrandName(card.brand_name || '');
    setBusinessNature(card.business_nature || '');
    setNotes(card.notes || '');
    setRequirementNote(card.requirement_note || '');
    setDeliverables(card.custom_deliverables || []);
    setTargetCountryIds(card.target_country_ids || []);
    setTargetRegions(card.target_regions || []);
    setTargetLanguages(card.target_languages || []);
    setSquadhireCategoryIds(card.squadhire_category_ids || []);
  }, [card]);

  // Catalog lookup: when service + plan + first selected tier are known,
  // pull daily/weekly hours and the per-country margin from subscriptions.
  const catalogServiceSlug = SERVICE_TYPE_TO_SLUG[serviceType] || '';
  const catalogPlan = planName ? PLAN_TO_CANONICAL[planName.toLowerCase()] || '' : '';
  const catalogTier = tiers[0] || '';
  const catalogQuery = useQuery<PlanLookupRow | null>({
    queryKey: ['admin-card-plan-lookup', catalogServiceSlug, catalogTier, catalogPlan],
    enabled: !!catalogServiceSlug && !!catalogPlan && !!catalogTier,
    queryFn: () =>
      api
        .get('/admin/subscriptions/lookup', {
          params: { service: catalogServiceSlug, tier: catalogTier, plan: catalogPlan },
        })
        .then((r) => r.data?.data || null)
        .catch(() => null),
  });

  const catalog = catalogQuery.data || null;
  const dailyHours = catalog?.plan?.daily_hours ?? null;
  const weeklyHours = catalog?.plan?.weekly_hours ?? null;
  const monthlyHours = useMemo(() => {
    if (dailyHours == null) return null;
    const days = workingDaysThisMonth(workingDays);
    return Number((dailyHours * days).toFixed(2));
  }, [dailyHours, workingDays]);

  // Catalog gives the default margin per (plan, country); typically the first
  // pricing row (India). Card-level edit lives in the existing markup column.
  const catalogPricingRow = catalog?.pricing?.[0] || null;
  const catalogMarginInRupees = useMemo(() => {
    if (!catalogPricingRow || proposedPrice <= 0) return null;
    return catalogPricingRow.margin_type === 'percent'
      ? Math.round((proposedPrice * catalogPricingRow.margin_value) / 100)
      : catalogPricingRow.margin_value;
  }, [catalogPricingRow, proposedPrice]);

  // Seed margin from catalog when admin hasn't set one yet (markup === 0 on
  // load and proposed price is known). Only fires once per card load via the
  // [card?.id, catalogPricingRow] dep — won't clobber a manual edit.
  useEffect(() => {
    if (!card) return;
    if ((card.markup ?? 0) > 0) return;
    if (catalogMarginInRupees == null) return;
    setMarkup(catalogMarginInRupees);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card?.id, catalogPricingRow?.plan_id, proposedPrice]);

  const partnerPrice = useMemo(() => {
    if (proposedPrice <= 0) return null;
    return Math.max(0, proposedPrice - (markup || 0));
  }, [proposedPrice, markup]);

  const saveMutation = useMutation({
    mutationFn: () =>
      api.patch(`/admin/subscription-cards/${cardId}/edit`, {
        service_type: serviceType || null,
        plan_name: planName || null,
        working_days: workingDays,
        customer_company: customerCompany || null,
        customer_location: customerLocation || null,
        customer_name: customerName || null,
        customer_email: customerEmail || null,
        customer_phone: customerPhone || null,
        proposed_price: proposedPrice || null,
        markup,
        publish_targets: publishTargets,
        distribution,
        brand_name: brandName || null,
        business_nature: businessNature || null,
        notes: notes || null,
        requirement_note: requirementNote || null,
        custom_deliverables: deliverables,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-card-editor', cardId] });
    },
  });

  const targetsMutation = useMutation({
    mutationFn: () =>
      api.put(`/admin/subscription-cards/${cardId}/targets`, {
        target_tiers: tiers,
        target_languages: targetLanguages,
        target_country_ids: targetCountryIds,
        target_regions: targetRegions,
        squadhire_category_ids: squadhireCategoryIds,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-card-editor', cardId] });
    },
  });

  // Countries list (for the Location section)
  const countriesQuery = useQuery({
    queryKey: ['admin-countries'],
    queryFn: () => api.get('/admin/countries').then((r) => r.data?.data || []),
  });
  const countries: Array<{ id: string; name: string }> = countriesQuery.data || [];
  const countryById: Record<string, { id: string; name: string }> = {};
  countries.forEach((c) => { countryById[c.id] = c; });

  // SquadHire categories — drives the publish gate. Empty = card is not
  // delivered to SquadHire (the "Not on SquadHire" badge in the list view).
  // Same query key the Subscriptions module uses, so the cache is shared.
  const squadhireCategoriesQuery = useQuery({
    queryKey: ['squadhire-categories'],
    queryFn: () => api.get('/admin/integrations/squadhire/categories').then((r) => r.data?.data || []),
    staleTime: 10 * 60 * 1000,
  });
  const squadhireCategories: Array<{ id: string; name: string; slug: string }> =
    squadhireCategoriesQuery.data || [];

  const publishMutation = useMutation({
    mutationFn: async () => {
      await saveMutation.mutateAsync();
      await targetsMutation.mutateAsync();
      return api.post(`/admin/subscription-cards/${cardId}/publish`, { distribution });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-published-cards'] });
      onClose();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/admin/subscription-cards/${cardId}`),
    onSuccess: onClose,
  });

  const handleSave = useCallback(async () => {
    await saveMutation.mutateAsync();
    await targetsMutation.mutateAsync();
  }, [saveMutation, targetsMutation]);

  const addDeliverable = () => {
    setDeliverables((prev) => [
      ...prev,
      { id: crypto.randomUUID(), name: '', kind: 'item', per_day: 0, per_week: 0, per_month: 0 },
    ]);
  };

  const updateDeliverable = (id: string, field: string, value: any) => {
    setDeliverables((prev) =>
      prev.map((d) => (d.id === id ? { ...d, [field]: value } : d)),
    );
  };

  const removeDeliverable = (id: string) => {
    setDeliverables((prev) => prev.filter((d) => d.id !== id));
  };

  const isDraft = card?.state === 'draft';

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-[#90A1B9]">Loading card…</p>
      </div>
    );
  }

  if (!card) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <p className="text-sm text-[#90A1B9]">Card not found.</p>
        <button onClick={onClose} className="text-sm text-blue-600 hover:underline">Go back</button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[#E2E8F0] bg-white px-6 py-4">
        <div>
          <button onClick={onClose} className="text-sm text-[#62748E] hover:text-[#0F172B]">
            ← Back
          </button>
          <h1 className="mt-1 text-lg font-semibold text-[#0F172B]">
            {card.source === 'request' ? 'Card from Request' : 'Custom Card'}
            {card.subscription_request_id && (
              <span className="ml-2 text-sm font-normal text-[#62748E]">
                (Request #{card.subscription_request_id})
              </span>
            )}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {isDraft && (
            <>
              <button
                onClick={() => deleteMutation.mutate()}
                disabled={deleteMutation.isPending}
                className="rounded-md border border-red-200 px-3 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-50"
              >
                Delete
              </button>
              <button
                onClick={handleSave}
                disabled={saveMutation.isPending}
                className="rounded-md border border-[#E2E8F0] px-3 py-2 text-sm font-medium text-[#0F172B] transition hover:bg-slate-50 disabled:opacity-50"
              >
                {saveMutation.isPending ? 'Saving…' : 'Save Draft'}
              </button>
              <button
                onClick={() => publishMutation.mutate()}
                disabled={publishMutation.isPending}
                className="rounded-md bg-[#0F172B] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#1E293B] disabled:opacity-50"
              >
                {publishMutation.isPending ? 'Publishing…' : 'Publish'}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Form */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto max-w-3xl space-y-8">
          {/* Plan Basics */}
          <Section title="Plan Basics">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Service Type">
                <select
                  value={serviceType}
                  onChange={(e) => setServiceType(e.target.value)}
                  disabled={!isDraft}
                  className="w-full rounded-md border border-[#E2E8F0] bg-white px-3 py-2 text-sm"
                >
                  <option value="">Select…</option>
                  {SERVICE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </Field>
              <Field label="Plan">
                <select
                  value={planName}
                  onChange={(e) => setPlanName(e.target.value)}
                  disabled={!isDraft}
                  className="w-full rounded-md border border-[#E2E8F0] bg-white px-3 py-2 text-sm"
                >
                  <option value="">Select…</option>
                  {VALID_PLANS.map((p) => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Tiers">
              <div className="flex flex-wrap gap-2">
                {VALID_TIERS.map((tier) => (
                  <label key={tier} className="flex items-center gap-1.5 text-sm">
                    <input
                      type="checkbox"
                      checked={tiers.includes(tier)}
                      onChange={(e) =>
                        setTiers(e.target.checked
                          ? [...tiers, tier]
                          : tiers.filter((t) => t !== tier))
                      }
                      disabled={!isDraft}
                      className="rounded border-[#E2E8F0]"
                    />
                    {tier}
                  </label>
                ))}
              </div>
            </Field>
            <Field label="Working Days">
              <div className="flex flex-wrap gap-2">
                {VALID_DAYS.map((day) => (
                  <label key={day} className="flex items-center gap-1.5 text-sm">
                    <input
                      type="checkbox"
                      checked={workingDays.includes(day)}
                      onChange={(e) =>
                        setWorkingDays(e.target.checked
                          ? [...workingDays, day]
                          : workingDays.filter((d) => d !== day))
                      }
                      disabled={!isDraft}
                      className="rounded border-[#E2E8F0]"
                    />
                    {day}
                  </label>
                ))}
              </div>
            </Field>
          </Section>

          {/* Customer */}
          {/* Location & Language */}
          <Section title="Location & Language">
            <Field label="Country">
              <select
                value={targetCountryIds[0] || ''}
                onChange={(e) => {
                  const id = e.target.value;
                  setTargetCountryIds(id ? [id] : []);
                  // Drop any region rows tied to a different country
                  setTargetRegions((prev) => prev.filter((r) => r.country_id === id));
                }}
                disabled={!isDraft}
                className="w-full rounded-md border border-[#E2E8F0] bg-white px-3 py-2 text-sm disabled:bg-slate-50"
              >
                <option value="">No country preference</option>
                {countries.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </Field>
            <Field label="States / regions">
              {(() => {
                const selectedCountryId = targetCountryIds[0];
                const selectedCountry = selectedCountryId ? countryById[selectedCountryId] : null;
                const stateOptions = selectedCountry ? STATES_BY_COUNTRY_NAME[selectedCountry.name] || [] : [];
                if (!selectedCountry) {
                  return <p className="text-xs text-[#90A1B9]">Pick a country above to enable.</p>;
                }
                if (stateOptions.length === 0) {
                  return <p className="text-xs text-[#90A1B9]">No state list configured for {selectedCountry.name}.</p>;
                }
                const selectedRegions = new Set(targetRegions.map((r) => r.region));
                return (
                  <div className="flex flex-wrap gap-2">
                    {stateOptions.map((state) => {
                      const active = selectedRegions.has(state);
                      return (
                        <button
                          key={state}
                          type="button"
                          onClick={() => {
                            if (!isDraft) return;
                            setTargetRegions((prev) => {
                              if (active) return prev.filter((r) => r.region !== state);
                              return [...prev, { country_id: selectedCountryId, region: state }];
                            });
                          }}
                          disabled={!isDraft}
                          className={`rounded-full px-3 py-1 text-xs transition border ${
                            active
                              ? 'bg-indigo-600 text-white border-indigo-600'
                              : 'bg-white text-[#0F172B] border-[#E2E8F0] hover:bg-indigo-50'
                          } disabled:opacity-50 disabled:cursor-not-allowed`}
                        >
                          {active && '✓ '}{state}
                        </button>
                      );
                    })}
                  </div>
                );
              })()}
            </Field>
            <Field label="Languages">
              <div className="flex flex-wrap gap-2">
                {LANGUAGE_OPTIONS.map((lang) => {
                  const active = targetLanguages.includes(lang);
                  return (
                    <button
                      key={lang}
                      type="button"
                      onClick={() => {
                        if (!isDraft) return;
                        setTargetLanguages((prev) =>
                          active ? prev.filter((l) => l !== lang) : [...prev, lang],
                        );
                      }}
                      disabled={!isDraft}
                      className={`rounded-full px-3 py-1 text-xs transition border ${
                        active
                          ? 'bg-amber-500 text-white border-amber-500'
                          : 'bg-white text-[#0F172B] border-[#E2E8F0] hover:bg-amber-50'
                      } disabled:opacity-50 disabled:cursor-not-allowed`}
                    >
                      {active && '✓ '}{lang}
                    </button>
                  );
                })}
              </div>
            </Field>
            <Field label="SquadHire Categories">
              <p className="mb-2 text-[11px] text-[#90A1B9]">
                The card is only delivered to SquadHire when at least one
                category is picked — talents subscribed to these categories
                see the card. Pre-filled from the matching subscription's
                SquadHire Profile when available.
              </p>
              {squadhireCategories.length === 0 ? (
                <p className="text-xs text-[#90A1B9]">No categories loaded.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {squadhireCategories.map((cat) => {
                    const active = squadhireCategoryIds.includes(cat.id);
                    return (
                      <button
                        key={cat.id}
                        type="button"
                        onClick={() => {
                          if (!isDraft) return;
                          setSquadhireCategoryIds((prev) =>
                            active ? prev.filter((id) => id !== cat.id) : [...prev, cat.id],
                          );
                        }}
                        disabled={!isDraft}
                        className={`rounded-full px-3 py-1 text-xs transition border ${
                          active
                            ? 'bg-emerald-600 text-white border-emerald-600'
                            : 'bg-white text-[#0F172B] border-[#E2E8F0] hover:bg-emerald-50'
                        } disabled:opacity-50 disabled:cursor-not-allowed`}
                      >
                        {active && '✓ '}{cat.name}
                      </button>
                    );
                  })}
                </div>
              )}
            </Field>
          </Section>

          <Section title="Customer">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Company">
                <input
                  value={customerCompany}
                  onChange={(e) => setCustomerCompany(e.target.value)}
                  disabled={!isDraft}
                  className="w-full rounded-md border border-[#E2E8F0] bg-white px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-500"
                />
              </Field>
              <Field label="Contact Name">
                <input
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  disabled={!isDraft}
                  className="w-full rounded-md border border-[#E2E8F0] bg-white px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-500"
                />
              </Field>
              <Field label="Email" onEditClick={isDraft ? () => setEmailEditable(true) : undefined} editActive={emailEditable}>
                <input
                  value={customerEmail}
                  onChange={(e) => setCustomerEmail(e.target.value)}
                  disabled={!isDraft || !emailEditable}
                  className="w-full rounded-md border border-[#E2E8F0] bg-white px-3 py-2 text-sm transition-colors disabled:bg-slate-50 disabled:text-slate-500"
                />
              </Field>
              <Field label="Phone" onEditClick={isDraft ? () => setPhoneEditable(true) : undefined} editActive={phoneEditable}>
                <input
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  disabled={!isDraft || !phoneEditable}
                  className="w-full rounded-md border border-[#E2E8F0] bg-white px-3 py-2 text-sm transition-colors disabled:bg-slate-50 disabled:text-slate-500"
                />
              </Field>
              <div className="col-span-2">
                <Field label="Location of Business">
                  <input
                    value={customerLocation}
                    onChange={(e) => setCustomerLocation(e.target.value)}
                    disabled={!isDraft}
                    placeholder="e.g. Bangalore, India"
                    className="w-full rounded-md border border-[#E2E8F0] bg-white px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-500"
                  />
                </Field>
              </div>
            </div>
          </Section>

          {/* Plan Deliverables (read-only, derived from catalog) */}
          <Section title="Plan Deliverables">
            {dailyHours == null ? (
              <p className="text-xs text-[#90A1B9]">
                Pick service, plan, and at least one tier to see hours from the catalog.
              </p>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-4">
                  <ReadOnlyField label="Daily Hours">{dailyHours} hr/day</ReadOnlyField>
                  <ReadOnlyField label="Weekly Hours">{weeklyHours ?? '—'} hr/wk</ReadOnlyField>
                  <ReadOnlyField label={`Monthly (${workingDaysThisMonth(workingDays)} days)`}>
                    {monthlyHours != null ? `${monthlyHours} hr/mo` : '—'}
                  </ReadOnlyField>
                </div>
                <p className="mt-2 text-[11px] text-[#90A1B9]">
                  Editable from the Subscriptions module ({catalog?.plan?.tier} · {catalog?.plan?.plan}).
                </p>
              </>
            )}
          </Section>

          {/* Custom Deliverables (moved here, below the auto-derived block) */}
          <Section title="Custom Deliverables">
            <div className="space-y-3">
              {deliverables.map((d) => (
                <div key={d.id} className="flex items-start gap-2 rounded-lg border border-[#E2E8F0] bg-white p-3">
                  <div className="flex-1 grid grid-cols-4 gap-2">
                    <input
                      value={d.name}
                      onChange={(e) => updateDeliverable(d.id, 'name', e.target.value)}
                      placeholder="Name"
                      disabled={!isDraft}
                      className="col-span-2 rounded-md border border-[#E2E8F0] px-2 py-1.5 text-sm"
                    />
                    <select
                      value={d.kind}
                      onChange={(e) => updateDeliverable(d.id, 'kind', e.target.value)}
                      disabled={!isDraft}
                      className="rounded-md border border-[#E2E8F0] px-2 py-1.5 text-sm"
                    >
                      <option value="item">Item</option>
                      <option value="hours">Hours</option>
                    </select>
                    <input
                      type="number"
                      value={d.per_month || ''}
                      onChange={(e) => updateDeliverable(d.id, 'per_month', parseInt(e.target.value) || 0)}
                      placeholder="/mo"
                      disabled={!isDraft}
                      className="rounded-md border border-[#E2E8F0] px-2 py-1.5 text-sm"
                    />
                  </div>
                  {isDraft && (
                    <button
                      onClick={() => removeDeliverable(d.id)}
                      className="mt-1.5 text-sm text-red-500 hover:text-red-700"
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
              {isDraft && (
                <button
                  onClick={addDeliverable}
                  className="rounded-md border border-dashed border-[#E2E8F0] px-3 py-2 text-sm text-[#62748E] hover:border-[#0F172B] hover:text-[#0F172B]"
                >
                  + Add Deliverable
                </button>
              )}
            </div>
          </Section>

          {/* Pricing */}
          <Section title="Pricing">
            <div className="grid grid-cols-3 gap-4">
              <Field label="Proposed Price (₹/mo)">
                <input
                  type="number"
                  value={proposedPrice || ''}
                  onChange={(e) => setProposedPrice(parseInt(e.target.value) || 0)}
                  disabled={!isDraft}
                  className="w-full rounded-md border border-[#E2E8F0] bg-white px-3 py-2 text-sm disabled:bg-slate-50"
                />
                {originalProposedPrice != null && originalProposedPrice !== proposedPrice && (
                  <p className="mt-1 text-[11px] text-[#90A1B9]">
                    Originally <span className="line-through">₹{originalProposedPrice.toLocaleString()}</span>
                  </p>
                )}
                {catalogPricingRow && (
                  <p className="mt-1 text-[11px] text-[#90A1B9]">
                    Catalog min: ₹{catalogPricingRow.price.toLocaleString()}
                  </p>
                )}
              </Field>
              <Field label="Margin (₹/mo)">
                <input
                  type="number"
                  min={0}
                  value={markup || ''}
                  onChange={(e) => setMarkup(parseInt(e.target.value) || 0)}
                  disabled={!isDraft}
                  className="w-full rounded-md border border-[#E2E8F0] bg-white px-3 py-2 text-sm disabled:bg-slate-50"
                />
                {catalogPricingRow && (
                  <p className="mt-1 text-[11px] text-[#90A1B9]">
                    Catalog: {catalogPricingRow.margin_type === 'percent'
                      ? `${catalogPricingRow.margin_value}% (= ₹${(catalogMarginInRupees ?? 0).toLocaleString()})`
                      : `₹${catalogPricingRow.margin_value.toLocaleString()} (flat)`}
                  </p>
                )}
              </Field>
              <Field label="Partner Price (₹/mo)">
                <div className="flex h-[38px] items-center rounded-md border border-[#E2E8F0] bg-slate-50 px-3 text-sm font-semibold text-[#0F172B]">
                  {partnerPrice != null ? `₹${partnerPrice.toLocaleString()}` : '—'}
                </div>
                <p className="mt-1 text-[11px] text-[#90A1B9]">= Proposed − Margin</p>
              </Field>
            </div>
          </Section>

          {/* Client Brief */}
          <Section title="Client Brief">
            <div className="grid grid-cols-1 gap-4">
              <Field label="Brand Name">
                <input
                  value={brandName}
                  onChange={(e) => setBrandName(e.target.value)}
                  disabled={!isDraft}
                  className="w-full rounded-md border border-[#E2E8F0] bg-white px-3 py-2 text-sm"
                />
              </Field>
              <Field label="Business Nature">
                <textarea
                  value={businessNature}
                  onChange={(e) => setBusinessNature(e.target.value)}
                  disabled={!isDraft}
                  rows={2}
                  className="w-full rounded-md border border-[#E2E8F0] bg-white px-3 py-2 text-sm resize-none"
                />
              </Field>
              <Field label="Notes">
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  disabled={!isDraft}
                  rows={3}
                  className="w-full rounded-md border border-[#E2E8F0] bg-white px-3 py-2 text-sm resize-none"
                />
              </Field>
              <Field label="Requirement Note">
                <textarea
                  value={requirementNote}
                  onChange={(e) => setRequirementNote(e.target.value)}
                  disabled={!isDraft}
                  rows={3}
                  placeholder="Short note about the requirement"
                  className="w-full rounded-md border border-[#E2E8F0] bg-white px-3 py-2 text-sm resize-none"
                />
              </Field>
            </div>
          </Section>

          {/* Publish Settings */}
          <Section title="Publish Settings">
            <Field label="Publish To">
              <div className="flex gap-4">
                {['partner', 'talent'].map((target) => (
                  <label key={target} className="flex items-center gap-1.5 text-sm">
                    <input
                      type="checkbox"
                      checked={publishTargets.includes(target)}
                      onChange={(e) =>
                        setPublishTargets(e.target.checked
                          ? [...publishTargets, target]
                          : publishTargets.filter((t) => t !== target))
                      }
                      disabled={!isDraft}
                      className="rounded border-[#E2E8F0]"
                    />
                    {target.charAt(0).toUpperCase() + target.slice(1)}
                  </label>
                ))}
              </div>
            </Field>
            <Field label="Distribution">
              <div className="flex gap-4">
                {(['broadcast', 'manual'] as const).map((mode) => (
                  <label key={mode} className="flex items-center gap-1.5 text-sm">
                    <input
                      type="radio"
                      name="distribution"
                      value={mode}
                      checked={distribution === mode}
                      onChange={() => setDistribution(mode)}
                      disabled={!isDraft}
                      className="border-[#E2E8F0]"
                    />
                    {mode === 'broadcast' ? 'Broadcast (all matching users)' : 'Publish (share manually)'}
                  </label>
                ))}
              </div>
            </Field>
          </Section>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="mb-3 text-sm font-semibold text-[#0F172B] uppercase tracking-wide">{title}</h2>
      <div className="space-y-4 rounded-lg border border-[#E2E8F0] bg-white p-4">
        {children}
      </div>
    </div>
  );
}

function Field({ label, children, onEditClick, editActive }: { label: string; children: React.ReactNode; onEditClick?: () => void; editActive?: boolean }) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-1.5">
        <label className="text-xs font-medium text-[#62748E]">{label}</label>
        {onEditClick && !editActive && (
          <button type="button" onClick={onEditClick} className="text-[#90A1B9] transition hover:text-[#2962FF]" title={`Edit ${label}`}>
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
            </svg>
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

function ReadOnlyField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-[#62748E]">{label}</label>
      <div className="flex h-[38px] items-center rounded-md border border-[#E2E8F0] bg-slate-50 px-3 text-sm font-semibold text-[#0F172B]">
        {children}
      </div>
    </div>
  );
}
