'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { resolveFinalizedPrice } from '@squadhub/shared';
import api from '@/services/api';
import { showToast } from '@/components/Toast';
import AdminSubscriptionCardRecipientsPanel from './AdminSubscriptionCardRecipientsPanel';
import AdminSubscriptionCardRecipientsView from './AdminSubscriptionCardRecipientsView';
import AdminCardClientPreview from './AdminCardClientPreview';
import type { CardViewMode } from './CardViewToggle';
import AdminRequestsList from './AdminRequestsList';
import AdminCustomCardsList from './AdminCustomCardsList';
import SliderPanel from './clients/SliderPanel';
import ClientBriefForm, { BRIEF_LAUNCHERS, type BriefType, type BriefProduct } from './ClientBriefForm';

export type AdminSubscriptionCard = {
  id: string;
  state: 'published' | 'assigned' | 'closed';
  distribution: 'broadcast' | 'manual';
  published_at: string | null;
  working_days: string[];
  brand_name: string | null;
  business_nature: string | null;
  notes: string | null;
  requirement_note?: string | null;
  requirement_voice_url?: string | null;
  target_tiers: string[];
  min_experience_years: number;
  target_languages: string[];
  target_country_ids: string[];
  target_regions: { country_id: string; region: string }[];
  custom_deliverables: { id: string; name: string; kind: 'hours' | 'item'; per_day: number; per_week: number; per_month: number }[];
  disabled_default_deliverable_ids: string[];
  plan_default_deliverables?: {
    id: string;
    kind: 'hours' | 'item';
    deliverable_type_id: string | null;
    deliverable_type_name: string | null;
    per_day: number;
    per_week: number;
    per_month: number;
  }[];
  partner_price_override: number | null;
  squadhire_category_ids?: string[] | null;
  selected_recipient_type?: 'partner' | 'talent' | null;
  selected_recipient_id?: string | null;
  parent_card_id?: string | null;
  secondary_card_count?: number;
  // Shared across the per-tier sibling cards fanned out from one multi-tier
  // brief. The list view collapses cards with the same brief_group_id into a
  // single card with one tab per tier. NULL on single-tier / legacy cards.
  brief_group_id?: string | null;
  recalled_at?: string | null;
  cancelled_at?: string | null;
  archived_at?: string | null;
  closed_at?: string | null;
  paused_at?: string | null;
  assigned_at?: string | null;
  admin_reviewed_at?: string | null;
  card_code?: string | null;
  linked_folder_id?: string | null;
  linked_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  subscription_request_id?: number | null;
  squadhire_synced_at?: string | null;
  squadhire_sync_attempts?: number | null;
  squadhire_sync_last_error?: string | null;
  squadhire_recipient_count?: number | null;
  customer_company?: string | null;
  customer_name?: string | null;
  customer_email?: string | null;
  customer_phone?: string | null;
  customer_location?: string | null;
  proposed_price?: number | null;
  /** Finalized monthly price the client pays. null = falls back to proposed_price. */
  subscription_price?: number | null;
  markup?: number | null;
  publish_targets?: string[] | null;
  plan_name?: string | null;
  service_type?: string | null;
  // Product line. 'assignment' = freelance project (renders an Assignment badge
  // + project budget/timeline instead of plan/monthly price). Defaults to
  // 'subscription' on legacy rows.
  card_type?: 'subscription' | 'assignment' | 'hiring' | null;
  assignment_details?: { duration?: string | null; start_date?: string | null; deadline?: string | null; scope_type?: string | null; pricing_mode?: 'priced' | 'unpriced' | null } | null;
  source?: 'submission' | 'request' | 'custom' | null;
  submission?: {
    id: string;
    business_name: string;
    country_id?: string;
    country?: { id: string; name: string; currency: string } | null;
  } | null;
  submission_subscription?: {
    subscription?: { id: string; name: string } | null;
    plan?: {
      id: string;
      plan: string;
      tier: string;
      pricing?: { country_id: string; price: number; margin_value?: number; margin_type?: 'fixed' | 'percent'; country?: { id: string; name: string; currency: string } | null }[];
    } | null;
  } | null;
  recipient_counts?: {
    partners: { pending: number; accepted: number; rejected: number; staged?: number };
    talents: { accepted: number; rejected: number; queued?: number };
  };
  // Published card still holding recipients that haven't been sent — drives the
  // "Needs broadcast" badge prompting the admin to open it and click Broadcast.
  needs_broadcast?: boolean;
  published_by_user?: { id: string; display_name: string | null; email: string | null } | null;
};

/**
 * Three states per card on the SquadHire delivery axis:
 *  - 'skipped'   — card has no SquadHire categories; webhook never fires by design.
 *  - 'pending'   — categories present, webhook not yet delivered (in retry loop).
 *  - 'delivered' — squadhire_synced_at set; nothing to surface (default, no chip).
 */
export function squadhireDeliveryState(card: AdminSubscriptionCard): 'skipped' | 'pending' | 'delivered' {
  if (card.squadhire_synced_at) return 'delivered';
  const hasCategories =
    Array.isArray(card.squadhire_category_ids) && card.squadhire_category_ids.length > 0;
  if (!hasCategories) return 'skipped';
  return 'pending';
}

/**
 * Service-type badge. Distinguishes which client-brief form a published card
 * came from — the designer/editor brief (`/connect`) vs the accountant brief
 * (`/connect/accountant`) — by the card's `service_type`. Values are the four
 * canonical display labels the rest of the system keys off (see
 * SLUG_TO_SERVICE_TYPE in server leads-public.ts). Unknown values still render
 * as a neutral pill so nothing silently disappears.
 */
const SERVICE_TYPE_BADGES: Record<string, { label: string; bg: string; color: string }> = {
  Designers: { label: 'Designer', bg: '#FCE7F3', color: '#9D174D' },
  Editors: { label: 'Editor', bg: '#CCFBF1', color: '#115E59' },
  'Designer plus Editor': { label: 'Designer + Editor', bg: '#EDE9FE', color: '#5B21B6' },
  Accountants: { label: 'Accountant', bg: '#DBEAFE', color: '#1E40AF' },
};

export function ServiceTypeBadge({ serviceType }: { serviceType?: string | null }) {
  if (!serviceType) return null;
  const badge =
    SERVICE_TYPE_BADGES[serviceType] ?? { label: serviceType, bg: '#EEF2F6', color: '#475569' };
  return (
    <span
      className="sh-status-pill shrink-0"
      style={{ backgroundColor: badge.bg, color: badge.color }}
      title={`From the ${badge.label} client brief`}
    >
      {badge.label}
    </span>
  );
}

/**
 * Product-line badge. Marks freelance Assignment cards (and reserved Hiring
 * cards) so they stand out from subscription cards in the same All Deals list.
 * Subscription cards render nothing — that's the default, no badge needed.
 */
const CARD_TYPE_BADGES: Record<string, { label: string; bg: string; color: string }> = {
  assignment: { label: 'Assignment', bg: '#FEF3C7', color: '#92400E' },
  hiring: { label: 'Hiring', bg: '#FAE8FF', color: '#86198F' },
};

export function CardTypeBadge({ cardType }: { cardType?: string | null }) {
  if (!cardType || cardType === 'subscription') return null;
  const badge =
    CARD_TYPE_BADGES[cardType] ?? { label: cardType, bg: '#EEF2F6', color: '#475569' };
  return (
    <span
      className="sh-status-pill shrink-0"
      style={{ backgroundColor: badge.bg, color: badge.color }}
      title={`This is a ${badge.label.toLowerCase()} brief`}
    >
      {badge.label}
    </span>
  );
}

type SalesPerson = { id: string; display_name: string | null; email: string | null };

function formatPublishedAt(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  const time = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const days = Math.floor((Date.now() - date.getTime()) / 86400000);
  if (days < 1) return `today at ${time}`;
  if (days === 1) return `yesterday at ${time}`;
  if (days < 7) return `${days}d ago at ${time}`;
  return `${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} at ${time}`;
}

