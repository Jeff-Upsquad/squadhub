'use client';

import { useState } from 'react';
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
  const requests: SubscriptionRequest[] = res?.data || [];

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
    <div className="flex h-full flex-col">
      <div className="border-b border-[#E2E8F0] bg-white px-6 pt-5 pb-4">
        <div className="mb-4">
          <h1 className="text-xl font-semibold text-[#0F172B]">From Requests</h1>
          <p className="mt-0.5 text-sm text-[#62748E]">
            Inbound subscription requests from the pricing page.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-md border border-[#E2E8F0] bg-white px-3 py-2 text-sm text-[#0F172B] focus:outline-none focus:ring-2 focus:ring-[#0F172B]/10"
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
            className="flex-1 min-w-[200px] rounded-md border border-[#E2E8F0] bg-white px-3 py-2 text-sm text-[#0F172B] placeholder:text-[#90A1B9] focus:outline-none focus:ring-2 focus:ring-[#0F172B]/10"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        {isLoading ? (
          <p className="py-8 text-center text-sm text-[#90A1B9]">Loading…</p>
        ) : requests.length === 0 ? (
          <div className="rounded-lg border border-[#E2E8F0] bg-white py-12 text-center">
            <p className="text-sm text-[#90A1B9]">No subscription requests found.</p>
          </div>
        ) : (
          <div className="space-y-1.5">
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
  const buttonClass = hasCard
    ? 'ml-2 rounded-md border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 transition hover:bg-indigo-100'
    : request.status === 'in_review'
    ? 'ml-2 rounded-md border border-[#E2E8F0] bg-white px-3 py-1.5 text-xs font-medium text-[#0F172B] transition hover:bg-slate-50 disabled:opacity-50'
    : 'ml-2 rounded-md bg-[#0F172B] px-3 py-1.5 text-xs font-medium text-white transition hover:bg-[#1E293B] disabled:opacity-50';
  const statusColors: Record<string, string> = {
    pending: '#F59E0B',
    in_review: '#3B82F6',
    published: '#10B981',
    declined: '#EF4444',
    cancelled: '#6B7280',
  };
  const color = statusColors[request.status] || '#6B7280';

  return (
    <div className="flex items-center justify-between rounded-lg border border-[#E2E8F0] bg-white px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-indigo-600 text-sm font-semibold">
          {(request.company || request.name).charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-[#0F172B]">
            {request.company || request.name}
          </p>
          <p className="mt-0.5 truncate text-xs text-[#62748E]">
            {request.service_type} · {request.tier} · {request.plan}
          </p>
          <p className="mt-0.5 truncate text-[11px] text-[#90A1B9]">
            {request.email} · {request.phone}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className="text-sm font-medium text-[#0F172B]">
          ₹{request.proposed_price.toLocaleString()}
        </span>
        {request.working_days && (
          <span className="text-xs text-[#62748E]">
            {request.working_days.split(',').length}d/wk
          </span>
        )}
        <span
          className="rounded-full px-2 py-0.5 text-[10px] font-medium"
          style={{ backgroundColor: `${color}18`, color }}
        >
          {request.status}
        </span>
        <span className="text-[11px] text-[#90A1B9]">
          {new Date(request.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
        </span>
        <button
          onClick={onAction}
          disabled={isPending}
          className={buttonClass}
        >
          {buttonLabel}
        </button>
      </div>
    </div>
  );
}
