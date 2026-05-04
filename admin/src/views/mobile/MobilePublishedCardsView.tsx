'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/services/api';
import type { PublishedCard } from '@/views/admin/AdminPublishedCards';
import MobileCardDetail from './MobileCardDetail';
import MobileRequestsList from './MobileRequestsList';
import MobileCustomCardsList from './MobileCustomCardsList';
import MobileFilterSheet from './MobileFilterSheet';

type Tab = 'published' | 'requests' | 'custom';
type StateFilter = 'all' | 'published' | 'closed';
type GroupBy = 'status' | 'date';

const TABS: { key: Tab; label: string }[] = [
  { key: 'published', label: 'Published' },
  { key: 'requests', label: 'Requests' },
  { key: 'custom', label: 'Custom' },
];

const STATE_FILTERS: { key: StateFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'published', label: 'Active' },
  { key: 'closed', label: 'Cancelled' },
];

type SalesPerson = { id: string; display_name: string | null; email: string | null };

function formatPublishedAt(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  const time = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const days = Math.floor((Date.now() - date.getTime()) / 86400000);
  if (days < 1) return `today ${time}`;
  if (days === 1) return `yesterday`;
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function bucketByDate(cards: PublishedCard[]): { today: PublishedCard[]; yesterday: PublishedCard[]; thisWeek: PublishedCard[]; earlier: PublishedCard[] } {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 86400000;
  const startOfWeek = startOfToday - 6 * 86400000;
  const today: PublishedCard[] = [];
  const yesterday: PublishedCard[] = [];
  const thisWeek: PublishedCard[] = [];
  const earlier: PublishedCard[] = [];
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

export default function MobilePublishedCardsView() {
  const [activeTab, setActiveTab] = useState<Tab>('published');
  const [stateFilter, setStateFilter] = useState<StateFilter>('all');
  const [publishedBy, setPublishedBy] = useState<string>('');
  const [search, setSearch] = useState('');
  const [groupBy, setGroupBy] = useState<GroupBy>('status');
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);

  const { data: cardsRes, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['admin-published-cards', stateFilter, publishedBy, search],
    queryFn: () => {
      const params: Record<string, string> = {};
      if (stateFilter !== 'all') params.state = stateFilter;
      if (publishedBy) params.published_by = publishedBy;
      if (search.trim()) params.search = search.trim();
      return api.get('/admin/subscription-cards', { params }).then((r) => r.data);
    },
    enabled: activeTab === 'published',
  });

  const { data: peopleRes } = useQuery({
    queryKey: ['admin-sales-people'],
    queryFn: () => api.get('/admin/onboarding-links/sales-people').then((r) => r.data),
  });
  const salesPeople: SalesPerson[] = peopleRes?.data || [];

  const cards: PublishedCard[] = cardsRes?.data || [];
  const selectedCard = cards.find((c) => c.id === selectedCardId) || null;

  const groups = useMemo(() => ({
    active: cards.filter((c) => c.state === 'published'),
    cancelled: cards.filter((c) => c.state === 'closed'),
  }), [cards]);

  const dateGroups = useMemo(() => bucketByDate(cards), [cards]);

  const activeFilterCount = (publishedBy ? 1 : 0) + (groupBy === 'date' ? 1 : 0);

  return (
    <div className="flex flex-col">
      {/* Tabs */}
      <div className="flex gap-1.5 border-b-2 border-black bg-white px-4 py-3">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`flex-1 rounded-lg border-2 px-3 py-2 text-xs font-bold transition-all active:scale-[0.97] ${
              activeTab === t.key
                ? 'border-black bg-[#0a0a0a] text-white shadow-[2px_2px_0_0_#d4ff4d]'
                : 'border-black/20 bg-white text-[#525252]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'requests' && <MobileRequestsList />}
      {activeTab === 'custom' && <MobileCustomCardsList />}

      {activeTab === 'published' && (
        <div className="pb-6">
          {/* Stats bar */}
          <div className="flex items-center justify-between gap-2 px-4 pt-4 pb-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border-2 border-black bg-[#d4ff4d] px-3 py-1 text-xs font-bold text-black shadow-[2px_2px_0_0_#000]">
              {cards.length} card{cards.length !== 1 ? 's' : ''}
            </span>
            <button
              onClick={() => setFilterSheetOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-xl border-2 border-black bg-white px-3 py-1.5 text-xs font-bold text-[#0a0a0a] shadow-[2px_2px_0_0_#000] active:scale-[0.97] transition-transform"
            >
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
              </svg>
              Filters
              {activeFilterCount > 0 && (
                <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-[#d4ff4d] text-[10px] font-bold text-black">
                  {activeFilterCount}
                </span>
              )}
            </button>
          </div>

          {/* State filter chips */}
          <div className="flex gap-2 overflow-x-auto px-4 pb-2 scrollbar-none">
            {STATE_FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setStateFilter(f.key)}
                className={`shrink-0 rounded-xl border-2 px-4 py-2 text-sm font-bold transition-all active:scale-[0.97] ${
                  stateFilter === f.key
                    ? 'border-black bg-[#0a0a0a] text-white shadow-[2px_2px_0_0_#d4ff4d]'
                    : 'border-black bg-white text-[#0a0a0a]'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="px-4 pb-3 pt-1">
            <div className="relative">
              <svg
                className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#a3a3a3]"
                fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search business name..."
                className="w-full rounded-xl border-2 border-black bg-white py-3 pl-10 pr-4 text-sm text-[#0a0a0a] placeholder-[#a3a3a3] outline-none transition-shadow focus:shadow-[3px_3px_0_0_#000]"
              />
            </div>
          </div>

          {/* Refresh */}
          <div className="px-4 pb-3">
            <button
              onClick={() => refetch()}
              disabled={isRefetching}
              className="w-full rounded-xl border-2 border-dashed border-[#a3a3a3] bg-white/60 py-2 text-xs font-semibold text-[#525252] active:scale-[0.98] transition-transform disabled:opacity-50"
            >
              {isRefetching ? 'Refreshing...' : 'Tap to refresh'}
            </button>
          </div>

          {/* Card list */}
          <div className="px-4">
            {isLoading ? (
              <div className="space-y-3">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="animate-pulse rounded-2xl border-2 border-black bg-white p-4 shadow-[3px_3px_0_0_#000]"
                  >
                    <div className="h-4 w-2/3 rounded-lg bg-[#e5e5e5]" />
                    <div className="mt-2 h-3 w-1/2 rounded-lg bg-[#e5e5e5]" />
                  </div>
                ))}
              </div>
            ) : cards.length === 0 ? (
              <div className="rounded-2xl border-2 border-black bg-white px-6 py-12 text-center shadow-[3px_3px_0_0_#000]">
                <p className="font-[family-name:var(--font-jakarta)] text-base font-bold text-[#0a0a0a]">
                  No cards found
                </p>
                <p className="mt-1 text-sm text-[#525252]">Try adjusting your filters.</p>
              </div>
            ) : groupBy === 'status' ? (
              <div className="space-y-5">
                {groups.active.length > 0 && (
                  <CardGroup label="Active" color="#10B981" items={groups.active} onOpen={setSelectedCardId} />
                )}
                {groups.cancelled.length > 0 && (
                  <CardGroup label="Cancelled" color="#6B7280" items={groups.cancelled} onOpen={setSelectedCardId} />
                )}
              </div>
            ) : (
              <div className="space-y-5">
                {dateGroups.today.length > 0 && (
                  <CardGroup label="Today" color="#525252" items={dateGroups.today} onOpen={setSelectedCardId} />
                )}
                {dateGroups.yesterday.length > 0 && (
                  <CardGroup label="Yesterday" color="#525252" items={dateGroups.yesterday} onOpen={setSelectedCardId} />
                )}
                {dateGroups.thisWeek.length > 0 && (
                  <CardGroup label="Earlier this week" color="#525252" items={dateGroups.thisWeek} onOpen={setSelectedCardId} />
                )}
                {dateGroups.earlier.length > 0 && (
                  <CardGroup label="Earlier" color="#525252" items={dateGroups.earlier} onOpen={setSelectedCardId} />
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Detail overlay */}
      {selectedCard && (
        <MobileCardDetail
          card={selectedCard}
          onClose={() => setSelectedCardId(null)}
        />
      )}

      {/* Filter sheet */}
      <MobileFilterSheet
        open={filterSheetOpen}
        onClose={() => setFilterSheetOpen(false)}
        salesPeople={salesPeople}
        publishedBy={publishedBy}
        onPublishedByChange={setPublishedBy}
        groupBy={groupBy}
        onGroupByChange={setGroupBy}
      />
    </div>
  );
}

function CardGroup({
  label,
  color,
  items,
  onOpen,
}: {
  label: string;
  color: string;
  items: PublishedCard[];
  onOpen: (id: string) => void;
}) {
  return (
    <div>
      <div className="mb-2.5 flex items-center gap-2">
        <span
          className="inline-flex items-center gap-1.5 rounded-full border-2 border-black px-3 py-0.5 text-xs font-bold shadow-[2px_2px_0_0_#000]"
          style={{ backgroundColor: `${color}18`, color }}
        >
          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
          {label}
        </span>
        <span className="text-xs font-bold text-[#a3a3a3]">({items.length})</span>
      </div>
      <div className="space-y-3">
        {items.map((card, idx) => (
          <CardItem key={card.id} card={card} index={idx} onOpen={() => onOpen(card.id)} />
        ))}
      </div>
    </div>
  );
}

function CardItem({ card, index, onOpen }: { card: PublishedCard; index: number; onOpen: () => void }) {
  const isActive = card.state === 'published';
  const isRecalled = !!card.recalled_at;
  const partners = card.recipient_counts?.partners ?? { pending: 0, accepted: 0, rejected: 0 };
  const talents = card.recipient_counts?.talents ?? { accepted: 0, rejected: 0 };
  const publisher = card.published_by_user;
  const business = card.submission?.business_name || card.customer_company || 'Unknown business';
  const subName = card.submission_subscription?.subscription?.name || card.plan_name;
  const plan = card.submission_subscription?.plan;
  const planLabel = plan ? `${plan.plan} · ${plan.tier}` : '';
  const subtitle = [subName, planLabel].filter(Boolean).join(' — ');

  return (
    <button
      onClick={onOpen}
      className="w-full rounded-2xl border-2 border-black bg-white text-left shadow-[3px_3px_0_0_#000] transition-transform active:scale-[0.98] active:shadow-[1px_1px_0_0_#000]"
      style={{ animation: `fadeSlideUp 0.3s ease-out ${index * 0.05}s both` }}
    >
      <div
        className="h-1.5 rounded-t-[14px]"
        style={{ backgroundColor: isActive ? '#10B981' : isRecalled ? '#F76808' : '#6B7280' }}
      />

      <div className="px-4 pb-3.5 pt-2.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="truncate font-[family-name:var(--font-jakarta)] text-[15px] font-bold text-[#0a0a0a]">
              {business}
            </p>
            {subtitle && (
              <p className="mt-0.5 truncate text-xs text-[#525252]">{subtitle}</p>
            )}
          </div>
          <svg className="mt-1 h-4 w-4 shrink-0 text-[#a3a3a3]" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {card.published_at && (
            <span className="text-[11px] text-[#a3a3a3]">{formatPublishedAt(card.published_at)}</span>
          )}
          {publisher && (
            <span className="text-[11px] text-[#a3a3a3]">
              &middot; {publisher.display_name || publisher.email || 'admin'}
            </span>
          )}
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <span
            className="inline-flex items-center gap-1 rounded-full border border-black/20 px-2 py-0.5 text-[10px] font-bold"
            style={{
              backgroundColor: isActive ? '#10B98118' : '#6B728018',
              color: isActive ? '#10B981' : '#6B7280',
            }}
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: isActive ? '#10B981' : '#6B7280' }}
            />
            {isActive ? 'Active' : 'Cancelled'}
          </span>
          {isRecalled && (
            <span className="rounded-full border border-black/20 bg-orange-100 px-2 py-0.5 text-[10px] font-bold text-orange-800">
              Recalled
            </span>
          )}
          {card.selected_recipient_type && (
            <span className="rounded-full border border-black/20 bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-800">
              Selected
            </span>
          )}
          {(card.secondary_card_count ?? 0) > 0 && (
            <span className="rounded-full border border-black/20 bg-indigo-100 px-2 py-0.5 text-[10px] font-bold text-indigo-800">
              {card.secondary_card_count} sec
            </span>
          )}
          <span className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-black/20 bg-[#F7F6F3] px-2 py-0.5 text-[10px] font-bold">
            <span className="text-[#a3a3a3]">P</span>
            <span className="text-emerald-700">{partners.accepted}</span>
            <span className="text-red-600">{partners.rejected}</span>
            <span className="text-amber-600">{partners.pending}</span>
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-black/20 bg-[#F7F6F3] px-2 py-0.5 text-[10px] font-bold">
            <span className="text-[#a3a3a3]">T</span>
            <span className="text-emerald-700">{talents.accepted}</span>
            <span className="text-red-600">{talents.rejected}</span>
          </span>
        </div>
      </div>
    </button>
  );
}
