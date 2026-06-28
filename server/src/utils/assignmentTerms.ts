// ============================================================
// assignmentTerms
//
// Shared helpers for the subscription_assignment_terms ledger — the per-(card,
// recipient) record that powers the Active Subscriptions admin view (payments +
// hours). A term is opened when a talent/partner becomes the chosen recipient
// for a card and closed when they're unassigned.
//
// Historically a term was only written by the admin finalize-selection flow
// (subscription-cards-admin-select.ts). A talent chosen via SquadHire's
// card-selection callback closed the card but never opened a term, so those
// engagements were invisible to the payments view. These helpers let both
// paths share one consistent ledger.
// ============================================================
import { supabaseAdmin } from '../supabase';

interface EnsureTermInput {
  cardId: string;
  recipientType: 'talent' | 'partner';
  recipientId: string;
  recipientName?: string | null;
  /** ISO timestamp the engagement started; defaults to now. */
  assignedDate?: string;
}

/**
 * Open an active assignment term for a (card, recipient) if one doesn't already
 * exist. Idempotent — safe to call from multiple selection paths. Best-effort:
 * never throws (the assignment itself has already succeeded by the time we get
 * here), so a ledger hiccup can't break the card flow.
 */
export async function ensureActiveAssignmentTerm(input: EnsureTermInput): Promise<void> {
  const { cardId, recipientType, recipientId } = input;
  try {
    // Already have an open term for this recipient on this card? Nothing to do.
    const { data: existing } = await supabaseAdmin
      .from('subscription_assignment_terms')
      .select('id')
      .eq('card_id', cardId)
      .eq('recipient_id', recipientId)
      .is('unassigned_date', null)
      .maybeSingle();
    if (existing) return;

    const assignedIso = input.assignedDate ?? new Date().toISOString();

    // Snapshot the display fields the view renders without extra joins.
    const { data: card } = await supabaseAdmin
      .from('subscription_cards')
      .select('brand_name, plan_name')
      .eq('id', cardId)
      .maybeSingle();

    let recipientName = input.recipientName ?? null;
    if (!recipientName) {
      if (recipientType === 'talent') {
        const { data: tr } = await supabaseAdmin
          .from('subscription_card_external_recipients')
          .select('talent_name')
          .eq('card_id', cardId)
          .eq('external_user_id', recipientId)
          .maybeSingle();
        recipientName = (tr as any)?.talent_name ?? null;
      } else {
        const { data: pu } = await supabaseAdmin
          .from('users')
          .select('display_name')
          .eq('id', recipientId)
          .maybeSingle();
        recipientName = (pu as any)?.display_name ?? null;
      }
    }

    await supabaseAdmin.from('subscription_assignment_terms').insert({
      card_id: cardId,
      recipient_type: recipientType,
      recipient_id: recipientId,
      recipient_name: recipientName,
      business_name: (card as any)?.brand_name ?? null,
      subscription_name: (card as any)?.plan_name ?? null,
      assigned_date: assignedIso,
      work_start_date: assignedIso.slice(0, 10),
      status: 'active',
    });
  } catch (err) {
    console.error('[assignmentTerms] ensureActiveAssignmentTerm failed', err);
  }
}

/**
 * Close every active term for a card (records the work-end date). Mirrors the
 * admin un-assign flow. Best-effort. Used when a selection is undone / a card
 * is reopened so we don't keep billing an engagement that was reversed.
 */
export async function endActiveAssignmentTermsForCard(cardId: string): Promise<void> {
  try {
    const endIso = new Date().toISOString();
    await supabaseAdmin
      .from('subscription_assignment_terms')
      .update({
        unassigned_date: endIso,
        work_end_date: endIso.slice(0, 10),
        status: 'ended',
        updated_at: endIso,
      })
      .eq('card_id', cardId)
      .eq('status', 'active');
  } catch (err) {
    console.error('[assignmentTerms] endActiveAssignmentTermsForCard failed', err);
  }
}
