import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { supabaseAdmin } from '../supabase';
import {
  notifySquadhireOfSelection,
  notifySquadhireOfSelectionUndo,
  notifySquadhireOfActivation,
} from '../utils/squadhireWebhook';
import { stageSubscriptionsFromAssignedCards } from '../utils/submissionPipeline';
import crypto from 'crypto';

const router = Router();
router.use(requireAuth);
router.use(requireAdmin);

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
        .in('partner_id', partner_ids);

      // Pass over non-selected accepted partners
      await supabaseAdmin
        .from('subscription_card_recipients')
        .update({ passed_over_at: now })
        .eq('card_id', cardId)
        .eq('status', 'accepted')
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
        .in('external_user_id', talent_ids);

      // Pass over non-selected accepted talents
      await supabaseAdmin
        .from('subscription_card_external_recipients')
        .update({ passed_over_at: now })
        .eq('card_id', cardId)
        .eq('status', 'accepted')
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
        .is('selected_at', null)
        .is('passed_over_at', null);
    }
    if (talent_ids.length > 0 && partner_ids.length === 0) {
      await supabaseAdmin
        .from('subscription_card_recipients')
        .update({ passed_over_at: now })
        .eq('card_id', cardId)
        .eq('status', 'accepted')
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

    res.json({ success: true, data: { card_code: isFirstAssign ? card.card_code : undefined } });
  } catch (err: any) {
    console.error('Assign error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

// ============================================================
// POST /admin/subscription-cards/:id/undo-selection
//
// Clears all selections and reverts card to published.
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

    // Clear selection on partner recipients
    await supabaseAdmin
      .from('subscription_card_recipients')
      .update({ selected_at: null, selected_by: null, passed_over_at: null })
      .eq('card_id', cardId)
      .not('selected_at', 'is', null);

    await supabaseAdmin
      .from('subscription_card_recipients')
      .update({ passed_over_at: null })
      .eq('card_id', cardId)
      .not('passed_over_at', 'is', null);

    // Clear selection on external recipients
    await supabaseAdmin
      .from('subscription_card_external_recipients')
      .update({ selected_at: null, selected_by: null, passed_over_at: null })
      .eq('card_id', cardId)
      .not('selected_at', 'is', null);

    await supabaseAdmin
      .from('subscription_card_external_recipients')
      .update({ passed_over_at: null })
      .eq('card_id', cardId)
      .not('passed_over_at', 'is', null);

    // Revert card to published
    await supabaseAdmin
      .from('subscription_cards')
      .update({
        state: 'published',
        assigned_at: null,
        selected_recipient_type: null,
        selected_recipient_id: null,
      })
      .eq('id', cardId);

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

    notifySquadhireOfActivation(cardId).catch((err) => {
      console.error('[finalize] notify squadhire failed', err);
    });

    res.json({ success: true });
  } catch (err: any) {
    console.error('Finalize selection error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

export default router;