type GroupBy = 'status' | 'date';
// UI bucket — independent of `state` because the "Assigned" bucket is driven by
// selected_recipient_id (which can coexist with state='closed' when the Profiles
// webhook closes the card and pins a selection together), and the published-state
// cards split into "published" (live, not yet broadcast) vs "broadcaster"
// (already broadcast to recipients).
export type Bucket = 'published' | 'broadcaster' | 'selected' | 'assigned' | 'paused' | 'cancelled';

/**
 * Precedence-based bucketing. A card with `selected_recipient_id` set always
 * lands in "assigned" — even if state='closed' (webhook flow) or state='assigned'
 * (admin manually picked one final recipient). Only when no final recipient
 * exists do we fall through to state-based buckets. A live published card then
 * splits by whether its recipients have been sent: `needs_broadcast` → the
 * "published" (awaiting-broadcast) bucket, otherwise the "broadcaster" bucket.
 * Closed cards land in "cancelled" and paused-but-still-assigned cards in
 * "paused", each surfaced by its own tab.
 */
export function categorize(card: AdminSubscriptionCard): Bucket {
  // Cancelled wins over the recipient pointer: cancelling a LIVE assignment
  // keeps selected_recipient_id for audit, and without this check the card
  // would sit in the Assigned tab forever offering actions that all 409.
  if (card.cancelled_at || card.state === 'closed') return 'cancelled';
  // A paused card keeps its selected_recipient_id and state='assigned' (pause
  // memory for resume), so it must be pulled out before the assigned check or
  // it would sit in the Assigned tab looking live.
  if (card.paused_at) return 'paused';
  if (card.selected_recipient_id) return 'assigned';
  if (card.state === 'assigned') return 'selected';
  // state === 'published'
  return card.needs_broadcast ? 'published' : 'broadcaster';
}

function bucketByDate<T extends { state: 'published' | 'assigned' | 'closed'; published_at: string | null }>(
  cards: T[],
): { today: T[]; yesterday: T[]; thisWeek: T[]; earlier: T[] } {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 86400000;
  const startOfWeek = startOfToday - 6 * 86400000;
  const today: T[] = [];
  const yesterday: T[] = [];
  const thisWeek: T[] = [];
  const earlier: T[] = [];
  for (const c of cards) {
    if (!c.published_at) { earlier.push(c); continue; }
    const t = new Date(c.published_at).getTime();
    if (t >= startOfToday) today.push(c);
    else if (t >= startOfYesterday) yesterday.push(c);
    else if (t >= startOfWeek) thisWeek.push(c);
    else earlier.push(c);
  }
  return { today, yesterday, thisWeek, earlier };
}

function subscriptionCardTitle(card: AdminSubscriptionCard): string {
  const business = card.submission?.business_name || card.brand_name || 'Unknown business';
  const subName = card.submission_subscription?.subscription?.name || card.plan_name;
  return subName ? `${business} · ${subName}` : business;
}

type Tab = 'requests' | 'published' | 'broadcaster' | 'selected' | 'assigned' | 'paused' | 'cancelled' | 'archive' | 'custom';

// Tabs backed by the subscription-cards lists (as opposed to New deals / Custom,
// which render their own components). These share the active + archived card
// queries and support the card detail view.
const CARD_LIST_TABS = ['published', 'broadcaster', 'selected', 'assigned', 'paused', 'cancelled', 'archive'] as const;

const TABS: { key: Tab; label: string }[] = [
  { key: 'requests', label: 'New deals' },
  { key: 'published', label: 'Published' },
  { key: 'broadcaster', label: 'Broadcasted' },
  { key: 'selected', label: 'Selected' },
  { key: 'assigned', label: 'Assigned' },
  { key: 'paused', label: 'Paused' },
  { key: 'cancelled', label: 'Cancelled' },
  { key: 'archive', label: 'Archive' },
  { key: 'custom', label: 'Custom' },
];

const HEADER_META: Record<Tab, { title: string; subtitle: string }> = {
  requests: {
    title: 'New Deals',
    subtitle: 'Incoming briefs and drafts. Fill in the details, save as a draft, then publish.',
  },
  published: {
    title: 'Published',
    subtitle: 'Published cards that haven’t been broadcast yet. Open one and click Broadcast to send it to partners and talents.',
  },
  broadcaster: {
    title: 'Broadcasted',
    subtitle: 'Cards already broadcast to partners and talents — awaiting accepts and rejects.',
  },
  selected: {
    title: 'Selected',
    subtitle: 'Cards where recipients have been selected, pending a final assignment.',
  },
  assigned: {
    title: 'Assigned',
    subtitle: 'Cards with a final recipient assigned. Pause or cancel a subscription right from its row.',
  },
  paused: {
    title: 'Paused',
    subtitle: 'Subscriptions paused mid-assignment — billing and the talent are on hold. Open one to resume (same talent or rebroadcast) or cancel it.',
  },
  cancelled: {
    title: 'Cancelled',
    subtitle: 'Subscriptions that were cancelled. Billing stopped on the cancel date and the card is closed.',
  },
  archive: {
    title: 'Archive',
    subtitle: 'Cards you’ve archived — hidden from talent feeds and the active pipeline.',
  },
  custom: {
    title: 'Custom Cards',
    subtitle: 'Cards created from scratch by admins (not from a request or submission).',
  },
};

// Empty-state copy for each card-list tab (shown when the bucket is empty and
// no search/filter is narrowing it).
const EMPTY_COPY: Record<(typeof CARD_LIST_TABS)[number], { title: string; hint: string }> = {
  published: {
    title: 'Nothing waiting to broadcast',
    hint: 'Published cards that still need to be sent to partners and talents show up here.',
  },
  broadcaster: {
    title: 'No broadcast cards yet',
    hint: 'Once you broadcast a card, it lands here while partners and talents respond.',
  },
  selected: {
    title: 'No selected cards',
    hint: 'Cards where recipients have been selected but not finally assigned show up here.',
  },
  assigned: {
    title: 'No assigned cards',
    hint: 'Cards with a final recipient assigned show up here.',
  },
  paused: {
    title: 'No paused subscriptions',
    hint: 'Assigned subscriptions you pause show up here until you resume or cancel them.',
  },
  cancelled: {
    title: 'No cancelled subscriptions',
    hint: 'Subscriptions you cancel show up here with their final billing dates.',
  },
  archive: {
    title: 'Nothing archived yet',
    hint: 'Cards you archive show up here.',
  },
};

