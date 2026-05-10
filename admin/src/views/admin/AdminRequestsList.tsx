'use client';

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import AdminCardEditor from './AdminCardEditor';

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

export default function AdminRequestsList() {
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [search, setSearch] = useState<string>('');
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: res, isLoading } = useQuery({
    queryKey: ['admin-subscription-requests', statusFilter, search],
    queryFn: () => {
      const params: Record<string, string> = {};
      if (statusFilter) params.status = statusFilter;
      if (search.trim()) params.search = search.trim();
      return api.get('/admin/subscription-requests', { params }).then((r) => r.data);
    },
  });
  const allRequests: SubscriptionRequest[] = res?.data || [];

  // Archived cards stay in the Archive tab — hide their originating
  // requests from From Requests so the active queue isn't polluted by
  // already-handled items. Same query key the published-cards module
  // uses, so the cache is shared and invalidations propagate.
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
      <AdminCardEditor
        cardId={editingCardId}
        onClose={() => {
          setEditingCardId(null);
          queryClient.invalidateQueries({ queryKey: ['admin-subscription-requests'] });
          queryClient.invalidateQueries({ queryKey: ['admin-published-cards'] });
        }}
      />
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      {/* Filters */}
      <div className="px-6 pb-4">
        <div className="sh-card p-3">
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="sh-input w-auto"
            >
              <option value="">All statuses</option>
              <option value="pending">Pending</option>
              <option value="in_review">In Review</option>
              <option value="published">Published</option>
              <option value="declined">Declined</option>
            </select>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, email, company…"
              className="sh-input flex-1 min-w-[220px]"
            />
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 pb-8">
        {isLoading ? (
          <div className="sh-card py-16 text-center">
            <p className="text-sm text-[var(--color-sh-ink-faint)]">Loading…</p>
          </div>
        ) : requests.length === 0 ? (
          <div className="sh-card py-16 text-center">
            <p className="text-sm text-[var(--color-sh-ink-subtle)]">No subscription requests found.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {requests.map((req) => (
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
    ? 'View Card'
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

  return (
    <div className="sh-card flex items-center justify-between px-5 py-4">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--color-sh-lime-soft)] text-[var(--color-sh-ink)] text-sm font-bold ring-1 ring-[var(--color-sh-warm-border)]">
          {(request.company || request.name).charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-[var(--color-sh-ink)]">
            {request.company || request.name}
          </p>
          <p className="mt-0.5 truncate text-xs text-[var(--color-sh-ink-muted)]">
            {request.service_type} · {request.tier} · {request.plan}
          </p>
          <p className="mt-0.5 truncate text-[11px] text-[var(--color-sh-ink-faint)]">
            {request.email} · {request.phone}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className="text-sm font-semibold text-[var(--color-sh-ink)]">
          ₹{request.proposed_price.toLocaleString()}
        </span>
        {request.working_days && (
          <span className="text-xs text-[var(--color-sh-ink-muted)]">
            {request.working_days.split(',').length}d/wk
          </span>
        )}
        <span
          className="sh-status-pill"
          style={{ backgroundColor: `${color}1F`, color }}
        >
          {request.status}
        </span>
        <span className="text-[11px] text-[var(--color-sh-ink-faint)]">
          {new Date(request.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
        </span>
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
