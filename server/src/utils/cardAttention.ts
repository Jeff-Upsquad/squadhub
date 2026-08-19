/**
 * "Needs attention" counts for the Requirement Cards module.
 *
 * The module's own tabs count client-side (see admin useLeadBadges) because
 * opening a tab reuses that fetch. A sidebar badge is different: it is mounted
 * on every page, in three apps, and must not drag a full hydrated card list
 * along with it — and Squad CRM can't run the client-side version at all,
 * since it only frames the module. So the count is computed here once and the
 * three sidebars all read the same number.
 *
 * Attention means the ball is in our court:
 *   · a new deal still sitting in the inbound queue
 *   · a published card nobody has broadcast yet
 *   · a card where the client picked someone and an admin must hit Assign
 *   · a job card that is new, has an offer out, or has a hire to mark joined
 *
 * The middle stages (screening → interview) are in-flight work, not a queue.
 */

import { supabaseAdmin } from '../supabase';
import { hydrateCardsBatch } from './subscriptionCards';
import { categorizeJobCard } from './jobStage';
import { listSubscriptionRequests } from './upsquadApi';

export type AttentionBadge = {
  /** Total for the badge. 0 renders nothing. */
  total: number;
  /** Human breakdown for the tooltip, e.g. ["3 new", "2 to broadcast"]. */
  parts: string[];
};

export type CardsAttention = AttentionBadge & {
  by_pipeline: {
    'subscription-cards': AttentionBadge;
    assignments: AttentionBadge;
    'job-cards': AttentionBadge;
  };
};

const EMPTY: AttentionBadge = { total: 0, parts: [] };

function badge(entries: [count: number, label: string][]): AttentionBadge {
  return {
    total: entries.reduce((sum, [n]) => sum + n, 0),
    parts: entries.filter(([n]) => n > 0).map(([n, label]) => `${n} ${label}`),
  };
}

/**
 * Server mirror of the admin module's categorize(), narrowed to the two
 * buckets the badge cares about. Order matters and matches it exactly:
 * cancelled and paused win over the recipient pointer, which wins over state.
 */
function attentionBucket(card: any, needsBroadcast: boolean): 'to-broadcast' | 'to-assign' | null {
  if (card.cancelled_at || card.state === 'closed') return null;
  if (card.paused_at) return null;
  if (card.selected_recipient_id) return null;
  if (card.state === 'assigned') return 'to-assign';
  return needsBroadcast ? 'to-broadcast' : null;
}

/** One product line of the subscription-style pipeline. */
async function subscriptionAttention(
  productLine: 'subscription' | 'assignment',
): Promise<AttentionBadge> {
  const typeFilter = (q: any) =>
    productLine === 'assignment' ? q.eq('card_type', 'assignment') : q.neq('card_type', 'assignment');

  // Live cards, exactly the set the module's active list shows.
  const { data: liveCards } = await typeFilter(
    supabaseAdmin
      .from('subscription_cards')
      .select('*')
      .is('parent_card_id', null)
      .is('deleted_at', null)
      .is('archived_at', null)
      .in('state', ['published', 'assigned', 'closed']),
  );

  const cards = liveCards || [];
  // needs_broadcast is derived from staged partners / queued talents, so it
  // has to come from the same hydration the list uses — a SQL re-derivation
  // would drift the moment either rule changes.
  const hydrated = cards.length > 0 ? await hydrateCardsBatch(cards) : new Map();

  let awaitingBroadcast = 0;
  let awaitingAssign = 0;
  for (const card of cards) {
    const bucket = attentionBucket(card, hydrated.get(card.id)?.needs_broadcast ?? false);
    if (bucket === 'to-broadcast') awaitingBroadcast++;
    else if (bucket === 'to-assign') awaitingAssign++;
  }

  // The three inbound-form queues that feed New Deals.
  const { count: inboundCount } = await typeFilter(
    supabaseAdmin
      .from('subscription_cards')
      .select('id', { count: 'exact', head: true })
      .is('parent_card_id', null)
      .is('deleted_at', null)
      .is('archived_at', null)
      .in('state', ['new', 'draft'])
      .in('source', ['shared_form', 'landing_page_form', 'internal_brief']),
  );

  let newDeals = inboundCount || 0;

  // The legacy upsquad queue has no product line, so it only counts toward
  // Subscription Cards. It is an external API — a slow or down upsquad must
  // not take the badge with it, so a failure just contributes nothing.
  if (productLine === 'subscription') {
    try {
      const { items } = await listSubscriptionRequests({});
      const pending = (items || []).filter(
        (r: any) => r.status === 'pending' || r.status === 'in_review',
      );

      // upsquad's status is external and doesn't track local archival, so a
      // request can stay 'pending' after its card is archived. The New Deals
      // list hides those rows, so the badge must too or it over-counts. The
      // link is subscription_cards.subscription_request_id, same as the list's
      // own enrichment.
      const requestIds = pending.map((r: any) => r.id).filter(Boolean);
      const archivedRequestIds = new Set<number>();
      if (requestIds.length > 0) {
        const { data: archivedCards } = await supabaseAdmin
          .from('subscription_cards')
          .select('subscription_request_id')
          .in('subscription_request_id', requestIds)
          .is('deleted_at', null)
          .not('archived_at', 'is', null);
        (archivedCards || []).forEach((c: any) =>
          archivedRequestIds.add(c.subscription_request_id as number),
        );
      }

      newDeals += pending.filter((r: any) => !archivedRequestIds.has(r.id)).length;
    } catch (err: any) {
      console.warn('[cardAttention] upsquad queue unavailable:', err?.message);
    }
  }

  return badge([
    [newDeals, 'new'],
    [awaitingBroadcast, 'to broadcast'],
    [awaitingAssign, 'to assign'],
  ]);
}

async function jobCardsAttention(): Promise<AttentionBadge> {
  const { data } = await supabaseAdmin
    .from('job_cards')
    .select('*')
    .is('deleted_at', null)
    .is('archived_at', null);

  let fresh = 0;
  let offer = 0;
  let hired = 0;
  for (const card of data || []) {
    const stage = categorizeJobCard(card as any);
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

/**
 * The whole module's badge, plus the per-pipeline breakdown the tooltips use.
 * Never throws — a sidebar badge is not worth failing a page render over.
 */
export async function getCardsAttention(): Promise<CardsAttention> {
  try {
    const [subscriptionCards, assignments, jobCards] = await Promise.all([
      subscriptionAttention('subscription'),
      subscriptionAttention('assignment'),
      jobCardsAttention(),
    ]);

    return {
      total: subscriptionCards.total + assignments.total + jobCards.total,
      parts: [
        ...subscriptionCards.parts.map((p) => `${p} · Subscription`),
        ...assignments.parts.map((p) => `${p} · Assignment`),
        ...jobCards.parts.map((p) => `${p} · Job`),
      ],
      by_pipeline: {
        'subscription-cards': subscriptionCards,
        assignments,
        'job-cards': jobCards,
      },
    };
  } catch (err: any) {
    console.warn('[cardAttention] failed:', err?.message);
    return {
      total: 0,
      parts: [],
      by_pipeline: {
        'subscription-cards': EMPTY,
        assignments: EMPTY,
        'job-cards': EMPTY,
      },
    };
  }
}
