'use client';

import { useCallback, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import api from '@/services/api';
import AdminPublishedCardRecipientsPanel from './AdminPublishedCardRecipientsPanel';
import AdminPublishedCardRecipientsView from './AdminPublishedCardRecipientsView';
import AdminRequestsList from './AdminRequestsList';
import AdminCustomCardsList from './AdminCustomCardsList';

export type PublishedCard = {
  id: string;
  state: 'published' | 'assigned' | 'closed';
  distribution: 'broadcast' | 'manual';
  published_at: string | null;
  working_days: string[];
  brand_name: string | null;
  business_nature: string | null;
  notes: string | null;
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
  recalled_at?: string | null;
  cancelled_at?: string | null;
  archived_at?: string | null;
  closed_at?: string | null;
  assigned_at?: string | null;
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
  markup?: number | null;
  publish_targets?: string[] | null;
  plan_name?: string | null;
  service_type?: string | null;
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
      pricing?: { country_id: string; price: number; country?: { id: string; name: string; currency: string } | null }[];
    } | null;
  } | null;
  recipient_counts?: {
    partners: { pending: number; accepted: number; rejected: number };
    talents: { accepted: number; rejected: number };
  };
  published_by_user?: { id: string; display_name: string | null; email: string | null } | null;
};

/**
 * Three states per card on the SquadHire delivery axis:
 *  - 'skipped'   — card has no SquadHire categories; webhook never fires by design.
 *  - 'pending'   — categories present, webhook not yet delivered (in retry loop).
 *  - 'delivered' — squadhire_synced_at set; nothing to surface (default, no chip).
 */
