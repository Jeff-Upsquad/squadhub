'use client';

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import { showToast } from '@/components/Toast';
import AdminCardEditor from './AdminCardEditor';
import ShareCardLinkModal from './ShareCardLinkModal';
import { CardAssigneeAvatars, type CardAssignees } from './CardAssigneePicker';

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
  // Raw card state — distinguishes a freshly-submitted brief ('new') from one
  // the admin has saved ('draft'). Both map to status 'pending' (Active sub-tab).
  state?: string;
  created_at: string;
  card_id: string | null;
  // Source tag — drives the badge + button label.
  //   'request'           → upsquad subscription request, shown without badge
  //   'shared_form'       → /connect submission, badge "Shared Form"
  //   'landing_page_form' → embedded marketing-page form, badge "Landing Page"
  //   'internal_brief'    → brief an internal user filled out, badge "Client Brief"
  source?: 'request' | 'shared_form' | 'landing_page_form' | 'internal_brief';
  // Provenance from the card serializer: who filled an internal brief, who
  // verified a client submission, and the approve / verify timestamps.
  created_by_user?: { id: string; display_name: string | null; email: string | null } | null;
  verified_by_user?: { id: string; display_name: string | null; email: string | null } | null;
  client_approved_at?: string | null;
  verified_at?: string | null;
  assignee_id?: string | null;
  collaborator_ids?: string[];
  assignee?: CardAssignees['assignee'];
  collaborators?: CardAssignees['collaborators'];
}

