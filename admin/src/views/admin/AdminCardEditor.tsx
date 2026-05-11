'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
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
  // Per-tier draft pricing: { Junior: { proposed_price, markup }, Pro: ... }.
  // Cleared at publish — fan-out copies each tier's values onto its own
  // sibling card. Empty {} on single-tier drafts.
  tier_pricing: Record<string, { proposed_price: number; markup: number }> | null;
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
      // Look in non-archived first, then archived — covers cards in any
      // state (draft / published / closed) and any archive bucket so the
      // editor doesn't 404 on cards moved to Archive.
      for (const archived of ['false', 'true'] as const) {
        for (const state of ['draft', 'published', 'closed']) {
          const params: Record<string, string> = { state };
          if (archived === 'true') params.archived = 'true';
          const r = await api.get('/admin/subscription-cards', { params });
          const found = (r.data?.data || []).find((c: any) => c.id === cardId);
          if (found) return found;
        }
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
  // Per-tier pricing — source of truth for the form. One entry per
  // selected tier. With 1 tier the Pricing section renders one group;
  // with N tiers it renders N stacked groups. On publish, the backend
  // either flips the single card to published (1 tier) or fans out N
  // sibling cards (2+ tiers), reading prices from this map either way.
  const [tierPricing, setTierPricing] = useState<Record<string, { proposedPrice: number; markup: number }>>({});
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
    // Hydrate tier_pricing from DB if present; otherwise seed every selected
    // tier from the legacy proposed_price/markup so the form round-trips
    // for cards that pre-date this column.
    const dbTierPricing = card.tier_pricing && typeof card.tier_pricing === 'object'
      ? card.tier_pricing
      : null;
    const initialPricing: Record<string, { proposedPrice: number; markup: number }> = {};
    if (dbTierPricing) {
      Object.entries(dbTierPricing).forEach(([tier, p]) => {
        initialPricing[tier] = {
          proposedPrice: (p as any)?.proposed_price ?? 0,
          markup: (p as any)?.markup ?? 0,
        };
      });
    }
    (card.target_tiers || []).forEach((tier) => {
      if (!initialPricing[tier]) {
        initialPricing[tier] = {
          proposedPrice: card.proposed_price || 0,
          markup: card.markup || 0,
        };
      }
    });
    setTierPricing(initialPricing);
    setOriginalProposedPrice(card.proposed_price);
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

  // Toggle a tier on/off, syncing tierPricing in lockstep so every
  // selected tier always has a row in the Pricing section.
  const toggleTier = useCallback((tier: string) => {
    setTiers((prev) => {
      const isOn = prev.includes(tier);
      const next = isOn ? prev.filter((t) => t !== tier) : [...prev, tier];
      setTierPricing((p) => {
        const np = { ...p };
        if (isOn) {
          delete np[tier];
        } else if (!np[tier]) {
          np[tier] = { proposedPrice: 0, markup: 0 };
        }
        return np;
      });
      return next;
    });
  }, []);

  const updateTierPricing = useCallback(
    (tier: string, field: 'proposedPrice' | 'markup', value: number) => {
      setTierPricing((prev) => ({
        ...prev,
        [tier]: {
          proposedPrice: prev[tier]?.proposedPrice ?? 0,
          markup: prev[tier]?.markup ?? 0,
          [field]: value,
        },
      }));
    },
    [],
  );

  // Catalog lookup: one query per selected tier. Each returns its own
  // daily/weekly hours plus the per-country pricing row (used to suggest
  // the default margin for that tier). Hidden tiers don't fire queries.
  const catalogServiceSlug = SERVICE_TYPE_TO_SLUG[serviceType] || '';
  const catalogPlan = planName ? PLAN_TO_CANONICAL[planName.toLowerCase()] || '' : '';
  const catalogQueries = useQueries({
    queries: tiers.map((tier) => ({
      queryKey: ['admin-card-plan-lookup', catalogServiceSlug, tier, catalogPlan],
      enabled: !!catalogServiceSlug && !!catalogPlan && !!tier,
      queryFn: () =>
        api
          .get('/admin/subscriptions/lookup', {
            params: { service: catalogServiceSlug, tier, plan: catalogPlan },
          })
          .then((r) => (r.data?.data as PlanLookupRow | null) || null)
          .catch(() => null),
    })),
  });

  // Index catalog rows by tier for O(1) access in the deliverables / pricing
  // tables. Keeps render code readable when iterating selected tiers.
  const catalogByTier = useMemo(() => {
    const map: Record<string, PlanLookupRow | null> = {};
    tiers.forEach((tier, i) => {
      map[tier] = (catalogQueries[i]?.data as PlanLookupRow | null) ?? null;
    });
    return map;
  }, [tiers, catalogQueries]);

  const workingDaysCount = useMemo(
    () => workingDaysThisMonth(workingDays),
    [workingDays],
  );

  // Compute monthly hours per tier on demand. dailyHours × working days
  // this month, mirroring the previous single-tier behavior.
  const monthlyHoursForTier = useCallback(
    (tier: string): number | null => {
      const daily = catalogByTier[tier]?.plan?.daily_hours ?? null;
      if (daily == null) return null;
      return Number((daily * workingDaysCount).toFixed(2));
    },
    [catalogByTier, workingDaysCount],
  );

  // Catalog-suggested margin in rupees for a given tier given that tier's
  // current proposed price. Mirrors the old single-tier helper.
  const catalogMarginForTier = useCallback(
    (tier: string): number | null => {
      const row = catalogByTier[tier]?.pricing?.[0] || null;
      const proposed = tierPricing[tier]?.proposedPrice ?? 0;
      if (!row || proposed <= 0) return null;
      return row.margin_type === 'percent'
        ? Math.round((proposed * row.margin_value) / 100)
        : row.margin_value;
    },
    [catalogByTier, tierPricing],
  );

  // Seed margin from catalog when admin hasn't set one yet for a tier.
  // Mirrors the legacy single-tier seed: only fires once per (card load,
  // tier, proposed price change) via the dep on tierPricingProposedKey.
  const tierPricingProposedKey = useMemo(
    () => tiers.map((t) => `${t}:${tierPricing[t]?.proposedPrice ?? 0}`).join('|'),
    [tiers, tierPricing],
  );
  useEffect(() => {
    if (!card) return;
    setTierPricing((prev) => {
      let changed = false;
      const next: typeof prev = { ...prev };
      for (const tier of tiers) {
        const entry = next[tier];
        if (!entry) continue;
        if (entry.markup > 0) continue;
        const row = catalogByTier[tier]?.pricing?.[0];
        if (!row || entry.proposedPrice <= 0) continue;
        const suggested = row.margin_type === 'percent'
          ? Math.round((entry.proposedPrice * row.margin_value) / 100)
          : row.margin_value;
        if (suggested > 0) {
          next[tier] = { ...entry, markup: suggested };
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card?.id, tierPricingProposedKey, JSON.stringify(Object.keys(catalogByTier))]);

  const partnerPriceForTier = useCallback(
    (tier: string): number | null => {
      const entry = tierPricing[tier];
      if (!entry || entry.proposedPrice <= 0) return null;
      return Math.max(0, entry.proposedPrice - (entry.markup || 0));
    },
    [tierPricing],
  );

  // Whether at least one selected tier has catalog data loaded — used to
  // decide whether to render the per-tier hours table or the empty-state
  // copy in the combined Deliverables section.
  const anyCatalogLoaded = tiers.some((t) => catalogByTier[t] != null);

  // Build the API tier_pricing map (snake_case shape) from the form state.
  const tierPricingPayload = useMemo(() => {
    const out: Record<string, { proposed_price: number; markup: number }> = {};
    for (const [tier, entry] of Object.entries(tierPricing)) {
      out[tier] = {
        proposed_price: entry.proposedPrice ?? 0,
        markup: entry.markup ?? 0,
      };
    }
    return out;
  }, [tierPricing]);

  // Legacy proposed_price / markup columns: only meaningful when there's
  // exactly one tier (single-card publish path reads from the row). With
  // 2+ tiers, fan-out reads tier_pricing instead, so we send 0/null here.
  const legacyProposedPrice = useMemo(() => {
    if (tiers.length !== 1) return null;
    return tierPricing[tiers[0]]?.proposedPrice || null;
  }, [tiers, tierPricing]);
  const legacyMarkup = useMemo(() => {
    if (tiers.length !== 1) return 0;
    return tierPricing[tiers[0]]?.markup || 0;
  }, [tiers, tierPricing]);

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
        proposed_price: legacyProposedPrice,
        markup: legacyMarkup,
        tier_pricing: tierPricingPayload,
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

  const archiveMutation = useMutation({
    mutationFn: () => api.post(`/admin/subscription-cards/${cardId}/archive`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-published-cards'] });
      queryClient.invalidateQueries({ queryKey: ['admin-subscription-requests'] });
      queryClient.invalidateQueries({ queryKey: ['admin-custom-cards'] });
      queryClient.invalidateQueries({ queryKey: ['admin-custom-cards-drafts'] });
      onClose();
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.error || err?.message || 'Unknown error';
      alert(`Archive failed: ${msg}`);
    },
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

  // Publish gate: every selected tier must have a non-zero proposed price
  // (single-tier and multi-tier both — fan-out throws on missing entries).
  // Fall back to "no tiers" disabled until at least one is selected.
  const canPublish =
    tiers.length > 0 &&
    tiers.every((t) => (tierPricing[t]?.proposedPrice ?? 0) > 0);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center sh-surface">
        <p className="text-sm text-[var(--color-sh-ink-faint)]">Loading card…</p>
      </div>
    );
  }

  if (!card) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 sh-surface">
        <p className="text-sm text-[var(--color-sh-ink-faint)]">Card not found.</p>
        <button onClick={onClose} className="sh-btn-ghost sh-btn-ghost-sm">Go back</button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col sh-surface">
      {/* Header */}
      <div className="flex items-center justify-between px-6 pt-6 pb-4">
        <div className="space-y-2">
          <button onClick={onClose} className="sh-btn-ghost sh-btn-ghost-sm">
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </button>
          <h1 className="sh-display text-2xl sm:text-3xl">
            {card.source === 'request' ? 'Card from Request' : 'Custom Card'}
            {card.subscription_request_id && (
              <span className="ml-2 text-base font-normal text-[var(--color-sh-ink-muted)]">
                (Request #{card.subscription_request_id})
              </span>
            )}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {isDraft && (
            <>
              <button
                onClick={() => {
                  if (window.confirm('Archive this draft card? It will move to the Archive tab where you can republish or delete it later.')) {
                    archiveMutation.mutate();
                  }
                }}
                disabled={archiveMutation.isPending}
                className="sh-btn-violet"
              >
                {archiveMutation.isPending ? 'Archiving…' : 'Archive'}
              </button>
              <button
                onClick={handleSave}
                disabled={saveMutation.isPending}
                className="sh-btn-ghost"
              >
                {saveMutation.isPending ? 'Saving…' : 'Save Draft'}
              </button>
              <button
                onClick={() => publishMutation.mutate()}
                disabled={publishMutation.isPending || !canPublish}
                title={
                  !canPublish
                    ? tiers.length === 0
                      ? 'Select at least one tier with a price'
                      : 'Every selected tier needs a proposed price'
                    : undefined
                }
                className="sh-btn-primary sh-btn-primary-sm"
              >
                {publishMutation.isPending ? 'Publishing…' : 'Publish'}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Form */}
      <div className="flex-1 overflow-y-auto px-6 pb-10">
        <div className="mx-auto max-w-3xl space-y-6">
          {/* Publish Settings */}
          <Section title="Publish Settings">
            <Field label="Publish To">
              <div className="flex gap-2">
                {['partner', 'talent'].map((target) => {
                  const active = publishTargets.includes(target);
                  return (
                    <PillCheckbox
                      key={target}
                      active={active}
                      disabled={!isDraft}
                      onClick={() =>
                        setPublishTargets(active
                          ? publishTargets.filter((t) => t !== target)
                          : [...publishTargets, target])
                      }
                      label={target.charAt(0).toUpperCase() + target.slice(1)}
                    />
                  );
                })}
              </div>
            </Field>
            <Field label="Distribution">
              <div className="flex gap-2">
                {(['broadcast', 'manual'] as const).map((mode) => {
                  const active = distribution === mode;
                  return (
                    <PillCheckbox
                      key={mode}
                      active={active}
                      disabled={!isDraft}
                      onClick={() => setDistribution(mode)}
                      label={mode === 'broadcast' ? 'Broadcast (all matching users)' : 'Publish (share manually)'}
                    />
                  );
                })}
              </div>
            </Field>
          </Section>

          {/* Plan Basics */}
          <Section title="Plan Basics">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Service Type">
                <select
                  value={serviceType}
                  onChange={(e) => setServiceType(e.target.value)}
                  disabled={!isDraft}
                  className="sh-input"
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
                  className="sh-input"
                >
                  <option value="">Select…</option>
                  {VALID_PLANS.map((p) => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Tiers">
              <div className="flex flex-wrap gap-2">
                {VALID_TIERS.map((tier) => {
                  const active = tiers.includes(tier);
                  return (
                    <PillCheckbox
                      key={tier}
                      active={active}
                      disabled={!isDraft}
                      onClick={() => toggleTier(tier)}
                      label={tier}
                    />
                  );
                })}
              </div>
              {tiers.length > 1 && (
                <p className="mt-2 text-[11px] text-[var(--color-sh-ink-faint)]">
                  Publishing will create one card per tier — each broadcast only to that tier's partners and shown as a separate card to the business.
                </p>
              )}
            </Field>
            <Field label="Working Days">
              <div className="flex flex-wrap gap-2">
                {VALID_DAYS.map((day) => {
                  const active = workingDays.includes(day);
                  return (
                    <PillCheckbox
                      key={day}
                      active={active}
                      disabled={!isDraft}
                      onClick={() =>
                        setWorkingDays(active ? workingDays.filter((d) => d !== day) : [...workingDays, day])
                      }
                      label={day}
                    />
                  );
                })}
              </div>
            </Field>
          </Section>

          {/* Deliverables — combined: catalog hours per selected tier (top)
              + shared custom deliverables list (bottom). Custom items are
              applied to every tier card on publish. */}
          <Section title="Deliverables">
            <div className="space-y-5">
              {/* Plan deliverables — one column per selected tier */}
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-sh-ink-muted)]">
                  Plan hours (from catalog)
                </h3>
                {tiers.length === 0 || !anyCatalogLoaded ? (
                  <p className="text-xs text-[var(--color-sh-ink-faint)]">
                    Pick service, plan, and at least one tier to see hours from the catalog.
                  </p>
                ) : (
                  <div className="overflow-x-auto rounded-[10px] border border-[var(--color-sh-warm-border)]">
                    <table className="w-full text-sm">
                      <thead className="bg-[var(--color-sh-cream)]">
                        <tr>
                          <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--color-sh-ink-muted)]">
                            Cadence
                          </th>
                          {tiers.map((tier) => (
                            <th
                              key={tier}
                              className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--color-sh-ink-muted)]"
                            >
                              {tier}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="border-t border-[var(--color-sh-warm-border)]">
                          <td className="px-3 py-2 font-medium text-[var(--color-sh-ink-muted)]">Daily</td>
                          {tiers.map((tier) => {
                            const daily = catalogByTier[tier]?.plan?.daily_hours ?? null;
                            return (
                              <td key={tier} className="px-3 py-2 font-bold text-[var(--color-sh-ink)]">
                                {daily != null ? `${daily} hr/day` : '—'}
                              </td>
                            );
                          })}
                        </tr>
                        <tr className="border-t border-[var(--color-sh-warm-border)]">
                          <td className="px-3 py-2 font-medium text-[var(--color-sh-ink-muted)]">Weekly</td>
                          {tiers.map((tier) => {
                            const weekly = catalogByTier[tier]?.plan?.weekly_hours ?? null;
                            return (
                              <td key={tier} className="px-3 py-2 font-bold text-[var(--color-sh-ink)]">
                                {weekly != null ? `${weekly} hr/wk` : '—'}
                              </td>
                            );
                          })}
                        </tr>
                        <tr className="border-t border-[var(--color-sh-warm-border)]">
                          <td className="px-3 py-2 font-medium text-[var(--color-sh-ink-muted)]">
                            Monthly ({workingDaysCount} days)
                          </td>
                          {tiers.map((tier) => {
                            const monthly = monthlyHoursForTier(tier);
                            return (
                              <td key={tier} className="px-3 py-2 font-bold text-[var(--color-sh-ink)]">
                                {monthly != null ? `${monthly} hr/mo` : '—'}
                              </td>
                            );
                          })}
                        </tr>
                      </tbody>
                    </table>
                    <p className="border-t border-[var(--color-sh-warm-border)] bg-[var(--color-sh-cream)] px-3 py-2 text-[11px] text-[var(--color-sh-ink-faint)]">
                      Hours come from the Subscriptions catalog ({planName || '—'} · {tiers.join(', ') || '—'}).
                    </p>
                  </div>
                )}
              </div>

              {/* Custom deliverables — shared across all tier cards */}
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-sh-ink-muted)]">
                  Custom deliverables
                  {tiers.length > 1 && (
                    <span className="ml-2 font-normal normal-case text-[var(--color-sh-ink-faint)]">
                      (shared across all selected tiers)
                    </span>
                  )}
                </h3>
                <div className="space-y-3">
                  {deliverables.map((d) => (
                    <div key={d.id} className="flex items-start gap-2 rounded-xl border border-[var(--color-sh-warm-border)] bg-[var(--color-sh-cream)] p-3">
                      <div className="flex-1 grid grid-cols-4 gap-2">
                        <input
                          value={d.name}
                          onChange={(e) => updateDeliverable(d.id, 'name', e.target.value)}
                          placeholder="Name"
                          disabled={!isDraft}
                          className="sh-input col-span-2"
                        />
                        <select
                          value={d.kind}
                          onChange={(e) => updateDeliverable(d.id, 'kind', e.target.value)}
                          disabled={!isDraft}
                          className="sh-input"
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
                          className="sh-input"
                        />
                      </div>
                      {isDraft && (
                        <button
                          onClick={() => removeDeliverable(d.id)}
                          className="mt-2 text-base text-red-500 hover:text-red-700"
                          aria-label="Remove deliverable"
                        >
                          ×
                        </button>
                      )}
                    </div>
                  ))}
                  {isDraft && (
                    <button
                      onClick={addDeliverable}
                      className="rounded-xl border border-dashed border-[var(--color-sh-warm-border)] px-4 py-2.5 text-sm font-semibold text-[var(--color-sh-ink-muted)] hover:border-[var(--color-sh-ink)] hover:text-[var(--color-sh-ink)] transition"
                    >
                      + Add Deliverable
                    </button>
                  )}
                </div>
              </div>
            </div>
          </Section>

          {/* Pricing — one labeled group per selected tier. With one tier
              selected this renders a single block, visually similar to the
              old single-trio layout. With N tiers each gets its own
              proposed/margin/partner-price row that publishes as a
              separate card. */}
          <Section title="Pricing">
            {tiers.length === 0 ? (
              <p className="text-xs text-[var(--color-sh-ink-faint)]">
                Select at least one tier above to set pricing.
              </p>
            ) : (
              <div className="space-y-4">
                {tiers.map((tier) => {
                  const entry = tierPricing[tier] || { proposedPrice: 0, markup: 0 };
                  const partnerPrice = partnerPriceForTier(tier);
                  const catalogPricingRow = catalogByTier[tier]?.pricing?.[0] || null;
                  const catalogMarginInRupees = catalogMarginForTier(tier);
                  const showOriginal =
                    tiers.length === 1 &&
                    originalProposedPrice != null &&
                    originalProposedPrice !== entry.proposedPrice;
                  return (
                    <div
                      key={tier}
                      className="rounded-xl border border-[var(--color-sh-warm-border)] bg-[var(--color-sh-cream)] p-4"
                    >
                      <div className="mb-3 flex items-center gap-2">
                        <h3 className="text-sm font-semibold text-[var(--color-sh-ink)]">
                          {tier} pricing
                        </h3>
                        <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-medium text-[var(--color-sh-ink-muted)]">
                          1 card on publish
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-4">
                        <Field label="Proposed Price (₹/mo)">
                          <input
                            type="number"
                            value={entry.proposedPrice || ''}
                            onChange={(e) =>
                              updateTierPricing(tier, 'proposedPrice', parseInt(e.target.value) || 0)
                            }
                            disabled={!isDraft}
                            className="sh-input"
                          />
                          {showOriginal && (
                            <p className="mt-1 text-[11px] text-[var(--color-sh-ink-faint)]">
                              Originally <span className="line-through">₹{originalProposedPrice!.toLocaleString()}</span>
                            </p>
                          )}
                          {catalogPricingRow && (
                            <p className="mt-1 text-[11px] text-[var(--color-sh-ink-faint)]">
                              Catalog min: ₹{catalogPricingRow.price.toLocaleString()}
                            </p>
                          )}
                        </Field>
                        <Field label="Margin (₹/mo)">
                          <input
                            type="number"
                            min={0}
                            value={entry.markup || ''}
                            onChange={(e) =>
                              updateTierPricing(tier, 'markup', parseInt(e.target.value) || 0)
                            }
                            disabled={!isDraft}
                            className="sh-input"
                          />
                          {catalogPricingRow && (
                            <p className="mt-1 text-[11px] text-[var(--color-sh-ink-faint)]">
                              Catalog: {catalogPricingRow.margin_type === 'percent'
                                ? `${catalogPricingRow.margin_value}% (= ₹${(catalogMarginInRupees ?? 0).toLocaleString()})`
                                : `₹${catalogPricingRow.margin_value.toLocaleString()} (flat)`}
                            </p>
                          )}
                        </Field>
                        <Field label="Partner Price (₹/mo)">
                          <div className="flex h-[40px] items-center rounded-[10px] border border-[var(--color-sh-warm-border)] bg-white px-3 text-sm font-bold text-[var(--color-sh-ink)]">
                            {partnerPrice != null ? `₹${partnerPrice.toLocaleString()}` : '—'}
                          </div>
                          <p className="mt-1 text-[11px] text-[var(--color-sh-ink-faint)]">= Proposed − Margin</p>
                        </Field>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Section>

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
                className="sh-input"
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
                  return <p className="text-xs text-[var(--color-sh-ink-faint)]">Pick a country above to enable.</p>;
                }
                if (stateOptions.length === 0) {
                  return <p className="text-xs text-[var(--color-sh-ink-faint)]">No state list configured for {selectedCountry.name}.</p>;
                }
                const selectedRegions = new Set(targetRegions.map((r) => r.region));
                return (
                  <div className="flex flex-wrap gap-2">
                    {stateOptions.map((state) => {
                      const active = selectedRegions.has(state);
                      return (
                        <PillCheckbox
                          key={state}
                          active={active}
                          disabled={!isDraft}
                          onClick={() => {
                            setTargetRegions((prev) => {
                              if (active) return prev.filter((r) => r.region !== state);
                              return [...prev, { country_id: selectedCountryId, region: state }];
                            });
                          }}
                          label={state}
                        />
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
                    <PillCheckbox
                      key={lang}
                      active={active}
                      disabled={!isDraft}
                      onClick={() => {
                        setTargetLanguages((prev) =>
                          active ? prev.filter((l) => l !== lang) : [...prev, lang],
                        );
                      }}
                      label={lang}
                    />
                  );
                })}
              </div>
            </Field>
            <Field label="SquadHire Categories">
              <p className="mb-2 text-[11px] text-[var(--color-sh-ink-faint)]">
                The card is only delivered to SquadHire when at least one
                category is picked — talents subscribed to these categories
                see the card. Pre-filled from the matching subscription's
                SquadHire Profile when available.
              </p>
              {squadhireCategories.length === 0 ? (
                <p className="text-xs text-[var(--color-sh-ink-faint)]">No categories loaded.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {squadhireCategories.map((cat) => {
                    const active = squadhireCategoryIds.includes(cat.id);
                    return (
                      <PillCheckbox
                        key={cat.id}
                        active={active}
                        disabled={!isDraft}
                        onClick={() => {
                          setSquadhireCategoryIds((prev) =>
                            active ? prev.filter((id) => id !== cat.id) : [...prev, cat.id],
                          );
                        }}
                        label={cat.name}
                      />
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
                  className="sh-input"
                />
              </Field>
              <Field label="Contact Name">
                <input
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  disabled={!isDraft}
                  className="sh-input"
                />
              </Field>
              <Field label="Email" onEditClick={isDraft ? () => setEmailEditable(true) : undefined} editActive={emailEditable}>
                <input
                  value={customerEmail}
                  onChange={(e) => setCustomerEmail(e.target.value)}
                  disabled={!isDraft || !emailEditable}
                  className="sh-input"
                />
              </Field>
              <Field label="Phone" onEditClick={isDraft ? () => setPhoneEditable(true) : undefined} editActive={phoneEditable}>
                <input
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  disabled={!isDraft || !phoneEditable}
                  className="sh-input"
                />
              </Field>
              <div className="col-span-2">
                <Field label="Location of Business">
                  <input
                    value={customerLocation}
                    onChange={(e) => setCustomerLocation(e.target.value)}
                    disabled={!isDraft}
                    placeholder="e.g. Bangalore, India"
                    className="sh-input"
                  />
                </Field>
              </div>
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
                  className="sh-input"
                />
              </Field>
              <Field label="Nature of Business">
                <textarea
                  value={businessNature}
                  onChange={(e) => setBusinessNature(e.target.value)}
                  disabled={!isDraft}
                  rows={2}
                  placeholder="e.g. D2C apparel, B2B SaaS, education…"
                  className="sh-input resize-none"
                />
              </Field>
              <Field label="Short Note About the Business">
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  disabled={!isDraft}
                  rows={3}
                  placeholder="A few lines so the talent has context before they start."
                  className="sh-input resize-none"
                />
              </Field>
              <Field label="Short Note About the Requirement" optional>
                <textarea
                  value={requirementNote}
                  onChange={(e) => setRequirementNote(e.target.value)}
                  disabled={!isDraft}
                  rows={3}
                  placeholder="What you'd like the talent to work on first — deliverables, references, brand guidelines."
                  className="sh-input resize-none"
                />
              </Field>
            </div>
          </Section>

        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="sh-section-heading mb-3 px-1">{title}</h2>
      <div className="sh-card space-y-4 p-5">
        {children}
      </div>
    </div>
  );
}

function Field({ label, children, onEditClick, editActive, optional }: { label: string; children: React.ReactNode; onEditClick?: () => void; editActive?: boolean; optional?: boolean }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1.5">
        <label className="text-xs font-semibold text-[var(--color-sh-ink-muted)]">
          {label}
          {optional && (
            <span className="ml-1 font-normal text-[var(--color-sh-ink-faint)]">(optional)</span>
          )}
        </label>
        {onEditClick && !editActive && (
          <button type="button" onClick={onEditClick} className="text-[var(--color-sh-ink-faint)] transition hover:text-[var(--color-sh-ink)]" title={`Edit ${label}`}>
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
      <label className="mb-1.5 block text-xs font-semibold text-[var(--color-sh-ink-muted)]">{label}</label>
      <div className="flex h-[40px] items-center rounded-[10px] border border-[var(--color-sh-warm-border)] bg-[var(--color-sh-cream)] px-3 text-sm font-bold text-[var(--color-sh-ink)]">
        {children}
      </div>
    </div>
  );
}

function PillCheckbox({ active, disabled, onClick, label }: { active: boolean; disabled?: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={() => { if (!disabled) onClick(); }}
      disabled={disabled}
      className="rounded-full px-3.5 py-1.5 text-xs font-semibold transition border-[1.5px] disabled:opacity-50 disabled:cursor-not-allowed"
      style={
        active
          ? { background: 'var(--color-sh-lime-soft)', color: 'var(--color-sh-ink)', borderColor: 'var(--color-sh-ink)' }
          : { background: '#fff', color: 'var(--color-sh-ink)', borderColor: 'var(--color-sh-warm-border)' }
      }
    >
      {active && <span className="mr-1">✓</span>}{label}
    </button>
  );
}
