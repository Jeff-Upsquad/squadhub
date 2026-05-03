'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import AdminCardEditor from './AdminCardEditor';

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
          queryClient.invalidateQueries({ queryKey: ['admin-published-cards'] });
        }}
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[#E2E8F0] bg-white px-6 pt-5 pb-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-[#0F172B]">Custom Cards</h1>
            <p className="mt-0.5 text-sm text-[#62748E]">
              Cards created from scratch by admins (not from a request or submission).
            </p>
          </div>
          <button
            onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending}
            className="rounded-md bg-[#0F172B] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#1E293B] disabled:opacity-50"
          >
            {createMutation.isPending ? 'Creating…' : 'New Custom Card'}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        {isLoading ? (
          <p className="py-8 text-center text-sm text-[#90A1B9]">Loading…</p>
        ) : allCards.length === 0 ? (
          <div className="rounded-lg border border-[#E2E8F0] bg-white py-12 text-center">
            <p className="text-sm text-[#90A1B9]">No custom cards yet.</p>
            <p className="mt-1 text-xs text-[#90A1B9]">Click "New Custom Card" to create one.</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {allCards.map((card) => (
              <button
                key={card.id}
                onClick={() => setEditingCardId(card.id)}
                className="flex w-full items-center justify-between rounded-lg border border-[#E2E8F0] bg-white px-4 py-3 text-left transition hover:shadow-sm"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 text-sm font-semibold">
                    {(card.customer_company || 'C').charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-[#0F172B]">
                      {card.customer_company || 'Untitled'}
                      {card.service_type ? ` · ${card.service_type}` : ''}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-[#62748E]">
                      {card.plan_name || 'No plan'}
                      {card.proposed_price ? ` · ₹${((card.proposed_price || 0) + (card.markup || 0)).toLocaleString()}/mo` : ''}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      card.state === 'draft'
                        ? 'bg-amber-100 text-amber-800'
                        : card.state === 'published'
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-slate-200 text-slate-600'
                    }`}
                  >
                    {card.state}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
