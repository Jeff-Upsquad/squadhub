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

const STATE_COLORS: Record<string, { bg: string; fg: string }> = {
  draft: { bg: '#FEF3C7', fg: '#92400E' },
  published: { bg: '#D1FAE5', fg: '#065F46' },
  closed: { bg: '#F3F4F6', fg: '#525252' },
};

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
    <div className="flex flex-col pb-6">
      <div className="px-4 pt-3 pb-3">
        <button
          onClick={() => createMutation.mutate()}
          disabled={createMutation.isPending}
          className="w-full rounded-xl border-2 border-black bg-[#d4ff4d] px-4 py-3 text-sm font-bold text-black shadow-[3px_3px_0_0_#000] transition-transform active:scale-[0.97] active:shadow-[1px_1px_0_0_#000] disabled:opacity-50"
        >
          {createMutation.isPending ? 'Creating...' : '+ New Custom Card'}
        </button>
      </div>

      <div className="space-y-3 px-4">
        {isLoading ? (
          <div className="animate-pulse rounded-2xl border-2 border-black bg-white p-4 shadow-[3px_3px_0_0_#000]">
            <div className="h-4 w-2/3 rounded-lg bg-[#e5e5e5]" />
            <div className="mt-2 h-3 w-1/2 rounded-lg bg-[#e5e5e5]" />
          </div>
        ) : allCards.length === 0 ? (
          <div className="rounded-2xl border-2 border-black bg-white px-6 py-12 text-center shadow-[3px_3px_0_0_#000]">
            <p className="font-[family-name:var(--font-jakarta)] text-base font-bold text-[#0a0a0a]">
              No custom cards yet
            </p>
            <p className="mt-1 text-sm text-[#525252]">Tap "New Custom Card" to create one.</p>
          </div>
        ) : (
          allCards.map((card, idx) => {
            const colors = STATE_COLORS[card.state] || STATE_COLORS.closed;
            const totalPrice = (card.proposed_price || 0) + (card.markup || 0);
            return (
              <button
                key={card.id}
                onClick={() => setEditingCardId(card.id)}
                className="w-full rounded-2xl border-2 border-black bg-white p-4 text-left shadow-[3px_3px_0_0_#000] transition-transform active:scale-[0.98] active:shadow-[1px_1px_0_0_#000]"
                style={{ animation: `fadeSlideUp 0.3s ease-out ${idx * 0.05}s both` }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-[family-name:var(--font-jakarta)] text-[15px] font-bold text-[#0a0a0a]">
                      {card.customer_company || 'Untitled'}
                      {card.service_type ? ` · ${card.service_type}` : ''}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-[#525252]">
                      {card.plan_name || 'No plan'}
                      {totalPrice ? ` · ₹${totalPrice.toLocaleString()}/mo` : ''}
                    </p>
                  </div>
                  <span
                    className="shrink-0 rounded-full border border-black/20 px-2 py-0.5 text-[10px] font-bold"
                    style={{ backgroundColor: colors.bg, color: colors.fg }}
                  >
                    {card.state}
                  </span>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