export default function AdminRequestsList({
  cardType = 'subscription',
}: {
  // Product line this New Deals queue is scoped to. The Assignments module
  // passes 'assignment' so only assignment briefs show; the legacy upsquad
  // subscription-request source is subscription-only and hidden for assignments.
  cardType?: 'subscription' | 'assignment';
} = {}) {
  const [search, setSearch] = useState<string>('');
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [shareCardId, setShareCardId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const isAssignment = cardType === 'assignment';

  // Server returns all statuses; sub-tabs filter client-side so counts stay
  // accurate without a per-tab fetch. The legacy upsquad subscription-request
  // queue has no product line, so it's only shown in the Subscription module.
  const { data: res, isLoading } = useQuery({
    queryKey: ['admin-subscription-requests', search],
    queryFn: () => {
      const params: Record<string, string> = {};
      if (search.trim()) params.search = search.trim();
      return api.get('/admin/subscription-requests', { params }).then((r) => r.data);
    },
    enabled: !isAssignment,
  });
  const upsquadRequests: SubscriptionRequest[] = isAssignment
    ? []
    : (res?.data || []).map((r: any) => ({ ...r, source: 'request' as const }));

  // Form submissions (Shared Form via /connect, plus Landing Page entries
  // from the marketing site) live in subscription_cards. New Deals only shows
  // the live inbound queue, so we fetch just the 'new'/'draft' cards; once a
  // card is published it moves to the Published/Broadcaster tabs, and once it's
  // closed it moves to Archive.
  function adaptCardToRequest(
    c: any,
    source: 'shared_form' | 'landing_page_form' | 'internal_brief',
  ): SubscriptionRequest {
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
      state: c.state,
      created_at: c.created_at || new Date().toISOString(),
      card_id: c.id,
      source,
      created_by_user: c.created_by_user || null,
      verified_by_user: c.verified_by_user || null,
      client_approved_at: c.client_approved_at || null,
      verified_at: c.verified_at || null,
      assignee_id: c.assignee_id || null,
      collaborator_ids: c.collaborator_ids || [],
      assignee: c.assignee || null,
      collaborators: c.collaborators || [],
    };
  }

  const { data: sharedRes, isLoading: sharedLoading } = useQuery({
    queryKey: ['admin-shared-form-submissions', cardType, search],
    queryFn: () => {
      const params: Record<string, string> = { source: 'shared_form', state: 'new,draft', card_type: cardType };
      if (search.trim()) params.search = search.trim();
      return api.get('/admin/subscription-cards', { params }).then((r) => r.data);
    },
  });
  const { data: lpRes, isLoading: lpLoading } = useQuery({
    queryKey: ['admin-landing-page-submissions', cardType, search],
    queryFn: () => {
      const params: Record<string, string> = { source: 'landing_page_form', state: 'new,draft', card_type: cardType };
      if (search.trim()) params.search = search.trim();
      return api.get('/admin/subscription-cards', { params }).then((r) => r.data);
    },
  });
  // Internal client briefs (Workflow 1) also land in the New Deals queue.
  const { data: briefRes, isLoading: briefLoading } = useQuery({
    queryKey: ['admin-internal-brief-submissions', cardType, search],
    queryFn: () => {
      const params: Record<string, string> = { source: 'internal_brief', state: 'new,draft', card_type: cardType };
      if (search.trim()) params.search = search.trim();
      return api.get('/admin/subscription-cards', { params }).then((r) => r.data);
    },
  });
  const sharedFormRequests: SubscriptionRequest[] =
    (sharedRes?.data || []).map((c: any) => adaptCardToRequest(c, 'shared_form'));
  const landingPageRequests: SubscriptionRequest[] =
    (lpRes?.data || []).map((c: any) => adaptCardToRequest(c, 'landing_page_form'));
  const internalBriefRequests: SubscriptionRequest[] =
    (briefRes?.data || []).map((c: any) => adaptCardToRequest(c, 'internal_brief'));

  const allRequests: SubscriptionRequest[] = [
    ...upsquadRequests,
    ...sharedFormRequests,
    ...landingPageRequests,
    ...internalBriefRequests,
  ];

  // Archived cards stay in the Archive tab — hide their originating
  // requests from Form Requests so the active queue isn't polluted by
  // already-handled items. Same query key the subscription-cards module
  // uses, so the cache is shared and invalidations propagate.
  const { data: archivedRes } = useQuery({
    queryKey: ['admin-subscription-cards', '', '', 'archived'],
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

  // New deals only surfaces the live inbound queue — freshly-submitted briefs
  // and admin-saved drafts (both status 'pending'), plus any upsquad requests
  // still pending review. Published cards live in the Published/Broadcaster
  // tabs and closed/declined ones in Archive.
  const visibleRequests = useMemo(
    () => requests.filter((r) => r.status === 'pending' || r.status === 'in_review'),
    [requests],
  );

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

  // Workflow 2: an internal user verifies a brief the client submitted directly.
  const verifyMutation = useMutation({
    mutationFn: (cardId: string) =>
      api.post(`/admin/subscription-cards/${cardId}/verify`).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-shared-form-submissions'] });
      queryClient.invalidateQueries({ queryKey: ['admin-landing-page-submissions'] });
      showToast('Brief verified', 'success');
    },
    onError: (err: any) =>
      showToast(err?.response?.data?.error || err.message || 'Failed to verify', 'error'),
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
          queryClient.invalidateQueries({ queryKey: ['admin-subscription-cards'] });
        }}
      />
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      {shareCardId && (
        <ShareCardLinkModal cardId={shareCardId} onClose={() => setShareCardId(null)} />
      )}

      {/* Who filled out the form — surfaced per row below. */}
      <div className="px-6 pt-5 pb-1">
        <p className="text-xs text-[var(--color-sh-ink-muted)]">
          Each request shows{' '}
          <span className="font-semibold text-[var(--color-sh-ink)]">who filled it out</span>{' '}
          — a brief your team created, or one the client submitted directly.
        </p>
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

      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-8">
        {isLoading || sharedLoading || lpLoading || briefLoading ? (
          <div className="sh-card py-16 text-center">
            <p className="text-sm text-[var(--color-sh-ink-faint)]">Loading…</p>
          </div>
        ) : visibleRequests.length === 0 ? (
          <div className="sh-card py-16 text-center">
            <p className="text-sm text-[var(--color-sh-ink-subtle)]">
              No new deals in the queue.
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
                onShare={() => {
                  if (req.card_id) setShareCardId(req.card_id);
                }}
                onVerify={() => {
                  if (req.card_id) verifyMutation.mutate(String(req.card_id));
                }}
                isPending={createCardMutation.isPending}
                isVerifying={verifyMutation.isPending}
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
  onShare,
  onVerify,
  isPending,
  isVerifying,
}: {
  request: SubscriptionRequest;
  onAction: () => void;
  onShare: () => void;
  onVerify: () => void;
  isPending: boolean;
  isVerifying: boolean;
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
            {request.source === 'internal_brief' && (
              <span
                className="shrink-0 rounded bg-[#EDE9FE] px-1.5 py-0.5 text-[10px] font-medium text-[#5B21B6] ring-1 ring-[#DDD6FE]"
                title="A client brief an internal user filled out"
              >
                Client Brief
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
          {request.source === 'internal_brief' ? (
            <p className="truncate text-[11px] font-medium text-[var(--color-sh-ink-muted)]">
              Filled out by {request.created_by_user?.display_name || request.created_by_user?.email || 'a team member'}
            </p>
          ) : isFormSubmission ? (
            <p className="truncate text-[11px] font-medium text-[var(--color-sh-ink-muted)]">
              Submitted by the client{request.name ? ` · ${request.name}` : ''}
            </p>
          ) : (request.name || request.email) ? (
            <p className="truncate text-[11px] text-[var(--color-sh-ink-faint)]">
              by {request.name || request.email}
            </p>
          ) : null}
        </div>
        <CardAssigneeAvatars card={request} className="ml-1 shrink-0" />
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {request.working_days && (
          <span className="text-xs text-[var(--color-sh-ink-muted)]">
            {request.working_days.split(',').length}d/wk
          </span>
        )}
        {request.state === 'new' || request.state === 'draft' ? (
          <span
            className="sh-status-pill"
            style={
              request.state === 'new'
                ? { backgroundColor: '#F59E0B22', color: '#B45309' }
                : { backgroundColor: '#6366F122', color: '#4338CA' }
            }
            title={
              request.state === 'new'
                ? 'Newly submitted — open it, fill in the details, then Save Draft'
                : 'Saved as a draft — share the client link or publish'
            }
          >
            {request.state === 'new' ? 'New' : 'Draft'}
          </span>
        ) : (
          <span
            className="sh-status-pill"
            style={{ backgroundColor: `${color}1F`, color }}
          >
            {request.status}
          </span>
        )}
        {request.source === 'internal_brief' && request.client_approved_at && (
          <span
            className="sh-status-pill"
            style={{ backgroundColor: '#10B98122', color: '#0F7A4F' }}
            title="The client reviewed and submitted this brief via the share link"
          >
            ✓ Client approved
          </span>
        )}
        {isFormSubmission && request.verified_at && (
          <span
            className="sh-status-pill"
            style={{ backgroundColor: '#06B6D422', color: '#0E7490' }}
            title={`Verified by ${request.verified_by_user?.display_name || request.verified_by_user?.email || 'a team member'}`}
          >
            ✓ Verified by {request.verified_by_user?.display_name || request.verified_by_user?.email || 'team'}
          </span>
        )}
        {isFormSubmission && !request.verified_at && (
          <button
            onClick={onVerify}
            disabled={isVerifying}
            className="sh-btn-ghost sh-btn-ghost-sm"
            title="Mark this client-submitted brief as verified"
          >
            {isVerifying ? 'Verifying…' : 'Verify'}
          </button>
        )}
        {request.card_id &&
          (request.status === 'pending' || request.status === 'in_review') &&
          request.state !== 'new' && (
            <button
              onClick={onShare}
              className="sh-btn-ghost sh-btn-ghost-sm"
              title="Generate a 24-hour link the client can open to confirm this brief"
            >
              Share link
            </button>
          )}
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
