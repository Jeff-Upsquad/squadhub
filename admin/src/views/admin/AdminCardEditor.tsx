'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import { STATES_BY_COUNTRY_NAME, LANGUAGE_OPTIONS } from './locationLanguageOptions';
import ShareCardLinkModal from './ShareCardLinkModal';
import ConfirmDialog from '@/components/ConfirmDialog';
import { showToast } from '@/components/Toast';

// Map the upsquad-style service_type label to the subscriptions catalog slug.
const SERVICE_TYPE_TO_SLUG: Record<string, string> = {
  Designers: 'designer',
  Editors: 'video_editor',
  'Designer plus Editor': 'designer_video_editor',
  Accountants: 'accountant',
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
  requirement_voice_url: string | null;
  hours_note: string | null;
  target_tiers: string[];
  min_experience_years: number;
  target_languages: string[];
  custom_deliverables: Deliverable[];
  proposed_price: number | null;
  // The client's stated monthly budget from their brief. Read-only reference —
  // distinct from proposed_price, which the admin sets. Per-tier budgets also
  // live under tier_pricing.<tier>.client_budget.
  client_budget: number | null;
  // Finalized monthly client price. null = not finalized (falls back to proposed).
  subscription_price: number | null;
  // Adjusted margin. null = inherit the plan catalog margin.
  markup: number | null;
  // Per-tier draft pricing: { Junior: { proposed_price, markup, subscription_price }, ... }.
  // Cleared at publish — fan-out copies each tier's values onto its own
  // sibling card. Empty {} on single-tier drafts.
  tier_pricing: Record<string, { proposed_price: number; markup: number | null; subscription_price?: number | null; client_budget?: number | null }> | null;
  publish_targets: string[];
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  customer_location: string | null;
  service_type: string | null;
  plan_name: string | null;
  subscription_request_id: number | null;
  squadhire_category_ids: string[] | null;
  target_country_ids: string[];
  target_regions: { country_id: string; region: string }[];
  created_by_user?: { id: string; display_name: string | null; email: string | null } | null;
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
const VALID_TIERS = ['Junior', 'Pro', 'Top Talents', 'Custom'];
// Display order for the per-tier deliverables + pricing blocks: highest tier
// first (Top Talents → Pro → Junior). Independent of selection order.
// Custom sorts last.
const TIER_DISPLAY_RANK: Record<string, number> = {
  'top talents': 0, pro: 1, junior: 2, custom: 3,
};
const VALID_PLANS = ['starter', 'basic', 'plus', 'pro', 'personal'];
const SERVICE_TYPES = ['Designers', 'Editors', 'Designer plus Editor', 'Accountants'];

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
      // state (new / draft / published / assigned / closed) and any archive
      // bucket so the editor doesn't 404 on a New Deal, an assigned card, or a
      // card moved to Archive.
      for (const archived of ['false', 'true'] as const) {
        for (const state of ['new', 'draft', 'published', 'assigned', 'closed']) {
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
  // Tier order for display blocks (deliverables + pricing): Top Talents → Pro
  // → Junior. The stored `tiers` order is left untouched (it controls fan-out).
  const displayTiers = useMemo(
    () => [...tiers].sort(
      (a, b) => (TIER_DISPLAY_RANK[a.toLowerCase()] ?? 99) - (TIER_DISPLAY_RANK[b.toLowerCase()] ?? 99),
    ),
    [tiers],
  );
  const [workingDays, setWorkingDays] = useState<string[]>([]);
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
  // markup null = inherit the plan catalog margin; subscriptionPrice null =
  // not finalized (falls back to proposedPrice).
  const [tierPricing, setTierPricing] = useState<Record<string, { proposedPrice: number; markup: number | null; subscriptionPrice: number | null; clientBudget: number | null }>>({});
  const [publishTargets, setPublishTargets] = useState<string[]>(['partner', 'talent']);
  const [distribution, setDistribution] = useState<string>('broadcast');
  const [brandName, setBrandName] = useState('');
  const [businessNature, setBusinessNature] = useState('');
  const [notes, setNotes] = useState('');
  const [requirementNote, setRequirementNote] = useState('');
  // Read-only: the client's recorded requirement voice note (if any).
  const [requirementVoiceUrl, setRequirementVoiceUrl] = useState<string | null>(null);
  const [hoursNote, setHoursNote] = useState('');
  const [deliverables, setDeliverables] = useState<Deliverable[]>([]);
  const [targetCountryIds, setTargetCountryIds] = useState<string[]>([]);
  const [targetRegions, setTargetRegions] = useState<{ country_id: string; region: string }[]>([]);
  const [targetLanguages, setTargetLanguages] = useState<string[]>([]);
  const [squadhireCategoryIds, setSquadhireCategoryIds] = useState<string[]>([]);

  // Populate form from loaded card
  useEffect(() => {
    if (!card) return;
    setServiceType(card.service_type || '');
    // Normalize to the canonical Title-case the <select> options use, so a
    // plan saved as 'Starter' (from the brief form) matches and renders instead
    // of falling through to the empty "Select…" placeholder. Falls back to the
    // raw value for any non-standard plan so nothing is silently dropped.
    setPlanName(PLAN_TO_CANONICAL[(card.plan_name || '').toLowerCase()] || card.plan_name || '');
    setTiers(card.target_tiers || []);
    setWorkingDays(card.working_days || []);
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
    const initialPricing: Record<string, { proposedPrice: number; markup: number | null; subscriptionPrice: number | null; clientBudget: number | null }> = {};
    if (dbTierPricing) {
      Object.entries(dbTierPricing).forEach(([tier, p]) => {
        initialPricing[tier] = {
          proposedPrice: (p as any)?.proposed_price ?? 0,
          markup: (p as any)?.markup ?? null,
          subscriptionPrice: (p as any)?.subscription_price ?? null,
          clientBudget: (p as any)?.client_budget ?? card.client_budget ?? null,
        };
      });
    }
    (card.target_tiers || []).forEach((tier) => {
      if (!initialPricing[tier]) {
        initialPricing[tier] = {
          proposedPrice: card.proposed_price || 0,
          markup: card.markup ?? null,
          subscriptionPrice: card.subscription_price ?? null,
          clientBudget: card.client_budget ?? null,
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
    setRequirementVoiceUrl(card.requirement_voice_url || null);
    setHoursNote(card.hours_note || '');
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
          np[tier] = { proposedPrice: 0, markup: null, subscriptionPrice: null, clientBudget: null };
        }
        return np;
      });
      return next;
    });
  }, []);

  const updateTierPricing = useCallback(
    (tier: string, field: 'proposedPrice' | 'markup' | 'subscriptionPrice', value: number | null) => {
      setTierPricing((prev) => ({
        ...prev,
        [tier]: {
          proposedPrice: prev[tier]?.proposedPrice ?? 0,
          markup: prev[tier]?.markup ?? null,
          subscriptionPrice: prev[tier]?.subscriptionPrice ?? null,
          clientBudget: prev[tier]?.clientBudget ?? null,
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
      const entry = tierPricing[tier];
      // Percent margins apply to the finalized price (what the client pays).
      const base = entry?.subscriptionPrice ?? entry?.proposedPrice ?? 0;
      if (!row || base <= 0) return null;
      return row.margin_type === 'percent'
        ? Math.round((base * row.margin_value) / 100)
        : row.margin_value;
    },
    [catalogByTier, tierPricing],
  );

  // Partner price preview: finalized price (subscription price, else proposed)
  // minus the final margin (the admin's adjusted markup, else the plan margin).
  // A blank markup inherits the catalog margin rather than meaning "zero".
  const partnerPriceForTier = useCallback(
    (tier: string): number | null => {
      const entry = tierPricing[tier];
      if (!entry) return null;
      const finalized = entry.subscriptionPrice ?? (entry.proposedPrice > 0 ? entry.proposedPrice : null);
      if (finalized == null) return null;
      const margin = entry.markup ?? catalogMarginForTier(tier) ?? 0;
      return Math.max(0, finalized - margin);
    },
    [tierPricing, catalogMarginForTier],
  );

  // Whether at least one selected tier has catalog data loaded — used to
  // decide whether to render the per-tier hours table or the empty-state
  // copy in the combined Deliverables section.
  const anyCatalogLoaded = tiers.some((t) => catalogByTier[t] != null);

  // Build the API tier_pricing map (snake_case shape) from the form state.
  const tierPricingPayload = useMemo(() => {
    const out: Record<string, { proposed_price: number; markup: number | null; subscription_price: number | null; client_budget: number | null }> = {};
    for (const [tier, entry] of Object.entries(tierPricing)) {
      out[tier] = {
        proposed_price: entry.proposedPrice ?? 0,
        markup: entry.markup ?? null,
        subscription_price: entry.subscriptionPrice ?? null,
        // Reference only — carried through so a save doesn't drop the client's
        // stated budget from the JSONB entry.
        client_budget: entry.clientBudget ?? null,
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
    if (tiers.length !== 1) return null;
    return tierPricing[tiers[0]]?.markup ?? null;
  }, [tiers, tierPricing]);
  const legacySubscriptionPrice = useMemo(() => {
    if (tiers.length !== 1) return null;
    return tierPricing[tiers[0]]?.subscriptionPrice ?? null;
  }, [tiers, tierPricing]);

  const saveMutation = useMutation({
    mutationFn: () =>
      api.patch(`/admin/subscription-cards/${cardId}/edit`, {
        service_type: serviceType || null,
        plan_name: planName || null,
        working_days: workingDays,
        customer_location: customerLocation || null,
        customer_name: customerName || null,
        customer_email: customerEmail || null,
        customer_phone: customerPhone || null,
        proposed_price: legacyProposedPrice,
        subscription_price: legacySubscriptionPrice,
        markup: legacyMarkup,
        tier_pricing: tierPricingPayload,
        publish_targets: publishTargets,
        distribution,
        brand_name: brandName || null,
        business_nature: businessNature || null,
        notes: notes || null,
        requirement_note: requirementNote || null,
        hours_note: hoursNote || null,
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
  // Defensive: never assume the endpoint handed back a clean array of
  // well-formed rows. A null/malformed entry here used to take down the whole
  // editor with a bare "client-side exception" instead of degrading the one
  // Location field.
  const countries: Array<{ id: string; name: string }> = useMemo(
    () => (Array.isArray(countriesQuery.data) ? countriesQuery.data : []),
    [countriesQuery.data],
  );
  const countryById: Record<string, { id: string; name: string }> = useMemo(() => {
    const map: Record<string, { id: string; name: string }> = {};
    countries.forEach((c) => {
      if (c && typeof c.id === 'string') map[c.id] = c;
    });
    return map;
  }, [countries]);

  // SquadHire categories — drives the publish gate. Empty = card is not
  // delivered to SquadHire (the "Not on SquadHire" badge in the list view).
  // Same query key the Subscriptions module uses, so the cache is shared.
  const squadhireCategoriesQuery = useQuery({
    queryKey: ['squadhire-categories'],
    queryFn: () => api.get('/admin/integrations/squadhire/categories').then((r) => r.data?.data || []),
    staleTime: 10 * 60 * 1000,
  });
  // SquadHire categories come from an external service via a server proxy, so
  // the shape is the least trustworthy data in this view. Coerce to an array
  // and drop anything without a usable id before it reaches the render map.
  const squadhireCategories: Array<{ id: string; name: string; slug: string }> = useMemo(
    () =>
      (Array.isArray(squadhireCategoriesQuery.data) ? squadhireCategoriesQuery.data : []).filter(
        (c: any): c is { id: string; name: string; slug: string } =>
          !!c && typeof c.id === 'string',
      ),
    [squadhireCategoriesQuery.data],
  );

  const publishMutation = useMutation({
    mutationFn: async () => {
      await saveMutation.mutateAsync();
      await targetsMutation.mutateAsync();
      return api.post(`/admin/subscription-cards/${cardId}/publish`, { distribution });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-subscription-cards'] });
      onClose();
    },
  });

  const archiveMutation = useMutation({
    mutationFn: () => api.post(`/admin/subscription-cards/${cardId}/archive`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-subscription-cards'] });
      queryClient.invalidateQueries({ queryKey: ['admin-subscription-requests'] });
      queryClient.invalidateQueries({ queryKey: ['admin-custom-cards'] });
      queryClient.invalidateQueries({ queryKey: ['admin-custom-cards-drafts'] });
      onClose();
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.error || err?.message || 'Unknown error';
      showToast(`Archive failed: ${msg}`, 'error');
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

  const [showShareModal, setShowShareModal] = useState(false);
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);

  const isDraft = card?.state === 'draft';
  // A freshly-submitted New Deal. Editable like a draft, but the shareable link
  // and Publish actions stay hidden until "Save Draft" promotes it (new → draft).
  const isNew = card?.state === 'new';
  const isEditable = isDraft || isNew;

  // Publish gate: every selected tier must have a non-zero proposed price
  // (single-tier and multi-tier both — fan-out throws on missing entries).
  // Fall back to "no tiers" disabled until at least one is selected.
  const canPublish =
    tiers.length > 0 &&
    tiers.every((t) => (tierPricing[t]?.proposedPrice ?? 0) > 0);

  if (isLoading) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center sh-surface">
        <p className="text-sm text-[var(--color-sh-ink-faint)]">Loading card…</p>
      </div>
    );
  }

  if (!card) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 sh-surface">
        <p className="text-sm text-[var(--color-sh-ink-faint)]">Card not found.</p>
        <button onClick={onClose} className="sh-btn-ghost sh-btn-ghost-sm">Go back</button>
      </div>
    );
  }

  return (
    // Root takes remaining space (flex-1/min-h-0), not h-full, so on desktop it
    // fits beside the still-visible New Deals list header instead of overflowing.
    <div className="flex min-h-0 flex-1 flex-col sh-surface">
      {/* Header + form share ONE scroll region so they scroll together, contained
          within the content area — the outer app shell/sidebar never scrolls. */}
      <div className="flex-1 min-h-0 overflow-y-auto">
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
            {card.source === 'request' ? 'Card from Request' : card.source === 'internal_brief' ? 'Client Brief' : 'Custom Card'}
            {card.subscription_request_id && (
              <span className="ml-2 text-base font-normal text-[var(--color-sh-ink-muted)]">
                (Request #{card.subscription_request_id})
              </span>
            )}
          </h1>
          {card.source === 'internal_brief' && (
            <p className="text-sm font-medium text-[var(--color-sh-ink-muted)]">
              Filled out by{' '}
              {card.created_by_user?.display_name ||
                card.created_by_user?.email ||
                'a team member'}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isEditable && (
            <>
              {/* Shareable client link only appears once it's a saved draft. */}
              {isDraft && ['shared_form', 'landing_page_form', 'request', 'internal_brief'].includes(card.source) && (
                <button
                  onClick={() => setShowShareModal(true)}
                  className="sh-btn-ghost"
                  title="Generate a 24-hour link the client can open to confirm this brief"
                >
                  Generate shareable link
                </button>
              )}
              <button
                onClick={() => setShowArchiveConfirm(true)}
                disabled={archiveMutation.isPending}
                className="sh-btn-violet"
              >
                {archiveMutation.isPending ? 'Archiving…' : 'Archive'}
              </button>
              <button
                onClick={handleSave}
                disabled={saveMutation.isPending}
                className="sh-btn-primary sh-btn-primary-sm"
                title={isNew ? 'Save the details and move this New Deal to Draft (unlocks the share link + Publish)' : undefined}
              >
                {saveMutation.isPending ? 'Saving…' : isNew ? 'Save Draft' : 'Save Draft'}
              </button>
              {/* Publish / Soft publish only once the draft is finalized. The
                  distribution toggle in Publish Settings decides which one. */}
              {isDraft && (
                <button
                  onClick={() => publishMutation.mutate()}
                  disabled={publishMutation.isPending || !canPublish}
                  title={
                    !canPublish
                      ? tiers.length === 0
                        ? 'Select at least one tier with a price'
                        : 'Every selected tier needs a proposed price'
                      : distribution === 'manual'
                        ? 'Soft publish — build the list, then hand-pick recipients before broadcasting'
                        : 'Publish — auto-match all qualifying partners into a staged list, then broadcast'
                  }
                  className="sh-btn-primary sh-btn-primary-sm"
                >
                  {publishMutation.isPending
                    ? 'Publishing…'
                    : distribution === 'manual'
                      ? 'Soft publish'
                      : 'Publish'}
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {showShareModal && (
        <ShareCardLinkModal cardId={card.id} onClose={() => setShowShareModal(false)} />
      )}

      <ConfirmDialog
        open={showArchiveConfirm}
        title="Archive this card?"
        description="It will move to the Archive tab where you can republish or delete it later."
        confirmLabel="Archive"
        pendingLabel="Archiving…"
        variant="warning"
        isPending={archiveMutation.isPending}
        onCancel={() => setShowArchiveConfirm(false)}
        onConfirm={() => {
          setShowArchiveConfirm(false);
          archiveMutation.mutate();
        }}
      />

      {/* Form */}
      <div className="px-6 pb-10">
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
                      disabled={!isEditable}
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
                      disabled={!isEditable}
                      onClick={() => setDistribution(mode)}
                      label={mode === 'broadcast' ? 'Publish (auto-match all)' : 'Soft publish (hand-pick)'}
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
                  disabled={!isEditable}
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
                  disabled={!isEditable}
                  className="sh-input"
                >
                  <option value="">Select…</option>
                  {VALID_PLANS.map((p) => {
                    const label = PLAN_TO_CANONICAL[p] || p;
                    return <option key={p} value={label}>{label}</option>;
                  })}
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
                      disabled={!isEditable}
                      onClick={() => toggleTier(tier)}
                      label={tier}
                    />
                  );
                })}
              </div>
              {tiers.length > 1 && (
                <p className="mt-2 text-[11px] text-[var(--color-sh-ink-faint)]">
                  Publishing creates one card with a tab per tier. Each tier is broadcast only to that tier&apos;s partners, and the business sees a single card with a tab for each tier.
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
                      disabled={!isEditable}
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
              applied to every tier tab of the published card. */}
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
                          {displayTiers.map((tier) => (
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
                          {displayTiers.map((tier) => {
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
                          {displayTiers.map((tier) => {
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
                          {displayTiers.map((tier) => {
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
                          disabled={!isEditable}
                          className="sh-input col-span-2"
                        />
                        <select
                          value={d.kind}
                          onChange={(e) => updateDeliverable(d.id, 'kind', e.target.value)}
                          disabled={!isEditable}
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
                          disabled={!isEditable}
                          className="sh-input"
                        />
                      </div>
                      {isEditable && (
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
                  {isEditable && (
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
              selected this renders a single block. With N tiers each gets its
              own proposed/margin/partner-price row, and on publish they become
              one card with a tab per tier (grouped via brief_group_id) rather
              than N separate cards. */}
          <Section title="Pricing">
            {tiers.length === 0 ? (
              <p className="text-xs text-[var(--color-sh-ink-faint)]">
                Select at least one tier above to set pricing.
              </p>
            ) : (
              <div className="space-y-3">
                {tiers.length > 1 && (
                  <p className="rounded-lg bg-[var(--color-sh-cream)] px-3 py-2 text-[11px] text-[var(--color-sh-ink-muted)]">
                    All {tiers.length} tiers publish as <strong>one card</strong> with a tab per tier — talents and the business each see only their tier&apos;s pricing.
                  </p>
                )}

                {/* Pricing matrix — one row per selected tier. Columns run
                    Subscription → Proposed → Final → Margin → Partner so the
                    money reads left-to-right from catalog reference to payout.
                    Final and Partner are the load-bearing figures (shaded): Final
                    always resolves to a concrete number the client pays (explicit
                    override, else the proposed price), and Partner is derived as
                    Final − Margin. */}
                <div className="overflow-x-auto rounded-xl border border-[var(--color-sh-warm-border)]">
                  <table className="w-full min-w-[880px] border-collapse text-left text-sm">
                    <thead>
                      <tr className="border-b border-[var(--color-sh-warm-border)] align-bottom">
                        <th className="bg-[var(--color-sh-cream)] px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-sh-ink-muted)]">
                          Tier
                        </th>
                        <th className="bg-[var(--color-sh-cream)] px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-sh-ink-muted)]">
                          Subscription price
                        </th>
                        <th className="bg-[var(--color-sh-cream)] px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-sh-ink-muted)]">
                          Client&apos;s budget
                        </th>
                        <th className="bg-[var(--color-sh-cream)] px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-sh-ink-muted)]">
                          Proposed price
                        </th>
                        <th className="bg-[var(--color-sh-cream)] px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-sh-ink)]">
                          Final price
                        </th>
                        <th className="bg-[var(--color-sh-cream)] px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-sh-ink-muted)]">
                          Margin
                        </th>
                        <th className="bg-[var(--color-sh-cream)] px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-sh-ink)]">
                          Partner price
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayTiers.map((tier, rowIdx) => {
                        const entry = tierPricing[tier] || { proposedPrice: 0, markup: null, subscriptionPrice: null };
                        const partnerPrice = partnerPriceForTier(tier);
                        const catalogPricingRow = catalogByTier[tier]?.pricing?.[0] || null;
                        const catalogMarginInRupees = catalogMarginForTier(tier);
                        const showOriginal =
                          tiers.length === 1 &&
                          originalProposedPrice != null &&
                          originalProposedPrice !== entry.proposedPrice;
                        // The final price the client actually pays always resolves
                        // to a number: the explicit override if set, otherwise the
                        // proposed price (mirrors partnerPriceForTier's fallback).
                        const effectiveFinal =
                          entry.subscriptionPrice ?? (entry.proposedPrice > 0 ? entry.proposedPrice : null);
                        const finalUsesProposed = entry.subscriptionPrice == null && effectiveFinal != null;
                        return (
                          <tr
                            key={tier}
                            className={`align-top ${rowIdx > 0 ? 'border-t border-[var(--color-sh-warm-border)]' : ''}`}
                          >
                            {/* Tier + publish badge */}
                            <td className="px-4 py-3">
                              <div className="text-sm font-semibold text-[var(--color-sh-ink)]">{tier}</div>
                              <span className="mt-1 inline-block rounded-full bg-[var(--color-sh-cream)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-sh-ink-muted)]">
                                {tiers.length > 1 ? 'Tab in 1 card' : '1 card on publish'}
                              </span>
                            </td>

                            {/* Subscription price — read-only catalog reference */}
                            <td className="px-3 py-3">
                              <div className="text-sm font-medium tabular-nums text-[var(--color-sh-ink-muted)]">
                                {catalogPricingRow ? `₹${catalogPricingRow.price.toLocaleString()}` : '—'}
                              </div>
                              <div className="mt-1 text-[10px] text-[var(--color-sh-ink-faint)]">Catalog default</div>
                            </td>

                            {/* Client's budget — read-only reference from the
                                brief. Never auto-fills Proposed price; the admin
                                sets that themselves. */}
                            <td className="px-3 py-3">
                              {entry.clientBudget && entry.clientBudget > 0 ? (
                                <>
                                  <div className="text-sm font-medium tabular-nums text-[var(--color-sh-ink-muted)]">
                                    ₹{entry.clientBudget.toLocaleString()}
                                  </div>
                                  <div className="mt-1 text-[10px] text-[var(--color-sh-ink-faint)]">Client shared</div>
                                </>
                              ) : (
                                <div className="text-sm text-[var(--color-sh-ink-faint)]">—</div>
                              )}
                            </td>

                            {/* Proposed price — editable (what we propose to charge) */}
                            <td className="px-3 py-3">
                              <PriceInput
                                value={entry.proposedPrice || ''}
                                onChange={(e) =>
                                  updateTierPricing(tier, 'proposedPrice', parseInt(e.target.value) || 0)
                                }
                                disabled={!isEditable}
                                ariaLabel={`${tier} proposed price`}
                              />
                              {showOriginal && (
                                <div className="mt-1 text-[10px] text-[var(--color-sh-ink-faint)]">
                                  Was <span className="line-through">₹{originalProposedPrice!.toLocaleString()}</span>
                                </div>
                              )}
                            </td>

                            {/* Final price — editable override, but always shows
                                the resolved figure the client actually pays. */}
                            <td className="bg-[var(--color-sh-cream)] px-3 py-3">
                              <PriceInput
                                value={entry.subscriptionPrice ?? ''}
                                placeholder={entry.proposedPrice ? `${entry.proposedPrice}` : ''}
                                onChange={(e) => {
                                  const v = parseInt(e.target.value);
                                  updateTierPricing(tier, 'subscriptionPrice', Number.isFinite(v) && v > 0 ? v : null);
                                }}
                                disabled={!isEditable}
                                emphasis
                                ariaLabel={`${tier} final price`}
                              />
                              <div className="mt-1 text-[10px] text-[var(--color-sh-ink-faint)]">
                                {effectiveFinal != null ? (
                                  <>
                                    Client pays{' '}
                                    <span className="font-semibold tabular-nums text-[var(--color-sh-ink)]">
                                      ₹{effectiveFinal.toLocaleString()}
                                    </span>
                                    {finalUsesProposed ? ' (proposed)' : ''}
                                  </>
                                ) : (
                                  'Set a proposed or final price'
                                )}
                              </div>
                            </td>

                            {/* Margin — editable (blank inherits plan margin) */}
                            <td className="px-3 py-3">
                              <PriceInput
                                value={entry.markup ?? ''}
                                placeholder={catalogMarginInRupees != null ? `${catalogMarginInRupees}` : ''}
                                onChange={(e) => {
                                  const v = parseInt(e.target.value);
                                  updateTierPricing(tier, 'markup', Number.isFinite(v) ? v : null);
                                }}
                                disabled={!isEditable}
                                ariaLabel={`${tier} margin`}
                              />
                              {catalogPricingRow ? (
                                <div className="mt-1 text-[10px] text-[var(--color-sh-ink-faint)]">
                                  {entry.markup == null ? 'Plan margin — ' : 'Plan: '}
                                  {catalogPricingRow.margin_type === 'percent'
                                    ? `${catalogPricingRow.margin_value}% (₹${(catalogMarginInRupees ?? 0).toLocaleString()})`
                                    : `₹${catalogPricingRow.margin_value.toLocaleString()} flat`}
                                </div>
                              ) : (
                                <div className="mt-1 text-[10px] text-[var(--color-sh-ink-faint)]">Blank = plan margin</div>
                              )}
                            </td>

                            {/* Partner price — derived, read-only, emphasized */}
                            <td className="bg-[var(--color-sh-cream)] px-4 py-3">
                              <div className="text-sm font-bold tabular-nums text-[var(--color-sh-ink)]">
                                {partnerPrice != null ? `₹${partnerPrice.toLocaleString()}` : '—'}
                              </div>
                              <div className="mt-1 text-[10px] text-[var(--color-sh-ink-faint)]">Final − Margin</div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <p className="px-1 text-[11px] leading-relaxed text-[var(--color-sh-ink-faint)]">
                  All amounts are ₹/month. <strong className="font-semibold text-[var(--color-sh-ink-muted)]">Subscription price</strong> is the catalog default · <strong className="font-semibold text-[var(--color-sh-ink-muted)]">Client&apos;s budget</strong> is what the client stated in their brief (reference only) · <strong className="font-semibold text-[var(--color-sh-ink-muted)]">Proposed price</strong> is what you propose to charge · <strong className="font-semibold text-[var(--color-sh-ink-muted)]">Final price</strong> is what the client pays (blank uses the proposed price) · <strong className="font-semibold text-[var(--color-sh-ink-muted)]">Partner price</strong> = Final − Margin.
                </p>
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
                disabled={!isEditable}
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
                const selectedCountryId = Array.isArray(targetCountryIds) ? targetCountryIds[0] : undefined;
                const selectedCountry = selectedCountryId ? countryById[selectedCountryId] : null;
                const stateOptions = selectedCountry?.name ? STATES_BY_COUNTRY_NAME[selectedCountry.name] || [] : [];
                if (!selectedCountry) {
                  return <p className="text-xs text-[var(--color-sh-ink-faint)]">Pick a country above to enable.</p>;
                }
                if (stateOptions.length === 0) {
                  return <p className="text-xs text-[var(--color-sh-ink-faint)]">No state list configured for {selectedCountry.name || 'this country'}.</p>;
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
                          disabled={!isEditable}
                          onClick={() => {
                            setTargetRegions((prev) => {
                              if (active) return prev.filter((r) => r.region !== state);
                              return [...prev, { country_id: selectedCountry.id, region: state }];
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
                      disabled={!isEditable}
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
                        disabled={!isEditable}
                        onClick={() => {
                          setSquadhireCategoryIds((prev) =>
                            active ? prev.filter((id) => id !== cat.id) : [...prev, cat.id],
                          );
                        }}
                        label={typeof cat.name === 'string' && cat.name ? cat.name : cat.slug || cat.id}
                      />
                    );
                  })}
                </div>
              )}
            </Field>
          </Section>

          <Section title="Customer">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Contact Person Name">
                <input
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  disabled={!isEditable}
                  className="sh-input"
                />
              </Field>
              <Field label="Email" onEditClick={isEditable ? () => setEmailEditable(true) : undefined} editActive={emailEditable}>
                <input
                  value={customerEmail}
                  onChange={(e) => setCustomerEmail(e.target.value)}
                  disabled={!isEditable || !emailEditable}
                  className="sh-input"
                />
              </Field>
              <Field label="Phone" onEditClick={isEditable ? () => setPhoneEditable(true) : undefined} editActive={phoneEditable}>
                <input
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  disabled={!isEditable || !phoneEditable}
                  className="sh-input"
                />
              </Field>
              <div className="col-span-2">
                <Field label="Location of Business">
                  <input
                    value={customerLocation}
                    onChange={(e) => setCustomerLocation(e.target.value)}
                    disabled={!isEditable}
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
                  disabled={!isEditable}
                  className="sh-input"
                />
              </Field>
              <Field label="Nature of Business">
                <textarea
                  value={businessNature}
                  onChange={(e) => setBusinessNature(e.target.value)}
                  disabled={!isEditable}
                  rows={2}
                  placeholder="e.g. D2C apparel, B2B SaaS, education…"
                  className="sh-input resize-none"
                />
              </Field>
              <Field label="Short Note About the Business">
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  disabled={!isEditable}
                  rows={3}
                  placeholder="A few lines so the talent has context before they start."
                  className="sh-input resize-none"
                />
              </Field>
              <Field label="Short Note About the Requirement" optional>
                <textarea
                  value={requirementNote}
                  onChange={(e) => setRequirementNote(e.target.value)}
                  disabled={!isEditable}
                  rows={3}
                  placeholder="What you'd like the talent to work on first — deliverables, references, brand guidelines."
                  className="sh-input resize-none"
                />
              </Field>
              <Field label="Requirement Voice Note" optional>
                {requirementVoiceUrl ? (
                  <div className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2">
                    <svg className="h-4 w-4 flex-shrink-0 text-foreground-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m0 0h-3.75m3.75 0h3.75M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
                    </svg>
                    {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                    <audio controls src={requirementVoiceUrl} className="h-9 w-full" />
                  </div>
                ) : (
                  <p className="text-sm text-foreground-muted">No voice note was submitted with this brief.</p>
                )}
              </Field>
              <Field label="Hours" optional>
                <input
                  type="text"
                  value={hoursNote}
                  onChange={(e) => setHoursNote(e.target.value)}
                  disabled={!isEditable}
                  placeholder="e.g. 4 hrs daily or 20 hrs/week"
                  className="sh-input"
                />
              </Field>
            </div>
          </Section>

          {/* Activity — chronological lifecycle feed */}
          <Section title="Activity">
            <CardActivityFeed cardId={cardId} />
          </Section>

        </div>
      </div>
      </div>
    </div>
  );
}

// ── Activity feed ───────────────────────────────────────────────────────────

interface CardEvent {
  id: string;
  event_type: string;
  actor_id: string | null;
  actor_type: 'admin' | 'partner' | 'talent' | 'system' | null;
  actor_label: string | null;
  metadata: Record<string, any> | null;
  created_at: string;
}

// event_type → { dot color, human label }. Unknown types fall back to the raw key.
const EVENT_META: Record<string, { color: string; label: string }> = {
  created: { color: '#9ca3af', label: 'Card created' },
  draft_saved: { color: '#9ca3af', label: 'Saved as draft' },
  published: { color: '#22c55e', label: 'Published (broadcast)' },
  soft_published: { color: '#84cc16', label: 'Soft-published (hand-pick)' },
  broadcast: { color: '#3b82f6', label: 'Broadcast' },
  recipient_accepted: { color: '#22c55e', label: 'Accepted' },
  recipient_declined: { color: '#ef4444', label: 'Declined' },
  recalled: { color: '#f59e0b', label: 'Recalled' },
  cancelled: { color: '#ef4444', label: 'Cancelled' },
  archived: { color: '#6b7280', label: 'Archived' },
  reinstated: { color: '#3b82f6', label: 'Reinstated' },
  republished: { color: '#22c55e', label: 'Republished' },
  assigned: { color: '#a855f7', label: 'Assigned' },
};

function formatEventTime(iso: string): string {
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function eventActorLine(e: CardEvent): string | null {
  if (e.actor_label) {
    const role = e.actor_type && e.actor_type !== 'admin' ? ` (${e.actor_type})` : '';
    return `${e.actor_label}${role}`;
  }
  if (e.actor_type === 'talent') return 'Talent';
  if (e.actor_type === 'partner') return 'Partner';
  if (e.actor_type === 'system') return 'System';
  return null;
}

function CardActivityFeed({ cardId }: { cardId: string }) {
  const { data: events, isLoading } = useQuery({
    queryKey: ['admin-card-events', cardId],
    queryFn: async (): Promise<CardEvent[]> => {
      const r = await api.get(`/admin/subscription-cards/${cardId}/events`);
      return r.data?.data || [];
    },
    enabled: !!cardId,
  });

  if (isLoading) {
    return <p className="text-sm text-[var(--color-sh-ink-faint)]">Loading activity…</p>;
  }
  if (!events || events.length === 0) {
    return (
      <p className="text-sm text-[var(--color-sh-ink-faint)]">
        No activity recorded yet. Lifecycle events (publish, broadcast, accept, recall…) will appear here going forward.
      </p>
    );
  }

  // Newest first in the feed.
  const ordered = [...events].reverse();

  return (
    <ol className="relative space-y-4 pl-4">
      {ordered.map((e, i) => {
        const meta = EVENT_META[e.event_type] || { color: '#9ca3af', label: e.event_type };
        const actor = eventActorLine(e);
        return (
          <li key={e.id} className="relative pl-4">
            {/* connector line */}
            {i < ordered.length - 1 && (
              <span
                className="absolute left-[3px] top-3 h-full w-px bg-[var(--color-sh-warm-border)]"
                aria-hidden
              />
            )}
            {/* dot */}
            <span
              className="absolute left-0 top-1.5 h-[7px] w-[7px] rounded-full"
              style={{ backgroundColor: meta.color }}
              aria-hidden
            />
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm font-medium text-[var(--color-sh-ink)]">{meta.label}</span>
              <span
                className="shrink-0 text-xs text-[var(--color-sh-ink-faint)]"
                title={new Date(e.created_at).toLocaleString()}
              >
                {formatEventTime(e.created_at)}
              </span>
            </div>
            {actor && (
              <span className="text-xs text-[var(--color-sh-ink-muted)]">by {actor}</span>
            )}
          </li>
        );
      })}
    </ol>
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

// Compact ₹-prefixed number input for the pricing table cells. `emphasis`
// bolds the value (used for the Final price column, the amount the client pays).
function PriceInput({
  value,
  onChange,
  placeholder,
  disabled,
  emphasis,
  ariaLabel,
}: {
  value: number | string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  disabled?: boolean;
  emphasis?: boolean;
  ariaLabel?: string;
}) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-[var(--color-sh-ink-faint)]">
        ₹
      </span>
      <input
        type="number"
        min={0}
        value={value}
        placeholder={placeholder}
        onChange={onChange}
        disabled={disabled}
        aria-label={ariaLabel}
        className={`sh-input sh-input-sm w-full min-w-[90px] pl-6 tabular-nums ${emphasis ? 'font-semibold' : ''}`}
      />
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
          : { background: 'var(--color-surface)', color: 'var(--color-sh-ink)', borderColor: 'var(--color-sh-warm-border)' }
      }
    >
      {active && <span className="mr-1">✓</span>}{label}
    </button>
  );
}
