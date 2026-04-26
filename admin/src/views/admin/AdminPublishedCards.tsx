'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/services/api';
import AdminPublishedCardRecipientsPanel from './AdminPublishedCardRecipientsPanel';

type PublishedCard = {
  id: string;
  state: 'published' | 'closed';
  published_at: string | null;
  submission?: { id: string; business_name: string } | null;
  submission_subscription?: {
    subscription?: { id: string; name: string } | null;
    plan?: { id: string; plan: string; tier: string } | null;
  } | null;
  recipient_counts?: {
    partners: { pending: number; accepted: number; rejected: number };
    talents: { accepted: number; rejected: number };
  };
  published_by_user?: { id: string; display_name: string | null; email: string | null } | null;
};

type SalesPerson = { id: string; display_name: string | null; email: string | null };

function formatPublishedAt(iso: string | null): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  const days = Math.floor((Date.now() - then) / 86400000);
  if (days < 1) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function publishedCardTitle(card: PublishedCard): string {
  const business = card.submission?.business_name || 'Unknown business';
  const subName = card.submission_subscription?.subscription?.name;
  return subName ? `${business} · ${subName}` : business;
}

export default function AdminPublishedCards() {
  const [stateFilter, setStateFilter] = useState<'all' | 'published' | 'closed'>('all');
  const [publishedBy, setPublishedBy] = useState<string>('');
  const [search, setSearch] = useState<string>('');
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

  const selectedCard = useMemo(
    () => cards.find((c) => c.id === selectedCardId) || null,
    [cards, selectedCardId],
  );

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[#E2E8F0] bg-white px-6 pt-5 pb-4">
        <div className="mb-4">
          <h1 className="text-xl font-semibold text-[#0F172B]">Published Cards</h1>
          <p className="mt-0.5 text-sm text-[#62748E]">All subscription cards published across the org.</p>
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
            {groups.active.length > 0 && (
              <CardGroup label="Active" color="#10B981" items={groups.active} onOpen={setSelectedCardId} />
            )}
            {groups.cancelled.length > 0 && (
              <CardGroup label="Cancelled" color="#6B7280" items={groups.cancelled} onOpen={setSelectedCardId} />
            )}
          </div>
        )}
      </div>

      {selectedCard && (
        <AdminPublishedCardRecipientsPanel
          cardId={selectedCard.id}
          title={publishedCardTitle(selectedCard)}
          onClose={() => setSelectedCardId(null)}
        />
      )}
    </div>
  );
}

function CardGroup({
  label, color, items, onOpen,
}: {
  label: string;
  color: string;
  items: PublishedCard[];
  onOpen: (id: string) => void;
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
          <PublishedCardRow key={card.id} card={card} onOpen={() => onOpen(card.id)} />
        ))}
      </div>
    </div>
  );
}

function PublishedCardRow({ card, onOpen }: { card: PublishedCard; onOpen: () => void }) {
  const business = card.submission?.business_name || 'Unknown';
  const subName = card.submission_subscription?.subscription?.name || '—';
  const plan = card.submission_subscription?.plan;
  const planLabel = plan ? `${plan.plan} · ${plan.tier}` : '';
  const partners = card.recipient_counts?.partners ?? { pending: 0, accepted: 0, rejected: 0 };
  const talents = card.recipient_counts?.talents ?? { accepted: 0, rejected: 0 };
  const publisher = card.published_by_user;

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
