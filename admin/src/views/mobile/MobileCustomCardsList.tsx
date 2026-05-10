'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import AdminCardEditor from '@/views/admin/AdminCardEditor';

interface CustomCard {
  id: string;
  state: string;
  customer_company: string | null;
  service_type: string | null;
  plan_name: string | null;
  proposed_price: number | null;
  markup: number;
  published_at: string | null;
  created_at: string;
}

export default function MobileCustomCardsList() {
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: res, isLoading } = useQuery({
    queryKey: ['admin-custom-cards'],
    queryFn: () =>
      api.get('/admin/subscription-cards', { params: { source: 'custom' } }).then((r) => r.data),
  });

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
      <div className="fixed inset-0 z-50 bg-white overflow-auto">
        <AdminCardEditor
          cardId={editingCardId}
          onClose={() => {
            setEditingCardId(null);
            queryClient.invalidateQueries({ queryKey: ['admin-custom-cards'] });
            queryClient.invalidateQueries({ queryKey: ['admin-custom-cards-drafts'] });
            queryClient.invalidateQueries({ queryKey: ['admin-published-cards'] });
          }}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      {/* Action strip */}
      <div className="px-4 pb-3">
        <div className="sh-card flex items-center justify-between gap-3 p-3">
          <p className="text-xs text-[var(--color-sh-ink-muted)] pl-1">
            Cards created from scratch by admins.
          </p>
          <button
            onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending}
            className="sh-btn-primary sh-btn-primary-sm shrink-0"
          >
            {createMutation.isPending ? 'Creating…' : 'New Card'}
          </button>
        </div>
      </div>

      <div className="flex-1 px-4 pb-8">
        {isLoading ? (
          <div className="sh-card py-10 text-center">
            <p className="text-sm text-[var(--color-sh-ink-faint)]">Loading…</p>
          </div>
        ) : allCards.length === 0 ? (
          <div className="sh-card py-10 text-center">
            <p className="text-sm text-[var(--color-sh-ink-subtle)]">No custom cards yet.</p>
            <p className="mt-1 text-xs text-[var(--color-sh-ink-faint)]">Tap "New Card" to create one.</p>
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
  const company = card.customer_company || 'Untitled';
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
      className="sh-card sh-card-interactive flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left"
    >
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--color-sh-lime-soft)] text-[var(--color-sh-ink)] text-sm font-bold ring-1 ring-[var(--color-sh-warm-border)]">
          {company.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-[var(--color-sh-ink)]">
            {company}{serviceType ? `: ${serviceType}` : ''}
          </p>
          {(planName || priceLabel) && (
            <p className="mt-0.5 truncate text-xs text-[var(--color-sh-ink-muted)]">
              {planName || 'No plan'}
              {priceLabel ? `, ${priceLabel}` : ''}
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