export default function AdminSubscriptionCards({
  productLine = 'subscription',
}: {
  // Which product line this module renders. 'subscription' (default) is the
  // Subscription Cards module; 'assignment' is the separate Assignments module.
  // Every card query is scoped to it so the two modules never show each other's
  // cards, and the brief launcher only offers the matching brief types.
  productLine?: 'subscription' | 'assignment';
} = {}) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const [activeTab, setActiveTab] = useState<Tab>('requests');
  const [publishedBy, setPublishedBy] = useState<string>('');
  const [search, setSearch] = useState<string>('');
  // Debounced copy of `search` — the query keys off this so each keystroke
  // doesn't refire the (server-hydrated) list fetch. The input stays instant.
  const [debouncedSearch, setDebouncedSearch] = useState<string>('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);
  const [groupBy, setGroupBy] = useState<GroupBy>('status');
  const [showPanel, setShowPanel] = useState(false);
  // Card-detail view mode: the admin recipients funnel ('admin') or the
  // read-only "Client view" ('client') that mirrors the SquadHire business
  // review screen. Reset to 'admin' whenever the detail collapses to the list.
  const [cardViewMode, setCardViewMode] = useState<CardViewMode>('admin');
  const [showBriefSlider, setShowBriefSlider] = useState(false);
  // The chosen launcher: which product (subscription/assignment) + role type
  // the brief form opens with. null = no form open.
  const [briefChoice, setBriefChoice] = useState<{ type: BriefType; product: BriefProduct } | null>(null);

  // Card detail view is driven by a URL query param (?card=<id>) so the
  // browser back button collapses the detail back to the list rather than
  // skipping out of the module entirely.
  const selectedCardId = searchParams.get('card');
  // Other query params are preserved — in the admin panel there usually aren't
  // any, but the Leads mini app keeps its active tab in the URL and the two
  // must travel together or opening a card would reset the tab.
  const setSelectedCardId = useCallback((id: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (id) {
      params.set('card', id);
      router.push(`${pathname}?${params.toString()}`);
    } else if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back();
    } else {
      params.delete('card');
      const qs = params.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname);
    }
  }, [router, pathname, searchParams]);

  const isCardListTab = (CARD_LIST_TABS as readonly string[]).includes(activeTab);

  // Two card queries feed the flattened tab bar. The active query drives the
  // Published / Broadcaster / Selected / Assigned buckets (and the closed cards
  // the Archive tab folds in); the archived query drives the rest of Archive.
  // Both run regardless of the active tab so every tab's count stays live.
  const { data: activeCardsRes, isLoading: activeLoading, isFetching: activeFetching } = useQuery({
    queryKey: ['admin-subscription-cards', productLine, publishedBy, debouncedSearch, 'active', selectedCardId],
    queryFn: () => {
      const params: Record<string, string> = { card_type: productLine };
      if (publishedBy) params.published_by = publishedBy;
      if (debouncedSearch.trim()) params.search = debouncedSearch.trim();
      if (selectedCardId) params.card_id = selectedCardId;
      return api.get('/admin/subscription-cards', { params }).then((r) => r.data);
    },
    // Keep showing the prior list while a new filter/search refetches, so the
    // view never blanks to a loading state mid-typing.
    placeholderData: keepPreviousData,
    // Re-opening the tab within 30s reuses cached cards instantly.
    staleTime: 30_000,
  });
  const activeCards: AdminSubscriptionCard[] = activeCardsRes?.data || [];

  const { data: archivedCardsRes, isLoading: archivedLoading, isFetching: archivedFetching } = useQuery({
    queryKey: ['admin-subscription-cards', productLine, publishedBy, debouncedSearch, 'archived', selectedCardId],
    queryFn: () => {
      const params: Record<string, string> = { archived: 'true', card_type: productLine };
      if (publishedBy) params.published_by = publishedBy;
      if (debouncedSearch.trim()) params.search = debouncedSearch.trim();
      if (selectedCardId) params.card_id = selectedCardId;
      return api.get('/admin/subscription-cards', { params }).then((r) => r.data);
    },
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
  const archivedCards: AdminSubscriptionCard[] = archivedCardsRes?.data || [];

  // The Archive tab loads both queries; every other card-list tab only needs
  // the active one.
  const isLoading = activeTab === 'archive' ? activeLoading || archivedLoading : activeLoading;
  const isFetching = activeTab === 'archive' ? activeFetching || archivedFetching : activeFetching;

  // Reuse the sales-people endpoint to populate the "Published by" dropdown.
  const { data: peopleRes } = useQuery({
    queryKey: ['admin-sales-people'],
    queryFn: () => api.get('/admin/onboarding-links/sales-people').then((r) => r.data),
  });
  const salesPeople: SalesPerson[] = peopleRes?.data || [];

  // Pending-request count drives the badge on the "New deals" tab.
  // Four sources feed the queue: upsquad subscription_requests + draft
  // subscription_cards from the public Shared Form (/connect), from the
  // embedded Landing Page form, and from internal client briefs.
  //
  // All of these are scoped to this module's product line and use the exact
  // query keys AdminRequestsList uses, so the badge counts the same rows the
  // tab actually lists (an unscoped badge made Assignments claim a new deal
  // that belonged to Subscriptions) and its mutations invalidate these too.
  const { data: pendingReqsRes } = useQuery({
    queryKey: ['admin-subscription-requests', ''],
    queryFn: () => api.get('/admin/subscription-requests').then((r) => r.data),
    // The legacy upsquad queue predates product lines, so it only belongs to
    // Subscriptions — same guard AdminRequestsList applies.
    enabled: productLine === 'subscription',
  });
  const { data: pendingSharedRes } = useQuery({
    queryKey: ['admin-shared-form-submissions', productLine, ''],
    queryFn: () =>
      api
        .get('/admin/subscription-cards', { params: { source: 'shared_form', state: 'new,draft', card_type: productLine } })
        .then((r) => r.data),
  });
  const { data: pendingLandingRes } = useQuery({
    queryKey: ['admin-landing-page-submissions', productLine, ''],
    queryFn: () =>
      api
        .get('/admin/subscription-cards', { params: { source: 'landing_page_form', state: 'new,draft', card_type: productLine } })
        .then((r) => r.data),
  });
  // Internal client briefs (Workflow 1) also land in the New Deals queue.
  const { data: pendingBriefRes } = useQuery({
    queryKey: ['admin-internal-brief-submissions', productLine, ''],
    queryFn: () =>
      api
        .get('/admin/subscription-cards', { params: { source: 'internal_brief', state: 'new,draft', card_type: productLine } })
        .then((r) => r.data),
  });
  // The upsquad endpoint returns every status, so narrow it to the two the
  // New deals tab actually lists. The other three queues already fetch only
  // state='new,draft' rows, which are pending by definition.
  //
  // The upsquad status is external and doesn't track local archival, so a
  // request can stay 'pending' after its card is archived. AdminRequestsList
  // hides those rows (they belong in Archive), so the badge must subtract them
  // too or it over-counts (e.g. badge 6 while the list shows 1). The three
  // card-backed queues already fetch only non-archived rows server-side.
  const archivedCardIdSet = useMemo(
    () => new Set(archivedCards.map((c) => c.id)),
    [archivedCards],
  );
  const pendingRequestCount =
    (pendingReqsRes?.data || []).filter(
      (r: { status?: string; card_id?: string | null }) =>
        (r.status === 'pending' || r.status === 'in_review') &&
        !(r.card_id && archivedCardIdSet.has(r.card_id)),
    ).length +
    (pendingSharedRes?.data || []).length +
    (pendingLandingRes?.data || []).length +
    (pendingBriefRes?.data || []).length;

  const bucketed = useMemo(() => {
    const out: Record<Bucket, AdminSubscriptionCard[]> = { published: [], broadcaster: [], selected: [], assigned: [], paused: [], cancelled: [] };
    for (const c of activeCards) out[categorize(c)].push(c);
    return out;
  }, [activeCards]);

  // Archive = only cards explicitly archived (archived_at set). Cancelled cards
  // now have their own tab, so they're no longer folded in here. Deduped by id.
  const archiveCards = useMemo(() => {
    const byId = new Map<string, AdminSubscriptionCard>();
    for (const c of archivedCards) byId.set(c.id, c);
    return [...byId.values()];
  }, [archivedCards]);

  const tabCounts = useMemo(() => ({
    published: bucketed.published.length,
    broadcaster: bucketed.broadcaster.length,
    selected: bucketed.selected.length,
    assigned: bucketed.assigned.length,
    paused: bucketed.paused.length,
    cancelled: bucketed.cancelled.length,
    archive: archiveCards.length,
  }), [bucketed, archiveCards]);

  const unreviewedAssignedCount = useMemo(
    () => bucketed.assigned.filter((c) => !c.admin_reviewed_at).length,
    [bucketed.assigned],
  );

  const unreviewedSelectedCount = useMemo(
    () => bucketed.selected.filter((c) => !c.admin_reviewed_at).length,
    [bucketed.selected],
  );

  // Cards shown under the active card-list tab.
  const cardsForTab = useMemo(() => {
    switch (activeTab) {
      case 'published': return bucketed.published;
      case 'broadcaster': return bucketed.broadcaster;
      case 'selected': return bucketed.selected;
      case 'assigned': return bucketed.assigned;
      case 'paused': return bucketed.paused;
      case 'cancelled': return bucketed.cancelled;
      case 'archive': return archiveCards;
      default: return [] as AdminSubscriptionCard[];
    }
  }, [activeTab, bucketed, archiveCards]);

  const dateGroups = useMemo(() => bucketByDate(cardsForTab), [cardsForTab]);

  // The opened card can live in either query (an archived card opened from the
  // Archive tab, or a live card from any other card-list tab).
  // A card opened via ?card= is force-included by the backend in BOTH the
  // active and archived responses, so dedupe by id to avoid a doubled tier chip.
  const allLoadedCards = useMemo(() => {
    const byId = new Map<string, AdminSubscriptionCard>();
    for (const c of [...activeCards, ...archivedCards]) byId.set(c.id, c);
    return [...byId.values()];
  }, [activeCards, archivedCards]);
  const selectedCard = useMemo(
    () => allLoadedCards.find((c) => c.id === selectedCardId) || null,
    [allLoadedCards, selectedCardId],
  );

  // Collapsing the detail back to the list resets the view mode, so the next
  // card always opens in the admin funnel (not whatever the last card used).
  // Switching tiers keeps selectedCardId non-null, so the mode persists there.
  useEffect(() => {
    if (!selectedCardId) setCardViewMode('admin');
  }, [selectedCardId]);

  // The per-tier sibling cards of the opened brief (tier-ordered), so the detail
  // view can show a tab per tier. Empty for single-tier / ungrouped cards.
  const selectedGroupCards = useMemo(() => {
    if (!selectedCard?.brief_group_id) return [] as AdminSubscriptionCard[];
    return allLoadedCards
      .filter((c) => c.brief_group_id === selectedCard.brief_group_id)
      .sort((a, b) => tierRankOf(a) - tierRankOf(b));
  }, [allLoadedCards, selectedCard]);

  // "All tiers" is the default overview when a grouped card is opened (no
  // ?rv=). A specific tier is marked with ?rv=tier so the back button and the
  // list open still land on the merged view first.
  const allTiersMode = selectedGroupCards.length > 1 && searchParams.get('rv') !== 'tier';

  // Switch the active tier inside the opened card. Uses replace (not push) so
  // the back button still returns to the list, not the previously-viewed tier.
  // Preserves the other query params (like the Leads mini app's ?leadTab=) the
  // same way setSelectedCardId does — building a bare URL here dropped leadTab,
  // which bounced the view back to Job Cards so the tier "wouldn't load".
  const selectTierCard = useCallback(
    (id: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set('card', id);
      params.set('rv', 'tier');
      router.replace(`${pathname}?${params.toString()}`);
    },
    [router, pathname, searchParams],
  );
  // Back to the merged "All tiers" overview (drops the ?rv=tier marker).
  const selectAllTiers = useCallback(
    () => {
      if (!selectedCardId) return;
      const params = new URLSearchParams(searchParams.toString());
      params.set('card', selectedCardId);
      params.delete('rv');
      router.replace(`${pathname}?${params.toString()}`);
    },
    [router, pathname, selectedCardId, searchParams],
  );

  // The card detail view is driven purely by ?card= (whichever tab is active).
  // A deep link — e.g. "View card" from the Clients module, which opens in a new
  // tab and mounts fresh on the default 'requests' tab — must still open the
  // detail, so this can't be gated on isCardListTab.
  const showDetailView = !!selectedCard;

  // When switching primary tabs, drop any stale ?card= so the detail view
  // doesn't unexpectedly re-open when the user comes back to this tab.
  const switchTab = useCallback((next: Tab) => {
    setActiveTab(next);
    if (searchParams.get('card')) {
      router.replace(pathname);
    }
  }, [pathname, router, searchParams]);

  // Header copy per tab. `count` is the small metric chip beside the title; for
  // the card-list tabs it's a live card count, otherwise a short descriptor.
  const headerCount = activeTab === 'requests'
    ? 'Inbound queue'
    : activeTab === 'custom'
      ? 'Admin-created'
      : (() => {
          const n = tabCounts[activeTab as keyof typeof tabCounts];
          return `${n} card${n === 1 ? '' : 's'}`;
        })();
  const headerMeta = { ...HEADER_META[activeTab], count: headerCount };

  return (
    <div className="flex h-full flex-col sh-surface">
      {!showDetailView && (
        <div className="px-6 pt-6 pb-4 space-y-4">
          {/* Header — compact, functional. Title + live count on one row, CTA
              aligned right; reclaims the vertical space the old masthead card ate. */}
          <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 border-b border-[var(--color-sh-warm-border)] pb-4">
            <div className="min-w-0 space-y-1">
              <div className="flex items-center gap-2.5">
                <h1 className="sh-display text-2xl leading-none sm:text-[28px]">
                  {headerMeta.title}
                </h1>
                <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[var(--color-sh-warm-border)] bg-[var(--color-surface)] px-2.5 py-1 text-xs font-bold text-[var(--color-sh-ink)]">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--color-sh-lime)' }} />
                  {headerMeta.count}
                </span>
              </div>
              <p className="max-w-xl text-[13px] text-[var(--color-sh-ink-muted)]">
                {headerMeta.subtitle}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowBriefSlider(true)}
              className="sh-btn-primary sh-btn-primary-sm shrink-0"
            >
              + Create client brief form
            </button>
          </header>

          {/* Tabs — one row across the whole deal lifecycle: the New deals
              inbound queue, the published-card buckets, Archive, then Custom. */}
          <div className="overflow-x-auto">
            <div className="sh-tab-bar">
              {TABS.map(({ key, label }) => {
                const count =
                  key === 'published' || key === 'broadcaster' || key === 'selected' || key === 'assigned'
                  || key === 'paused' || key === 'cancelled'
                    ? tabCounts[key]
                    : key === 'archive'
                      ? tabCounts.archive
                      : null;
                return (
                  <button
                    key={key}
                    type="button"
                    data-active={activeTab === key}
                    onClick={() => switchTab(key)}
                    className="sh-tab"
                  >
                    {label}
                    {count != null && <span className="opacity-70"> ({count})</span>}
                    {key === 'requests' && pendingRequestCount > 0 && (
                      <span
                        className="ml-1 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1.5 text-[10px] font-bold leading-none"
                        style={{
                          // Lime fill doesn't flip between themes, so pin the
                          // ink dark — the global --sh-ink flips light in dark
                          // mode and would vanish on the yellow badge.
                          background: 'var(--color-sh-lime)',
                          color: '#0a0a0a',
                          boxShadow: 'inset 0 0 0 1px #0a0a0a',
                        }}
                        title={`${pendingRequestCount} pending review`}
                      >
                        {pendingRequestCount}
                      </span>
                    )}
                    {((key === 'assigned' && unreviewedAssignedCount > 0) ||
                      (key === 'selected' && unreviewedSelectedCount > 0)) && (
                      <span
                        className="ml-1 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1.5 text-[10px] font-bold leading-none"
                        style={{ background: '#DC2626', color: 'white' }}
                        title={`${
                          key === 'assigned' ? unreviewedAssignedCount : unreviewedSelectedCount
                        } new — admin review pending`}
                      >
                        {key === 'assigned' ? unreviewedAssignedCount : unreviewedSelectedCount} new
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Filters */}
          {isCardListTab && (
            <div className="flex flex-wrap items-center gap-1.5">
              <select
                value={publishedBy}
                onChange={(e) => setPublishedBy(e.target.value)}
                className="sh-input sh-input-sm"
                style={{ width: 'auto' }}
              >
                <option value="">All sales people</option>
                {salesPeople.map((p) => (
                  <option key={p.id} value={p.id}>{p.display_name || p.email || p.id.slice(0, 8)}</option>
                ))}
              </select>
              <div className="relative flex-1 min-w-[160px]">
                <svg
                  className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-sh-ink-faint)]"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M10.5 18a7.5 7.5 0 100-15 7.5 7.5 0 000 15z" />
                </svg>
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search business…"
                  className="sh-input sh-input-sm pl-8 pr-8"
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch('')}
                    aria-label="Clear search"
                    className="absolute right-2 top-1/2 -translate-y-1/2 flex h-5 w-5 items-center justify-center rounded-full text-[var(--color-sh-ink-faint)] transition hover:bg-[var(--color-sh-cream)] hover:text-[var(--color-sh-ink)]"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
              <select
                value={groupBy}
                onChange={(e) => setGroupBy(e.target.value as GroupBy)}
                className="sh-input sh-input-sm"
                style={{ width: 'auto' }}
              >
                <option value="status">Flat list</option>
                <option value="date">By date</option>
              </select>
            </div>
          )}
        </div>
      )}

      {selectedCard ? (
        cardViewMode === 'client' ? (
          <AdminCardClientPreview
            key={`client-${selectedCard.id}`}
            card={selectedCard}
            title={subscriptionCardTitle(selectedCard)}
            onBack={() => { setSelectedCardId(null); setShowPanel(false); }}
            onOpenPanel={() => setShowPanel(true)}
            viewMode={cardViewMode}
            onSetViewMode={setCardViewMode}
            tierTabs={selectedGroupCards.length > 1 ? (
              <DetailTierTabs
                cards={selectedGroupCards}
                activeId={selectedCard.id}
                allActive={allTiersMode}
                onSelect={selectTierCard}
                onSelectAll={selectAllTiers}
              />
            ) : undefined}
          />
        ) : (
          <AdminSubscriptionCardRecipientsView
            key={selectedCard.id}
            card={selectedCard}
            title={subscriptionCardTitle(selectedCard)}
            onBack={() => { setSelectedCardId(null); setShowPanel(false); }}
            onOpenPanel={() => setShowPanel(true)}
            groupCards={selectedGroupCards}
            allTiersMode={allTiersMode}
            viewMode={cardViewMode}
            onSetViewMode={setCardViewMode}
            tierTabs={selectedGroupCards.length > 1 ? (
              <DetailTierTabs
                cards={selectedGroupCards}
                activeId={selectedCard.id}
                allActive={allTiersMode}
                onSelect={selectTierCard}
                onSelectAll={selectAllTiers}
              />
            ) : undefined}
          />
        )
      ) : isCardListTab ? (
        <div className="flex-1 overflow-y-auto px-6 pb-8">
          <RefreshingBar show={isFetching && !isLoading} />
          {isLoading ? (
            <CardListSkeleton />
          ) : cardsForTab.length === 0 ? (
            <EmptyState
              title={debouncedSearch || publishedBy ? 'No cards match your filters' : EMPTY_COPY[activeTab as (typeof CARD_LIST_TABS)[number]].title}
              hint={debouncedSearch || publishedBy ? 'Try clearing the search or filters above.' : EMPTY_COPY[activeTab as (typeof CARD_LIST_TABS)[number]].hint}
            />
          ) : groupBy === 'date' ? (
            <div className="space-y-7">
              {dateGroups.today.length > 0 && (
                <CardGroup label="Today" color="#475569" items={dateGroups.today} onOpen={setSelectedCardId} showCancelledTag={activeTab === 'archive' || activeTab === 'cancelled'} showArchivedTag={activeTab === 'archive'} />
              )}
              {dateGroups.yesterday.length > 0 && (
                <CardGroup label="Yesterday" color="#475569" items={dateGroups.yesterday} onOpen={setSelectedCardId} showCancelledTag={activeTab === 'archive' || activeTab === 'cancelled'} showArchivedTag={activeTab === 'archive'} />
              )}
              {dateGroups.thisWeek.length > 0 && (
                <CardGroup label="Earlier this week" color="#475569" items={dateGroups.thisWeek} onOpen={setSelectedCardId} showCancelledTag={activeTab === 'archive' || activeTab === 'cancelled'} showArchivedTag={activeTab === 'archive'} />
              )}
              {dateGroups.earlier.length > 0 && (
                <CardGroup label="Earlier" color="#475569" items={dateGroups.earlier} onOpen={setSelectedCardId} showCancelledTag={activeTab === 'archive' || activeTab === 'cancelled'} showArchivedTag={activeTab === 'archive'} />
              )}
            </div>
          ) : (
            <CardList
              items={cardsForTab}
              onOpen={setSelectedCardId}
              canShowCancelled={activeTab === 'archive' || activeTab === 'cancelled'}
              canShowArchived={activeTab === 'archive'}
            />
          )}
        </div>
      ) : null}

      {!showDetailView && activeTab === 'requests' && <AdminRequestsList cardType={productLine} />}
      {!showDetailView && activeTab === 'custom' && <AdminCustomCardsList cardType={productLine} />}

      {selectedCard && showPanel && (
        <AdminSubscriptionCardRecipientsPanel
          card={selectedCard}
          title={subscriptionCardTitle(selectedCard)}
          onClose={() => setShowPanel(false)}
        />
      )}

      {/* Create client brief form → pick a type → fill out the brief form. */}
      <SliderPanel
        open={showBriefSlider}
        onClose={() => setShowBriefSlider(false)}
        title="New client brief"
      >
        <p className="mb-4 text-sm text-foreground-muted">
          Pick a brief type. You&apos;ll fill out the client brief form, and it lands in New Deals.
        </p>
        <div className="space-y-3">
          {BRIEF_LAUNCHERS.filter((t) => t.product === productLine).map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => { setShowBriefSlider(false); setBriefChoice({ type: t.type, product: t.product }); }}
              className="flex w-full items-center justify-between rounded-xl border border-divider bg-surface px-4 py-3 text-left transition hover:border-ink hover:shadow-sm"
            >
              <span>
                <span className="block text-sm font-semibold text-foreground">{t.title}</span>
                <span className="mt-0.5 block text-xs text-foreground-muted">{t.blurb}</span>
              </span>
              <span className="text-lg text-foreground-dim">→</span>
            </button>
          ))}
        </div>
      </SliderPanel>

      {/* The full /connect-style brief form opens as a standalone overlay. */}
      {briefChoice && (
        <ClientBriefForm
          type={briefChoice.type}
          product={briefChoice.product}
          onClose={() => setBriefChoice(null)}
          onCreated={() => { setBriefChoice(null); switchTab('requests'); }}
        />
      )}
    </div>
  );
}

