'use client';

import { useState } from 'react';
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

const STATUSES: { key: string; label: string }[] = [
  { key: '', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'in_review', label: 'In Review' },
  { key: 'published', label: 'Published' },
  { key: 'declined', label: 'Declined' },
];

const STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  pending: { bg: '#FEF3C7', fg: '#92400E' },
  in_review: { bg: '#DBEAFE', fg: '#1E40AF' },
  published: { bg: '#D1FAE5', fg: '#065F46' },
  declined: { bg: '#FEE2E2', fg: '#991B1B' },
  cancelled: { bg: '#F3F4F6', fg: '#525252' },
};

export default function MobileRequestsList() {
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
    <div className="flex flex-col pb-6">
      <div className="flex gap-2 overflow-x-auto px-4 pt-3 pb-2 scrollbar-none">
        {STATUSES.map((s) => (
          <button
            key={s.key}
            onClick={() => setStatusFilter(s.key)}
            className={`shrink-0 rounded-xl border-2 px-3.5 py-1.5 text-xs font-bold transition-all active:scale-[0.97] ${
              statusFilter === s.key
                ? 'border-black bg-[#0a0a0a] text-white shadow-[2px_2px_0_0_#d4ff4d]'
                : 'border-black bg-white text-[#0a0a0a]'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="px-4 pb-3 pt-1">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, email, company..."
          className="w-full rounded-xl border-2 border-black bg-white py-3 px-4 text-sm text-[#0a0a0a] placeholder-[#a3a3a3] outline-none transition-shadow focus:shadow-[3px_3px_0_0_#000]"
        />
      </div>

      <div className="space-y-3 px-4">
        {isLoading ? (
          <div className="animate-pulse rounded-2xl border-2 border-black bg-white p-4 shadow-[3px_3px_0_0_#000]">
            <div className="h-4 w-2/3 rounded-lg bg-[#e5e5e5]" />
            <div className="mt-2 h-3 w-1/2 rounded-lg bg-[#e5e5e5]" />
          </div>
        ) : requests.length === 0 ? (
          <div className="rounded-2xl border-2 border-black bg-white px-6 py-12 text-center shadow-[3px_3px_0_0_#000]">
            <p className="font-[family-name:var(--font-jakarta)] text-base font-bold text-[#0a0a0a]">
              No requests found
            </p>
            <p className="mt-1 text-sm text-[#525252]">Try adjusting your filters.</p>
          </div>
        ) : (
          requests.map((req, idx) => (
            <RequestItem
              key={req.id}
              request={req}
              index={idx}
              isPending={createCardMutation.isPending}
              onAction={() => {
                if (req.card_id) setEditingCardId(req.card_id);
                else createCardMutation.mutate(req.id);
              }}
            />
          ))
        )}
      </div>
    </div>
  );
}

function RequestItem({
  request,
  index,
  onAction,
  isPending,
}: {
  request: SubscriptionRequest;
  index: number;
  onAction: () => void;
  isPending: boolean;
}) {
  const colors = STATUS_COLORS[request.status] || STATUS_COLORS.cancelled;
  const hasCard = !!request.card_id;
  const buttonLabel = hasCard
    ? 'View Card'
    : request.status === 'pending'
    ? isPending ? 'Creating...' : 'Review'
    : request.status === 'in_review'
    ? 'Continue'
    : 'Review';
  const buttonVariant = hasCard
    ? 'bg-white border-black text-[#0a0a0a]'
    : 'bg-[#d4ff4d] border-black text-black';

  return (
    <div
      className="rounded-2xl border-2 border-black bg-white p-4 shadow-[3px_3px_0_0_#000]"
      style={{ animation: `fadeSlideUp 0.3s ease-out ${index * 0.05}s both` }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate font-[family-name:var(--font-jakarta)] text-[15px] font-bold text-[#0a0a0a]">
            {request.company || request.name}
          </p>
          <p className="mt-0.5 truncate text-xs text-[#525252]">
            {request.service_type} · {request.tier} · {request.plan}
          </p>
          <p className="mt-0.5 truncate text-[11px] text-[#a3a3a3]">{request.email}</p>
          {request.phone && (
            <p className="truncate text-[11px] text-[#a3a3a3]">{request.phone}</p>
          )}
        </div>
        <span
          className="shrink-0 rounded-full border border-black/20 px-2 py-0.5 text-[10px] font-bold"
          style={{ backgroundColor: colors.bg, color: colors.fg }}
        >
          {request.status.replace('_', ' ')}
        </span>
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-xs text-[#525252]">
          <span className="font-bold text-[#0a0a0a]">
            ₹{request.proposed_price.toLocaleString()}
          </span>
          {request.working_days && (
            <span className="text-[#a3a3a3]">
              · {request.working_days.split(',').length}d/wk
            </span>
          )}
          <span className="text-[#a3a3a3]">
            · {new Date(request.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </span>
        </div>
        <button
          onClick={onAction}
          disabled={isPending}
          className={`shrink-0 rounded-xl border-2 px-4 py-2 text-xs font-bold shadow-[2px_2px_0_0_#000] transition-transform active:scale-[0.97] active:shadow-[1px_1px_0_0_#000] disabled:opacity-50 ${buttonVariant}`}
        >
          {buttonLabel}
        </button>
      </div>
    </div>
  );
}
