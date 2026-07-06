import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { supabaseAdmin } from '../supabase';
import {
  notifySquadhireOfSelection,
  notifySquadhireOfSelectionUndo,
  notifySquadhireOfActivation,
  notifySquadhireOfFreshBroadcast,
  notifySquadhireOfManualAssignment,
  notifySquadhireOfManualRemoval,
  buildSquadhirePayloadForCard,
  deliverCardToSquadhire,
  previewSquadhireMatches,
} from '../utils/squadhireWebhook';
import { stageSubscriptionsFromAssignedCards } from '../utils/submissionPipeline';
import { logCardEvent } from '../utils/cardEvents';
import {
  ensureActiveAssignmentTerm,
  endActiveAssignmentTermsForCard,
} from '../utils/assignmentTerms';
import { fetchTalentAvailability, fetchTalentStatuses } from '../utils/squadhireTalent';
import { loadCardBilling } from '../utils/cardBilling';
import { buildPlanSnapshot, resolvePlanIdForCard } from '../utils/cardPlanSnapshot';
import { copyCardToNewDraft } from '../utils/duplicateCard';
import { handOffSpaceToNewTalent } from '../utils/spaceTalentHandoff';
import {
  syncClientSubscriptionForCard,
  type CardActor,
  type CardLifecycleResult,
} from '../utils/clientCardLink';
import crypto from 'crypto';

const router = Router();
router.use(requireAuth);
router.use(requireAdmin);

// Day before an ISO date (YYYY-MM-DD), UTC-safe. When a change takes effect ON
// `date`, the outgoing term is billed through the day before so the boundary day
// isn't double-counted across both plans/talents.
function isoDayBefore(date: string): string {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// Future effective dates are rejected: the SquadHire-side effects (talent
// removal/assignment, notifications) apply immediately and carry no date, so a
// future-dated change would strip a talent's card while their term still runs.
// Backdating (retroactive corrections) remains allowed. IST is the reporting
// timezone, so "today" is the IST calendar day.
function isFutureEffectiveDate(date: string): boolean {
  const istToday = new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return date > istToday;
}

// Refresh the SquadHire mirror's card content (plan name / hours / price) after
// an in-place card change. The activation webhook only stamps a timestamp — the
// talent-facing fields live in the mirror's content JSONB, which only a full
// card re-delivery rewrites. Safe on assigned cards: SquadHire's ingest re-runs
// the matcher fan-out only for active broadcast cards, so this is a pure
// content refresh. Returns a warning string for the admin when delivery fails
// (there is no sweeper retry for already-synced assigned cards).
async function redeliverCardContent(cardId: string): Promise<string | null> {
  try {
    const payload = await buildSquadhirePayloadForCard(cardId);
    if (!payload) return 'SquadHire content sync skipped: card payload could not be built.';
    await deliverCardToSquadhire(cardId, payload);
    const { data: check } = await supabaseAdmin
      .from('subscription_cards')
      .select('squadhire_sync_last_error')
      .eq('id', cardId)
      .maybeSingle();
    if ((check as any)?.squadhire_sync_last_error) {
      return 'Saved, but SquadHire could not be updated — the talent may see stale plan details. Re-apply the change or check the integration.';
    }
    return null;
  } catch (err) {
    console.error('[redeliverCardContent] failed', cardId, err);
    return 'Saved, but SquadHire could not be updated — the talent may see stale plan details.';
  }
}

// Generate a unique CARD-XXXXXX code. Retries on collision.
async function generateCardCode(): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const suffix = crypto.randomBytes(4).toString('base64url').slice(0, 6).toUpperCase();
    const code = `CARD-${suffix}`;
    const { data: existing } = await supabaseAdmin
      .from('subscription_cards')
      .select('id')
      .eq('card_code', code)
      .maybeSingle();
    if (!existing) return code;
  }
  throw new Error('Failed to generate unique card code after 10 attempts');
}

// ============================================================
// POST /admin/subscription-cards/:id/assign
//
// Batch-assign multiple accepted recipients. Card transitions
// from published → assigned on first call. Subsequent calls add
// more selections (re-stamps passed_over on non-selected).
//
// Side effects on first assign (published → assigned):
//   1. Generates a unique card_code (CARD-XXXXXX)
//   2. Auto-stages subscriptions for the linked submission if any
// ============================================================
const assignSchema = z.object({
  partner_ids: z.array(z.string().uuid()).default([]),
  talent_ids: z.array(z.string().min(1)).default([]),
});