// Thin top-of-list indicator shown while a filter/search refetch is in flight
// but prior results are still on screen (keepPreviousData). Avoids the jarring
// blank-then-repaint the old "Loading…" card caused on every keystroke.
function RefreshingBar({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <div className="mb-3 flex items-center gap-2 text-[11px] font-medium text-[var(--color-sh-ink-faint)]">
      <span className="inline-flex h-3 w-3 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />
      Updating…
    </div>
  );
}

// Skeleton placeholder rows shown on the very first load (no cached data yet),
// matching the real SubscriptionCardRow layout so the list doesn't jump when data
// arrives.
function CardListSkeleton() {
  return (
    <div className="space-y-2" aria-hidden="true">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="sh-card flex items-center justify-between px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-[var(--color-sh-cream)]" />
            <div className="space-y-2">
              <div className="h-3.5 w-40 animate-pulse rounded bg-[var(--color-sh-cream)]" />
              <div className="h-3 w-24 animate-pulse rounded bg-[var(--color-sh-cream)]" />
            </div>
          </div>
          <div className="hidden items-center gap-2 sm:flex">
            <div className="h-6 w-20 animate-pulse rounded-full bg-[var(--color-sh-cream)]" />
            <div className="h-6 w-20 animate-pulse rounded-full bg-[var(--color-sh-cream)]" />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="sh-card flex flex-col items-center gap-2 px-6 py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-sh-cream)] text-[var(--color-sh-ink-faint)]">
        <svg className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 17v-6h6v6m-9 4h12a2 2 0 002-2V7a2 2 0 00-2-2h-5l-2-2H6a2 2 0 00-2 2v14a2 2 0 002 2z" />
        </svg>
      </div>
      <p className="text-sm font-semibold text-[var(--color-sh-ink)]">{title}</p>
      <p className="max-w-xs text-xs text-[var(--color-sh-ink-muted)]">{hint}</p>
    </div>
  );
}

