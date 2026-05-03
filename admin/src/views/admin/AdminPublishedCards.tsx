'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/services/api';
import AdminPublishedCardRecipientsPanel from './AdminPublishedCardRecipientsPanel';
import AdminRequestsList from './AdminRequestsList';
import AdminCustomCardsList from './AdminCustomCardsList';

export type PublishedCard = {
  id: string;
  state: 'published' | 'closed';
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
  partner_price_override: number | null;
  squadhire_category_ids?: string[] | null;
  selected_recipient_type?: 'partner' | 'talent' | null;
  selected_recipient_id?: string | null;
  parent_card_id?: string | null;
  secondary_card_count?: number;
  recalled_at?: string | null;
  squadhire_synced_at?: string | null;
  squadhire_sync_attempts?: number | null;
  squadhire_sync_last_error?: string | null;
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
function squadhireDeliveryState(card: PublishedCard): 'skipped' | 'pending' | 'delivered' {
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

function bucketByDate<T extends { state: 'published' | 'closed'; published_at: string | null }>(
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
  const business = card.submission?.business_name || 'Unknown business';
  const subName = card.submission_subscription?.subscription?.name;
  return subName ? `${business} · ${subName}` : business;
}

type Tab = 'published' | 'requests' | 'custom';

export default function AdminPublishedCards() {
  const [activeTab, setActiveTab] = useState<Tab>('published');
  const [stateFilter, setStateFilter] = useState<'all' | 'published' | 'closed'>('all');
  const [publishedBy, setPublishedBy] = useState<string>('');
  const [search, setSearch] = useState<string>('');
  const [groupBy, setGroupBy] = useState<GroupBy>('status');
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);

  const { data: cardsRes, isLoading } = useQuery({
    queryKey: ['admin-published-cards', stateFilter, publishedBy, search],
    queryFn: () => {
      const params: Record<string, string> = {};
      if (stateFilter !== 'all') params.state = stateFilter;
      if (publishedBy) params.published_by = publishedBy;
      if (search.trim()) params.search = search.trim();
      return api.get('/admin/subscription-cards', { params }).then((r) => r.data);
    },
  });
  const cards: PublishedCard[] = cardsRes?.data || [];

  // Reuse the sales-people endpoint to populate the "Published by" dropdown.
  const { data: peopleRes } = useQuery({
    queryKey: ['admin-sales-people'],
    queryFn: () => api.get('/admin/onboarding-links/sales-people').then((r) => r.data),
  });
  const salesPeople: SalesPerson[] = peopleRes?.data || [];

  const groups = useMemo(() => ({
    active: cards.filter((c) => c.state === 'published'),
    cancelled: cards.filter((c) => c.state === 'closed'),
  }), [cards]);

  const dateGroups = useMemo(() => bucketByDate(cards), [cards]);

  const selectedCard = useMemo(
    () => cards.find((c) => c.id === selectedCardId) || null,
    [cards, selectedCardId],
  );

  if (activeTab === 'requests') return <AdminRequestsList />;
  if (activeTab === 'custom') return <AdminCustomCardsList />;

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[#E2E8F0] bg-white px-6 pt-5 pb-4">
        <div className="mb-4">
          <h1 className="text-xl font-semibold text-[#0F172B]">Published Cards</h1>
          <p className="mt-0.5 text-sm text-[#62748E]">All subscription cards published across the org.</p>
        </div>
        <div className="mb-4 flex gap-1 rounded-lg bg-slate-100 p-1">
          {([['published', 'Published'], ['requests', 'From Requests'], ['custom', 'Custom']] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${
                activeTab === key
                  ? 'bg-white text-[#0F172B] shadow-sm'
                  : 'text-[#62748E] hover:text-[#0F172B]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={stateFilter}
            onChange={(e) => setStateFilter(e.target.value as 'all' | 'published' | 'closed')}
            className="rounded-md border border-[#E2E8F0] bg-white px-3 py-2 text-sm text-[#0F172B] focus:outline-none focus:ring-2 focus:ring-[#0F172B]/10"
          >
            <option value="all">All states</option>
            <option value="published">Active</option>
            <option value="closed">Cancelled</option>
          </select>
          <select
            value={publishedBy}
            onChange={(e) => setPublishedBy(e.target.value)}
            className="rounded-md border border-[#E2E8F0] bg-white px-3 py-2 text-sm text-[#0F172B] focus:outline-none focus:ring-2 focus:ring-[#0F172B]/10"
          >
            <option value="">All sales people</option>
            {salesPeople.map((p) => (
              <option key={p.id} value={p.id}>{p.display_name || p.email || p.id.slice(0, 8)}</option>
            ))}
          </select>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search business name…"
            className="flex-1 min-w-[200px] rounded-md border border-[#E2E8F0] bg-white px-3 py-2 text-sm text-[#0F172B] placeholder:text-[#90A1B9] focus:outline-none focus:ring-2 focus:ring-[#0F172B]/10"
          />
          <select
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value as GroupBy)}
            className="rounded-md border border-[#E2E8F0] bg-white px-3 py-2 text-sm text-[#0F172B] focus:outline-none focus:ring-2 focus:ring-[#0F172B]/10"
          >
            <option value="status">Group by status</option>
            <option value="date">Group by date</option>
          </select>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        {isLoading ? (
          <p className="py-8 text-center text-sm text-[#90A1B9]">Loading…</p>
        ) : cards.length === 0 ? (
          <div className="rounded-lg border border-[#E2E8F0] bg-white py-12 text-center">
            <p className="text-sm text-[#90A1B9]">No published cards match your filters.</p>
          </div>
        ) : (
          <div className="space-y-6">
            {groupBy === 'status' ? (
              <>
                {groups.active.length > 0 && (
                  <CardGroup label="Active" color="#10B981" items={groups.active} onOpen={setSelectedCardId} showCancelledTag={false} />
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

      {selectedCard && (
        <AdminPublishedCardRecipientsPanel
          card={selectedCard}
          title={publishedCardTitle(selectedCard)}
          onClose={() => setSelectedCardId(null)}
        />
      )}
    </div>
  );
}

function CardGroup({
  label, color, items, onOpen, showCancelledTag,
}: {
  label: string;
  color: string;
  items: PublishedCard[];
  onOpen: (id: string) => void;
  showCancelledTag: boolean;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
          style={{ backgroundColor: `${color}18`, color }}
        >
          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
          {label}
        </span>
        <span className="text-xs text-[#90A1B9]">({items.length})</span>
      </div>
      <div className="space-y-1.5">
        {items.map((card) => (
          <PublishedCardRow
            key={card.id}
            card={card}
            onOpen={() => onOpen(card.id)}
            showCancelledTag={showCancelledTag && card.state === 'closed'}
          />
        ))}
      </div>
    </div>
  );
}

function PublishedCardRow({ card, onOpen, showCancelledTag }: { card: PublishedCard; onOpen: () => void; showCancelledTag: boolean }) {
  const business = card.submission?.business_name || 'Unknown';
  const subName = card.submission_subscription?.subscription?.name || '—';
  const plan = card.submission_subscription?.plan;
  const planLabel = plan ? `${plan.plan} · ${plan.tier}` : '';
  const partners = card.recipient_counts?.partners ?? { pending: 0, accepted: 0, rejected: 0 };
  const talents = card.recipient_counts?.talents ?? { accepted: 0, rejected: 0 };
  const publisher = card.published_by_user;
  const deliveryState = squadhireDeliveryState(card);

  return (
    <button
      onClick={onOpen}
      className="flex w-full items-center justify-between rounded-lg border border-[#E2E8F0] bg-white px-4 py-3 text-left transition hover:shadow-sm"
    >
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-violet-50 text-violet-600 text-sm font-semibold">
          {business.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-[#0F172B]">
            {business} · {subName}
          </p>
          <p className="mt-0.5 truncate text-xs text-[#62748E]">
            {planLabel}
            {planLabel && card.published_at ? ' · ' : ''}
            {card.published_at ? `Published ${formatPublishedAt(card.published_at)}` : ''}
          </p>
          {publisher && (
            <p className="mt-0.5 truncate text-[11px] text-[#90A1B9]">
              by {publisher.display_name || publisher.email || publisher.id.slice(0, 8)}
            </p>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {showCancelledTag && !card.recalled_at && (
          <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-medium text-slate-600">
            Cancelled
          </span>
        )}
        {card.recalled_at && (
          <span
            className="rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-medium text-orange-800"
            title="Card was recalled after acceptances. Acceptees keep seeing it with a Recalled tag."
          >
            Recalled
          </span>
        )}
        {deliveryState === 'skipped' && (
          <span
            className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800"
            title="No SquadHire categories were selected, so this card was never delivered to SquadHire. Talents will not see it. Recall, edit categories, then re-publish to deliver."
          >
            Not on SquadHire
          </span>
        )}
        {deliveryState === 'pending' && (
          <span
            className="rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-medium text-orange-800"
            title={
              card.squadhire_sync_last_error
                ? `SquadHire delivery failed: ${card.squadhire_sync_last_error} (${card.squadhire_sync_attempts ?? 0} attempts). Retry sweeper runs every 5 min.`
                : `SquadHire delivery in progress (${card.squadhire_sync_attempts ?? 0} attempts so far). Retry sweeper runs every 5 min.`
            }
          >
            SquadHire pending
          </span>
        )}
        {card.selected_recipient_type && (
          <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-800">
            Selected ({card.selected_recipient_type})
          </span>
        )}
        {(card.secondary_card_count ?? 0) > 0 && (
          <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-medium text-indigo-800">
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
      className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-700"
      title={
        pending != null
          ? `${label}: ${accepted} accepted, ${rejected} rejected, ${pending} pending`
          : `${label}: ${accepted} accepted, ${rejected} rejected`
      }
    >
      <span className="text-[#90A1B9]">{label}</span>
      <span className="text-emerald-700">{accepted}✓</span>
      <span className="text-red-600">{rejected}✗</span>
      {pending != null && <span className="text-amber-700">{pending}⌛</span>}
    </span>
  );
}
