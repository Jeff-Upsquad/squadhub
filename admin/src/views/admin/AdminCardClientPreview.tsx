'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import { showToast } from '@/components/Toast';
import { useSquadhireConfig } from '@/hooks/useSquadhireConfig';
import CardViewToggle, { type CardViewMode } from './CardViewToggle';
import AdminAssignmentOffers, { ClientBidActions } from './AdminAssignmentOffers';
import ClientViewChatPanel from './ClientViewChatPanel';
import { formatRelative } from './AdminSubscriptionCardRecipientsView';
import type { AdminSubscriptionCard } from './AdminSubscriptionCards';

// ─── The SquadHire business review screen, live inside the Hub ───────────────
//
// This is not an admin summary of what the customer sees — it reads the SAME
// business-portal services the customer's own browser calls (via the signed
// `client-view/card` webhook), so the photo, tier, category, live bid figure and
// "New" markers are the customer's, resolved once, upstream.
//
// Every action the business can take is here too: shortlist, reject, select,
// unselect, accept/counter/decline a bid, and the intro chatroom. They run
// through the same business primitives, and each one is written to the card's
// activity log with YOUR name, so the feed always says who really acted. Chat
// messages are sent as the signed-in user, never as the business.
//
// The one thing that is deliberately NOT identical: payment. The client pays
// through their own portal, so here we surface the live payment state and hand
// over the hosted link to pass on — nobody in the Hub handles card details. We
// also never clear the customer's "New" markers; reading their screen must not
// make their own unread badges disappear.

// ── The business portal's recipient shape (mirrors CardRecipientForBusiness) ──
type OfferAmount = { amount?: number; currency?: string | null; period?: string | null };

type BusinessRecipient = {
  recipient_id: string;
  talent_user_id: string;
  card_id: string;
  talent_name: string | null;
  profile_photo_url: string | null;
  current_location: string | null;
  profile_id: string | null;
  category: { id?: string; name?: string } | Array<{ id?: string; name?: string }> | null;
  skill_tool_names?: string[];
  tier: string | null;
  tier_custom: string | null;
  proposed_price: number | null;
  currency: string | null;
  offer_id?: string | null;
  offer_status?: string | null;
  offer_amount?: OfferAmount | null;
  business_review_status: 'shortlisted' | 'rejected' | null;
  selected_at: string | null;
  passed_over_at: string | null;
  responded_at: string | null;
  business_seen_at: string | null;
  subscription_activated_at: string | null;
};

type BusinessCard = {
  id: string;
  external_id: string | null;
  brand_name: string | null;
  subscription_name: string | null;
  plan_name: string | null;
  customer_company: string | null;
  customer_location: string | null;
  business_nature: string | null;
  description: string | null;
  status: string | null;
  recalled_at: string | null;
  currency: string | null;
  customer_monthly_price: number | null;
  hours_label: string | null;
  working_days: string[] | null;
  target_tiers: string[];
  target_regions: Array<{ region: string }>;
  target_languages: string[];
  categories: Array<{ id: string; name: string }>;
  custom_deliverables: Array<{ id?: string; name?: string; kind?: string; per_day?: number; per_week?: number; per_month?: number }>;
  additional_requirements: Record<string, string[]> | null;
  assignment_details: { duration?: string; start_date?: string; deadline?: string } | null;
};

type CardPayment = {
  id: string;
  recipient_id: string;
  status: 'created' | 'paid' | 'failed' | 'cancelled';
  amount: number | null;
  currency: string | null;
  period?: string | null;
  payment_url: string | null;
  invoice_number: string | null;
  invoice_url: string | null;
  invoice_sent_at: string | null;
};

// Highest tier first, matching the business portal's All · Top talents · Pro · Junior.
const TIER_TAB_ORDER = ['Top Talents', 'Pro', 'Junior'];

// One talent → one section. When the same person holds several recipient rows
// (a grouped multi-tier brief) or also has an open bid, the furthest stage wins.
const SECTION_RANK: Record<string, number> = {
  assigned: 5,
  selected: 4,
  shortlisted: 3,
  bidding: 2,
  review: 1,
};

function normalizeTier(tier: string | null | undefined): string | null {
  const t = (tier ?? '').toLowerCase().trim();
  if (t === 'junior') return 'Junior';
  if (t === 'pro') return 'Pro';
  if (t === 'top talents') return 'Top Talents';
  return null;
}

function initials(name: string | undefined | null): string {
  if (!name) return 'T';
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || 'T';
}

function categoryOf(r: BusinessRecipient): { id: string | null; name: string | null } {
  const cat = r.category;
  const one = Array.isArray(cat) ? cat[0] : cat;
  return { id: one?.id ?? null, name: one?.name ?? null };
}

function symbolFor(currency: string | null | undefined): string {
  return !currency || currency === 'INR' ? '₹' : `${currency} `;
}

// Format an ISO date ("2026-07-15") as a long date, parsed as local midnight so
// the day can't shift by timezone.
function fmtDate(s: string | null | undefined): string {
  const v = (s ?? '').trim();
  if (!v) return '';
  const d = new Date(`${v}T00:00:00`);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
}