function CardGroup({
  label, color, items, onOpen, showCancelledTag, showArchivedTag,
}: {
  label: string;
  color: string;
  items: AdminSubscriptionCard[];
  onOpen: (id: string) => void;
  showCancelledTag: boolean;
  showArchivedTag?: boolean;
}) {
  return (
    <div>
      {/* Section header — colored dot + label + count, then a hairline rule that
          carries the eye across the row. Reads as a real list section, not a pill. */}
      <div className="mb-3 flex items-center gap-3">
        <div className="flex shrink-0 items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
          <span className="text-xs font-bold uppercase tracking-[0.04em] text-[var(--color-sh-ink)]">
            {label}
          </span>
          <span className="text-xs font-semibold text-[var(--color-sh-ink-faint)] tabular-nums">
            {items.length}
          </span>
        </div>
        <div className="h-px flex-1 bg-[var(--color-sh-warm-border)]" />
      </div>
      <CardList
        items={items}
        onOpen={onOpen}
        canShowCancelled={showCancelledTag}
        canShowArchived={showArchivedTag}
      />
    </div>
  );
}

// Customer-facing monthly price for a card: the finalized subscription price
// (or proposed price) the client pays. Staged cards have neither, so fall back
// to the plan's catalog pricing row.
function priceLabelForCard(card: AdminSubscriptionCard): string {
  const planPrice = card.submission_subscription?.plan?.pricing?.[0];
  const priceCurrency = planPrice?.country?.currency || '₹';
  const priceValue = resolveFinalizedPrice(card) ?? planPrice?.price ?? null;
  return priceValue ? `${priceCurrency}${Number(priceValue).toLocaleString()}/mo` : '';
}

