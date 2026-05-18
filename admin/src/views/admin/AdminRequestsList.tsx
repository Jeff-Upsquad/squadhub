'use client';

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import AdminCardEditor from './AdminCardEditor';

interface SubscriptionRequest {
  id: number | string;
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
  // Source tag — drives the badge + button label.
  //   'request'           → upsquad subscription request, shown without badge
  //   'shared_form'       → /connect submission, badge "Shared Form"
  //   'landing_page_form' → embedded marketing-page form, badge "Landing Page"
  source?: 'request' | 'shared_form' | 'landing_page_form';
}

type RequestSubTab = 'active' | 'published' | 'declined';

export default function AdminRequestsList() {
  const [subTab, setSubTab] = useState<RequestSubTab>('active');
  const [search, setSearch] = useState<string>('');
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  // Server returns all statuses; sub-tabs filter client-side so counts stay
  // accurate without a per-tab fetch.
  const { data: res, isLoading } = useQuery({
    queryKey: ['admin-subscription-requests', search],
    queryFn: () => {
      const params: Record<string, string> = {};
      if (search.trim()) params.search = search.trim();
      return api.get('/admin/subscription-requests', { params }).then((r) => r.data);
    },
  });
  const upsquadRequests: SubscriptionRequest[] = (res?.data || []).map(
    (r: any) => ({ ...r, source: 'request' as const }),
  );

  // Form submissions (Shared Form via /connect, plus Landing Page entries
  // from the marketing site) live in subscription_cards. Draft cards drive
  // the Active sub-tab; published/assigned/closed cards drive Published and
  // Declined. Two queries per source — drafts and non-drafts — because the
  // server endpoint excludes drafts unless explicitly asked.
  function adaptCardToRequest(c: any, source: 'shared_form' | 'landing_page_form'): SubscriptionRequest {
    let status: SubscriptionRequest['status'] = 'pending';
    if (c.state === 'published' || c.state === 'assigned') status = 'published';
    else if (c.state === 'closed') status = 'cancelled';
    return {
      id: c.id,
      service_type: c.service_type || '',
      tier: Array.isArray(c.target_tiers) && c.target_tiers.length > 0 ? c.target_tiers[0] : '',
      plan: c.plan_name || '',
      proposed_price: c.proposed_price || 0,
      working_days: Array.isArray(c.working_days) ? c.working_days.join(',') : '',
      name: c.customer_name || '',
      email: c.customer_email || '',
      company: c.brand_name || c.customer_company || '',
      phone: c.customer_phone || '',
      status,
      created_at: c.created_at || new Date().toISOString(),
      card_id: c.id,
      source,
    };
  }

  const { data: sharedRes, isLoading: sharedLoading } = useQuery({
    queryKey: ['admin-shared-form-submissions', search],
    queryFn: () => {
      const params: Record<string, string> = { source: 'shared_form', state: 'draft' };
      if (search.trim()) params.search = search.trim();
      return api.get('/admin/subscription-cards', { params }).then((r) => r.data);
    },
  });
  const { data: lpRes, isLoading: lpLoading } = useQuery({
    queryKey: ['admin-landing-page-submissions', search],
    queryFn: () => {
      const params: Record<string, string> = { source: 'landing_page_form', state: 'draft' };
      if (search.trim()) params.search = search.trim();
      return api.get('/admin/subscription-cards', { params }).then((r) => r.data);
    },
  });
  // Non-draft cards from the same two form sources — surface published,
  // assigned, and closed cards in the Published / Declined sub-tabs.
  const { data: sharedPublishedRes, isLoading: sharedPublishedLoading } = useQuery({
    queryKey: ['admin-shared-form-submissions', 'published', search],
    queryFn: () => {
      const params: Record<string, string> = { source: 'shared_form' };
      if (search.trim()) params.search = search.trim();
      return api.get('/admin/subscription-cards', { params }).then((r) => r.data);
    },
  });
  const { data: lpPublishedRes, isLoading: lpPublishedLoading } = useQuery({
    queryKey: ['admin-landing-page-submissions', 'published', search],
    queryFn: () => {
      const params: Record<string, string> = { source: 'landing_page_form' };
      if (search.trim()) params.search = search.trim();
      return api.get('/admin/subscription-cards', { params }).then((r) => r.data);
    },
  });
  const sharedFormRequests: SubscriptionRequest[] = [
    ...(sharedRes?.data || []).map((c: any) => adaptCardToRequest(c, 'shared_form')),
    ...(sharedPublishedRes?.data || []).map((c: any) => adaptCardToRequest(c, 'shared_form')),
  ];
  const landingPageRequests: SubscriptionRequest[] = [
    ...(lpRes?.data || []).map((c: any) => adaptCardToRequest(c, 'landing_page_form')),
    ...(lpPublishedRes?.data || []).map((c: any) => adaptCardToRequest(c, 'landing_page_form')),
  ];

  const allRequests: SubscriptionRequest[] = [
    ...upsquadRequests,
    ...sharedFormRequests,
    ...landingPageRequests,
  ];

  // Archived cards stay in the Archive tab — hide their originating
  // requests from Form Requests so the active queue isn't polluted by
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
    () =>
      allRequests
        .filter((r) => !r.card_id || !archivedCardIds.has(r.card_id))
        .sort(
          (a, b) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        ),
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
      queryClient.invalidateQueries({ queryKey: ['admin-shared-form-submissions'] });
      queryClient.invalidateQueries({ queryKey: ['admin-landing-page-submissions'] });
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
          queryClient.invalidateQueries({ queryKey: ['admin-shared-form-submissions'] });
          queryClient.invalidateQueries({ queryKey: ['admin-landing-page-submissions'] });
          queryClient.invalidateQueries({ queryKey: ['admin-published-cards'] });
        }}
      />
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      {/* Sub-tabs */}
      <div className="px-6 pb-3">
        <div className="overflow-x-auto">
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
      <div className="px-6 pb-4">
        <div className="relative max-w-md">
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

      <div className="flex-1 overflow-y-auto px-6 pb-8">
        {isLoading || sharedLoading || lpLoading || sharedPublishedLoading || lpPublishedLoading ? (
          <div className="sh-card py-16 text-center">
            <p className="text-sm text-[var(--color-sh-ink-faint)]">Loading…</p>
          </div>
        ) : visibleRequests.length === 0 ? (
          <div className="sh-card py-16 text-center">
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
                key={`${req.source || 'request'}-${req.id}`}
                request={req}
                onAction={() => {
                  if (req.card_id) {
                    setEditingCardId(req.card_id);
                  } else if (typeof req.id === 'number') {
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
  // Form submissions (shared_form / landing_page_form) come in with a draft
  // card already created, but from the admin's POV they're still untouched —
  // surface them as "Review" so the queue reads consistently with upsquad
  // requests rather than implying the card is in-progress.
  const isFormSubmission =
    request.source === 'shared_form' || request.source === 'landing_page_form';
  const buttonLabel = isFormSubmission
    ? request.status === 'pending'
      ? 'Review'
      : 'View Card'
    : hasCard
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

  const company = request.company || request.name || 'Unknown';
  const serviceType = request.service_type || '';
  const planName = request.plan || '';
  const priceLabel = request.proposed_price
    ? `₹${request.proposed_price.toLocaleString()}/mo`
    : '';
  const createdAt = new Date(request.created_at);
  const dateLabel = `${createdAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} at ${createdAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;

  return (
    <div className="sh-card flex items-center justify-between px-5 py-4">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--color-sh-lime-soft)] text-[var(--color-sh-ink)] text-sm font-bold ring-1 ring-[var(--color-sh-warm-border)]">
          {company.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0">
          <p className="flex items-center gap-2 truncate text-sm font-semibold text-[var(--color-sh-ink)]">
            <span className="truncate">{company}{serviceType ? `: ${serviceType}` : ''}</span>
            {request.source === 'shared_form' && (
              <span
                className="shrink-0 rounded bg-[var(--color-sh-lime-soft)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-sh-ink)] ring-1 ring-[var(--color-sh-warm-border)]"
                title="Submitted via a shared /connect link"
              >
                Shared Form
              </span>
            )}
            {request.source === 'landing_page_form' && (
              <span
                className="shrink-0 rounded bg-[var(--color-sh-lime-soft)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-sh-ink)] ring-1 ring-[var(--color-sh-warm-border)]"
                title="Submitted via the marketing landing page form"
              >
                Landing Page
              </span>
            )}
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
      <div className="flex shrink-0 items-center gap-2">
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
        {isFormSubmission ? (
          <button
            onClick={onAction}
            className={request.status === 'pending' ? 'sh-btn-primary sh-btn-primary-sm' : 'sh-btn-info'}
          >
            {buttonLabel}
          </button>
        ) : hasCard ? (
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
