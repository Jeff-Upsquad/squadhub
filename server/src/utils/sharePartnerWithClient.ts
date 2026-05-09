import { supabaseAdmin } from '../supabase';

/**
 * Share a partner with the business-side client that owns a subscription card.
 *
 * Call this after a partner accepts (or is accepted-on-their-behalf for) a
 * subscription card. The card → submission_subscription → submission → client
 * chain resolves the owning client, and we upsert into
 * partner_client_assignments(user_id, client_id) so the partner appears in the
 * business user's partner list.
 *
 * Idempotent — UNIQUE(user_id, client_id) plus `ignoreDuplicates: true` keeps
 * a second call from clobbering an existing role assignment.
 *
 * Silently no-ops when:
 *   - the card has no submission_subscription_id (custom cards)
 *   - the staged subscription's submission has not converted to a client yet
 *
 * Errors are logged and swallowed — visibility-sharing is a side effect of
 * acceptance and should never block the primary acceptance write.
 */
export async function sharePartnerWithCardClient(
  partnerId: string,
  cardId: string,
): Promise<void> {
  try {
    const { data: cardRow } = await supabaseAdmin
      .from('subscription_cards')
      .select('submission_subscription_id')
      .eq('id', cardId)
      .maybeSingle();
    if (!cardRow?.submission_subscription_id) return;

    const { data: staged } = await supabaseAdmin
      .from('client_submission_subscriptions')
      .select('submission_id')
      .eq('id', cardRow.submission_subscription_id)
      .maybeSingle();
    if (!staged?.submission_id) return;

    const { data: client } = await supabaseAdmin
      .from('clients')
      .select('id')
      .eq('submission_id', staged.submission_id)
      .maybeSingle();
    if (!client?.id) return;

    await supabaseAdmin
      .from('partner_client_assignments')
      .upsert(
        { user_id: partnerId, client_id: client.id, role: null },
        { onConflict: 'user_id,client_id', ignoreDuplicates: true },
      );
  } catch (err) {
    console.error('[sharePartnerWithCardClient] failed:', err);
  }
}