function SubscriptionCardRow({ card, onOpen, showCancelledTag, showArchivedTag, onReinstate, reinstating, onPause, onCancel, pausing, cancelling }: { card: AdminSubscriptionCard; onOpen: () => void; showCancelledTag: boolean; showArchivedTag?: boolean; onReinstate?: () => void; reinstating?: boolean; onPause?: () => void; onCancel?: () => void; pausing?: boolean; cancelling?: boolean }) {
  const business = card.submission?.business_name || card.brand_name || 'Unknown';
  const serviceType = card.service_type || '';
  const planName =
    card.submission_subscription?.subscription?.name
    || card.plan_name
    || (card.submission_subscription?.plan
        ? `${card.submission_subscription.plan.plan} · ${card.submission_subscription.plan.tier}`
        : '');
  const priceLabel = priceLabelForCard(card);
  const publisher = card.published_by_user;
  const publisherLabel = publisher
    ? publisher.display_name || publisher.email || publisher.id.slice(0, 8)
    : null;

  const leftBlock = (
    <div className="flex min-w-0 items-center gap-3">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--color-sh-lime-soft)] text-[var(--color-sh-ink)] text-sm font-bold ring-1 ring-[var(--color-sh-warm-border)]">
        {business.charAt(0).toUpperCase()}
      </div>
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <p className="truncate text-sm font-semibold text-[var(--color-sh-ink)]">
            {business}
          </p>
          <ServiceTypeBadge serviceType={serviceType} />
          <CardTypeBadge cardType={card.card_type} />
          {card.card_code && (
            <span className="shrink-0 font-mono text-[10px] text-[var(--color-sh-ink-faint)]">
              {card.card_code}
            </span>
          )}
        </div>
        {(planName || priceLabel) && (
          <p className="mt-0.5 truncate text-xs text-[var(--color-sh-ink-muted)]">
            {planName}
            {planName && priceLabel ? ', ' : ''}
            {priceLabel}
          </p>
        )}
        {(card.published_at || publisherLabel) && (
          <p className="mt-1 truncate text-[11px] text-[var(--color-sh-ink-faint)]">
            {card.published_at ? formatPublishedAt(card.published_at) : ''}
            {card.published_at && publisherLabel ? ' · ' : ''}
            {publisherLabel ? `by ${publisherLabel}` : ''}
          </p>
        )}
      </div>
    </div>
  );
  const statusCluster = (
    <CardStatusAndCounts card={card} showCancelledTag={showCancelledTag} showArchivedTag={showArchivedTag} />
  );

  // Archived rows get an inline Reinstate action. The plain row is itself a
  // <button>, and a <button> can't nest inside a <button> — so here we render a
  // card-shaped <div> with a full-bleed click layer beneath the content (keeps
  // the whole row openable) and the Reinstate button layered above it.
  if (showArchivedTag && card.archived_at && onReinstate) {
    return (
      <div className="sh-card sh-card-interactive relative flex w-full items-center justify-between px-5 py-4 text-left">
        <button
          type="button"
          onClick={onOpen}
          aria-label={`Open ${business}`}
          className="absolute inset-0 z-0"
        />
        <div className="pointer-events-none relative z-10 flex min-w-0 flex-1 items-center">
          {leftBlock}
        </div>
        <div className="relative z-10 flex shrink-0 items-center gap-2 pl-3">
          <div className="pointer-events-none">{statusCluster}</div>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onReinstate(); }}
            disabled={reinstating}
            className="sh-btn-primary shrink-0"
          >
            {reinstating ? 'Reinstating…' : 'Reinstate'}
          </button>
        </div>
      </div>
    );
  }

  // Assigned rows get inline Pause / Cancel actions — the same nested-button-safe
  // layout as the archived Reinstate row (a <button> can't nest inside a <button>).
  if (categorize(card) === 'assigned' && onPause && onCancel) {
    return (
      <div className="sh-card sh-card-interactive relative flex w-full items-center justify-between px-5 py-4 text-left">
        <button
          type="button"
          onClick={onOpen}
          aria-label={`Open ${business}`}
          className="absolute inset-0 z-0"
        />
        <div className="pointer-events-none relative z-10 flex min-w-0 flex-1 items-center">
          {leftBlock}
        </div>
        <div className="relative z-10 flex shrink-0 items-center gap-2 pl-3">
          <div className="pointer-events-none">{statusCluster}</div>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onPause(); }}
            disabled={pausing || cancelling}
            className="sh-btn-warning shrink-0"
            title="Pause billing and release the talent — you can resume later"
          >
            {pausing ? 'Pausing…' : 'Pause'}
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onCancel(); }}
            disabled={pausing || cancelling}
            className="sh-btn-danger shrink-0"
            title="Cancel this subscription — billing stops and the card closes permanently"
          >
            {cancelling ? 'Cancelling…' : 'Cancel'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      onClick={onOpen}
      className="sh-card sh-card-interactive flex w-full items-center justify-between px-5 py-4 text-left"
    >
      {leftBlock}
      {statusCluster}
    </button>
  );
}

