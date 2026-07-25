import { useQuery } from '@tanstack/react-query';
import api from '@/services/api';
import {
  categorize,
  type AdminSubscriptionCard,
} from '@/views/admin/AdminSubscriptionCards';
import { categorizeJobCard, type AdminJobCard } from '@/views/admin/jobs/AdminJobCards';

/**
 * Attention counts for the three Leads tabs.
 *
 * These deliberately reuse the modules' OWN query keys and their exported
 * categorizers rather than counting server-side. Two reasons:
 *
 *  1. No drift. `needs_broadcast` and the lifecycle buckets are derived, not
 *     stored — a second implementation would silently disagree with the tab
 *     counts the user sees after clicking through.
 *  2. Free warm cache. Opening a tab re-uses the fetch the badge already made,
 *     so the module renders instantly instead of showing a spinner.
 */

export type LeadBadge = {
  /** Total shown on the tab. 0 renders no badge. */
  total: number;
  /** Human breakdown, surfaced as the tab's tooltip. */
  parts: string[];
};

const EMPTY: LeadBadge = { total: 0, parts: [] };

function badge(entries: [count: number, label: string][]): LeadBadge {
  const parts = entries.filter(([n]) => n > 0).map(([n, label]) => `${n} ${label}`);
  return { total: entries.reduce((sum, [n]) => sum + n, 0), parts };
}

/** Poll often enough that a new form submission shows up without a reload. */
const LIVE = { staleTime: 30_000, refetchInterval: 60_000 } as const;

/** One of the three inbound-form queues that feed the New Deals tab. */
function fetchInbound(
  source: 'shared_form' | 'landing_page_form' | 'internal_brief',
  cardType: 'subscription' | 'assignment',
) {
  return api
    .get('/admin/subscription-cards', {
      params: { source, state: 'new,draft', card_type: cardType },
    })
    .then((r) => r.data);
}

/**
 * Subscription-style pipelines (Subscription Cards and Assignments share one
 * module, split by `card_type`).
 *
 * Needs attention =
 *   · new deals still sitting in the inbound queue
 *   · published cards that haven't been broadcast yet
 *   · cards where the client selected someone and an admin must hit Assign
 */
function useCardPipelineBadge(productLine: 'subscription' | 'assignment'): LeadBadge {
  // Same key as AdminSubscriptionCards' active-cards query with no filters and
  // no card open, so the two share a cache entry.
  const { data: activeRes } = useQuery({
    queryKey: ['admin-subscription-cards', productLine, '', '', 'active', null],
    queryFn: () =>
      api
        .get('/admin/subscription-cards', { params: { card_type: productLine } })
        .then((r) => r.data),
    ...LIVE,
  });

  // The three inbound-form queues. Keys match AdminRequestsList exactly (which
  // scopes them by card type — unlike the admin module's own tab badge, which
  // counts both product lines together).
  const { data: sharedRes } = useQuery({
    queryKey: ['admin-shared-form-submissions', productLine, ''],
    queryFn: () => fetchInbound('shared_form', productLine),
    ...LIVE,
  });
  const { data: landingRes } = useQuery({
    queryKey: ['admin-landing-page-submissions', productLine, ''],
    queryFn: () => fetchInbound('landing_page_form', productLine),
    ...LIVE,
  });
  const { data: briefRes } = useQuery({
    queryKey: ['admin-internal-brief-submissions', productLine, ''],
    queryFn: () => fetchInbound('internal_brief', productLine),
    ...LIVE,
  });

  // The legacy upsquad request queue has no product line, so it only counts
  // toward Subscription Cards (mirrors AdminRequestsList's `enabled` guard).
  const { data: reqRes } = useQuery({
    queryKey: ['admin-subscription-requests', ''],
    queryFn: () => api.get('/admin/subscription-requests').then((r) => r.data),
    enabled: productLine === 'subscription',
    ...LIVE,
  });

  // upsquad status is external and doesn't track local archival, so a request
  // can stay 'pending' after its card is archived. AdminRequestsList hides
  // those rows (they belong in Archive), so this badge must too or it
  // over-counts. Same key as AdminSubscriptionCards' archived query so the
  // cache is shared; subscription-only, mirroring the upsquad scope above.
  const { data: archivedRes } = useQuery({
    queryKey: ['admin-subscription-cards', productLine, '', '', 'archived', null],
    queryFn: () =>
      api
        .get('/admin/subscription-cards', { params: { archived: 'true', card_type: productLine } })
        .then((r) => r.data),
    enabled: productLine === 'subscription',
    ...LIVE,
  });
  const archivedCardIds = new Set(
    ((archivedRes?.data || []) as { id: string }[]).map((c) => c.id),
  );

  const cards: AdminSubscriptionCard[] = activeRes?.data || [];
  let awaitingBroadcast = 0;
  let awaitingAssign = 0;
  for (const card of cards) {
    const bucket = categorize(card);
    if (bucket === 'published') awaitingBroadcast++;
    else if (bucket === 'selected') awaitingAssign++;
  }

  // That endpoint returns every status, so narrow it to the two the New deals
  // tab lists. The other three queues fetch only state='new,draft' rows.
  // Archived-linked requests are dropped — see archivedCardIds above.
  const upsquadPending = (reqRes?.data || []).filter(
    (r: { status?: string; card_id?: string | null }) =>
      (r.status === 'pending' || r.status === 'in_review') &&
      !(r.card_id && archivedCardIds.has(r.card_id)),
  ).length;

  const newDeals =
    (sharedRes?.data || []).length +
    (landingRes?.data || []).length +
    (briefRes?.data || []).length +
    (productLine === 'subscription' ? upsquadPending : 0);

  return badge([
    [newDeals, 'new'],
    [awaitingBroadcast, 'to broadcast'],
    [awaitingAssign, 'to assign'],
  ]);
}

/**
 * Hiring pipeline.
 *
 * Needs attention = untouched briefs, plus the two stages where the ball is in
 * our court: an offer is out awaiting follow-up, and a hired candidate still
 * needs to be marked joined. The middle stages (screening → interview) are
 * genuinely in-flight work, not a queue, so they don't raise a badge.
 */
function useJobCardsBadge(): LeadBadge {
  const { data } = useQuery({
    queryKey: ['admin-job-cards', ''],
    queryFn: () => api.get('/admin/job-cards').then((r) => r.data),
    ...LIVE,
  });

  const cards: AdminJobCard[] = data?.data || [];
  let fresh = 0;
  let offer = 0;
  let hired = 0;
  for (const card of cards) {
    const stage = (card.stage as string | undefined) ?? categorizeJobCard(card);
    if (stage === 'new') fresh++;
    else if (stage === 'offer') offer++;
    else if (stage === 'hired') hired++;
  }

  return badge([
    [fresh, 'new'],
    [offer, 'in offer'],
    [hired, 'to mark joined'],
  ]);
}

export function useLeadBadges(): Record<'job-cards' | 'subscription-cards' | 'assignments', LeadBadge> {
  const jobCards = useJobCardsBadge();
  const subscriptionCards = useCardPipelineBadge('subscription');
  const assignments = useCardPipelineBadge('assignment');

  return {
    'job-cards': jobCards,
    'subscription-cards': subscriptionCards,
    assignments,
  };
}

export { EMPTY as EMPTY_BADGE };