router.post('/subscription-cards/:id/assign', async (req: Request, res: Response) => {
  try {
    const parsed = assignSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0]?.message ?? 'Invalid body' });
      return;
    }
    const cardId = req.params.id as string;
    const { partner_ids, talent_ids } = parsed.data;
    const adminId = (req as any).user?.id as string;

    if (partner_ids.length === 0 && talent_ids.length === 0) {
      res.status(400).json({ success: false, error: 'At least one partner or talent must be selected' });
      return;
    }

    const { data: card, error: cardErr } = await supabaseAdmin
      .from('subscription_cards')
      .select('id, state, submission_subscription_id, card_code, paused_at')
      .eq('id', cardId)
      .maybeSingle();
    if (cardErr) { res.status(500).json({ success: false, error: cardErr.message }); return; }
    if (!card) { res.status(404).json({ success: false, error: 'Card not found' }); return; }
    if (card.state !== 'published' && card.state !== 'assigned') {
      res.status(409).json({ success: false, error: 'Card must be published or assigned' });
      return;
    }
    if ((card as any).paused_at) {
      res.status(409).json({ success: false, error: 'Subscription is paused — resume it first' });
      return;
    }

    const now = new Date().toISOString();

    // ── Partners ──
    if (partner_ids.length > 0) {
      // Stamp selected
      await supabaseAdmin
        .from('subscription_card_recipients')
        .update({ selected_at: now, selected_by: adminId, passed_over_at: null })
        .eq('card_id', cardId)
        .eq('status', 'accepted')
        .is('archived_at', null)
        .in('partner_id', partner_ids);

      // Pass over non-selected accepted partners
      await supabaseAdmin
        .from('subscription_card_recipients')
        .update({ passed_over_at: now })
        .eq('card_id', cardId)
        .eq('status', 'accepted')
        .is('archived_at', null)
        .is('selected_at', null)
        .is('passed_over_at', null);
    }

    // ── Talents (SquadHire) ──
    if (talent_ids.length > 0) {
      // Stamp selected
      await supabaseAdmin
        .from('subscription_card_external_recipients')
        .update({ selected_at: now, selected_by: adminId, passed_over_at: null })
        .eq('card_id', cardId)
        .eq('status', 'accepted')
        .is('archived_at', null)
        .in('external_user_id', talent_ids);

      // Pass over non-selected accepted talents
      await supabaseAdmin
        .from('subscription_card_external_recipients')
        .update({ passed_over_at: now })
        .eq('card_id', cardId)
        .eq('status', 'accepted')
        .is('archived_at', null)
        .is('selected_at', null)
        .is('passed_over_at', null);
    }

    // If only partners were selected, still pass over non-selected talents (and vice versa)
    if (partner_ids.length > 0 && talent_ids.length === 0) {
      await supabaseAdmin
        .from('subscription_card_external_recipients')
        .update({ passed_over_at: now })
        .eq('card_id', cardId)
        .eq('status', 'accepted')
        .is('archived_at', null)
        .is('selected_at', null)
        .is('passed_over_at', null);
    }
    if (talent_ids.length > 0 && partner_ids.length === 0) {
      await supabaseAdmin
        .from('subscription_card_recipients')
        .update({ passed_over_at: now })
        .eq('card_id', cardId)
        .eq('status', 'accepted')
        .is('archived_at', null)
        .is('selected_at', null)
        .is('passed_over_at', null);
    }

    // ── First-time assign side effects ──
    const isFirstAssign = card.state === 'published';
    if (isFirstAssign) {
      // 1. Generate unique card_code if not already set
      if (!card.card_code) {
        const code = await generateCardCode();
        card.card_code = code;
      }

      // 2. Auto-stage subscriptions for the linked submission
      const submissionSubId: string | null = card.submission_subscription_id;
      if (submissionSubId) {
        const { data: stagedSub } = await supabaseAdmin
          .from('client_submission_subscriptions')
          .select('submission_id')
          .eq('id', submissionSubId)
          .maybeSingle();

        if (stagedSub?.submission_id) {
          stageSubscriptionsFromAssignedCards(stagedSub.submission_id).catch((err) => {
            console.error('[assign] auto-stage failed', err);
          });
        }
      }
    }

    // Transition card to assigned (Selected bucket — selected_recipient_id stays null).
    // Reset admin_reviewed_at so the "NEW" badge re-opens on the Selected tab for
    // every fresh selection event (handles first-time move + re-assign after undo).
    const cardUpdate: Record<string, unknown> = { state: 'assigned', admin_reviewed_at: null };
    if (isFirstAssign) {
      cardUpdate.assigned_at = now;
      if (card.card_code) cardUpdate.card_code = card.card_code;
    }
    await supabaseAdmin
      .from('subscription_cards')
      .update(cardUpdate)
      .eq('id', cardId);

    // Notify SquadHire. Fire-and-forget.
    notifySquadhireOfSelection(cardId, talent_ids, now).catch((err) => {
      console.error('[assign] notify squadhire failed', err);
    });

    await logCardEvent({
      cardId,
      eventType: 'assigned',
      actorId: (req as any).userId ?? adminId ?? null,
      actorType: 'admin',
      actorLabel: (req as any).userName ?? null,
      metadata: {
        partner_count: partner_ids.length,
        talent_count: talent_ids.length,
        first_assign: isFirstAssign,
      },
    });

    res.json({ success: true, data: { card_code: isFirstAssign ? card.card_code : undefined } });
  } catch (err: any) {
    console.error('Assign error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

// Reset a card back to `published` and close its active assignment term.
// (Recipient rows are handled separately by the caller.)
// `effectiveDate` (YYYY-MM-DD) ends the old term on the intended date rather
// than today, so billing pro-rates at the true boundary (e.g. when reopening
// to source a replacement talent from a chosen date).
async function resetCardAndCloseTerms(cardId: string, effectiveDate?: string): Promise<void> {
  await supabaseAdmin
    .from('subscription_cards')
    .update({
      state: 'published',
      assigned_at: null,
      admin_reviewed_at: null,
      recalled_at: null,
      closed_at: null,
      // A published card can't be "paused" — clear the marker so an
      // Unassign/Reopen on a paused card doesn't strand it in a state where
      // every manage action 409s.
      paused_at: null,
      selected_recipient_type: null,
      selected_recipient_id: null,
      squadhire_activation_notified_at: null,
      squadhire_activation_notify_attempts: 0,
      squadhire_activation_notify_error: null,
    })
    .eq('id', cardId);

  // Close any active assignment term for this card (records the work end date).
  await endActiveAssignmentTermsForCard(cardId, effectiveDate);
}

// Clear the CURRENT round's selection on a card and reopen it to `published`,
// keeping the (current, non-archived) recipients so they can be re-selected.
// Used by undo-selection (Unassign).
async function resetCardSelection(cardId: string): Promise<void> {
  await supabaseAdmin
    .from('subscription_card_recipients')
    .update({ selected_at: null, selected_by: null, passed_over_at: null })
    .eq('card_id', cardId)
    .is('archived_at', null)
    .not('selected_at', 'is', null);
  await supabaseAdmin
    .from('subscription_card_recipients')
    .update({ passed_over_at: null })
    .eq('card_id', cardId)
    .is('archived_at', null)
    .not('passed_over_at', 'is', null);
  await supabaseAdmin
    .from('subscription_card_external_recipients')
    .update({ selected_at: null, selected_by: null, passed_over_at: null })
    .eq('card_id', cardId)
    .is('archived_at', null)
    .not('selected_at', 'is', null);
  await supabaseAdmin
    .from('subscription_card_external_recipients')
    .update({ passed_over_at: null })
    .eq('card_id', cardId)
    .is('archived_at', null)
    .not('passed_over_at', 'is', null);

  await resetCardAndCloseTerms(cardId);
}

// Reopen an assignment (the paused-resume "reopen" mode or the assigned "Repost"
// action) back to the Published tab WITHOUT broadcasting. Archives the current
// round, resets the card to `published` (closing the active term), releases the
// previous talent on SquadHire + the linked space, and gives the card a fresh
// not-yet-broadcast posture (broadcast distribution, mirror treated as un-synced,
// attempts 0, preview cleared) so it lands in the Published tab with the "who
// would match" preview and the admin drives Broadcast + select next.
//
// The squadhire_sync_attempts reset is load-bearing: the sync sweeper delivers a
// published broadcast card with squadhire_synced_at NULL once attempts > 0, so
// leaving the old count would auto-broadcast behind the admin's back.
// Reopen an assignment (the paused-resume "reopen" mode or the assigned "Repost"
// action) back to the New Deals section as a DRAFT — NOT straight to Published.
// Archives the current round, ends the active term (billing stops), releases the
// previous talent on SquadHire + the linked space, and gives the card a fresh
// not-yet-broadcast posture so it lands back in the **Published** tab. There it
// shows the former assignee(s) + a refreshed match preview, and the admin drives
// Broadcast-to-previous / Broadcast-to-all → select → assign (assign date = new
// start date). Shared by the paused-resume "reopen" mode.
//
// The squadhire_sync_attempts reset is load-bearing: the sweeper delivers a
// published broadcast card with squadhire_synced_at NULL once attempts > 0, so
// leaving the old count would auto-broadcast behind the admin's back.
async function reopenAssignmentToPublished(
  cardId: string,
  prev: { type: 'talent' | 'partner' | null; id: string | null },
): Promise<void> {
  const nowIso = new Date().toISOString();
  await supabaseAdmin
    .from('subscription_card_recipients')
    .update({ archived_at: nowIso })
    .eq('card_id', cardId)
    .is('archived_at', null);
  await supabaseAdmin
    .from('subscription_card_external_recipients')
    .update({ archived_at: nowIso })
    .eq('card_id', cardId)
    .is('archived_at', null);

  await resetCardAndCloseTerms(cardId); // → published; paused_at/selection cleared; active term ended

  if (prev.type === 'talent' && prev.id) {
    handOffSpaceToNewTalent({
      cardId,
      oldRecipientType: 'talent',
      oldRecipientId: prev.id,
      newRecipientType: null,
      newRecipientId: null,
    }).catch((err) => console.error('[reopen] space hand-off failed', err));
  }

  notifySquadhireOfSelectionUndo(cardId).catch((err) => {
    console.error('[reopen] notify squadhire selection-undo failed', err);
  });

  // Fresh not-yet-broadcast posture so it sits in the Published tab (needs_broadcast)
  // and the match preview recomputes. NOT delivered — Broadcast does first-delivery.
  await supabaseAdmin
    .from('subscription_cards')
    .update({
      distribution: 'broadcast',
      squadhire_synced_at: null,
      squadhire_sync_attempts: 0,
      squadhire_match_preview: null,
    })
    .eq('id', cardId);
}

// ============================================================
// POST /admin/subscription-cards/:id/undo-selection
//
// Clears all selections and reverts card to published. Works for both the
// pre-finalize "Selected" bucket and the finalized "Assigned" bucket (both have
// state='assigned') — for an assigned card this is the "Unassign" action.
// ============================================================
router.post('/subscription-cards/:id/undo-selection', async (req: Request, res: Response) => {
  try {
    const cardId = req.params.id as string;

    const { data: card, error: cardErr } = await supabaseAdmin
      .from('subscription_cards')
      .select('id, state')
      .eq('id', cardId)
      .maybeSingle();
    if (cardErr) { res.status(500).json({ success: false, error: cardErr.message }); return; }
    if (!card) { res.status(404).json({ success: false, error: 'Card not found' }); return; }
    if (card.state !== 'assigned') {
      res.status(409).json({ success: false, error: 'Card is not assigned' });
      return;
    }

    await resetCardSelection(cardId);

    notifySquadhireOfSelectionUndo(cardId).catch((err) => {
      console.error('[undo-selection] notify squadhire failed', err);
    });

    res.json({ success: true });
  } catch (err: any) {
    console.error('Undo selection error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

// ============================================================
// POST /admin/subscription-cards/:id/finalize-selection
//
// Admin reviews a card sitting in the "Selected" bucket (state='assigned'
// with no selected_recipient_id yet) and finalizes the selection. This
// stamps selected_recipient_id + selected_recipient_type — the card moves
// to the "Assigned" bucket — and notifies SquadHire so the talent's
// "My Clients" tab flips from Selected (waiting admin approval) → Assigned.
// ============================================================
router.post('/subscription-cards/:id/finalize-selection', async (req: Request, res: Response) => {
  try {
    const cardId = req.params.id as string;

    const { data: card, error: cardErr } = await supabaseAdmin
      .from('subscription_cards')
      .select('id, state, selected_recipient_id')
      .eq('id', cardId)
      .maybeSingle();
    if (cardErr) { res.status(500).json({ success: false, error: cardErr.message }); return; }
    if (!card) { res.status(404).json({ success: false, error: 'Card not found' }); return; }
    if (card.state !== 'assigned') {
      res.status(409).json({ success: false, error: 'Card is not in selected state' });
      return;
    }
    if (card.selected_recipient_id) {
      res.status(409).json({ success: false, error: 'Card is already assigned' });
      return;
    }

    // Prefer external (talent) recipient since SquadHire is the common path.
    const { data: talentRows, error: talentErr } = await supabaseAdmin
      .from('subscription_card_external_recipients')
      .select('external_user_id, selected_at')
      .eq('card_id', cardId)
      .is('archived_at', null)
      .not('selected_at', 'is', null)
      .order('selected_at', { ascending: false })
      .limit(1);
    if (talentErr) { res.status(500).json({ success: false, error: talentErr.message }); return; }

    let recipientType: 'talent' | 'partner' | null = null;
    let recipientId: string | null = null;
    if (talentRows && talentRows.length > 0) {
      recipientType = 'talent';
      recipientId = (talentRows[0] as any).external_user_id;
    } else {
      const { data: partnerRows, error: partnerErr } = await supabaseAdmin
        .from('subscription_card_recipients')
        .select('partner_id, selected_at')
        .eq('card_id', cardId)
        .is('archived_at', null)
        .not('selected_at', 'is', null)
        .order('selected_at', { ascending: false })
        .limit(1);
      if (partnerErr) { res.status(500).json({ success: false, error: partnerErr.message }); return; }
      if (partnerRows && partnerRows.length > 0) {
        recipientType = 'partner';
        recipientId = (partnerRows[0] as any).partner_id;
      }
    }

    if (!recipientType || !recipientId) {
      res.status(409).json({ success: false, error: 'No selected recipient found to finalize' });
      return;
    }

    const { error: updErr } = await supabaseAdmin
      .from('subscription_cards')
      .update({
        selected_recipient_type: recipientType,
        selected_recipient_id: recipientId,
      })
      .eq('id', cardId);
    if (updErr) { res.status(500).json({ success: false, error: updErr.message }); return; }

    // Record the assignment term. Routed through the shared helper so the term
    // captures its frozen plan/price snapshot (migration 152). Best-effort: the
    // assignment itself already succeeded.
    await ensureActiveAssignmentTerm({ cardId, recipientType, recipientId });

    notifySquadhireOfActivation(cardId).catch((err) => {
      console.error('[finalize] notify squadhire failed', err);
    });

    res.json({ success: true });
  } catch (err: any) {
    console.error('Finalize selection error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

// ============================================================
// POST /admin/subscription-cards/:id/reopen-for-new-talents
//
// Reopen the card to a fresh round: ARCHIVE the current round's recipients
// (kept for history, hidden from the current view), reset the card to
// `published`, and notify SquadHire to clear its selection. Does NOT broadcast —
// the admin triggers that separately via /broadcast.
// ============================================================
const reopenSchema = z.object({
  effective_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

router.post('/subscription-cards/:id/reopen-for-new-talents', async (req: Request, res: Response) => {
  try {
    const cardId = req.params.id as string;
    const parsed = reopenSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0]?.message ?? 'Invalid body' });
      return;
    }
    const effectiveDate = parsed.data.effective_date;
    if (effectiveDate && isFutureEffectiveDate(effectiveDate)) {
      res.status(400).json({ success: false, error: 'Effective date cannot be in the future — the talent-side switch applies immediately.' });
      return;
    }

    const { data: card, error: cardErr } = await supabaseAdmin
      .from('subscription_cards')
      .select('id, state, selected_recipient_type, selected_recipient_id')
      .eq('id', cardId)
      .maybeSingle();
    if (cardErr) { res.status(500).json({ success: false, error: cardErr.message }); return; }
    if (!card) { res.status(404).json({ success: false, error: 'Card not found' }); return; }
    if (card.state === 'closed') {
      res.status(409).json({ success: false, error: 'Card is closed' });
      return;
    }

    // Archive the current round's recipients (kept for history; dropped from the
    // current view via the archived_at IS NULL filter on the list + selection).
    const archivedAt = new Date().toISOString();
    await supabaseAdmin
      .from('subscription_card_recipients')
      .update({ archived_at: archivedAt })
      .eq('card_id', cardId)
      .is('archived_at', null);
    await supabaseAdmin
      .from('subscription_card_external_recipients')
      .update({ archived_at: archivedAt })
      .eq('card_id', cardId)
      .is('archived_at', null);

    await resetCardAndCloseTerms(cardId, effectiveDate);

    // Hand the linked space off from the outgoing talent: repoint auto-assign,
    // move open tasks, and revoke access, so work stops routing to them while a
    // replacement is sourced. Best-effort.
    if (card.selected_recipient_type === 'talent' && card.selected_recipient_id) {
      handOffSpaceToNewTalent({
        cardId,
        oldRecipientType: 'talent',
        oldRecipientId: card.selected_recipient_id,
        newRecipientType: null,
        newRecipientId: null,
      }).catch((err) => console.error('[reopen] space hand-off failed', err));
    }

    // Clear the talent's selection on SquadHire (drops the card from My Clients).
    notifySquadhireOfSelectionUndo(cardId).catch((err) => {
      console.error('[reopen] notify squadhire selection-undo failed', err);
    });

    res.json({ success: true });
  } catch (err: any) {
    console.error('Reopen for new talents error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

// ============================================================
// POST /admin/subscription-cards/:id/offer-previous-talent
//
// "Broadcast to previous talent" on a reopened, re-published card: send a fresh
// PENDING offer to the card's most-recent former assignee (from the ENDED
// assignment terms). They must accept before billing resumes (finalized via the
// normal accept flow). A previous PARTNER isn't on SquadHire, so they're
// re-assigned directly (billing today). Card must be `published`, unassigned.
// ============================================================
router.post('/subscription-cards/:id/offer-previous-talent', async (req: Request, res: Response) => {
  try {
    const cardId = req.params.id as string;
    const { data: card, error: cardErr } = await supabaseAdmin
      .from('subscription_cards')
      .select('id, state, paused_at, selected_recipient_id')
      .eq('id', cardId)
      .maybeSingle();
    if (cardErr) { res.status(500).json({ success: false, error: cardErr.message }); return; }
    if (!card) { res.status(404).json({ success: false, error: 'Card not found' }); return; }
    if (card.paused_at) { res.status(409).json({ success: false, error: 'Subscription is paused — resume it first' }); return; }
    if (card.state !== 'published') { res.status(409).json({ success: false, error: 'Publish the card first, then broadcast' }); return; }
    if (card.selected_recipient_id) { res.status(409).json({ success: false, error: 'Card is already assigned' }); return; }

    // Most-recent former assignee (the "previous talent") from the ended terms.
    const { data: term } = await supabaseAdmin
      .from('subscription_assignment_terms')
      .select('recipient_type, recipient_id, recipient_name')
      .eq('card_id', cardId)
      .eq('status', 'ended')
      .order('assigned_date', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!term) { res.status(409).json({ success: false, error: 'No previous talent on record — broadcast to all instead' }); return; }

    const rType = (term as any).recipient_type as 'talent' | 'partner';
    const rId = (term as any).recipient_id as string;
    const rName = (term as any).recipient_name as string | null;
    const nowIso = new Date().toISOString();
    const todayIst = new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const warnings: string[] = [];

    if (rType === 'partner') {
      // Partners aren't on SquadHire — re-assign directly (billing today).
      await supabaseAdmin
        .from('subscription_card_recipients')
        .upsert(
          {
            card_id: cardId,
            partner_id: rId,
            status: 'accepted',
            assigned_manually: true,
            selected_at: nowIso,
            selected_by: (req as any).user?.id ?? null,
            passed_over_at: null,
            archived_at: null,
          },
          { onConflict: 'card_id,partner_id' },
        );
      await supabaseAdmin
        .from('subscription_cards')
        .update({ state: 'assigned', assigned_at: nowIso, admin_reviewed_at: null, selected_recipient_type: 'partner', selected_recipient_id: rId })
        .eq('id', cardId);
      await ensureActiveAssignmentTerm({ cardId, recipientType: 'partner', recipientId: rId, recipientName: rName, assignedDate: todayIst });
      handOffSpaceToNewTalent({ cardId, oldRecipientType: null, oldRecipientId: null, newRecipientType: 'partner', newRecipientId: rId })
        .catch((err) => console.error('[offer-previous-talent] space hand-off failed', err));
    } else {
      // Single hand-picked offer to the previous talent — manual distribution.
      const { data: prevRow } = await supabaseAdmin
        .from('subscription_card_external_recipients')
        .select('id, talent_name, email')
        .eq('card_id', cardId)
        .eq('external_user_id', rId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      await supabaseAdmin.from('subscription_cards').update({ distribution: 'manual' }).eq('id', cardId);

      // Revive-or-insert a fresh PENDING offer (never a bare insert — the prior
      // archived row would collide on the external-recipient unique key).
      const offer = {
        status: 'pending' as const,
        responded_at: null,
        assigned_manually: true,
        selected_at: null,
        selected_by: null,
        passed_over_at: null,
        archived_at: null,
        notified_at: nowIso,
        squadhire_notified_at: null,
        squadhire_notify_attempts: 0,
        squadhire_notify_error: null,
        talent_name: (prevRow as any)?.talent_name ?? rName ?? null,
        email: (prevRow as any)?.email ?? null,
      };
      let offerRowId: string | undefined;
      if ((prevRow as any)?.id) {
        await supabaseAdmin.from('subscription_card_external_recipients').update(offer).eq('id', (prevRow as any).id);
        offerRowId = (prevRow as any).id;
      } else {
        const { data: inserted } = await supabaseAdmin
          .from('subscription_card_external_recipients')
          .insert({ card_id: cardId, external_system: 'squadhire', external_recipient_id: rId, external_user_id: rId, ...offer })
          .select('id')
          .maybeSingle();
        offerRowId = (inserted as any)?.id;
      }

      // Deliver the card to SquadHire so the offer is visible, then notify.
      const payload = await buildSquadhirePayloadForCard(cardId);
      if (payload) await deliverCardToSquadhire(cardId, payload);
      const outcome = await notifySquadhireOfManualAssignment(cardId, rId, offerRowId);
      if (!outcome.delivered) {
        warnings.push('Offered to the previous talent, but SquadHire was not notified — they may not see the offer yet. The system will retry automatically.');
      }
    }

    logCardEvent({
      cardId,
      eventType: 'broadcast',
      actorId: (req as any).user?.id ?? null,
      actorType: 'admin',
      actorLabel: (req as any).userName ?? null,
      metadata: { to_previous_talent: true, recipient_type: rType, recipient_id: rId },
    });

    res.json({ success: true, ...(warnings.length ? { warning: warnings.join(' ') } : {}) });
  } catch (err: any) {
    console.error('Offer previous talent error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

// ============================================================
// POST /admin/subscription-cards/:id/rebroadcast
//
// Broadcast a reopened published card to a FRESH pool of talents: signals
// SquadHire to wipe the prior round and re-fan-out to the full matching pool.
// Named /rebroadcast (NOT /broadcast) to avoid colliding with the requests
// router's /broadcast, which upgrades a manual card to broadcast distribution.
// ============================================================
router.post('/subscription-cards/:id/rebroadcast', async (req: Request, res: Response) => {
  try {
    const cardId = req.params.id as string;

    const { data: card, error: cardErr } = await supabaseAdmin
      .from('subscription_cards')
      .select('id, state, distribution, squadhire_synced_at')
      .eq('id', cardId)
      .maybeSingle();
    if (cardErr) { res.status(500).json({ success: false, error: cardErr.message }); return; }
    if (!card) { res.status(404).json({ success: false, error: 'Card not found' }); return; }
    if (card.state !== 'published') {
      res.status(409).json({ success: false, error: 'Card must be published to broadcast' });
      return;
    }

    // Rebroadcasting IS a broadcast: the pool gets notified immediately. A
    // soft-published (manual) card therefore graduates to broadcast
    // distribution here — otherwise the recipients view keeps mislabeling the
    // already-notified pool as "queued — not broadcast yet", and (for a
    // never-synced card) the ingest would skip the fan-out entirely. Same
    // upgrade the requests router's /broadcast performs. Done BEFORE payload
    // build so the delivered card carries distribution='broadcast'.
    if ((card as any).distribution === 'manual') {
      await supabaseAdmin
        .from('subscription_cards')
        .update({ distribution: 'broadcast' })
        .eq('id', cardId);
    }

    if (!card.squadhire_synced_at) {
      // First broadcast. Under the New Deal lifecycle, publish no longer
      // auto-delivers to SquadHire (the sweeper is gated to wait for this
      // action), so the card isn't there yet — deliver it now. The ingest
      // matches talents on first arrival, so this IS the broadcast. A fresh
      // re-fan-out would no-op on a card SquadHire doesn't have yet.
      // Fire-and-forget: the sync sweeper retries if this attempt fails
      // (attempts > 0 after the try, so the gate lets it through).
      buildSquadhirePayloadForCard(cardId)
        .then((payload) => payload && deliverCardToSquadhire(cardId, payload))
        .catch((err) => console.error('[broadcast] squadhire first-delivery failed', err));
    } else {
      // Already on SquadHire (re-broadcast / fresh round after a reopen): wipe
      // the prior round and re-fan-out to the full matching pool. Fire-and-forget.
      notifySquadhireOfFreshBroadcast(cardId).catch((err) => {
        console.error('[broadcast] notify squadhire fresh-broadcast failed', err);
      });
    }

    res.json({ success: true });
  } catch (err: any) {
    console.error('Broadcast error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

// ============================================================
// GET /admin/subscription-cards/:id/plan-options
//
// Plans the card can be switched to (upgrade/downgrade): every plan under the
// same subscription as the card's current plan, plus the current plan_id so the
// UI can mark it. Powers the "Change plan" picker.
// ============================================================
router.get('/subscription-cards/:id/plan-options', async (req: Request, res: Response) => {
  try {
    const cardId = req.params.id as string;
    const { data: card, error: cardErr } = await supabaseAdmin
      .from('subscription_cards')
      .select('id, submission_subscription_id, service_type, plan_name, target_tiers, plan_snapshot')
      .eq('id', cardId)
      .maybeSingle();
    if (cardErr) { res.status(500).json({ success: false, error: cardErr.message }); return; }
    if (!card) { res.status(404).json({ success: false, error: 'Card not found' }); return; }

    let currentPlanId: string | null = (card.plan_snapshot as any)?.plan?.id ?? null;
    if (!currentPlanId) currentPlanId = await resolvePlanIdForCard(card);

    let subscriptionId: string | null = null;
    if (currentPlanId) {
      const { data: plan } = await supabaseAdmin
        .from('subscription_plans')
        .select('subscription_id')
        .eq('id', currentPlanId)
        .maybeSingle();
      subscriptionId = (plan as any)?.subscription_id ?? null;
    }

    let plans: any[] = [];
    if (subscriptionId) {
      const { data } = await supabaseAdmin
        .from('subscription_plans')
        .select('id, plan, tier, daily_hours, weekly_hours')
        .eq('subscription_id', subscriptionId)
        .order('plan', { ascending: true })
        .order('tier', { ascending: true });
      plans = data ?? [];
    }

    res.json({ success: true, data: { current_plan_id: currentPlanId, plans } });
  } catch (err: any) {
    console.error('Plan options error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

// ============================================================
// POST /admin/subscription-cards/:id/upgrade-downgrade
//
// Upgrade/downgrade a LIVE assignment via the new-card model: SOFT-CANCEL the
// current card (state=closed, cancel_type='soft', terms ended, talent released)
// and create a NEW draft in New Deals carrying the NEW plan + the same details.
// The new card SUPERSEDES the old (chained so Reports + assignment-history stay
// continuous across the change) and inherits the linked space + subscription
// link. It shows the former assignees, so the admin can broadcast to them / new
// recipients / everyone and re-assign on the new plan (billing starts fresh then).
// ============================================================
const upgradeDowngradeSchema = z.object({
  plan_id: z.string().uuid(),
  subscription_price: z.number().int().nonnegative().nullable().optional(),
  markup: z.number().int().nullable().optional(),
  partner_price_override: z.number().int().nullable().optional(),
});

router.post('/subscription-cards/:id/upgrade-downgrade', async (req: Request, res: Response) => {
  try {
    const cardId = req.params.id as string;
    const parsed = upgradeDowngradeSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0]?.message ?? 'Invalid body' });
      return;
    }
    const { plan_id } = parsed.data;

    const { data: card, error: cardErr } = await supabaseAdmin
      .from('subscription_cards')
      .select('id, state, paused_at, selected_recipient_type, selected_recipient_id, linked_folder_id, submission_subscription_id')
      .eq('id', cardId)
      .maybeSingle();
    if (cardErr) { res.status(500).json({ success: false, error: cardErr.message }); return; }
    if (!card) { res.status(404).json({ success: false, error: 'Card not found' }); return; }
    if (card.paused_at) { res.status(409).json({ success: false, error: 'Subscription is paused — resume it first' }); return; }
    if (card.state !== 'assigned' || !card.selected_recipient_id) {
      res.status(409).json({ success: false, error: 'Card is not an active assignment' });
      return;
    }

    const snapshot = await buildPlanSnapshot(plan_id);
    if (!snapshot) { res.status(400).json({ success: false, error: 'Plan not found' }); return; }

    const actorId = (req as any).user?.id ?? null;
    const nowIso = new Date().toISOString();
    const oldFolderId = (card as any).linked_folder_id as string | null;
    const oldSubSubId = (card as any).submission_subscription_id as string | null;
    const oldType = card.selected_recipient_type as 'talent' | 'partner' | null;
    const oldId = card.selected_recipient_id as string | null;
    const warnings: string[] = [];

    // 1. End the old plan's billing terms (records the work end date).
    await endActiveAssignmentTermsForCard(cardId);

    // 2. Release the previous recipient from the linked space (both talent AND
    //    partner) while the folder is still attached — awaited, before detach.
    //    The SquadHire removal is talent-only (partners aren't on SquadHire).
    if (oldType && oldId) {
      if (oldType === 'talent') {
        const removal = await notifySquadhireOfManualRemoval(cardId, oldId, { notify: true });
        if (!removal.delivered) {
          warnings.push('SquadHire could not release the previous talent — reconcile it there too.');
        }
      }
      await handOffSpaceToNewTalent({
        cardId,
        oldRecipientType: oldType,
        oldRecipientId: oldId,
        newRecipientType: null,
        newRecipientId: null,
      }).catch((err) => console.error('[upgrade-downgrade] space hand-off failed', err));
    }

    // 3. Soft-cancel the old card and DETACH its unique links (submission +
    //    folder) so they can move to the new card without violating the 1:1 keys.
    await supabaseAdmin
      .from('subscription_cards')
      .update({
        state: 'closed',
        cancelled_at: nowIso,
        closed_at: nowIso,
        cancel_type: 'soft',
        paused_at: null,
        linked_folder_id: null,
        linked_at: null,
        submission_subscription_id: null,
      })
      .eq('id', cardId);

    // 4. Create the new draft on the NEW plan, superseding the old and inheriting
    //    its space + subscription link. It carries the same details (copied) and,
    //    via supersedes_card_id, the old card's former-assignee + billing history.
    const result = await copyCardToNewDraft(
      cardId,
      {
        plan_snapshot: snapshot,
        plan_name: snapshot.plan.plan ?? null,
        markup: parsed.data.markup ?? null,
        partner_price_override: parsed.data.partner_price_override ?? null,
        ...('subscription_price' in parsed.data ? { subscription_price: parsed.data.subscription_price ?? null } : {}),
        supersedes_card_id: cardId,
        linked_folder_id: oldFolderId,
        linked_at: oldFolderId ? nowIso : null,
        submission_subscription_id: oldSubSubId,
      },
      actorId,
    );
    if ('error' in result) { res.status(500).json({ success: false, error: result.error }); return; }

    // 5. The client's subscription continues on the new card (best-effort sync).
    await syncClientSubscriptionForCard(result.id, { status: 'active' }).catch((err) =>
      console.error('[upgrade-downgrade] client subscription sync failed', err),
    );

    // 6. Audit both ends of the swap.
    logCardEvent({
      cardId,
      eventType: 'cancelled',
      actorId,
      actorType: 'admin',
      actorLabel: (req as any).userName ?? null,
      metadata: { cancel_type: 'soft', superseded_by: result.id, reason: 'plan_change' },
    });
    logCardEvent({
      cardId: result.id,
      eventType: 'plan_changed',
      actorId,
      actorType: 'admin',
      actorLabel: (req as any).userName ?? null,
      metadata: { supersedes: cardId, plan_id, plan: snapshot.plan.plan, tier: snapshot.plan.tier, new_card: true },
    });

    res.json({ success: true, data: { id: result.id }, ...(warnings.length ? { warning: warnings.join(' ') } : {}) });
  } catch (err: any) {
    console.error('Upgrade/downgrade error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

// ============================================================
// POST /admin/subscription-cards/:id/pause
//
// Pause a LIVE assignment: billing stops that day (the active term ends the
// day before, so the pause day itself is not billed), the talent's SquadHire
// My Clients card is retired with an "assignment updated" push, and the card
// keeps state='assigned' + selected_recipient_* as the "previous talent"
// memory the resume flow offers to re-assign. Reports/elapsed-time follow
// automatically: no active term covering a day → 0 committed target.
// ============================================================
export async function pauseCardCore(cardId: string, actor: CardActor): Promise<CardLifecycleResult> {
  try {
    const { data: card, error: cardErr } = await supabaseAdmin
      .from('subscription_cards')
      .select('id, state, paused_at, selected_recipient_type, selected_recipient_id')
      .eq('id', cardId)
      .maybeSingle();
    if (cardErr) return { httpStatus: 500, body: { success: false, error: cardErr.message } };
    if (!card) return { httpStatus: 404, body: { success: false, error: 'Card not found' } };
    if (card.state !== 'assigned' || !card.selected_recipient_id) {
      return { httpStatus: 409, body: { success: false, error: 'Card is not an active assignment' } };
    }
    if (card.paused_at) {
      return { httpStatus: 409, body: { success: false, error: 'Subscription is already paused' } };
    }

    const nowIso = new Date().toISOString();
    const todayIst = new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);

    // 1. Billing stops today: the term ends the day before, same boundary
    //    convention as change-plan/change-talent (no partial-day billing).
    await endActiveAssignmentTermsForCard(cardId, isoDayBefore(todayIst));

    // 1b. The pause day is unbilled, so the cron's auto-elapsed rows for today
    //     (12:01/15:00 checkpoints that may have already run) must not stand.
    //     Manual overrides are kept.
    const { data: linkRow } = await supabaseAdmin
      .from('subscription_cards')
      .select('linked_folder_id')
      .eq('id', cardId)
      .maybeSingle();
    if ((linkRow as any)?.linked_folder_id) {
      await supabaseAdmin
        .from('elapsed_time_entries')
        .delete()
        .eq('folder_id', (linkRow as any).linked_folder_id)
        .eq('date', todayIst)
        .eq('source', 'auto');
    }

    // 2. Mark paused. selected_recipient_* stays — it's the resume memory.
    const { error: updErr } = await supabaseAdmin
      .from('subscription_cards')
      .update({ paused_at: nowIso })
      .eq('id', cardId);
    if (updErr) return { httpStatus: 500, body: { success: false, error: updErr.message } };

    // 3. Retire the talent's local recipient row for this round (audit kept,
    //    sweeper can't ghost-retry it) and their SquadHire mirror, with a push.
    const warnings: string[] = [];
    if (card.selected_recipient_type === 'talent' && card.selected_recipient_id) {
      await supabaseAdmin
        .from('subscription_card_external_recipients')
        .update({ archived_at: nowIso })
        .eq('card_id', cardId)
        .eq('external_user_id', card.selected_recipient_id)
        .is('archived_at', null);
      const removal = await notifySquadhireOfManualRemoval(cardId, card.selected_recipient_id, { notify: true });
      if (!removal.delivered) {
        // A re-POST of /pause would 409 (already paused), so don't suggest it.
        warnings.push('Paused, but SquadHire could not be updated — the talent may still see this client. Check the integration; resuming and pausing again will retry.');
      }
    }

    // Mirror onto the linked Clients-module subscription (best-effort).
    await syncClientSubscriptionForCard(cardId, { status: 'paused' });

    logCardEvent({
      cardId,
      eventType: 'paused',
      actorId: actor.userId,
      actorType: 'admin',
      actorLabel: actor.userName ?? null,
      metadata: { recipient_type: card.selected_recipient_type, recipient_id: card.selected_recipient_id },
    });

    return { httpStatus: 200, body: { success: true, ...(warnings.length ? { warning: warnings.join(' ') } : {}) } };
  } catch (err: any) {
    console.error('Pause subscription error:', err);
    return { httpStatus: 500, body: { success: false, error: err?.message || 'Internal server error' } };
  }
}

router.post('/subscription-cards/:id/pause', async (req: Request, res: Response) => {
  const result = await pauseCardCore(req.params.id as string, {
    userId: (req as any).user?.id ?? null,
    userName: (req as any).userName ?? null,
  });
  res.status(result.httpStatus).json(result.body);
});

// ============================================================
// GET /admin/subscription-cards/:id/previous-talent-availability
//
// Resume helper: is the previously-assigned talent free to take the work
// back? Returns their SquadHire self-declared weekly hours plus the committed
// hours across their OTHER active assignment terms, so the admin can decide
// between re-assigning them and rebroadcasting.
// ============================================================
router.get('/subscription-cards/:id/previous-talent-availability', async (req: Request, res: Response) => {
  try {
    const cardId = req.params.id as string;
    const { data: card } = await supabaseAdmin
      .from('subscription_cards')
      .select('id, paused_at, selected_recipient_type, selected_recipient_id')
      .eq('id', cardId)
      .maybeSingle();
    if (!card) { res.status(404).json({ success: false, error: 'Card not found' }); return; }
    if (!card.selected_recipient_id) {
      res.json({ success: true, data: { has_previous_talent: false } });
      return;
    }

    // Partner recipients aren't on SquadHire, so there's no availability to
    // fetch — but they ARE a valid previous recipient the resume flow can
    // re-assign. Return their name so the modal offers the same-recipient path.
    if (card.selected_recipient_type === 'partner') {
      const { data: pu } = await supabaseAdmin
        .from('users')
        .select('display_name')
        .eq('id', card.selected_recipient_id)
        .maybeSingle();
      res.json({
        success: true,
        data: {
          has_previous_talent: true,
          recipient_type: 'partner',
          talent_id: card.selected_recipient_id,
          talent_name: (pu as any)?.display_name ?? null,
          available_weekly_hours: null,
          committed_weekly_hours: 0,
          free_weekly_hours: null,
          active_other_cards: 0,
        },
      });
      return;
    }
    const talentId = card.selected_recipient_id as string;

    // Display name from the (archived) recipient row of this card.
    const { data: rec } = await supabaseAdmin
      .from('subscription_card_external_recipients')
      .select('talent_name')
      .eq('card_id', cardId)
      .eq('external_user_id', talentId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    // Committed hours from their still-active terms on OTHER cards.
    const { data: terms } = await supabaseAdmin
      .from('subscription_assignment_terms')
      .select('card_id')
      .eq('recipient_type', 'talent')
      .eq('recipient_id', talentId)
      .eq('status', 'active');
    const otherCardIds = [...new Set((terms || []).map((t: any) => t.card_id).filter((id: string) => id !== cardId))];
    let committedWeekly = 0;
    if (otherCardIds.length) {
      const billing = await loadCardBilling(otherCardIds);
      for (const b of billing.values()) {
        if (b.weekly_hours != null) committedWeekly += b.weekly_hours;
      }
    }

    const availability = await fetchTalentAvailability([talentId]);
    const avail = availability.get(talentId);

    res.json({
      success: true,
      data: {
        has_previous_talent: true,
        recipient_type: 'talent',
        talent_id: talentId,
        talent_name: (rec as any)?.talent_name ?? null,
        available_weekly_hours: avail?.weekly_hours ?? null,
        committed_weekly_hours: Math.round(committedWeekly * 100) / 100,
        free_weekly_hours:
          avail?.weekly_hours != null
            ? Math.round((avail.weekly_hours - committedWeekly) * 100) / 100
            : null,
        active_other_cards: otherCardIds.length,
      },
    });
  } catch (err: any) {
    console.error('Previous talent availability error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

// ============================================================
// GET /admin/subscription-cards/:id/assignment-history
//
// Former assignees of this card, newest first, sourced from the ENDED
// assignment terms (subscription_assignment_terms.status='ended'). The current
// active assignee is excluded on purpose — it's shown in the "Selected" card
// above, and its term is still 'active'. The most-recent ended term is the
// "previous assignee"; older ones are "past assignees". Deduped by recipient
// so someone who held the card across non-contiguous stints appears once (their
// most-recent stint's dates win). Talents are enriched with their current
// SquadHire standing (active/inactive/suspended, or not_found if they've left);
// partners have no SquadHire status. Soft-degrades: if SquadHire is unreachable
// the rows still return with squadhire_status=null.
// ============================================================
router.get('/subscription-cards/:id/assignment-history', async (req: Request, res: Response) => {
  try {
    const cardId = req.params.id as string;
    const { data: card } = await supabaseAdmin
      .from('subscription_cards')
      .select('id, supersedes_card_id')
      .eq('id', cardId)
      .maybeSingle();
    if (!card) { res.status(404).json({ success: false, error: 'Card not found' }); return; }

    // Walk the supersedes chain so an upgraded/downgraded card shows the former
    // assignees from the card(s) it replaced too (e.g. all four past designers).
    const chainIds: string[] = [cardId];
    let cursor = (card as any).supersedes_card_id as string | null;
    for (let hops = 0; cursor && hops < 25; hops++) {
      if (chainIds.includes(cursor)) break;
      chainIds.push(cursor);
      const { data: prev } = await supabaseAdmin
        .from('subscription_cards')
        .select('supersedes_card_id')
        .eq('id', cursor)
        .maybeSingle();
      cursor = (prev as any)?.supersedes_card_id ?? null;
    }

    const { data: terms } = await supabaseAdmin
      .from('subscription_assignment_terms')
      .select('recipient_type, recipient_id, recipient_name, assigned_date, unassigned_date, work_start_date, work_end_date')
      .in('card_id', chainIds)
      .eq('status', 'ended')
      .order('assigned_date', { ascending: false });

    // Dedupe by recipient — newest stint wins (rows are already newest-first).
    const seen = new Set<string>();
    type Entry = {
      recipient_type: 'talent' | 'partner';
      recipient_id: string;
      recipient_name: string | null;
      assigned_date: string | null;
      unassigned_date: string | null;
      work_start_date: string | null;
      work_end_date: string | null;
    };
    const entries: Entry[] = [];
    for (const t of (terms || []) as any[]) {
      const key = `${t.recipient_type}:${t.recipient_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push({
        recipient_type: t.recipient_type,
        recipient_id: t.recipient_id,
        recipient_name: t.recipient_name ?? null,
        assigned_date: t.assigned_date ?? null,
        unassigned_date: t.unassigned_date ?? null,
        work_start_date: t.work_start_date ?? null,
        work_end_date: t.work_end_date ?? null,
      });
    }

    // Enrich talents with SquadHire account standing (graceful-degrade to null).
    const talentIds = entries.filter((e) => e.recipient_type === 'talent').map((e) => e.recipient_id);
    const statuses = talentIds.length ? await fetchTalentStatuses(talentIds) : new Map();
    const enriched = entries.map((e) => {
      const st = e.recipient_type === 'talent' ? statuses.get(e.recipient_id) : undefined;
      return {
        ...e,
        squadhire_status: st ? st.status_tag : null,
        suspended_reason: st ? st.suspended_reason : null,
        blacklisted_reason: st ? st.blacklisted_reason : null,
      };
    });

    const [previous = null, ...past] = enriched;
    res.json({ success: true, data: { previous, past } });
  } catch (err: any) {
    console.error('Assignment history error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

// ============================================================
// GET /admin/subscription-cards/:id/match-pool
//
// The "who else is available" pool for the resume flow. Unlike the published
// match-preview (which only computes for state='published' cards), this runs
// the matcher for ANY card — including a paused one — so the resume UI can show
// who a rebroadcast would reach before the admin commits. Read-only; never
// writes recipients. Soft-fails to an empty pool when SquadHire is unreachable
// so the modal still works.
// ============================================================
router.get('/subscription-cards/:id/match-pool', async (req: Request, res: Response) => {
  try {
    const cardId = req.params.id as string;
    const preview = await previewSquadhireMatches(cardId);
    res.json({ success: true, data: { count: preview.count, talents: preview.talents } });
  } catch (err: any) {
    console.error('Match pool preview error:', err);
    res.json({ success: true, data: { count: 0, talents: [] }, note: err?.message || 'Failed to reach SquadHire' });
  }
});

// ============================================================
// POST /admin/subscription-cards/:id/resume
//
// Restart a paused subscription. Modes:
//   same_talent — re-assign the previous talent: fresh term from today,
//                 SquadHire direct-assign (back into My Clients), content
//                 re-delivery. Billing resumes today.
//   rebroadcast — no previous talent (or they're busy): archive the old
//                 round, reopen the card to `published`, and re-fan-out to
//                 the matching pool. Billing stays stopped until a new talent
//                 is finalized (the sourcing gap is unbilled by design).
//   reopen      — like rebroadcast but WITHOUT the fan-out: archive the old
//                 round and reset to `published` with a fresh not-yet-broadcast
//                 posture, so the card lands back in the Published tab (former
//                 assignees + "who would match" preview) and the admin drives
//                 Broadcast + selection through the normal flow.
// ============================================================
const resumeSchema = z.object({
  mode: z.enum(['same_talent', 'same_talent_offer', 'rebroadcast', 'reopen']),
});

export async function resumeCardCore(
  cardId: string,
  mode: 'same_talent' | 'same_talent_offer' | 'rebroadcast' | 'reopen',
  actor: CardActor,
): Promise<CardLifecycleResult> {
  try {
    const { data: card, error: cardErr } = await supabaseAdmin
      .from('subscription_cards')
      .select('id, state, paused_at, selected_recipient_type, selected_recipient_id')
      .eq('id', cardId)
      .maybeSingle();
    if (cardErr) return { httpStatus: 500, body: { success: false, error: cardErr.message } };
    if (!card) return { httpStatus: 404, body: { success: false, error: 'Card not found' } };
    if (!card.paused_at) {
      return { httpStatus: 409, body: { success: false, error: 'Subscription is not paused' } };
    }
    // A paused card is always state='assigned'; anything else means it was
    // closed/cancelled by another flow while paused — resuming would revive a
    // dead card and open a billing term nothing else knows about.
    if (card.state !== 'assigned') {
      return { httpStatus: 409, body: { success: false, error: 'Card is no longer an active assignment — it cannot be resumed' } };
    }

    const nowIso = new Date().toISOString();
    const todayIst = new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const warnings: string[] = [];

    // Conditional un-pause: exactly ONE resume wins. A concurrent double-click
    // would otherwise run the whole flow twice (double webhooks; the partial
    // unique index on active terms is the DB backstop for double-billing).
    const { data: unpaused } = await supabaseAdmin
      .from('subscription_cards')
      .update({ paused_at: null })
      .eq('id', cardId)
      .not('paused_at', 'is', null)
      .select('id');
    if (!unpaused || unpaused.length === 0) {
      return { httpStatus: 409, body: { success: false, error: 'Subscription is not paused' } };
    }

    if (mode === 'same_talent') {
      const rType = card.selected_recipient_type as 'talent' | 'partner' | null;
      const rId = card.selected_recipient_id as string | null;
      if (!rType || !rId) {
        // Nothing external happened yet — restore the pause before bailing.
        await supabaseAdmin.from('subscription_cards').update({ paused_at: card.paused_at }).eq('id', cardId);
        return { httpStatus: 409, body: { success: false, error: 'No previous recipient on this card — use rebroadcast instead' } };
      }

      if (rType === 'talent') {
        // Revive the row pause archived. Looked up by (card, external_user_id)
        // — NOT upserted on the (card, external_system, external_recipient_id)
        // key: broadcast-accept rows store the SquadHire recipient-row id in
        // external_recipient_id, so an upsert keyed on the user id would
        // insert a DUPLICATE row sharing external_user_id and break every
        // downstream maybeSingle() lookup on that pair.
        const { data: existingRow } = await supabaseAdmin
          .from('subscription_card_external_recipients')
          .select('id')
          .eq('card_id', cardId)
          .eq('external_user_id', rId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        const revival = {
          status: 'accepted',
          responded_at: nowIso,
          assigned_manually: true,
          selected_at: nowIso,
          selected_by: actor.userId,
          passed_over_at: null,
          archived_at: null,
          notified_at: nowIso,
          squadhire_notified_at: null,
          squadhire_notify_attempts: 0,
          squadhire_notify_error: null,
        };
        let rowId: string | undefined;
        if (existingRow) {
          await supabaseAdmin
            .from('subscription_card_external_recipients')
            .update(revival)
            .eq('id', (existingRow as any).id);
          rowId = (existingRow as any).id;
        } else {
          const { data: inserted } = await supabaseAdmin
            .from('subscription_card_external_recipients')
            .insert({
              card_id: cardId,
              external_system: 'squadhire',
              external_recipient_id: rId,
              external_user_id: rId,
              ...revival,
            })
            .select('id')
            .maybeSingle();
          rowId = (inserted as any)?.id;
        }

        const outcome = await notifySquadhireOfManualAssignment(cardId, rId, rowId);
        if (!outcome.delivered) {
          warnings.push('SquadHire was not notified — the talent may not see the client yet. The system will retry automatically.');
        }
        notifySquadhireOfActivation(cardId).catch((err) =>
          console.error('[resume] notify squadhire activation failed', err),
        );
        const contentWarning = await redeliverCardContent(cardId);
        if (contentWarning) warnings.push(contentWarning);
      }

      // Billing resumes today with the card's current plan/price.
      await ensureActiveAssignmentTerm({
        cardId,
        recipientType: rType,
        recipientId: rId,
        assignedDate: todayIst,
      });
    } else if (mode === 'same_talent_offer') {
      // Offer-based resume: instead of re-placing the previous talent directly,
      // reopen the card to Published and send an OFFER to just them — they must
      // accept before billing resumes (finalized via the normal accept flow).
      // A previous PARTNER isn't on SquadHire, so they fall back to a direct
      // re-assign (billing today), as in same_talent.
      const rType2 = card.selected_recipient_type as 'talent' | 'partner' | null;
      const rId2 = card.selected_recipient_id as string | null;
      if (!rType2 || !rId2) {
        await supabaseAdmin.from('subscription_cards').update({ paused_at: card.paused_at }).eq('id', cardId);
        return { httpStatus: 409, body: { success: false, error: 'No previous recipient on this card — use rebroadcast instead' } };
      }
      if (rType2 === 'partner') {
        await ensureActiveAssignmentTerm({ cardId, recipientType: 'partner', recipientId: rId2, assignedDate: todayIst });
      } else {
        // Capture the talent's existing (soon-to-be-archived) row before we
        // clear the round — we revive it as the offer rather than insert a
        // duplicate (the (card, system, external_recipient_id) key would clash).
        const { data: prevRow } = await supabaseAdmin
          .from('subscription_card_external_recipients')
          .select('id, talent_name, email')
          .eq('card_id', cardId)
          .eq('external_user_id', rId2)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        // Archive the old round, reopen to published, then re-offer to just them.
        await supabaseAdmin
          .from('subscription_card_recipients')
          .update({ archived_at: nowIso })
          .eq('card_id', cardId)
          .is('archived_at', null);
        await supabaseAdmin
          .from('subscription_card_external_recipients')
          .update({ archived_at: nowIso })
          .eq('card_id', cardId)
          .is('archived_at', null);

        await resetCardAndCloseTerms(cardId); // card → published (term already ended by pause)

        // A single hand-picked offer — manual distribution, not a pool broadcast.
        await supabaseAdmin
          .from('subscription_cards')
          .update({ distribution: 'manual' })
          .eq('id', cardId);

        // Fresh PENDING offer for the previous talent. Revive-or-insert (never a
        // bare insert) so the just-archived row is un-archived + reset in place
        // instead of colliding on the external-recipient unique key.
        const offer = {
          status: 'pending' as const,
          responded_at: null,
          assigned_manually: true,
          selected_at: null,
          selected_by: null,
          passed_over_at: null,
          archived_at: null,
          notified_at: nowIso,
          squadhire_notified_at: null,
          squadhire_notify_attempts: 0,
          squadhire_notify_error: null,
          talent_name: (prevRow as any)?.talent_name ?? null,
          email: (prevRow as any)?.email ?? null,
        };
        let offerRowId: string | undefined;
        if ((prevRow as any)?.id) {
          await supabaseAdmin
            .from('subscription_card_external_recipients')
            .update(offer)
            .eq('id', (prevRow as any).id);
          offerRowId = (prevRow as any).id;
        } else {
          const { data: insertedOffer } = await supabaseAdmin
            .from('subscription_card_external_recipients')
            .insert({
              card_id: cardId,
              external_system: 'squadhire',
              external_recipient_id: rId2,
              external_user_id: rId2,
              ...offer,
            })
            .select('id')
            .maybeSingle();
          offerRowId = (insertedOffer as any)?.id;
        }

        // Deliver the card to SquadHire so the offer is deliverable, then notify.
        const payload = await buildSquadhirePayloadForCard(cardId);
        if (payload) await deliverCardToSquadhire(cardId, payload);
        const outcome = await notifySquadhireOfManualAssignment(cardId, rId2, offerRowId);
        if (!outcome.delivered) {
          warnings.push('Reopened and offered to the previous talent, but SquadHire was not notified — they may not see the offer yet. The system will retry automatically.');
        }
      }
    } else if (mode === 'reopen') {
      // reopen: reset the card to the **Published** tab (former talent released,
      // active term closed, matching pool refreshed). The admin then broadcasts
      // to the previous talent / all matching, re-selects, and assigns (assign
      // date = new start date). See reopenAssignmentToPublished.
      await reopenAssignmentToPublished(cardId, {
        type: card.selected_recipient_type as 'talent' | 'partner' | null,
        id: card.selected_recipient_id as string | null,
      });
    } else {
      // rebroadcast: reopen to a fresh round (mirrors reopen-for-new-talents),
      // then re-fan-out. The card leaves `assigned`, so the "previous talent"
      // memory is consumed here. (paused_at already cleared by the conditional
      // un-pause above.)
      const oldType = card.selected_recipient_type as 'talent' | 'partner' | null;
      const oldId = card.selected_recipient_id as string | null;

      const archivedAt = nowIso;
      await supabaseAdmin
        .from('subscription_card_recipients')
        .update({ archived_at: archivedAt })
        .eq('card_id', cardId)
        .is('archived_at', null);
      await supabaseAdmin
        .from('subscription_card_external_recipients')
        .update({ archived_at: archivedAt })
        .eq('card_id', cardId)
        .is('archived_at', null);

      await resetCardAndCloseTerms(cardId); // card → published (terms already ended by pause)

      if (oldType === 'talent' && oldId) {
        handOffSpaceToNewTalent({
          cardId,
          oldRecipientType: 'talent',
          oldRecipientId: oldId,
          newRecipientType: null,
          newRecipientId: null,
        }).catch((err) => console.error('[resume] space hand-off failed', err));
      }

      notifySquadhireOfSelectionUndo(cardId).catch((err) => {
        console.error('[resume] notify squadhire selection-undo failed', err);
      });

      // Re-fan-out (same logic as /rebroadcast). A rebroadcast IS a broadcast —
      // graduate a soft-published card so the pool's notified state renders
      // correctly and first-delivery ingest fans out.
      await supabaseAdmin
        .from('subscription_cards')
        .update({ distribution: 'broadcast' })
        .eq('id', cardId)
        .eq('distribution', 'manual');
      const { data: sync } = await supabaseAdmin
        .from('subscription_cards')
        .select('squadhire_synced_at')
        .eq('id', cardId)
        .maybeSingle();
      if (!(sync as any)?.squadhire_synced_at) {
        buildSquadhirePayloadForCard(cardId)
          .then((payload) => payload && deliverCardToSquadhire(cardId, payload))
          .catch((err) => console.error('[resume] squadhire first-delivery failed', err));
      } else {
        notifySquadhireOfFreshBroadcast(cardId).catch((err) => {
          console.error('[resume] notify squadhire fresh-broadcast failed', err);
        });
      }
    }

    // Mirror onto the linked Clients-module subscription: resumed = active again
    // (same_talent re-bills today; rebroadcast reopens the search — either way
    // the client's subscription is no longer paused). Best-effort.
    await syncClientSubscriptionForCard(cardId, { status: 'active' });

    logCardEvent({
      cardId,
      eventType: 'resumed',
      actorId: actor.userId,
      actorType: 'admin',
      actorLabel: actor.userName ?? null,
      metadata: { mode },
    });

    return { httpStatus: 200, body: { success: true, ...(warnings.length ? { warning: warnings.join(' ') } : {}) } };
  } catch (err: any) {
    console.error('Resume subscription error:', err);
    return { httpStatus: 500, body: { success: false, error: err?.message || 'Internal server error' } };
  }
}

router.post('/subscription-cards/:id/resume', async (req: Request, res: Response) => {
  const parsed = resumeSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ success: false, error: parsed.error.issues[0]?.message ?? 'Invalid body' });
    return;
  }
  const result = await resumeCardCore(req.params.id as string, parsed.data.mode, {
    userId: (req as any).user?.id ?? null,
    userName: (req as any).userName ?? null,
  });
  res.status(result.httpStatus).json(result.body);
});

export default router;