// The right-hand cluster of status pills + accept/reject count chips. Shared
// between the flat SubscriptionCardRow and the active tier of a grouped card.
function CardStatusAndCounts({ card, showCancelledTag, showArchivedTag }: { card: AdminSubscriptionCard; showCancelledTag: boolean; showArchivedTag?: boolean }) {
  const partners = card.recipient_counts?.partners ?? { pending: 0, accepted: 0, rejected: 0 };
  const talents = card.recipient_counts?.talents ?? { accepted: 0, rejected: 0 };
  const deliveryState = squadhireDeliveryState(card);
  return (
      <div className="flex shrink-0 items-center gap-1.5">
        {showArchivedTag && (
          <span
            className="sh-status-pill"
            style={{ backgroundColor: '#F2EBFE', color: '#6B21A8' }}
            title={`Archived${card.archived_at ? ' on ' + new Date(card.archived_at).toLocaleString() : ''}. Hidden from talent feeds and the default Published list.`}
          >
            Archived
          </span>
        )}
        {showCancelledTag && !card.recalled_at && (
          <span className="sh-status-pill" style={{ backgroundColor: '#EEF2F6', color: '#475569' }}>
            Cancelled
          </span>
        )}
        {card.recalled_at && (
          <span
            className="sh-status-pill"
            style={{ backgroundColor: '#FFE9D9', color: '#9A3412' }}
            title="Card was recalled after acceptances. Acceptees keep seeing it with a Recalled tag."
          >
            Recalled
          </span>
        )}
        {deliveryState === 'skipped' && (
          <span
            className="sh-status-pill"
            style={{ backgroundColor: '#FEF3C7', color: '#92400E' }}
            title="No SquadHire categories were selected, so this card was never delivered to SquadHire. Talents will not see it. Recall, edit categories, then re-publish to deliver."
          >
            Not on SquadHire
          </span>
        )}
        {deliveryState === 'pending' && (
          <span
            className="sh-status-pill"
            style={{ backgroundColor: '#FFE9D9', color: '#9A3412' }}
            title={
              card.squadhire_sync_last_error
                ? `SquadHire delivery failed: ${card.squadhire_sync_last_error} (${card.squadhire_sync_attempts ?? 0} attempts). Retry sweeper runs every 5 min.`
                : `SquadHire delivery in progress (${card.squadhire_sync_attempts ?? 0} attempts so far). Retry sweeper runs every 5 min.`
            }
          >
            SquadHire pending
          </span>
        )}
        {(() => {
          const bucket = categorize(card);
          if (bucket === 'paused') {
            return (
              <span
                className="sh-status-pill"
                style={{ backgroundColor: '#FEF3C7', color: '#92400E' }}
                title={
                  card.paused_at
                    ? `Paused on ${new Date(card.paused_at).toLocaleDateString()}. Billing and the talent are on hold until you resume or cancel.`
                    : 'Paused'
                }
              >
                Paused{card.paused_at ? ` · ${new Date(card.paused_at).toLocaleDateString()}` : ''}
              </span>
            );
          }
          if (bucket === 'assigned') {
            const isUnreviewed = !card.admin_reviewed_at;
            return (
              <>
                <span className="sh-status-pill" style={{ backgroundColor: '#D1FAE5', color: '#065F46' }}>
                  Assigned{card.selected_recipient_type ? ` (${card.selected_recipient_type})` : ''}
                </span>
                {isUnreviewed && (
                  <span
                    className="sh-status-pill"
                    style={{ backgroundColor: '#DC2626', color: 'white' }}
                    title="A talent has been assigned to this card. Click Review to open it."
                  >
                    NEW
                  </span>
                )}
              </>
            );
          }
          if (bucket === 'selected') {
            const isUnreviewed = !card.admin_reviewed_at;
            return (
              <>
                <span className="sh-status-pill" style={{ backgroundColor: '#E0F2FE', color: '#075985' }}>
                  Selected
                </span>
                {isUnreviewed && (
                  <span
                    className="sh-status-pill"
                    style={{ backgroundColor: '#DC2626', color: 'white' }}
                    title="A talent has been selected for this card. Click Review to open it."
                  >
                    NEW
                  </span>
                )}
              </>
            );
          }
          return null;
        })()}
        {(card.secondary_card_count ?? 0) > 0 && (
          <span className="sh-status-pill" style={{ backgroundColor: '#E0E7FF', color: '#3730A3' }}>
            {card.secondary_card_count} secondary
          </span>
        )}
        {card.card_code && card.linked_folder_id && (
          <span className="sh-status-pill" style={{ backgroundColor: '#D1FAE5', color: '#065F46' }}>
            Linked
          </span>
        )}
        {card.card_code && !card.linked_folder_id && card.state === 'assigned' && (
          <span className="sh-status-pill" style={{ backgroundColor: '#FEF3C7', color: '#92400E' }}>
            Not linked
          </span>
        )}
        {card.needs_broadcast && (
          <span
            className="sh-status-pill"
            style={{ backgroundColor: '#FEF3C7', color: '#92400E' }}
            title="This card is published but its recipients haven't been sent yet. Open it and click Broadcast to notify them."
          >
            Needs broadcast
          </span>
        )}
        <CountChip label="Partners" accepted={partners.accepted} rejected={partners.rejected} pending={partners.pending} />
        <CountChip label="Talents" accepted={talents.accepted} rejected={talents.rejected} />
      </div>
  );
}

function CountChip({
  label, accepted, rejected, pending,
}: {
  label: string;
  accepted: number;
  rejected: number;
  pending?: number;
}) {
  // Signal over noise: when nothing has happened, the chip reads "Partners —"
  // instead of a row of colored zeros. Only non-zero counts get color/weight,
  // so a busy card's real numbers pop out of the list at a glance.
  const total = accepted + rejected + (pending ?? 0);
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-sh-warm-border)] bg-[var(--color-surface)] px-2.5 py-1 text-[11px]"
      title={
        pending != null
          ? `${label}: ${accepted} accepted, ${rejected} rejected, ${pending} pending`
          : `${label}: ${accepted} accepted, ${rejected} rejected`
      }
    >
      <span className="font-medium text-[var(--color-sh-ink-subtle)]">{label}</span>
      {total === 0 ? (
        <span className="text-[var(--color-sh-ink-faint)]">—</span>
      ) : (
        <span className="inline-flex items-center gap-1 tabular-nums">
          {accepted > 0 && <span className="font-semibold text-emerald-600">{accepted}✓</span>}
          {rejected > 0 && <span className="font-semibold text-red-500">{rejected}✗</span>}
          {pending != null && pending > 0 && <span className="font-semibold text-amber-600">{pending}⌛</span>}
        </span>
      )}
    </span>
  );
}

// ── Per-tier card grouping ───────────────────────────────────────────────
// A multi-tier brief fans out into one published card per tier, all sharing a
// brief_group_id. The list collapses those siblings into a single card with
// one tab per tier so the admin sees "one card, N tiers" instead of N rows.

const TIER_RANK: Record<string, number> = {
  junior: 0,
  pro: 1,
  'top talents': 2,
};

function tierOf(card: AdminSubscriptionCard): string | null {
  return Array.isArray(card.target_tiers) && card.target_tiers.length > 0
    ? card.target_tiers[0]
    : null;
}

function tierRankOf(card: AdminSubscriptionCard): number {
  const t = (tierOf(card) || '').toLowerCase();
  return TIER_RANK[t] ?? 99;
}

type CardListEntry =
  | { kind: 'single'; card: AdminSubscriptionCard }
  | { kind: 'group'; groupId: string; cards: AdminSubscriptionCard[] };

// Collapse cards sharing a brief_group_id into one group entry, preserving
// first-appearance order. A group with only one sibling present in this list
// (e.g. the other tiers fell into a different status bucket) degrades to a
// normal single row.
function buildCardListEntries(items: AdminSubscriptionCard[]): CardListEntry[] {
  const entries: CardListEntry[] = [];
  const groupBuckets = new Map<string, AdminSubscriptionCard[]>();

  for (const card of items) {
    const gid = card.brief_group_id || null;
    if (!gid) {
      entries.push({ kind: 'single', card });
      continue;
    }
    let bucket = groupBuckets.get(gid);
    if (!bucket) {
      bucket = [];
      groupBuckets.set(gid, bucket);
      entries.push({ kind: 'group', groupId: gid, cards: bucket });
    }
    bucket.push(card);
  }

  return entries.map((e) => {
    if (e.kind !== 'group') return e;
    const cards = [...e.cards].sort((a, b) => tierRankOf(a) - tierRankOf(b));
    return cards.length === 1
      ? { kind: 'single' as const, card: cards[0] }
      : { kind: 'group' as const, groupId: e.groupId, cards };
  });
}

