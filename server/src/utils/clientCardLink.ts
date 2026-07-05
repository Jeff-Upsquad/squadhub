// ============================================================
// clientCardLink
//
// Bridges the two independent representations of a subscription:
//   - client_subscriptions   — the client's plan row (Clients module)
//   - subscription_cards      — the delivery/billing card (Published Cards)
//
// They have no direct FK. The link is the composite path:
//   client_subscriptions(client_id, subscription_id, plan_id)
//     ↔ client_submission_subscriptions(submission_id, subscription_id, plan_id)
//     ↔ subscription_cards.submission_subscription_id
//
// A client_subscription maps to AT MOST ONE card (unique
// submission_subscription_id on the card), or none (plan row with no card yet).
// These helpers let a lifecycle action on one side keep the other in sync.
// ============================================================
import { supabaseAdmin } from '../supabase';

/** Who is performing a card lifecycle action (for audit logging). */
export interface CardActor {
  userId: string | null;
  userName?: string | null;
}

/**
 * Result of a card lifecycle core function. `httpStatus`/`body` let the thin
 * route wrapper reply verbatim, while other callers (the Clients module) can
 * branch on `httpStatus` and surface `body.error` / `body.warning`.
 */
export interface CardLifecycleResult {
  httpStatus: number;
  body: any;
}

/**
 * Resolve the subscription_card linked to a client_subscription row, or null.
 * Forward path: cs → client.submission → staged sub → card.
 * Best-effort: returns null on any miss rather than throwing.
 */
export async function findCardIdForClientSubscription(
  clientId: string,
  csId: string,
): Promise<string | null> {
  try {
    const { data: cs } = await supabaseAdmin
      .from('client_subscriptions')
      .select('subscription_id, plan_id')
      .eq('id', csId)
      .eq('client_id', clientId)
      .maybeSingle();
    if (!cs) return null;

    const { data: client } = await supabaseAdmin
      .from('clients')
      .select('submission_id')
      .eq('id', clientId)
      .maybeSingle();
    if (!(client as any)?.submission_id) return null;

    const { data: staged } = await supabaseAdmin
      .from('client_submission_subscriptions')
      .select('id')
      .eq('submission_id', (client as any).submission_id)
      .eq('subscription_id', (cs as any).subscription_id)
      .eq('plan_id', (cs as any).plan_id)
      .maybeSingle();
    if (!(staged as any)?.id) return null;

    const { data: card } = await supabaseAdmin
      .from('subscription_cards')
      .select('id')
      .eq('submission_subscription_id', (staged as any).id)
      .maybeSingle();
    return (card as any)?.id ?? null;
  } catch (err) {
    console.error('[clientCardLink] findCardIdForClientSubscription failed', err);
    return null;
  }
}

/**
 * Resolve the client_subscription linked to a card, or null.
 * Reverse path: card → staged sub → client → client_subscription.
 */
async function findClientSubscriptionForCard(
  cardId: string,
): Promise<{ clientId: string; csId: string } | null> {
  const { data: card } = await supabaseAdmin
    .from('subscription_cards')
    .select('submission_subscription_id')
    .eq('id', cardId)
    .maybeSingle();
  if (!(card as any)?.submission_subscription_id) return null;

  const { data: staged } = await supabaseAdmin
    .from('client_submission_subscriptions')
    .select('submission_id, subscription_id, plan_id')
    .eq('id', (card as any).submission_subscription_id)
    .maybeSingle();
  if (!staged) return null;

  const { data: clientRow } = await supabaseAdmin
    .from('clients')
    .select('id')
    .eq('submission_id', (staged as any).submission_id)
    .maybeSingle();
  if (!(clientRow as any)?.id) return null;

  const { data: cs } = await supabaseAdmin
    .from('client_subscriptions')
    .select('id')
    .eq('client_id', (clientRow as any).id)
    .eq('subscription_id', (staged as any).subscription_id)
    .eq('plan_id', (staged as any).plan_id)
    .maybeSingle();
  if (!(cs as any)?.id) return null;

  return { clientId: (clientRow as any).id, csId: (cs as any).id };
}

export interface ClientSubscriptionSyncPatch {
  /** Sets client_subscriptions.status. */
  status?: 'active' | 'paused' | 'cancelled';
  /** true → archived_at=now, false → archived_at=null. Omitted = leave as-is. */
  archived?: boolean;
}

/**
 * Reverse sync: mirror a card lifecycle change onto its linked
 * client_subscription so the Clients module stays accurate. Best-effort — a
 * missing link or a write error must never break the card action that called
 * this. Idempotent (safe to call even when the Clients side already matches).
 */
export async function syncClientSubscriptionForCard(
  cardId: string,
  patch: ClientSubscriptionSyncPatch,
): Promise<void> {
  try {
    if (patch.status == null && patch.archived == null) return;
    const link = await findClientSubscriptionForCard(cardId);
    if (!link) return;

    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (patch.status != null) update.status = patch.status;
    if (patch.archived === true) update.archived_at = new Date().toISOString();
    if (patch.archived === false) update.archived_at = null;

    await supabaseAdmin
      .from('client_subscriptions')
      .update(update)
      .eq('id', link.csId);
  } catch (err) {
    console.error('[clientCardLink] syncClientSubscriptionForCard failed', err);
  }
}