export default function AdminCardClientPreview({
  card,
  title,
  onBack,
  onOpenPanel,
  viewMode,
  onSetViewMode,
}: {
  card: AdminSubscriptionCard;
  title: string;
  onBack: () => void;
  onOpenPanel: () => void;
  viewMode: CardViewMode;
  onSetViewMode: (m: CardViewMode) => void;
}) {
  const { adminUrl } = useSquadhireConfig();
  const qc = useQueryClient();
  const [confirmSelect, setConfirmSelect] = useState<BusinessRecipient | null>(null);
  const [confirmUnselect, setConfirmUnselect] = useState<BusinessRecipient | null>(null);
  const [chatTarget, setChatTarget] = useState<{ id: string; name: string } | null>(null);
  const [activeTier, setActiveTier] = useState<string>('all');

  // The customer's own screen, straight from the business portal's services.
  const { data, isLoading, error } = useQuery({
    queryKey: ['client-view-card', card.id],
    queryFn: async () => {
      const r = await api.get(`/admin/subscription-cards/${card.id}/client-view/card`);
      return r.data as { card: BusinessCard; recipients: BusinessRecipient[] };
    },
    retry: false,
  });

  const { data: paymentsRes } = useQuery({
    queryKey: ['client-view-payments', card.id],
    queryFn: async () => {
      const r = await api.get(`/admin/subscription-cards/${card.id}/client-view/payments`);
      return r.data as { payments: Record<string, CardPayment> };
    },
    retry: false,
    enabled: !!data,
  });
  const payments = paymentsRes?.payments ?? {};

  const invalidateCard = () => {
    qc.invalidateQueries({ queryKey: ['client-view-card', card.id] });
    qc.invalidateQueries({ queryKey: ['client-view-payments', card.id] });
    qc.invalidateQueries({ queryKey: ['admin-card-recipients', card.id] });
    qc.invalidateQueries({ queryKey: ['admin-card-squadhire-recipients', card.id] });
    qc.invalidateQueries({ queryKey: ['admin-card-events', card.id] });
    qc.invalidateQueries({ queryKey: ['admin-assignment-offers', card.id] });
    qc.invalidateQueries({ queryKey: ['admin-subscription-cards'] });
    qc.invalidateQueries({ queryKey: ['admin-card'] });
    qc.invalidateQueries({ queryKey: ['admin-card-detail', card.id] });
  };

  const review = useMutation({
    mutationFn: (v: { r: BusinessRecipient; action: 'shortlist' | 'reject' | 'unshortlist' }) =>
      api.post(`/admin/subscription-cards/${card.id}/client-view/review`, {
        talent_user_id: v.r.talent_user_id,
        recipient_id: v.r.recipient_id,
        action: v.action,
        talent_name: v.r.talent_name ?? undefined,
      }),
    onSuccess: (_d, v) => {
      invalidateCard();
      showToast(
        v.action === 'shortlist'
          ? 'Talent shortlisted'
          : v.action === 'reject'
            ? 'Talent rejected'
            : 'Removed from shortlist',
        'success',
      );
    },
    onError: (e: any) => showToast(e?.response?.data?.error || 'Could not update review', 'error'),
  });

  const selectMut = useMutation({
    mutationFn: (r: BusinessRecipient) =>
      api.post(`/admin/subscription-cards/${card.id}/client-view/select`, {
        talent_user_id: r.talent_user_id,
        recipient_id: r.recipient_id,
        talent_name: r.talent_name ?? undefined,
      }),
    onSuccess: () => {
      setConfirmSelect(null);
      invalidateCard();
      showToast('Talent selected — awaiting admin confirmation', 'success');
    },
    onError: (e: any) => showToast(e?.response?.data?.error || 'Could not select talent', 'error'),
  });

  const unselectMut = useMutation({
    mutationFn: (r: BusinessRecipient) =>
      api.post(`/admin/subscription-cards/${card.id}/client-view/unselect`, {
        talent_name: r.talent_name ?? undefined,
      }),
    onSuccess: () => {
      setConfirmUnselect(null);
      invalidateCard();
      showToast('Selection removed', 'success');
    },
    onError: (e: any) => {
      setConfirmUnselect(null);
      showToast(e?.response?.data?.error || 'Could not remove the selection', 'error');
    },
  });

  const paymentLink = useMutation({
    mutationFn: (r: BusinessRecipient) =>
      api.post(`/admin/subscription-cards/${card.id}/client-view/payments/link`, {
        recipient_id: r.recipient_id,
        talent_name: r.talent_name ?? undefined,
      }),
    onSuccess: async (res: any) => {
      const url = res?.data?.payment?.payment_url as string | undefined;
      qc.invalidateQueries({ queryKey: ['client-view-payments', card.id] });
      qc.invalidateQueries({ queryKey: ['admin-card-events', card.id] });
      if (url) await copyToClipboard(url, 'Payment link copied — send it to the client');
      else showToast('Payment link created', 'success');
    },
    onError: (e: any) => showToast(e?.response?.data?.error || 'Could not create a payment link', 'error'),
  });

  const { data: events } = useQuery({
    queryKey: ['admin-card-events', card.id],
    queryFn: async () => {
      const r = await api.get(`/admin/subscription-cards/${card.id}/events`);
      return (r.data?.data || []) as Array<{
        id: string;
        event_type: string;
        actor_label: string | null;
        actor_type: string | null;
        metadata: Record<string, unknown> | null;
        created_at: string;
      }>;
    },
  });
  const clientEvents = useMemo(
    () => (events ?? []).filter((e) => e.event_type.startsWith('client_')).slice().reverse(),
    [events],
  );

  const brief = data?.card ?? null;
  const recipients = useMemo(() => data?.recipients ?? [], [data]);
  const isAssignment = card.card_type === 'assignment';
  const isClosed =
    brief != null
      ? brief.status === 'archived' || !!brief.recalled_at
      : !!card.archived_at || !!card.cancelled_at || !!card.recalled_at || card.state === 'closed';
  const isSubmitted = brief?.status === 'submitted';
  const listPrice = brief?.customer_monthly_price ?? null;
  const currency = brief?.currency ?? null;

  const hasSelection = useMemo(() => recipients.some((r) => r.selected_at), [recipients]);

  // ── One talent, one section ────────────────────────────────────────────────
  // Subscription "request quote" tiers have no fixed price (proposed_price
  // null). Their first talent quote (pending_business) should sit in
  // "For Review" so business sees it as a new quote to review, not in
  // the Bidding negotiation section. SquadHire still lists normally.
  const isRequestQuoteCard =
    card.card_type !== 'assignment' &&
    card.subscription_price == null &&
    (card.proposed_price == null || card.proposed_price === 0);
  const sectionOf = (r: BusinessRecipient): string | null => {
    if (r.selected_at && r.subscription_activated_at) return 'assigned';
    if (r.selected_at) return 'selected';
    if (r.business_review_status === 'shortlisted') return 'shortlisted';
    if (r.offer_id && (r.offer_status === 'pending_business' || r.offer_status === 'pending_talent')) {
      if (isRequestQuoteCard && r.offer_status === 'pending_business') return 'review';
      return 'bidding';
    }
    if (!r.business_review_status) return 'review';
    return null;
  };

  const uniqueByTalent = useMemo(() => {
    const best = new Map<string, BusinessRecipient>();
    for (const r of recipients) {
      const key = r.talent_user_id || `recipient:${r.recipient_id}`;
      const prev = best.get(key);
      if (!prev) {
        best.set(key, r);
        continue;
      }
      const nextRank = SECTION_RANK[sectionOf(r) ?? ''] ?? 0;
      const prevRank = SECTION_RANK[sectionOf(prev) ?? ''] ?? 0;
      if (nextRank > prevRank) best.set(key, r);
    }
    return [...best.values()].map((r) => ({ r, section: sectionOf(r) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipients]);

  const selected = uniqueByTalent.filter((x) => x.section === 'selected' || x.section === 'assigned').map((x) => x.r);
  const selectedAssigned = selected.filter((r) => r.subscription_activated_at);
  const selectedPending = selected.filter((r) => !r.subscription_activated_at);
  // 'bidding' talents stay in the review pool here: unlike the customer, whose
  // bids live in their own portal section, the Hub's Bidding block is a live
  // admin read, so hiding them from the pool would lose the Shortlist/Reject
  // actions for anyone who has bid.
  const shortlisted = uniqueByTalent.filter((x) => x.section === 'shortlisted').map((x) => x.r);
  const forReview = uniqueByTalent
    .filter((x) => x.section === 'review' || x.section === 'bidding')
    .map((x) => x.r);

  // The customer's own unread markers. We show them but never clear them —
  // reading their screen must not make their badges vanish.
  const isNew = (r: BusinessRecipient) =>
    !r.business_seen_at && !r.business_review_status && !r.selected_at;

  const groupTiers = useMemo(() => {
    const present = new Set<string>();
    for (const t of brief?.target_tiers ?? card.target_tiers ?? []) {
      const n = normalizeTier(t);
      if (n) present.add(n);
    }
    return TIER_TAB_ORDER.filter((t) => present.has(t));
  }, [brief?.target_tiers, card.target_tiers]);

  const tierMatches = (r: BusinessRecipient) => activeTier === 'all' || normalizeTier(r.tier) === activeTier;
  const forReviewView = forReview
    .filter(tierMatches)
    .sort((a, b) => (isNew(b) ? 1 : 0) - (isNew(a) ? 1 : 0));
  const shortlistedView = shortlisted.filter(tierMatches);
  const newAcceptedCount = forReview.filter(isNew).length;
  const tierCount = (key: string) => {
    const pool = [...forReview, ...shortlisted];
    return key === 'all' ? pool.length : pool.filter((r) => normalizeTier(r.tier) === key).length;
  };

  const additionalReqs = flattenAdditionalReqs(brief?.additional_requirements);

  const busy = review.isPending || selectMut.isPending;
  const canActOn = (r: BusinessRecipient) => !isClosed && !isSubmitted && !hasSelection && !r.passed_over_at;

  // The business builds its own title: company first (the brand is often what
  // the talent works ON, not the customer), then the subscription.
  const titleLead = brief?.customer_company || brief?.brand_name || brief?.subscription_name || title;
  const displayTitle =
    brief?.subscription_name && titleLead !== brief.subscription_name
      ? `${titleLead} · ${brief.subscription_name}`
      : titleLead;
  const priceDisplay =
    listPrice != null
      ? `${symbolFor(currency)}${listPrice.toLocaleString()}${isAssignment ? '' : '/mo'}`
      : null;
  const timeline = brief?.assignment_details ?? null;

  const headerRow = (
    <div className="flex items-center justify-between gap-3">
      <button onClick={onBack} className="sh-btn-ghost sh-btn-ghost-sm">
        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
        Back to Subscription Cards
      </button>
      <div className="flex items-center gap-2">
        <CardViewToggle viewMode={viewMode} onSetViewMode={onSetViewMode} />
        <button onClick={onOpenPanel} className="sh-btn-ghost sh-btn-ghost-sm">
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75"
            />
          </svg>
          Card Details
        </button>
      </div>
    </div>
  );

  const rowActions = (r: BusinessRecipient, extra?: React.ReactNode) => (
    <div className="grid grid-cols-2 gap-2 sm:flex sm:shrink-0 sm:flex-wrap sm:items-center">
      <button
        type="button"
        disabled={isClosed}
        onClick={() => setChatTarget({ id: r.talent_user_id, name: r.talent_name || 'Talent' })}
        className="rounded-lg border border-[var(--color-sh-warm-border)] px-2 py-2 text-xs font-semibold text-[var(--color-sh-ink)] transition hover:bg-[var(--color-sh-cream)] disabled:opacity-40 sm:px-3 sm:py-1.5"
      >
        Chatroom
      </button>
      <ClientBidActions
        cardId={card.id}
        offerId={r.offer_id ?? null}
        offerStatus={r.offer_status ?? null}
        disabled={isClosed || isSubmitted || hasSelection}
      />
      {extra}
    </div>
  );

  return (
    <div className="flex min-h-0 h-full flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto px-6 pt-6 pb-10">
        {headerRow}

        <div className="flex items-start gap-2 rounded-xl border border-[var(--color-sh-warm-border)] bg-[var(--color-sh-cream)] px-4 py-2.5">
          <svg className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-sh-ink-subtle)]" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
          <p className="text-xs text-[var(--color-sh-ink-muted)]">
            The business&rsquo;s own review screen in SquadHire, live — shortlist, reject, select,
            unselect, bids and chatrooms all act as the business. Every action is logged below under{' '}
            <span className="font-semibold">your name</span>, and chat messages show your name, not
            the business&rsquo;s.
          </p>
        </div>

        {error && (
          <div className="rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-300">
            {((error as any)?.response?.data?.error as string) ||
              'Could not load the business review screen from SquadHire.'}{' '}
            A card only has a client view once it is linked to a business and broadcast. Use{' '}
            <span className="font-semibold">Admin</span> for the full recipient funnel.
          </div>
        )}

        {/* ═══ Card brief — the customer's own copy ═══ */}
        <div className="sh-card p-5 sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="truncate font-[family-name:var(--font-jakarta)] text-lg font-semibold text-[var(--color-sh-ink)]">
                {displayTitle}
              </h1>
              {brief?.plan_name && (
                <p className="mt-0.5 text-sm text-[var(--color-sh-ink-subtle)]">{brief.plan_name}</p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {isSubmitted && (
                <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
                  Submitted
                </span>
              )}
              {isClosed && (
                <span className="rounded-full bg-[var(--color-sh-cream)] px-3 py-1 text-xs font-semibold text-[var(--color-sh-ink-subtle)]">
                  {brief?.recalled_at || card.recalled_at ? 'Recalled' : 'Closed'}
                </span>
              )}
              {priceDisplay && (
                <span className="rounded-full bg-[var(--color-sh-lime-soft)] px-3 py-1 text-xs font-semibold text-[var(--color-sh-ink)]">
                  {priceDisplay}
                </span>
              )}
            </div>
          </div>

          {(brief?.categories?.length ?? 0) > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {brief!.categories.map((cat) => (
                <span
                  key={cat.id}
                  className="rounded-full bg-[var(--color-sh-cream)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--color-sh-ink)]"
                >
                  {cat.name}
                </span>
              ))}
            </div>
          )}

          {brief && (
            <>
              <Section title={isAssignment ? 'Assignment' : 'Subscription'}>
                <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
                  {brief.subscription_name && <DetailRow label="Service">{brief.subscription_name}</DetailRow>}
                  {brief.plan_name && <DetailRow label="Plan">{brief.plan_name}</DetailRow>}
                  {brief.target_tiers.length > 0 && (
                    <DetailRow label={brief.target_tiers.length === 1 ? 'Tier' : 'Tiers'}>
                      {brief.target_tiers.join(', ')}
                    </DetailRow>
                  )}
                  {brief.hours_label && <DetailRow label="Availability">{brief.hours_label}</DetailRow>}
                  {!isAssignment && (brief.working_days?.length ?? 0) > 0 && (
                    <DetailRow label="Working days">{brief.working_days!.join(', ')}</DetailRow>
                  )}
                </dl>
                {brief.custom_deliverables.length > 0 && (
                  <div className="mt-3">
                    <p className="text-[11px] font-medium uppercase tracking-wider text-[var(--color-sh-ink-faint)]">
                      Custom deliverables
                    </p>
                    <ul className="mt-1.5 space-y-1 text-sm text-[var(--color-sh-ink)]">
                      {brief.custom_deliverables.map((d, i) => {
                        const cadence = [
                          d.per_day ? `${d.per_day}/day` : null,
                          d.per_week ? `${d.per_week}/week` : null,
                          d.per_month ? `${d.per_month}/month` : null,
                        ]
                          .filter(Boolean)
                          .join(' · ');
                        return (
                          <li key={d.id ?? i} className="flex items-baseline gap-2">
                            <span className="font-medium">{d.name || '—'}</span>
                            {cadence && <span className="text-xs text-[var(--color-sh-ink-subtle)]">{cadence}</span>}
                            {d.kind && <span className="text-[10px] uppercase text-[var(--color-sh-ink-faint)]">{d.kind}</span>}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </Section>

              {(brief.target_regions.length > 0 || brief.target_languages.length > 0) && (
                <Section title="Location & languages">
                  <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
                    {brief.target_regions.length > 0 && (
                      <DetailRow label={brief.target_regions.length === 1 ? 'Region' : 'Regions'}>
                        {brief.target_regions.map((r) => r.region).join(', ')}
                      </DetailRow>
                    )}
                    {brief.target_languages.length > 0 && (
                      <DetailRow label={brief.target_languages.length === 1 ? 'Language' : 'Languages'}>
                        {brief.target_languages.join(', ')}
                      </DetailRow>
                    )}
                  </dl>
                </Section>
              )}

              {priceDisplay && (
                <Section title={isAssignment ? 'Project budget' : 'Budget'}>
                  <p className="text-lg font-semibold text-[var(--color-sh-ink)]">{priceDisplay}</p>
                </Section>
              )}

              {isAssignment && timeline && (timeline.duration || timeline.start_date || timeline.deadline) && (
                <Section title="Timeline">
                  <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
                    {timeline.duration && <DetailRow label="Duration">{timeline.duration}</DetailRow>}
                    {timeline.start_date && <DetailRow label="Start date">{fmtDate(timeline.start_date)}</DetailRow>}
                    {timeline.deadline && <DetailRow label="Deadline">{fmtDate(timeline.deadline)}</DetailRow>}
                  </dl>
                </Section>
              )}

              {isAssignment && brief.description && (
                <Section title="Scope & deliverables">
                  <p className="whitespace-pre-line text-sm text-[var(--color-sh-ink-muted)]">{brief.description}</p>
                </Section>
              )}

              {(brief.brand_name || brief.business_nature || brief.customer_location || (!isAssignment && brief.description)) && (
                <Section title="About the brand">
                  <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
                    {brief.brand_name && brief.brand_name !== brief.customer_company && (
                      <DetailRow label="Brand">{brief.brand_name}</DetailRow>
                    )}
                    {brief.business_nature && <DetailRow label="Nature of business">{brief.business_nature}</DetailRow>}
                    {brief.customer_location && <DetailRow label="Location of business">{brief.customer_location}</DetailRow>}
                  </dl>
                  {!isAssignment && brief.description && (
                    <p className="mt-3 whitespace-pre-line text-sm text-[var(--color-sh-ink-muted)]">
                      {brief.description}
                    </p>
                  )}
                </Section>
              )}
            </>
          )}
        </div>

        {isSubmitted && (
          <div className="rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-300">
            Awaiting team review — this brief has been submitted and will appear with candidates once published.
          </div>
        )}

        {/* ═══ Bidding — same position as the business portal, above the funnel ═══ */}
        <AdminAssignmentOffers
          cardId={card.id}
          clientView
          hideWhenEmpty
          isRequestQuote={
            card.card_type !== 'assignment' &&
            (card as any).subscription_price == null &&
            ((card as any).proposed_price == null || (card as any).proposed_price === 0)
          }
          onOpenChat={
            isClosed ? undefined : (talentUserId, talentName) => setChatTarget({ id: talentUserId, name: talentName })
          }
        />

        {/* ═══ Assigned — the confirmed pick ═══ */}
        {selectedAssigned.length > 0 && (
          <div className="rounded-2xl border-2 border-emerald-200 bg-emerald-50/60 p-5 sm:p-6 dark:border-emerald-900/50 dark:bg-emerald-950/20">
            <h2 className="mb-3 flex items-center gap-2 font-[family-name:var(--font-jakarta)] text-sm font-semibold text-emerald-800 dark:text-emerald-300">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {selectedAssigned.length === 1 ? 'Assigned Talent' : 'Assigned Talents'}
            </h2>
            <div className="space-y-4">
              {selectedAssigned.map((r) => (
                <div key={r.recipient_id} className="flex flex-col gap-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
                    <TalentIdentity r={r} adminUrl={adminUrl} />
                    <div className="flex flex-col gap-2.5 sm:ml-auto sm:flex-row sm:items-center">
                      <PriceBlock r={r} listPrice={listPrice} isAssignment={isAssignment} />
                      <span className="self-start rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700">
                        Assigned
                      </span>
                    </div>
                  </div>
                  <PaymentBlock
                    r={r}
                    payment={payments[r.recipient_id] ?? null}
                    isAssignment={isAssignment}
                    onCreateLink={() => paymentLink.mutate(r)}
                    creating={paymentLink.isPending}
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ═══ Selected — pending admin confirmation ═══ */}
        {selectedPending.length > 0 && (
          <div className="rounded-2xl border-2 border-amber-200 bg-amber-50/60 p-5 sm:p-6 dark:border-amber-900/50 dark:bg-amber-950/20">
            <h2 className="mb-1 flex items-center gap-2 font-[family-name:var(--font-jakarta)] text-sm font-semibold text-amber-800 dark:text-amber-300">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Selected — pending confirmation
            </h2>
            <p className="mb-3 text-xs text-amber-700 dark:text-amber-400">
              We&rsquo;re finalising this assignment. You&rsquo;ll see it confirmed here shortly.
            </p>
            <div className="space-y-4">
              {selectedPending.map((r) => {
                const payment = payments[r.recipient_id] ?? null;
                return (
                  <div key={r.recipient_id} className="flex flex-col gap-3">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
                      <TalentIdentity r={r} adminUrl={adminUrl} />
                      <div className="flex flex-col gap-2.5 sm:ml-auto sm:flex-row sm:items-center">
                        <PriceBlock r={r} listPrice={listPrice} isAssignment={isAssignment} />
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            disabled={isClosed}
                            onClick={() => setChatTarget({ id: r.talent_user_id, name: r.talent_name || 'Talent' })}
                            className="rounded-lg border border-[var(--color-sh-warm-border)] px-2.5 py-1.5 text-xs font-semibold text-[var(--color-sh-ink)] transition hover:bg-[var(--color-sh-cream)] disabled:opacity-40"
                          >
                            Chatroom
                          </button>
                          <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-semibold text-amber-700">
                            Selected
                          </span>
                          {/* Undoing a paid-for pick needs a refund, so SquadHire
                              refuses it — don't offer what we know is rejected. */}
                          {payment?.status !== 'paid' && (
                            <button
                              type="button"
                              onClick={() => setConfirmUnselect(r)}
                              title="Remove this selection and pick someone else"
                              className="rounded-full border border-[var(--color-sh-warm-border)] px-2.5 py-0.5 text-[11px] font-semibold text-[var(--color-sh-ink-subtle)] transition hover:text-[var(--color-sh-ink)]"
                            >
                              Unselect
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                    <PaymentBlock
                      r={r}
                      payment={payment}
                      isAssignment={isAssignment}
                      onCreateLink={() => paymentLink.mutate(r)}
                      creating={paymentLink.isPending}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Tier sub-tabs — multi-tier briefs, filtering both review sections. */}
        {groupTiers.length > 1 && (
          <div className="sh-card flex flex-wrap items-center gap-1.5 px-3 py-2">
            <span className="mr-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-sh-ink-faint)]">
              Tiers
            </span>
            {[{ key: 'all', label: 'All' }, ...groupTiers.map((t) => ({ key: t, label: t }))].map((tab) => {
              const active = activeTier === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveTier(tab.key)}
                  className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                    active
                      ? 'border-transparent bg-[var(--color-sh-lime-soft)] text-[var(--color-sh-ink)] shadow-[inset_0_0_0_1px_var(--color-sh-ink)]'
                      : 'border-[var(--color-sh-warm-border)] bg-surface text-[var(--color-sh-ink-muted)] hover:text-[var(--color-sh-ink)]'
                  }`}
                >
                  {tab.label}
                  <span className={`ml-1 ${active ? 'opacity-80' : 'text-[var(--color-sh-ink-faint)]'}`}>
                    {tierCount(tab.key)}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* ═══ Shortlisted ═══ */}
        <ListCard
          title="Shortlisted"
          count={shortlistedView.length}
          emptyText="No shortlisted talents yet. Review talents below to add them here."
        >
          {shortlistedView.map((r) => (
            <li key={r.recipient_id} className="px-5 py-4 sm:px-6">
              <div className="flex flex-col gap-3">
                <TalentIdentity r={r} adminUrl={adminUrl} inactive={(isClosed || hasSelection) && !r.selected_at} />
                <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
                  <PriceBlock r={r} listPrice={listPrice} isAssignment={isAssignment} />
                  {rowActions(
                    r,
                    <>
                      <button
                        type="button"
                        disabled={!canActOn(r) || busy}
                        onClick={() => review.mutate({ r, action: 'unshortlist' })}
                        className="rounded-lg border border-[var(--color-sh-warm-border)] px-2 py-2 text-xs font-semibold text-[var(--color-sh-ink-subtle)] transition hover:bg-[var(--color-sh-cream)] disabled:opacity-40 sm:px-3 sm:py-1.5"
                      >
                        Remove
                      </button>
                      <button
                        type="button"
                        disabled={!canActOn(r) || busy}
                        onClick={() => setConfirmSelect(r)}
                        className="sh-btn-primary sh-btn-primary-xs"
                      >
                        Select
                      </button>
                    </>,
                  )}
                </div>
                {(hasSelection || isClosed) && !r.selected_at && (
                  <span className="self-start rounded-full bg-[var(--color-sh-cream)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-sh-ink-subtle)]">
                    Not selected
                  </span>
                )}
              </div>
              <MatchChips reqs={additionalReqs} talentNames={r.skill_tool_names} />
            </li>
          ))}
        </ListCard>

        {/* ═══ New talents for review ═══ */}
        <ListCard
          title="New talents for review"
          count={forReviewView.length}
          loading={isLoading}
          emptyText="No new talents to review."
          badge={
            newAcceptedCount > 0 ? (
              <span className="shrink-0 rounded-full bg-red-500 px-2 py-0.5 text-[10px] font-bold text-white">
                {newAcceptedCount} new
              </span>
            ) : null
          }
        >
          {forReviewView.map((r) => (
            <li
              key={r.recipient_id}
              className={`px-5 py-4 sm:px-6 ${isNew(r) ? 'bg-red-50/40 dark:bg-red-950/10' : ''}`}
            >
              <div className="flex flex-col gap-3">
                <TalentIdentity
                  r={r}
                  adminUrl={adminUrl}
                  isNew={isNew(r)}
                  inactive={(isClosed || hasSelection) && !r.selected_at}
                  subtitle={r.responded_at ? `Accepted ${formatRelative(r.responded_at)}` : undefined}
                />
                <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
                  <PriceBlock r={r} listPrice={listPrice} isAssignment={isAssignment} />
                  {rowActions(
                    r,
                    <>
                      <button
                        type="button"
                        disabled={!canActOn(r) || busy}
                        onClick={() => review.mutate({ r, action: 'shortlist' })}
                        className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-40 sm:py-1.5"
                      >
                        Shortlist
                      </button>
                      <button
                        type="button"
                        disabled={!canActOn(r) || busy}
                        onClick={() => review.mutate({ r, action: 'reject' })}
                        className="rounded-lg border border-[var(--color-sh-warm-border)] px-3 py-2 text-xs font-semibold text-[var(--color-sh-ink-subtle)] transition hover:border-red-200 hover:text-red-600 disabled:opacity-40 sm:py-1.5"
                      >
                        Reject
                      </button>
                    </>,
                  )}
                </div>
              </div>
              <MatchChips reqs={additionalReqs} talentNames={r.skill_tool_names} />
            </li>
          ))}
        </ListCard>

        <ActivityLog events={clientEvents} />
      </div>

      {confirmSelect && (
        <ConfirmDialog
          title="Confirm selection"
          onCancel={() => setConfirmSelect(null)}
          cancelLabel="Cancel"
          confirmLabel={selectMut.isPending ? 'Selecting…' : 'Select talent'}
          confirmDisabled={selectMut.isPending}
          onConfirm={() => selectMut.mutate(confirmSelect)}
        >
          <p className="text-sm text-[var(--color-sh-ink-muted)]">
            You are about to select <strong>{confirmSelect.talent_name || 'this talent'}</strong>. Only one
            talent can be selected per card.
          </p>
          <p className="mt-2 text-sm text-amber-700">
            The pick goes to the Squad team for confirmation. Once approved it&rsquo;ll show as Assigned and
            the subscription starts.
          </p>
        </ConfirmDialog>
      )}

      {confirmUnselect && (
        <ConfirmDialog
          title="Remove this selection?"
          onCancel={() => setConfirmUnselect(null)}
          cancelLabel="Keep selection"
          confirmLabel={unselectMut.isPending ? 'Removing…' : 'Remove selection'}
          confirmDisabled={unselectMut.isPending}
          onConfirm={() => unselectMut.mutate(confirmUnselect)}
        >
          <p className="text-sm text-[var(--color-sh-ink-muted)]">
            <strong>{confirmUnselect.talent_name || 'This talent'}</strong> will no longer be selected, and
            someone else can be picked. Their agreed price is kept, so they can be selected again later at
            the same figure.
          </p>
          <p className="mt-2 text-sm text-[var(--color-sh-ink-muted)]">
            The talent is notified, and any other bids this pick closed will reopen.
          </p>
        </ConfirmDialog>
      )}

      {chatTarget && (
        <ClientViewChatPanel
          cardId={card.id}
          talentUserId={chatTarget.id}
          talentName={chatTarget.name}
          onClose={() => setChatTarget(null)}
        />
      )}
    </div>
  );
}

// ─── Presentational helpers ──────────────────────────────────────────────────

async function copyToClipboard(text: string, message: string) {
  try {
    await navigator.clipboard.writeText(text);
    showToast(message, 'success');
  } catch {
    // Clipboard is blocked in some embeds — show the link so it can be copied by hand.
    showToast(text, 'success');
  }
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-3 border-t border-[var(--color-sh-warm-border)] pt-3">
      <h2 className="mb-1.5 font-[family-name:var(--font-jakarta)] text-[13px] font-semibold text-[var(--color-sh-ink)]">
        {title}
      </h2>
      {children}
    </div>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-medium uppercase tracking-wider text-[var(--color-sh-ink-faint)]">{label}</dt>
      <dd className="text-sm text-[var(--color-sh-ink)]">{children}</dd>
    </div>
  );
}

function ListCard({
  title,
  count,
  children,
  emptyText,
  loading = false,
  badge = null,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
  emptyText: string;
  loading?: boolean;
  badge?: React.ReactNode;
}) {
  return (
    <div className="sh-card">
      <div className="flex items-center justify-between border-b border-[var(--color-sh-warm-border)] px-5 py-4 sm:px-6">
        <div className="flex items-center gap-2">
          <h2 className="font-[family-name:var(--font-jakarta)] text-sm font-semibold text-[var(--color-sh-ink)]">
            {title}
          </h2>
          {badge}
        </div>
        <span className="text-xs text-[var(--color-sh-ink-faint)]">{count} total</span>
      </div>
      {loading ? (
        <div className="space-y-2 p-4">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="h-14 animate-pulse rounded-xl bg-[var(--color-sh-cream)]" />
          ))}
        </div>
      ) : count === 0 ? (
        <div className="px-6 py-10 text-center">
          <p className="text-sm text-[var(--color-sh-ink-subtle)]">{emptyText}</p>
        </div>
      ) : (
        <ul className="divide-y divide-[var(--color-sh-warm-border)]">{children}</ul>
      )}
    </div>
  );
}

/**
 * Photo (or tinted initials), name, tier chip, category · location — the same
 * identity block the customer sees. The profile opens in SquadHire's admin,
 * not the business portal: an admin has no business session to view it with.
 */
function TalentIdentity({
  r,
  adminUrl,
  isNew = false,
  inactive = false,
  subtitle,
}: {
  r: BusinessRecipient;
  adminUrl: string | null | undefined;
  isNew?: boolean;
  inactive?: boolean;
  subtitle?: string;
}) {
  const cat = categoryOf(r);
  const meta = [cat.name, r.current_location].filter(Boolean).join(' · ');
  const href = adminUrl ? `${adminUrl}/admin/users/${r.talent_user_id}` : null;

  const body = (
    <>
      {r.profile_photo_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={r.profile_photo_url}
          alt={r.talent_name ?? ''}
          className="h-11 w-11 shrink-0 rounded-xl object-cover ring-1 ring-[var(--color-sh-warm-border)]"
        />
      ) : (
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--color-sh-lime-soft)] font-[family-name:var(--font-jakarta)] text-sm font-semibold text-[var(--color-sh-ink)] ring-1 ring-[var(--color-sh-warm-border)]">
          {initials(r.talent_name)}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="min-w-0 truncate font-[family-name:var(--font-jakarta)] text-[15px] font-semibold text-[var(--color-sh-ink)]">
            {r.talent_name || 'Unknown talent'}
          </p>
          {isNew && (
            <span className="shrink-0 rounded-full bg-red-500 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
              New
            </span>
          )}
          {r.tier && (
            <span className="shrink-0 rounded-full bg-[var(--color-sh-cream)] px-2 py-0.5 text-[10px] font-semibold text-[var(--color-sh-ink)]">
              {r.tier_custom || r.tier}
            </span>
          )}
        </div>
        {(meta || subtitle) && (
          <p className="mt-0.5 truncate text-xs text-[var(--color-sh-ink-faint)]">{meta || subtitle}</p>
        )}
        {meta && subtitle && <p className="truncate text-xs text-[var(--color-sh-ink-faint)]">{subtitle}</p>}
      </div>
    </>
  );

  if (inactive) {
    return <div className="flex min-w-0 select-none items-center gap-3 opacity-45 grayscale sm:gap-4">{body}</div>;
  }
  if (!href) return <div className="flex min-w-0 items-center gap-3 sm:gap-4">{body}</div>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title="View this talent in SquadHire"
      className="flex min-w-0 items-center gap-3 transition-opacity hover:opacity-70 sm:gap-4"
    >
      {body}
    </a>
  );
}

/** The business-facing figure, and where it came from. */
function resolvePrice(r: BusinessRecipient) {
  const offer = r.offer_amount;
  if (offer && typeof offer.amount === 'number' && offer.amount > 0) {
    return {
      amount: offer.amount,
      currency: offer.currency ?? r.currency ?? null,
      period: offer.period ?? 'per_month',
      fromBid: true,
      offerStatus: r.offer_status ?? null,
    };
  }
  if (r.proposed_price != null && r.proposed_price > 0) {
    return { amount: r.proposed_price, currency: r.currency ?? null, period: 'per_month', fromBid: false, offerStatus: null };
  }
  return null;
}

function priceLabel(status: string | null, fromBid: boolean): string {
  if (!fromBid) return 'List price';
  if (status === 'accepted') return 'Agreed';
  if (status === 'pending_talent') return 'Your offer';
  if (status === 'pending_business') return 'Talent bid';
  return 'Bid';
}

function PriceBlock({
  r,
  listPrice,
  isAssignment = false,
}: {
  r: BusinessRecipient;
  listPrice: number | null;
  isAssignment?: boolean;
}) {
  const resolved = resolvePrice(r);
  if (!resolved) return null;

  const cur = symbolFor(resolved.currency);
  const isProject = isAssignment || resolved.period === 'project';
  const suffix = isProject ? '' : '/mo';
  const label = priceLabel(resolved.offerStatus, resolved.fromBid);
  const differs = listPrice != null && listPrice > 0 && resolved.amount !== listPrice;
  const isAgreed = resolved.fromBid && resolved.offerStatus === 'accepted';
  const isLiveBid = resolved.fromBid && !isAgreed;

  return (
    <div
      className={`w-full rounded-xl px-3.5 py-2 text-left ring-1 sm:w-auto sm:min-w-[7.5rem] sm:shrink-0 sm:text-right ${
        isAgreed
          ? 'bg-emerald-50 ring-emerald-200 dark:bg-emerald-950/20 dark:ring-emerald-900/50'
          : isLiveBid
            ? 'bg-amber-50 ring-amber-200 dark:bg-amber-950/20 dark:ring-amber-900/50'
            : 'bg-[var(--color-sh-cream)] ring-[var(--color-sh-warm-border)]'
      }`}
      title={differs && listPrice != null ? `${label} · list was ${cur}${listPrice.toLocaleString()}${suffix}` : label}
    >
      <p
        className={`text-[10px] font-semibold uppercase tracking-wider ${
          isAgreed ? 'text-emerald-700' : isLiveBid ? 'text-amber-800 dark:text-amber-400' : 'text-[var(--color-sh-ink-faint)]'
        }`}
      >
        {label}
      </p>
      <p
        className={`mt-0.5 font-[family-name:var(--font-jakarta)] text-[15px] font-bold leading-tight tabular-nums sm:text-base ${
          isAgreed ? 'text-emerald-900 dark:text-emerald-300' : 'text-[var(--color-sh-ink)]'
        }`}
      >
        {cur}
        {resolved.amount.toLocaleString()}
        {suffix && <span className="ml-0.5 text-[11px] font-semibold text-[var(--color-sh-ink-subtle)]">{suffix}</span>}
      </p>
      {differs && listPrice != null && (
        <p className="mt-0.5 text-[10px] font-medium text-[var(--color-sh-ink-faint)]">
          {resolved.amount > listPrice ? '↑' : '↓'} from {cur}
          {listPrice.toLocaleString()}
          {suffix}
        </p>
      )}
    </div>
  );
}

/**
 * The client's payment, in three states — the same figure and receipt the
 * business sees. The Hub does not take the payment: an unpaid card gets a
 * hosted link to hand to the client, so no card details pass through here.
 */
function PaymentBlock({
  r,
  payment,
  isAssignment,
  onCreateLink,
  creating,
}: {
  r: BusinessRecipient;
  payment: CardPayment | null;
  isAssignment: boolean;
  onCreateLink: () => void;
  creating: boolean;
}) {
  const resolved = resolvePrice(r);
  const amount = payment?.amount ?? resolved?.amount ?? null;
  const currencyCode = payment?.currency ?? resolved?.currency ?? null;
  if (amount == null || !(amount > 0)) return null;

  const cur = symbolFor(currencyCode);
  const isProject = isAssignment || (payment?.period ?? resolved?.period) === 'project';
  const amountLabel = `${cur}${amount.toLocaleString()}${isProject ? '' : '/mo'}`;

  if (payment?.status === 'paid') {
    return (
      <div className="rounded-xl border border-emerald-200 bg-[var(--color-surface)] p-3.5 sm:p-4 dark:border-emerald-900/50">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <svg className="h-4 w-4 shrink-0 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="font-[family-name:var(--font-jakarta)] text-[13px] font-semibold text-emerald-800 dark:text-emerald-300">
              Payment received — {amountLabel}
            </p>
          </div>
          {payment.invoice_number && payment.invoice_url && (
            <a
              href={payment.invoice_url}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full border border-emerald-300 px-3 py-1 text-[11px] font-semibold text-emerald-800 transition hover:bg-emerald-50 dark:text-emerald-300"
            >
              View invoice {payment.invoice_number}
            </a>
          )}
        </div>
        <p className="mt-1 text-[11.5px] text-[var(--color-sh-ink-subtle)]">
          {payment.invoice_sent_at
            ? 'The invoice has been sent to the client on WhatsApp.'
            : payment.invoice_number
              ? 'The invoice is ready — it reaches the client on WhatsApp shortly.'
              : "The invoice is being generated — it reaches the client on WhatsApp shortly."}
        </p>
      </div>
    );
  }

  const link = payment?.status === 'created' ? payment.payment_url : null;

  return (
    <div className="rounded-xl border border-[var(--color-sh-warm-border)] bg-[var(--color-surface)] p-3.5 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-[family-name:var(--font-jakarta)] text-[13px] font-semibold text-[var(--color-sh-ink)]">
            Payment — {amountLabel} due
          </p>
          <p className="mt-0.5 text-[11.5px] text-[var(--color-sh-ink-subtle)]">
            {link
              ? 'A payment link is live for this client. Send it on to complete the booking.'
              : `Create the hosted link for ${r.talent_name || 'this talent'} and send it to the client. The invoice follows on WhatsApp once paid.`}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {link && (
            <a
              href={link}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full border border-[var(--color-sh-warm-border)] px-3 py-2 text-[13px] font-semibold text-[var(--color-sh-ink)] transition hover:bg-[var(--color-sh-cream)]"
            >
              Open
            </a>
          )}
          <button
            type="button"
            onClick={() => (link ? copyToClipboard(link, 'Payment link copied — send it to the client') : onCreateLink())}
            disabled={creating}
            className="sh-btn-primary sh-btn-primary-sm"
          >
            {creating ? 'Working…' : link ? 'Copy payment link' : 'Create payment link'}
          </button>
        </div>
      </div>
      <p className="mt-2 text-[10.5px] text-[var(--color-sh-ink-faint)]">
        Secured by Razorpay · the client pays through the link, never through the Hub.
      </p>
    </div>
  );
}

// ── Additional requirements ─────────────────────────────────────────────────
// Presence-match the brief's optional skills/tools against a talent's profile.
// Reference only for the client — it never affects who was matched.
interface ReqItem {
  group: string;
  label: string;
}

function flattenAdditionalReqs(raw: Record<string, string[]> | null | undefined): ReqItem[] {
  if (!raw || typeof raw !== 'object') return [];
  const out: ReqItem[] = [];
  for (const [group, list] of Object.entries(raw)) {
    if (!Array.isArray(list)) continue;
    for (const label of list) {
      const l = typeof label === 'string' ? label.trim() : '';
      if (l) out.push({ group, label: l });
    }
  }
  return out;
}

function MatchChips({ reqs, talentNames }: { reqs: ReqItem[]; talentNames?: string[] }) {
  if (reqs.length === 0) return null;
  const have = new Set((talentNames ?? []).map((n) => n.trim().toLowerCase()).filter(Boolean));
  return (
    <div className="mt-3 sm:pl-[56px]">
      <p className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wide text-[var(--color-sh-ink-faint)]">
        Additional requirements
      </p>
      <div className="flex flex-wrap gap-1.5">
        {reqs.map((req, i) => {
          const matched = have.has(req.label.toLowerCase());
          return (
            <span
              key={`${req.group}-${req.label}-${i}`}
              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                matched
                  ? 'border-[#BFE6C9] bg-[#EAF7EE] text-[#1F7E36]'
                  : 'border-[#F4C9C4] bg-[#FDECEC] text-[#C13515]'
              }`}
              title={matched ? 'Talent lists this' : 'Not listed by this talent'}
            >
              <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
                {matched ? (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6L6 18" />
                )}
              </svg>
              {req.label}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function ConfirmDialog({
  title,
  children,
  onCancel,
  onConfirm,
  cancelLabel,
  confirmLabel,
  confirmDisabled = false,
}: {
  title: string;
  children: React.ReactNode;
  onCancel: () => void;
  onConfirm: () => void;
  cancelLabel: string;
  confirmLabel: string;
  confirmDisabled?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <button type="button" className="absolute inset-0 bg-black/40" aria-label="Cancel" onClick={onCancel} />
      <div className="relative mx-4 w-full max-w-md rounded-2xl border border-[var(--color-sh-warm-border)] bg-[var(--color-surface)] p-6 shadow-2xl">
        <h3 className="font-[family-name:var(--font-jakarta)] text-lg font-semibold text-[var(--color-sh-ink)]">
          {title}
        </h3>
        <div className="mt-2">{children}</div>
        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-[var(--color-sh-warm-border)] px-4 py-2 text-sm font-semibold text-[var(--color-sh-ink-muted)]"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            disabled={confirmDisabled}
            onClick={onConfirm}
            className="sh-btn-primary sh-btn-primary-sm"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

const CLIENT_EVENT_LABEL: Record<string, string> = {
  client_shortlisted: 'Shortlisted',
  client_rejected: 'Rejected',
  client_unshortlisted: 'Removed from shortlist',
  client_selected: 'Selected',
  client_unselected: 'Removed the selection',
  client_payment_link: 'Created a payment link',
  client_chat_opened: 'Opened a chatroom',
  client_chat_message: 'Sent a chat message',
};

function ActivityLog({
  events,
}: {
  events: Array<{
    id: string;
    event_type: string;
    actor_label: string | null;
    metadata: Record<string, unknown> | null;
    created_at: string;
  }>;
}) {
  return (
    <div className="sh-card">
      <div className="flex items-center justify-between border-b border-[var(--color-sh-warm-border)] px-5 py-4 sm:px-6">
        <h2 className="font-[family-name:var(--font-jakarta)] text-sm font-semibold text-[var(--color-sh-ink)]">
          Activity log
        </h2>
        <span className="text-xs text-[var(--color-sh-ink-faint)]">{events.length} total</span>
      </div>
      {events.length === 0 ? (
        <div className="px-6 py-10 text-center">
          <p className="text-sm text-[var(--color-sh-ink-subtle)]">
            Actions taken from this Client view — shortlist, reject, select, unselect, chat — appear here.
          </p>
        </div>
      ) : (
        <ol className="divide-y divide-[var(--color-sh-warm-border)]">
          {events.map((e) => {
            const talent = typeof e.metadata?.talent_name === 'string' ? e.metadata.talent_name : null;
            const preview = typeof e.metadata?.preview === 'string' ? e.metadata.preview : null;
            return (
              <li key={e.id} className="px-5 py-3 sm:px-6">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-sm font-medium text-[var(--color-sh-ink)]">
                    {CLIENT_EVENT_LABEL[e.event_type] || e.event_type}
                    {talent ? <span className="font-normal text-[var(--color-sh-ink-muted)]"> · {talent}</span> : null}
                  </p>
                  <span className="shrink-0 text-[11px] text-[var(--color-sh-ink-faint)]">
                    {formatRelative(e.created_at)}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-[var(--color-sh-ink-subtle)]">
                  {e.actor_label ? `by ${e.actor_label}` : 'by a Leads user'}
                </p>
                {preview && <p className="mt-1 text-xs text-[var(--color-sh-ink-muted)]">&ldquo;{preview}&rdquo;</p>}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