function CardList({ items, onOpen, canShowCancelled, canShowArchived }: {
  items: AdminSubscriptionCard[];
  onOpen: (id: string) => void;
  canShowCancelled: boolean;
  canShowArchived?: boolean;
}) {
  const entries = useMemo(() => buildCardListEntries(items), [items]);
  const qc = useQueryClient();
  // Inline reinstate straight from an archived row — no need to open the card.
  // Clears archived_at server-side; both the active + archived lists refetch,
  // so the row leaves the Archive tab on success.
  const reinstate = useMutation({
    mutationFn: (cardId: string) => api.post(`/admin/subscription-cards/${cardId}/reinstate`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-subscription-cards'] });
      showToast('Card reinstated to its previous state.', 'success');
    },
    onError: (err: any) => {
      showToast(err?.response?.data?.error || err.message || 'Failed to reinstate card', 'error');
    },
  });
  // Inline pause / cancel straight from an assigned row. Both stop billing today
  // (the server ends the active assignment term) and release the talent; the
  // active list refetches so the row moves to the Paused / Cancelled tab.
  const pause = useMutation({
    mutationFn: (cardId: string) => api.post(`/admin/subscription-cards/${cardId}/pause`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-subscription-cards'] });
      showToast('Subscription paused — billing stops today and the talent is released.', 'success');
    },
    onError: (err: any) => {
      showToast(err?.response?.data?.error || err.message || 'Failed to pause subscription', 'error');
    },
  });
  const cancel = useMutation({
    mutationFn: (cardId: string) => api.post(`/admin/subscription-cards/${cardId}/cancel`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-subscription-cards'] });
      showToast('Subscription cancelled — billing stopped and the card is closed.', 'success');
    },
    onError: (err: any) => {
      showToast(err?.response?.data?.error || err.message || 'Failed to cancel subscription', 'error');
    },
  });
  return (
    <div className="space-y-2">
      {entries.map((e) =>
        e.kind === 'single' ? (
          <SubscriptionCardRow
            key={e.card.id}
            card={e.card}
            onOpen={() => onOpen(e.card.id)}
            showCancelledTag={canShowCancelled && e.card.state === 'closed'}
            showArchivedTag={!!canShowArchived && !!e.card.archived_at}
            onReinstate={() => reinstate.mutate(e.card.id)}
            reinstating={reinstate.isPending && reinstate.variables === e.card.id}
            onPause={() => {
              if (window.confirm('Pause this subscription?\n\nBilling stops today and the talent is released until you resume.')) {
                pause.mutate(e.card.id);
              }
            }}
            onCancel={() => {
              if (window.confirm('Cancel this subscription permanently?\n\nBilling stops today, the card closes, and the talent is released. This cannot be undone.')) {
                cancel.mutate(e.card.id);
              }
            }}
            pausing={pause.isPending && pause.variables === e.card.id}
            cancelling={cancel.isPending && cancel.variables === e.card.id}
          />
        ) : (
          <GroupedSubscriptionCard
            key={e.groupId}
            cards={e.cards}
            onOpen={onOpen}
            canShowCancelled={canShowCancelled}
            canShowArchived={canShowArchived}
          />
        ),
      )}
    </div>
  );
}

// One card, one tab per tier. The summary row mirrors a normal SubscriptionCardRow
// but reflects the active tier; the tab bar switches which tier's card is
// summarised, and clicking the summary opens that tier card's recipients.
// A multi-tier brief in the list — ONE summary card. The per-tier tabs live in
// the opened detail view (see DetailTierTabs), not here. Counts aggregate across
// the group; opening it loads the group's first tier (the detail view then lets
// the admin switch tiers and see each tier's matched talents).
function GroupedSubscriptionCard({ cards, onOpen }: {
  cards: AdminSubscriptionCard[];
  onOpen: (id: string) => void;
  canShowCancelled: boolean;
  canShowArchived?: boolean;
}) {
  const rep = cards[0];
  const business = rep.submission?.business_name || rep.brand_name || 'Unknown';
  const serviceType = rep.service_type || '';
  const planName = rep.submission_subscription?.subscription?.name || rep.plan_name || '';
  const tierList = cards.map((c) => tierOf(c)).filter(Boolean).join(', ');
  const subtitle = [planName, tierList].filter(Boolean).join(' · ');
  const publisher = rep.published_by_user;
  const publisherLabel = publisher
    ? publisher.display_name || publisher.email || publisher.id.slice(0, 8)
    : null;
  const anyNeedsBroadcast = cards.some((c) => c.needs_broadcast);
  const agg = cards.reduce(
    (acc, c) => {
      const p = c.recipient_counts?.partners;
      const t = c.recipient_counts?.talents;
      acc.pa += p?.accepted ?? 0; acc.pr += p?.rejected ?? 0; acc.pp += p?.pending ?? 0;
      acc.ta += t?.accepted ?? 0; acc.tr += t?.rejected ?? 0;
      return acc;
    },
    { pa: 0, pr: 0, pp: 0, ta: 0, tr: 0 },
  );

  return (
    <button
      onClick={() => onOpen(rep.id)}
      className="sh-card sh-card-interactive flex w-full items-center justify-between px-5 py-4 text-left"
    >
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--color-sh-lime-soft)] text-[var(--color-sh-ink)] text-sm font-bold ring-1 ring-[var(--color-sh-warm-border)]">
          {business.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <p className="truncate text-sm font-semibold text-[var(--color-sh-ink)]">{business}</p>
            <ServiceTypeBadge serviceType={serviceType} />
            <CardTypeBadge cardType={rep.card_type} />
            <span
              className="sh-status-pill shrink-0"
              style={{ backgroundColor: '#E0E7FF', color: '#3730A3' }}
              title="One brief published across multiple tiers — open it to see each tier and its matched talents."
            >
              {cards.length} tiers
            </span>
          </div>
          {subtitle && (
            <p className="mt-0.5 truncate text-xs text-[var(--color-sh-ink-muted)]">{subtitle}</p>
          )}
          {(rep.published_at || publisherLabel) && (
            <p className="mt-1 truncate text-[11px] text-[var(--color-sh-ink-faint)]">
              {rep.published_at ? formatPublishedAt(rep.published_at) : ''}
              {rep.published_at && publisherLabel ? ' · ' : ''}
              {publisherLabel ? `by ${publisherLabel}` : ''}
            </p>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {anyNeedsBroadcast && (
          <span
            className="sh-status-pill"
            style={{ backgroundColor: '#FEF3C7', color: '#92400E' }}
            title="One or more tiers are published but their recipients haven't been sent yet. Open the card and broadcast each tier."
          >
            Needs broadcast
          </span>
        )}
        <CountChip label="Partners" accepted={agg.pa} rejected={agg.pr} pending={agg.pp} />
        <CountChip label="Talents" accepted={agg.ta} rejected={agg.tr} />
      </div>
    </button>
  );
}

// The per-tier tab control rendered inside the opened card (detail view). Each
// tab is a tier sibling; selecting it swaps the active card so the recipients
// below are that tier's matched talents.
function DetailTierTabs({ cards, activeId, allActive, onSelect, onSelectAll }: {
  cards: AdminSubscriptionCard[];
  activeId: string;
  allActive?: boolean;
  onSelect: (id: string) => void;
  onSelectAll?: () => void;
}) {
  const tabClass = (active: boolean) =>
    `rounded-full border px-3 py-1 text-xs font-medium transition ${
      active
        ? 'border-transparent bg-[var(--color-sh-lime-soft)] text-[var(--color-sh-ink)] shadow-[inset_0_0_0_1px_var(--color-sh-ink)]'
        : 'border-[var(--color-sh-warm-border)] bg-surface text-[var(--color-sh-ink-muted)] hover:text-[var(--color-sh-ink)]'
    }`;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-sh-ink-faint)]">
        Tiers
      </span>
      {onSelectAll && (
        <button
          type="button"
          onClick={onSelectAll}
          data-active={allActive}
          className={tabClass(!!allActive)}
          title="Show every tier's recipients together"
        >
          All
        </button>
      )}
      {cards.map((c) => {
        const isActive = !allActive && c.id === activeId;
        const price = priceLabelForCard(c);
        return (
          <button
            key={c.id}
            type="button"
            onClick={() => onSelect(c.id)}
            data-active={isActive}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
              isActive
                ? 'border-transparent bg-[var(--color-sh-lime-soft)] text-[var(--color-sh-ink)] shadow-[inset_0_0_0_1px_var(--color-sh-ink)]'
                : 'border-[var(--color-sh-warm-border)] bg-surface text-[var(--color-sh-ink-muted)] hover:text-[var(--color-sh-ink)]'
            }`}
          >
            {tierOf(c) || '—'}
            {price ? <span className={isActive ? 'opacity-80' : 'opacity-70'}> · {price}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