export function squadhireDeliveryState(card: PublishedCard): 'skipped' | 'pending' | 'delivered' {
  if (card.squadhire_synced_at) return 'delivered';
  const hasCategories =
    Array.isArray(card.squadhire_category_ids) && card.squadhire_category_ids.length > 0;
  if (!hasCategories) return 'skipped';
  return 'pending';
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
type StateFilter = 'all' | 'published' | 'assigned' | 'closed';

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

function publishedCardTitle(card: PublishedCard): string {
  const business = card.submission?.business_name || card.customer_company || 'Unknown business';
  const subName = card.submission_subscription?.subscription?.name || card.plan_name;
  return subName ? `${business} · ${subName}` : business;
}

type Tab = 'published' | 'requests' | 'custom' | 'archive';

export default function AdminPublishedCards() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const [activeTab, setActiveTab] = useState<Tab>('published');
  const [stateFilter, setStateFilter] = useState<StateFilter>('all');
  const [publishedBy, setPublishedBy] = useState<string>('');
  const [search, setSearch] = useState<string>('');
  const [groupBy, setGroupBy] = useState<GroupBy>('status');
  const [showPanel, setShowPanel] = useState(false);

  // Card detail view is driven by a URL query param (?card=<id>) so the
  // browser back button collapses the detail back to the list rather than
  // skipping out of the module entirely.
  const selectedCardId = searchParams.get('card');
  const setSelectedCardId = useCallback((id: string | null) => {
    if (id) {
      router.push(`${pathname}?card=${id}`);
    } else if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back();
    } else {
      router.push(pathname);
    }
  }, [router, pathname]);

  const isArchiveTab = activeTab === 'archive';

  // Server returns all states for the current tab; state filtering happens
  // client-side so the secondary tabs can show accurate counts.
  const { data: cardsRes, isLoading } = useQuery({
    queryKey: ['admin-published-cards', publishedBy, search, isArchiveTab ? 'archived' : 'active'],
    queryFn: () => {
      const params: Record<string, string> = {};
      if (publishedBy) params.published_by = publishedBy;
      if (search.trim()) params.search = search.trim();
      if (isArchiveTab) params.archived = 'true';
      return api.get('/admin/subscription-cards', { params }).then((r) => r.data);
    },
    enabled: activeTab === 'published' || activeTab === 'archive',
  });
  const cards: PublishedCard[] = cardsRes?.data || [];

  // Reuse the sales-people endpoint to populate the "Published by" dropdown.
  const { data: peopleRes } = useQuery({
    queryKey: ['admin-sales-people'],
    queryFn: () => api.get('/admin/onboarding-links/sales-people').then((r) => r.data),
  });
  const salesPeople: SalesPerson[] = peopleRes?.data || [];

  // Pending-request count drives the badge on the "Form Requests" tab.
  // Same query-key prefix as AdminRequestsList so its mutations invalidate
  // this count automatically.
  const { data: pendingReqsRes } = useQuery({
    queryKey: ['admin-subscription-requests', 'pending', ''],
    queryFn: () =>
      api
        .get('/admin/subscription-requests', { params: { status: 'pending' } })
        .then((r) => r.data),
  });
  const pendingRequestCount = (pendingReqsRes?.data || []).length;

  const stateCounts = useMemo(() => ({
    all: cards.length,
    published: cards.filter((c) => c.state === 'published').length,
    assigned: cards.filter((c) => c.state === 'assigned').length,
    closed: cards.filter((c) => c.state === 'closed').length,
  }), [cards]);

  const filteredCards = useMemo(
    () => stateFilter === 'all' ? cards : cards.filter((c) => c.state === stateFilter),
    [cards, stateFilter],
  );

  const groups = useMemo(() => ({
    active: filteredCards.filter((c) => c.state === 'published'),
    assigned: filteredCards.filter((c) => c.state === 'assigned'),
    cancelled: filteredCards.filter((c) => c.state === 'closed'),
  }), [filteredCards]);

  const dateGroups = useMemo(() => bucketByDate(filteredCards), [filteredCards]);

  const selectedCard = useMemo(
    () => cards.find((c) => c.id === selectedCardId) || null,
    [cards, selectedCardId],
  );

  const showDetailView = (activeTab === 'published' || activeTab === 'archive') && !!selectedCard;

  // When switching primary tabs, drop any stale ?card= so the detail view
  // doesn't unexpectedly re-open when the user comes back to this tab.
  const switchTab = useCallback((next: Tab) => {
    setActiveTab(next);
    if (searchParams.get('card')) {
      router.replace(pathname);
    }
  }, [pathname, router, searchParams]);

  return (
    <div className="flex h-full flex-col sh-surface">
      {!showDetailView && (
        <div className="px-6 pt-6 pb-4 space-y-5">
          {/* Hero card */}
          <div className="sh-card p-6 sm:p-7">
            <div className="space-y-3">
              <span className="sh-eyebrow">
                <span className="sh-eyebrow-dot" />
                {activeTab === 'archive'
                  ? `${cards.length} archived card${cards.length === 1 ? '' : 's'}`
                  : activeTab === 'requests'
                    ? 'Inbound queue'
                    : activeTab === 'custom'
                      ? 'Admin-created'
                      : `${cards.length} published card${cards.length === 1 ? '' : 's'}`}
              </span>
              <h1 className="sh-display text-3xl sm:text-4xl">
                {activeTab === 'archive' ? 'Archived Cards' : activeTab === 'requests' ? 'Form Requests' : activeTab === 'custom' ? 'Custom Cards' : 'Published Cards'}
              </h1>
              <p className="text-sm text-[var(--color-sh-ink-muted)] max-w-xl">
                {activeTab === 'archive'
                  ? 'Hidden from talent feeds and the default Published list. Republish or delete from here.'
                  : activeTab === 'requests'
                    ? 'Inbound subscription requests from the pricing page.'
                    : activeTab === 'custom'
                      ? 'Cards created from scratch by admins (not from a request or submission).'
                      : 'All subscription cards published across the org.'}
              </p>
            </div>
          </div>

          {/* Primary tabs */}
          <div className="overflow-x-auto">
            <div className="sh-tab-bar">
              {([['published', 'Published'], ['requests', 'Form Requests'], ['custom', 'Custom'], ['archive', 'Archive']] as const).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  data-active={activeTab === key}
                  onClick={() => switchTab(key)}
                  className="sh-tab"
                >
                  {label}
                  {key === 'requests' && pendingRequestCount > 0 && (
                    <span
                      className="ml-1 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1.5 text-[10px] font-bold leading-none"
                      style={{
                        background: 'var(--color-sh-lime)',
                        color: 'var(--color-sh-ink)',
                        boxShadow: 'inset 0 0 0 1px var(--color-sh-ink)',
                      }}
                      title={`${pendingRequestCount} pending review`}
                    >
                      {pendingRequestCount}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Secondary tabs (state filter) — only on Published / Archive */}
          {(activeTab === 'published' || activeTab === 'archive') && (
            <div className="overflow-x-auto">
              <div className="sh-tab-bar">
                {([['all', 'All'], ['published', 'Active'], ['assigned', 'Assigned'], ['closed', 'Cancelled']] as const).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    data-active={stateFilter === key}
                    onClick={() => setStateFilter(key)}
                    className="sh-tab"
                  >
                    {label} <span className="opacity-70">({stateCounts[key]})</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Filters */}
          {(activeTab === 'published' || activeTab === 'archive') && (
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
                  className="sh-input sh-input-sm pl-8"
                />
              </div>
              <select
                value={groupBy}
                onChange={(e) => setGroupBy(e.target.value as GroupBy)}
                className="sh-input sh-input-sm"
                style={{ width: 'auto' }}
              >
                <option value="status">By status</option>
                <option value="date">By date</option>
              </select>
            </div>
          )}
        </div>
      )}

      {(activeTab === 'published' || activeTab === 'archive') && selectedCard ? (
        <AdminPublishedCardRecipientsView
          card={selectedCard}
          title={publishedCardTitle(selectedCard)}
          onBack={() => { setSelectedCardId(null); setShowPanel(false); }}
          onOpenPanel={() => setShowPanel(true)}
        />
      ) : activeTab === 'published' ? (
        <div className="flex-1 overflow-y-auto px-6 pb-8">
          {isLoading ? (
            <div className="sh-card py-16 text-center">
              <p className="text-sm text-[var(--color-sh-ink-faint)]">Loading…</p>
            </div>
          ) : filteredCards.length === 0 ? (
            <div className="sh-card py-16 text-center">
              <p className="text-sm text-[var(--color-sh-ink-subtle)]">No cards match your filters.</p>
            </div>
          ) : stateFilter !== 'all' ? (
            // Single-state view: flat list, no group headers.
            <div className="space-y-2">
              {filteredCards.map((card) => (
                <PublishedCardRow
                  key={card.id}
                  card={card}
                  onOpen={() => setSelectedCardId(card.id)}
                  showCancelledTag={card.state === 'closed'}
                />
              ))}
            </div>
          ) : (
            <div className="space-y-7">
              {groupBy === 'status' ? (
                <>
                  {groups.active.length > 0 && (
                    <CardGroup label="Active" color="#10B981" items={groups.active} onOpen={setSelectedCardId} showCancelledTag={false} />
                  )}
                  {groups.assigned.length > 0 && (
                    <CardGroup label="Assigned" color="#0EA5E9" items={groups.assigned} onOpen={setSelectedCardId} showCancelledTag={false} />
                  )}
                  {groups.cancelled.length > 0 && (
                    <CardGroup label="Cancelled" color="#6B7280" items={groups.cancelled} onOpen={setSelectedCardId} showCancelledTag={false} />
                  )}
                </>
              ) : (
                <>
                  {dateGroups.today.length > 0 && (
                    <CardGroup label="Today" color="#475569" items={dateGroups.today} onOpen={setSelectedCardId} showCancelledTag />
                  )}
                  {dateGroups.yesterday.length > 0 && (
                    <CardGroup label="Yesterday" color="#475569" items={dateGroups.yesterday} onOpen={setSelectedCardId} showCancelledTag />
                  )}
                  {dateGroups.thisWeek.length > 0 && (
                    <CardGroup label="Earlier this week" color="#475569" items={dateGroups.thisWeek} onOpen={setSelectedCardId} showCancelledTag />
                  )}
                  {dateGroups.earlier.length > 0 && (
                    <CardGroup label="Earlier" color="#475569" items={dateGroups.earlier} onOpen={setSelectedCardId} showCancelledTag />
                  )}
                </>
              )}
            </div>
          )}
        </div>
      ) : activeTab === 'archive' ? (
        <div className="flex-1 overflow-y-auto px-6 pb-8">
          {isLoading ? (
            <div className="sh-card py-16 text-center">
              <p className="text-sm text-[var(--color-sh-ink-faint)]">Loading…</p>
            </div>
          ) : filteredCards.length === 0 ? (
            <div className="sh-card py-16 text-center">
              <p className="text-sm text-[var(--color-sh-ink-subtle)]">No archived cards yet.</p>
            </div>
          ) : (
            <CardGroup label="Archived" color="#7C3AED" items={filteredCards} onOpen={setSelectedCardId} showCancelledTag={false} showArchivedTag />
          )}
        </div>
      ) : null}

      {activeTab === 'requests' && <AdminRequestsList />}
      {activeTab === 'custom' && <AdminCustomCardsList />}

      {selectedCard && showPanel && (
        <AdminPublishedCardRecipientsPanel
          card={selectedCard}
          title={publishedCardTitle(selectedCard)}
          onClose={() => setShowPanel(false)}
        />
      )}
    </div>
  );
}

function CardGroup({
  label, color, items, onOpen, showCancelledTag, showArchivedTag,
}: {
  label: string;
  color: string;
  items: PublishedCard[];
  onOpen: (id: string) => void;
  showCancelledTag: boolean;
  showArchivedTag?: boolean;
}) {
  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <span
          className="sh-status-pill"
          style={{ backgroundColor: `${color}1F`, color }}
        >
          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
          {label} · {items.length}
        </span>
      </div>
      <div className="space-y-2">
        {items.map((card) => (
          <PublishedCardRow
            key={card.id}
            card={card}
            onOpen={() => onOpen(card.id)}
            showCancelledTag={showCancelledTag && card.state === 'closed'}
            showArchivedTag={!!showArchivedTag && !!card.archived_at}
          />
        ))}
      </div>
    </div>
  );
}

function PublishedCardRow({ card, onOpen, showCancelledTag, showArchivedTag }: { card: PublishedCard; onOpen: () => void; showCancelledTag: boolean; showArchivedTag?: boolean }) {
  const business = card.submission?.business_name || card.customer_company || 'Unknown';
  const serviceType = card.service_type || '';
  const planName =
    card.submission_subscription?.subscription?.name
    || card.plan_name
    || (card.submission_subscription?.plan
        ? `${card.submission_subscription.plan.plan} · ${card.submission_subscription.plan.tier}`
        : '');
  const planPrice = card.submission_subscription?.plan?.pricing?.[0];
  const priceCurrency = planPrice?.country?.currency || '₹';
  const priceValue = planPrice?.price ?? card.proposed_price ?? null;
  const priceLabel = priceValue
    ? `${priceCurrency}${Number(priceValue).toLocaleString()}/mo`
    : '';
  const partners = card.recipient_counts?.partners ?? { pending: 0, accepted: 0, rejected: 0 };
  const talents = card.recipient_counts?.talents ?? { accepted: 0, rejected: 0 };
  const publisher = card.published_by_user;
  const publisherLabel = publisher
    ? publisher.display_name || publisher.email || publisher.id.slice(0, 8)
    : null;
  const deliveryState = squadhireDeliveryState(card);

  return (
    <button
      onClick={onOpen}
      className="sh-card sh-card-interactive flex w-full items-center justify-between px-5 py-4 text-left"
    >
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--color-sh-lime-soft)] text-[var(--color-sh-ink)] text-sm font-bold ring-1 ring-[var(--color-sh-warm-border)]">
          {business.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-[var(--color-sh-ink)]">
            {business}{serviceType ? `: ${serviceType}` : ''}
          </p>
          {(planName || priceLabel) && (
            <p className="mt-0.5 truncate text-xs text-[var(--color-sh-ink-muted)]">
              {planName}
              {planName && priceLabel ? ', ' : ''}
              {priceLabel}
            </p>
          )}
          {card.published_at && (
            <p className="mt-0.5 truncate text-[11px] text-[var(--color-sh-ink-faint)]">
              {formatPublishedAt(card.published_at)}
            </p>
          )}
          {publisherLabel && (
            <p className="truncate text-[11px] text-[var(--color-sh-ink-faint)]">
              by {publisherLabel}
            </p>
          )}
        </div>
      </div>
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
        {card.state === 'assigned' && (
          <span className="sh-status-pill" style={{ backgroundColor: '#E0F2FE', color: '#075985' }}>
            Assigned
          </span>
        )}
        {card.selected_recipient_type && card.state !== 'assigned' && (
          <span className="sh-status-pill" style={{ backgroundColor: '#DBEAFE', color: '#1E40AF' }}>
            Selected ({card.selected_recipient_type})
          </span>
        )}
        {(card.secondary_card_count ?? 0) > 0 && (
          <span className="sh-status-pill" style={{ backgroundColor: '#E0E7FF', color: '#3730A3' }}>
            {card.secondary_card_count} secondary
          </span>
        )}
        <CountChip label="Partners" accepted={partners.accepted} rejected={partners.rejected} pending={partners.pending} />
        <CountChip label="Talents" accepted={talents.accepted} rejected={talents.rejected} />
      </div>
    </button>
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
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-[var(--color-sh-cream)] border border-[var(--color-sh-warm-border)] px-2.5 py-0.5 text-[11px] font-medium"
      title={
        pending != null
          ? `${label}: ${accepted} accepted, ${rejected} rejected, ${pending} pending`
          : `${label}: ${accepted} accepted, ${rejected} rejected`
      }
    >
      <span className="text-[var(--color-sh-ink-subtle)]">{label}</span>
      <span className="text-emerald-700 font-semibold">{accepted}✓</span>
      <span className="text-red-600 font-semibold">{rejected}✗</span>
      {pending != null && <span className="text-amber-700 font-semibold">{pending}⌛</span>}
    </span>
  );
}
