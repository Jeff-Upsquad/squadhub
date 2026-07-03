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
} from '../utils/squadhireWebhook';
import { stageSubscriptionsFromAssignedCards } from '../utils/submissionPipeline';
import { logCardEvent } from '../utils/cardEvents';
import {
  ensureActiveAssignmentTerm,
  endActiveAssignmentTermsForCard,
} from '../utils/assignmentTerms';
import { buildPlanSnapshot, resolvePlanIdForCard } from '../utils/cardPlanSnapshot';
import { handOffSpaceToNewTalent } from '../utils/spaceTalentHandoff';
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
      .select('id, state, submission_subscription_id, card_code')
      .eq('id', cardId)
      .maybeSingle();
    if (cardErr) { res.status(500).json({ success: false, error: cardErr.message }); return; }
    if (!card) { res.status(404).json({ success: false, error: 'Card not found' }); return; }
    if (card.state !== 'published' && card.state !== 'assigned') {
      res.status(409).json({ success: false, error: 'Card must be published or assigned' });
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
      .select('id, state, squadhire_synced_at')
      .eq('id', cardId)
      .maybeSingle();
    if (cardErr) { res.status(500).json({ success: false, error: cardErr.message }); return; }
    if (!card) { res.status(404).json({ success: false, error: 'Card not found' }); return; }
    if (card.state !== 'published') {
      res.status(409).json({ success: false, error: 'Card must be published to broadcast' });
      return;
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
// POST /admin/subscription-cards/:id/change-plan
//
// Upgrade or downgrade the plan on a LIVE assignment without recall/republish.
// Ends the current term at `effective_date` (its frozen plan/price is kept, so
// prior billing is untouched), swaps the card's plan_snapshot + pricing to the
// new plan, and opens a fresh term carrying the new snapshot. Same card, same
// talent, same linked client space — billing pro-rates at the boundary.
// ============================================================
const changePlanSchema = z.object({
  plan_id: z.string().uuid(),
  effective_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  // Finalized monthly client price for the new plan. Optional — omit to keep
  // the current price. Per-card margin overrides default to null (use the new
  // plan's catalog margin) unless explicitly provided.
  subscription_price: z.number().int().nonnegative().nullable().optional(),
  markup: z.number().int().nullable().optional(),
  partner_price_override: z.number().int().nullable().optional(),
});

router.post('/subscription-cards/:id/change-plan', async (req: Request, res: Response) => {
  try {
    const cardId = req.params.id as string;
    const parsed = changePlanSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0]?.message ?? 'Invalid body' });
      return;
    }
    const { plan_id, effective_date } = parsed.data;
    if (isFutureEffectiveDate(effective_date)) {
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
    if (card.state !== 'assigned' || !card.selected_recipient_id) {
      res.status(409).json({ success: false, error: 'Card is not an active assignment' });
      return;
    }

    const snapshot = await buildPlanSnapshot(plan_id);
    if (!snapshot) {
      res.status(400).json({ success: false, error: 'Plan not found' });
      return;
    }

    // 1. Freeze the outgoing plan: close the current term the day before the
    //    change so the boundary day isn't billed on both plans. Its plan/price
    //    snapshot was captured when it opened, so pre-change billing stays correct.
    await endActiveAssignmentTermsForCard(cardId, isoDayBefore(effective_date));

    // 2. Point the card at the new plan + pricing.
    const cardUpdate: Record<string, unknown> = {
      plan_snapshot: snapshot,
      plan_name: snapshot.plan.plan ?? null,
      markup: parsed.data.markup ?? null,
      partner_price_override: parsed.data.partner_price_override ?? null,
    };
    if ('subscription_price' in parsed.data) {
      cardUpdate.subscription_price = parsed.data.subscription_price ?? null;
    }
    const { error: updErr } = await supabaseAdmin
      .from('subscription_cards')
      .update(cardUpdate)
      .eq('id', cardId);
    if (updErr) { res.status(500).json({ success: false, error: updErr.message }); return; }

    // 3. Open a new term for the same recipient — captures the NEW snapshot/price.
    await ensureActiveAssignmentTerm({
      cardId,
      recipientType: card.selected_recipient_type as 'talent' | 'partner',
      recipientId: card.selected_recipient_id,
      assignedDate: effective_date,
    });

    // 4. Push the new plan to SquadHire. The activation webhook alone does NOT
    //    do this — it only stamps a timestamp. The talent-facing plan name /
    //    hours / price live in the SquadHire mirror's content JSONB, which only
    //    a full card re-delivery rewrites. Awaited so the admin learns when the
    //    talent side could not be updated.
    const syncWarning = await redeliverCardContent(cardId);
    notifySquadhireOfActivation(cardId).catch((err) => {
      console.error('[change-plan] notify squadhire failed', err);
    });

    // 5. Audit.
    logCardEvent({
      cardId,
      eventType: 'plan_changed',
      actorId: (req as any).user?.id ?? null,
      actorType: 'admin',
      actorLabel: (req as any).userName ?? null,
      metadata: {
        plan_id,
        plan: snapshot.plan.plan,
        tier: snapshot.plan.tier,
        effective_date,
      },
    });

    res.json({ success: true, ...(syncWarning ? { warning: syncWarning } : {}) });
  } catch (err: any) {
    console.error('Change plan error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

// ============================================================
// POST /admin/subscription-cards/:id/change-talent
//
// Secondary shortcut: swap the assigned talent to a KNOWN replacement without a
// pool-wide re-broadcast (the primary "find a new talent" path is reopen +
// rebroadcast). Ends the old term, deactivates the old talent, points the card
// at B, notifies B directly, opens a new term, and hands off the linked space.
// Card stays `assigned` throughout.
// ============================================================
const changeTalentSchema = z.object({
  recipient_type: z.enum(['talent', 'partner']),
  recipient_id: z.string().min(1),
  effective_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  recipient_name: z.string().optional(),
  recipient_email: z.string().optional(),
});

router.post('/subscription-cards/:id/change-talent', async (req: Request, res: Response) => {
  try {
    const cardId = req.params.id as string;
    const parsed = changeTalentSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0]?.message ?? 'Invalid body' });
      return;
    }
    const { recipient_type, recipient_id, effective_date, recipient_name, recipient_email } = parsed.data;
    if (isFutureEffectiveDate(effective_date)) {
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
    if (card.state !== 'assigned' || !card.selected_recipient_id) {
      res.status(409).json({ success: false, error: 'Card is not an active assignment' });
      return;
    }
    const oldType = card.selected_recipient_type as 'talent' | 'partner' | null;
    const oldId = card.selected_recipient_id as string;
    if (oldType === recipient_type && oldId === recipient_id) {
      res.status(409).json({ success: false, error: 'That talent is already assigned' });
      return;
    }

    const nowIso = new Date().toISOString();

    // 1. Close the outgoing talent's term the day before the change so the
    //    boundary day isn't billed to both talents.
    await endActiveAssignmentTermsForCard(cardId, isoDayBefore(effective_date));

    // 2. Stamp B as the selected recipient (create the row if brand-new).
    //    Sweeper columns are explicitly reset: if B had an earlier delivered
    //    hand-pick row on this card, a stale squadhire_notified_at stamp (or
    //    exhausted attempts) would otherwise block the background retry the
    //    admin is promised when the inline webhook below fails.
    let newRecipientRowId: string | undefined;
    if (recipient_type === 'talent') {
      const { data: row } = await supabaseAdmin
        .from('subscription_card_external_recipients')
        .upsert(
          {
            card_id: cardId,
            external_system: 'squadhire',
            external_recipient_id: recipient_id,
            external_user_id: recipient_id,
            talent_name: recipient_name ?? null,
            email: recipient_email ?? null,
            status: 'accepted',
            responded_at: nowIso,
            assigned_manually: true,
            selected_at: nowIso,
            selected_by: (req as any).user?.id ?? null,
            passed_over_at: null,
            archived_at: null,
            notified_at: nowIso,
            squadhire_notified_at: null,
            squadhire_notify_attempts: 0,
            squadhire_notify_error: null,
          },
          { onConflict: 'card_id,external_system,external_recipient_id' },
        )
        .select('id')
        .maybeSingle();
      newRecipientRowId = (row as any)?.id;
    } else {
      await supabaseAdmin
        .from('subscription_card_recipients')
        .upsert(
          {
            card_id: cardId,
            partner_id: recipient_id,
            status: 'accepted',
            assigned_manually: true,
            selected_at: nowIso,
            selected_by: (req as any).user?.id ?? null,
            passed_over_at: null,
            archived_at: null,
          },
          { onConflict: 'card_id,partner_id' },
        );
    }

    // 3. Point the card at B; card stays `assigned`. Local writes land BEFORE
    //    any external side effect, so a mid-route failure can't strip A on
    //    SquadHire while SquadHub still shows A assigned.
    const { error: updErr } = await supabaseAdmin
      .from('subscription_cards')
      .update({ selected_recipient_type: recipient_type, selected_recipient_id: recipient_id })
      .eq('id', cardId);
    if (updErr) { res.status(500).json({ success: false, error: updErr.message }); return; }

    // 4. Retire A's local recipient row so the manual-assignment sweeper can
    //    never resurrect them with a ghost retry offer (its query skips
    //    archived rows). Kept as audit, hidden from the current round.
    if (oldType === 'talent' && oldId) {
      await supabaseAdmin
        .from('subscription_card_external_recipients')
        .update({ archived_at: nowIso })
        .eq('card_id', cardId)
        .eq('external_user_id', oldId)
        .is('archived_at', null);
    }

    // 5. Deactivate the outgoing talent on SquadHire (targeted, no broadcast).
    //    notify:true → SquadHire pushes an "assignment updated" notification,
    //    retires the recipient row, clears the card pointer, and cleans the
    //    business-dashboard share. Awaited: a lost removal would leave A
    //    seeing the client in My Clients indefinitely, so the admin must know.
    const warnings: string[] = [];
    if (oldType === 'talent' && oldId) {
      const removal = await notifySquadhireOfManualRemoval(cardId, oldId, { notify: true });
      if (!removal.delivered) {
        warnings.push('SquadHire could not remove the previous talent — they may still see this client. Re-run the change or check the integration.');
      }
    }

    // 6. Notify B directly (targeted push, not a broadcast) + activation. The
    //    card already points at B (step 3), so the assignment webhook carries
    //    assigned:true and SquadHire records B as selected — straight into
    //    My Clients, not a pending offer. Awaited so a delivery failure is
    //    surfaced to the admin instead of silently stranding B.
    if (recipient_type === 'talent') {
      const outcome = await notifySquadhireOfManualAssignment(cardId, recipient_id, newRecipientRowId);
      if (!outcome.delivered) {
        warnings.push('SquadHire was not notified of the new talent — they may not see the client yet. The system will retry automatically.');
      }
    }
    notifySquadhireOfActivation(cardId).catch((err) =>
      console.error('[change-talent] notify squadhire activation failed', err),
    );

    // Refresh the mirror's card content too (plan/hours/price labels) so the
    // incoming talent sees current terms even after an earlier plan change.
    const contentWarning = await redeliverCardContent(cardId);
    if (contentWarning) warnings.push(contentWarning);

    // 7. Open B's term (captures the current plan/price snapshot).
    await ensureActiveAssignmentTerm({
      cardId,
      recipientType: recipient_type,
      recipientId: recipient_id,
      recipientName: recipient_name ?? null,
      assignedDate: effective_date,
    });

    // 8. Hand the linked space off from old talent → new: repoint auto-assign,
    //    reassign open tasks, revoke old access. Best-effort.
    handOffSpaceToNewTalent({
      cardId,
      oldRecipientType: oldType,
      oldRecipientId: oldId,
      newRecipientType: recipient_type,
      newRecipientId: recipient_id,
    }).catch((err) => console.error('[change-talent] space hand-off failed', err));

    // 9. Audit.
    logCardEvent({
      cardId,
      eventType: 'talent_changed',
      actorId: (req as any).user?.id ?? null,
      actorType: 'admin',
      actorLabel: (req as any).userName ?? null,
      metadata: {
        from: { type: oldType, id: oldId },
        to: { type: recipient_type, id: recipient_id },
        effective_date,
      },
    });

    res.json({ success: true, ...(warnings.length ? { warning: warnings.join(' ') } : {}) });
  } catch (err: any) {
    console.error('Change talent error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

export default router;
