'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import AdminCardEditor from '@/views/admin/AdminCardEditor';

interface SubscriptionRequest {
  id: number;
  service_type: string;
  tier: string;
  plan: string;
  proposed_price: number;
  working_days: string;
  name: string;
  email: string;
  company: string;
  phone: string;
  status: string;
  created_at: string;
  card_id: string | null;
}

type RequestSubTab = 'active' | 'published' | 'declined';

export default function MobileRequestsList() {
  const [subTab, setSubTab] = useState<RequestSubTab>('active');
  const [search, setSearch] = useState<string>('');
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: res, isLoading } = useQuery({
    queryKey: ['admin-subscription-requests', search],
    queryFn: () => {
      const params: Record<string, string> = {};
      if (search.trim()) params.search = search.trim();
      return api.get('/admin/subscription-requests', { params }).then((r) => r.data);
    },
  });
  const allRequests: SubscriptionRequest[] = res?.data || [];

  // Hide requests for archived cards. Same query-key shape as the
  // published-cards module so the cache is shared.
  const { data: archivedRes } = useQuery({
    queryKey: ['admin-published-cards', '', '', 'archived'],
    queryFn: () =>
      api
        .get('/admin/subscription-cards', { params: { archived: 'true' } })
        .then((r) => r.data),
    staleTime: 30 * 1000,
  });
  const archivedCardIds = useMemo(() => {
    const list = (archivedRes?.data || []) as { id: string }[];
    return new Set(list.map((c) => c.id));
  }, [archivedRes]);

  const requests = useMemo(
    () => allRequests.filter((r) => !r.card_id || !archivedCardIds.has(r.card_id)),
    [allRequests, archivedCardIds],
  );

  const counts = useMemo(() => ({
    active: requests.filter((r) => r.status === 'pending' || r.status === 'in_review').length,
    published: requests.filter((r) => r.status === 'published').length,
    declined: requests.filter((r) => r.status === 'declined' || r.status === 'cancelled').length,
  }), [requests]);

  const visibleRequests = useMemo(() => {
    switch (subTab) {
      case 'active':
        return requests.filter((r) => r.status === 'pending' || r.status === 'in_review');
      case 'published':
        return requests.filter((r) => r.status === 'published');
      case 'declined':
        return requests.filter((r) => r.status === 'declined' || r.status === 'cancelled');
    }
  }, [requests, subTab]);

  const createCardMutation = useMutation({
    mutationFn: (requestId: number) =>
      api.post('/admin/subscription-cards/from-request', { subscription_request_id: requestId }).then((r) => r.data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['admin-subscription-requests'] });
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
            queryClient.invalidateQueries({ queryKey: ['admin-subscription-requests'] });
            queryClient.invalidateQueries({ queryKey: ['admin-published-cards'] });
          }}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      {/* Sub-tabs */}
      <div className="px-4 pb-3">
        <div className="overflow-x-auto scrollbar-none">
          <div className="sh-tab-bar">
            <button
              type="button"
              data-active={subTab === 'active'}
              onClick={() => setSubTab('active')}
              className="sh-tab"
            >
              Active <span className="opacity-70">({counts.active})</span>
            </button>
            <button
              type="button"
              data-active={subTab === 'published'}
              onClick={() => setSubTab('published')}
              className="sh-tab"
            >
              Published <span className="opacity-70">({counts.published})</span>
            </button>
            {(counts.declined > 0 || subTab === 'declined') && (
              <button
                type="button"
                data-active={subTab === 'declined'}
                onClick={() => setSubTab('declined')}
                className="sh-tab"
              >
                Declined <span className="opacity-70">({counts.declined})</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="px-4 pb-3">
        <div className="relative">
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
            placeholder="Search name, email, company…"
            className="sh-input sh-input-sm pl-8"
          />
        </div>
      </div>

      <div className="flex-1 px-4 pb-8">
        {isLoading ? (
          <div className="sh-card py-10 text-center">
            <p className="text-sm text-[var(--color-sh-ink-faint)]">Loading…</p>
          </div>
        ) : visibleRequests.length === 0 ? (
          <div className="sh-card py-10 text-center">
            <p className="text-sm text-[var(--color-sh-ink-subtle)]">
              {subTab === 'active'
                ? 'No active requests in the queue.'
                : subTab === 'published'
                  ? 'No published requests yet.'
                  : 'No declined requests.'}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {visibleRequests.map((req) => (
              <RequestRow
                key={req.id}
                request={req}
                onAction={() => {
                  if (req.card_id) {
                    setEditingCardId(req.card_id);
                  } else {
                    createCardMutation.mutate(req.id);
                  }
                }}
                isPending={createCardMutation.isPending}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function RequestRow({
  request,
  onAction,
  isPending,
}: {
  request: SubscriptionRequest;
  onAction: () => void;
  isPending: boolean;
}) {
  const hasCard = !!request.card_id;
  const buttonLabel = hasCard
    ? 'View'
    : request.status === 'pending'
    ? isPending
      ? 'Creating…'
      : 'Review'
    : request.status === 'in_review'
    ? 'Continue'
    : 'Review';
  const statusColors: Record<string, string> = {
    pending: '#F59E0B',
    in_review: '#3B82F6',
    published: '#10B981',
    declined: '#EF4444',
    cancelled: '#6B7280',
  };
  const color = statusColors[request.status] || '#6B7280';

  const company = request.company || request.name || 'Unknown';
  const serviceType = request.service_type || '';
  const planName = request.plan || '';
  const priceLabel = request.proposed_price
    ? `₹${request.proposed_price.toLocaleString()}/mo`
    : '';
  const createdAt = new Date(request.created_at);
  const dateLabel = `${createdAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} at ${createdAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;

  return (
    <div className="sh-card flex flex-col gap-2.5 px-4 py-3.5">
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
              {planName}
              {planName && priceLabel ? ', ' : ''}
              {priceLabel}
            </p>
          )}
          <p className="mt-0.5 truncate text-[11px] text-[var(--color-sh-ink-faint)]">
            {dateLabel}
          </p>
          {(request.name || request.email) && (
            <p className="truncate text-[11px] text-[var(--color-sh-ink-faint)]">
              by {request.name || request.email}
            </p>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {request.working_days && (
            <span className="text-[11px] text-[var(--color-sh-ink-muted)]">
              {request.working_days.split(',').length}d/wk
            </span>
          )}
          <span
            className="sh-status-pill"
            style={{ backgroundColor: `${color}1F`, color }}
          >
            {request.status.replace('_', ' ')}
          </span>
        </div>
        {hasCard ? (
          <button onClick={onAction} className="sh-btn-info">
            {buttonLabel}
          </button>
        ) : request.status === 'pending' ? (
          <button onClick={onAction} disabled={isPending} className="sh-btn-primary sh-btn-primary-sm">
            {buttonLabel}
          </button>
        ) : (
          <button onClick={onAction} disabled={isPending} className="sh-btn-ghost sh-btn-ghost-sm">
            {buttonLabel}
          </button>
        )}
      </div>
    </div>
  );
}
