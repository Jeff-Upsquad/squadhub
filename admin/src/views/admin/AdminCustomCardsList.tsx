'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import AdminCardEditor from './AdminCardEditor';

interface CustomCard {
  id: string;
  state: string;
  brand_name: string | null;
  service_type: string | null;
  plan_name: string | null;
  proposed_price: number | null;
  markup: number;
  published_at: string | null;
  created_at: string;
}

export default function AdminCustomCardsList() {
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: res, isLoading } = useQuery({
    queryKey: ['admin-custom-cards'],
    queryFn: () =>
      api.get('/admin/subscription-cards', { params: { source: 'custom' } }).then((r) => r.data),
  });

  // Also fetch drafts (the main endpoint defaults to published+closed)
  const { data: draftsRes } = useQuery({
    queryKey: ['admin-custom-cards-drafts'],
    queryFn: () =>
      api.get('/admin/subscription-cards', { params: { source: 'custom', state: 'draft' } }).then((r) => r.data),
  });

  const publishedCards: CustomCard[] = res?.data || [];
  const draftCards: CustomCard[] = draftsRes?.data || [];
  const allCards = [...draftCards, ...publishedCards];

  const createMutation = useMutation({
    mutationFn: () =>
      api.post('/admin/subscription-cards/custom', {}).then((r) => r.data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['admin-custom-cards'] });
      if (data?.data?.id) setEditingCardId(data.data.id);
    },
  });

  if (editingCardId) {
    return (
      <AdminCardEditor
        cardId={editingCardId}
        onClose={() => {
          setEditingCardId(null);
          queryClient.invalidateQueries({ queryKey: ['admin-custom-cards'] });
          queryClient.invalidateQueries({ queryKey: ['admin-custom-cards-drafts'] });
          queryClient.invalidateQueries({ queryKey: ['admin-subscription-cards'] });
        }}
      />
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      {/* Action strip */}
      <div className="px-6 pb-4">
        <div className="sh-card flex items-center justify-between p-3">
          <p className="text-xs text-[var(--color-sh-ink-muted)] pl-1">
            Cards created from scratch by admins (no request, no submission).
          </p>
          <button
            onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending}
            className="sh-btn-primary sh-btn-primary-sm"
          >
            {createMutation.isPending ? 'Creating…' : 'New Custom Card'}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 pb-8">
        {isLoading ? (
          <div className="sh-card py-16 text-center">
            <p className="text-sm text-[var(--color-sh-ink-faint)]">Loading…</p>
          </div>
        ) : allCards.length === 0 ? (
          <div className="sh-card py-16 text-center">
            <p className="text-sm text-[var(--color-sh-ink-subtle)]">No custom cards yet.</p>
            <p className="mt-1 text-xs text-[var(--color-sh-ink-faint)]">Click "New Custom Card" to create one.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {allCards.map((card) => (
              <CustomCardRow
                key={card.id}
                card={card}
                onOpen={() => setEditingCardId(card.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CustomCardRow({ card, onOpen }: { card: CustomCard; onOpen: () => void }) {
  const company = card.brand_name || 'Untitled';
  const serviceType = card.service_type || '';
  const planName = card.plan_name || '';
  const totalPrice = card.proposed_price
    ? (card.proposed_price + (card.markup || 0))
    : null;
  const priceLabel = totalPrice ? `₹${totalPrice.toLocaleString()}/mo` : '';
  const dateIso = card.published_at || card.created_at;
  const dateObj = new Date(dateIso);
  const dateLabel = `${card.published_at ? 'Published' : 'Created'} ${dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} at ${dateObj.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;

  return (
    <button
      onClick={onOpen}
      className="sh-card sh-card-interactive flex w-full items-center justify-between px-5 py-4 text-left"
    >
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--color-sh-lime-soft)] text-[var(--color-sh-ink)] text-sm font-bold ring-1 ring-[var(--color-sh-warm-border)]">
          {company.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-[var(--color-sh-ink)]">
            {company}{serviceType ? `: ${serviceType}` : ''}
          </p>
          {(planName || priceLabel) && (
            <p className="mt-0.5 truncate text-xs text-[var(--color-sh-ink-muted)]">
              {planName || 'No plan'}
              {(planName || true) && priceLabel ? ', ' : ''}
              {priceLabel}
            </p>
          )}
          <p className="mt-0.5 truncate text-[11px] text-[var(--color-sh-ink-faint)]">
            {dateLabel}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {card.state === 'draft' ? (
          <span className="sh-status-pill" style={{ backgroundColor: '#FEF3C7', color: '#92400E' }}>
            draft
          </span>
        ) : card.state === 'published' ? (
          <span className="sh-status-pill" style={{ backgroundColor: '#D1FAE5', color: '#065F46' }}>
            published
          </span>
        ) : (
          <span className="sh-status-pill" style={{ backgroundColor: '#EEF2F6', color: '#475569' }}>
            {card.state}
          </span>
        )}
      </div>
    </button>
  );
}
