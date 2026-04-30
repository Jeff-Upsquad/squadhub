import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { supabaseAdmin } from '../supabase';
import {
  notifySquadhireOfSelection,
  notifySquadhireOfSelectionUndo,
} from '../utils/squadhireWebhook';

const router = Router();
router.use(requireAuth);
router.use(requireAdmin);

// ============================================================
// POST /admin/subscription-cards/:id/select-partner
// ============================================================
const selectPartnerSchema = z.object({
  partner_id: z.string().uuid(),
});

router.post('/subscription-cards/:id/select-partner', async (req: Request, res: Response) => {
  try {
    const parsed = selectPartnerSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0]?.message ?? 'Invalid body' });
      return;
    }
    const cardId = req.params.id as string;
    const { partner_id } = parsed.data;
    const adminId = (req as any).user?.id as string;

    const { data: card, error: cardErr } = await supabaseAdmin
      .from('subscription_cards')
      .select('id, state, selected_recipient_type')
      .eq('id', cardId)
      .maybeSingle();
    if (cardErr) { res.status(500).json({ success: false, error: cardErr.message }); return; }
    if (!card) { res.status(404).json({ success: false, error: 'Card not found' }); return; }
    if (card.state !== 'published') {
      res.status(409).json({ success: false, error: 'Card must be published to select a recipient' });
      return;
    }
    if (card.selected_recipient_type) {
      res.status(409).json({ success: false, error: 'A recipient has already been selected for this card' });
      return;
    }

    const { data: recipient } = await supabaseAdmin
      .from('subscription_card_recipients')
      .select('partner_id, status')
      .eq('card_id', cardId)
      .eq('partner_id', partner_id)
      .maybeSingle();
    if (!recipient || recipient.status !== 'accepted') {
      res.status(400).json({ success: false, error: 'Partner must have accepted before they can be selected' });
      return;
    }

    const now = new Date().toISOString();

    // Stamp the selected partner
    await supabaseAdmin
      .from('subscription_card_recipients')
      .update({ selected_at: now, selected_by: adminId })
      .eq('card_id', cardId)
      .eq('partner_id', partner_id);

    // Pass over all other accepted partners
    await supabaseAdmin
      .from('subscription_card_recipients')
      .update({ passed_over_at: now })
      .eq('card_id', cardId)
      .eq('status', 'accepted')
      .neq('partner_id', partner_id)
      .is('passed_over_at', null);

    // Pass over all accepted talents
    await supabaseAdmin
      .from('subscription_card_external_recipients')
      .update({ passed_over_at: now })
      .eq('card_id', cardId)
      .eq('status', 'accepted')
      .is('passed_over_at', null);

    // Close the card
    await supabaseAdmin
      .from('subscription_cards')
      .update({
        state: 'closed',
        closed_at: now,
        selected_recipient_type: 'partner',
        selected_recipient_id: partner_id,
      })
      .eq('id', cardId);

    // Notify SquadHire (card is now archived). Fire-and-forget.
    notifySquadhireOfSelection(cardId, null, now).catch((err) => {
      console.error('[select-partner] notify squadhire failed', err);
    });

    res.json({ success: true });
  } catch (err: any) {
    console.error('Select partner error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

// ============================================================
// POST /admin/subscription-cards/:id/select-talent
// ============================================================
const selectTalentSchema = z.object({
  talent_id: z.string().min(1),
});

router.post('/subscription-cards/:id/select-talent', async (req: Request, res: Response) => {
  try {
    const parsed = selectTalentSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0]?.message ?? 'Invalid body' });
      return;
    }
    const cardId = req.params.id as string;
    const { talent_id } = parsed.data;
    const adminId = (req as any).user?.id as string;

    const { data: card, error: cardErr } = await supabaseAdmin
      .from('subscription_cards')
      .select('id, state, selected_recipient_type')
      .eq('id', cardId)
      .maybeSingle();
    if (cardErr) { res.status(500).json({ success: false, error: cardErr.message }); return; }
    if (!card) { res.status(404).json({ success: false, error: 'Card not found' }); return; }
    if (card.state !== 'published') {
      res.status(409).json({ success: false, error: 'Card must be published to select a recipient' });
      return;
    }
    if (card.selected_recipient_type) {
      res.status(409).json({ success: false, error: 'A recipient has already been selected for this card' });
      return;
    }

    const { data: recipient } = await supabaseAdmin
      .from('subscription_card_external_recipients')
      .select('external_user_id, status')
      .eq('card_id', cardId)
      .eq('external_user_id', talent_id)
      .maybeSingle();
    if (!recipient || recipient.status !== 'accepted') {
      res.status(400).json({ success: false, error: 'Talent must have accepted before they can be selected' });
      return;
    }

    const now = new Date().toISOString();

    // Stamp the selected talent
    await supabaseAdmin
      .from('subscription_card_external_recipients')
      .update({ selected_at: now, selected_by: adminId })
      .eq('card_id', cardId)
      .eq('external_user_id', talent_id);

    // Pass over all other accepted talents
    await supabaseAdmin
      .from('subscription_card_external_recipients')
      .update({ passed_over_at: now })
      .eq('card_id', cardId)
      .eq('status', 'accepted')
      .neq('external_user_id', talent_id)
      .is('passed_over_at', null);

    // Pass over all accepted partners
    await supabaseAdmin
      .from('subscription_card_recipients')
      .update({ passed_over_at: now })
      .eq('card_id', cardId)
      .eq('status', 'accepted')
      .is('passed_over_at', null);

    // Close the card
    await supabaseAdmin
      .from('subscription_cards')
      .update({
        state: 'closed',
        closed_at: now,
        selected_recipient_type: 'talent',
        selected_recipient_id: talent_id,
      })
      .eq('id', cardId);

    // Notify SquadHire with the selected talent id so it stamps its local row.
    notifySquadhireOfSelection(cardId, talent_id, now).catch((err) => {
      console.error('[select-talent] notify squadhire failed', err);
    });

    res.json({ success: true });
  } catch (err: any) {
    console.error('Select talent error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

// ============================================================
// POST /admin/subscription-cards/:id/undo-selection
// ============================================================
router.post('/subscription-cards/:id/undo-selection', async (req: Request, res: Response) => {
  try {
    const cardId = req.params.id as string;

    const { data: card, error: cardErr } = await supabaseAdmin
      .from('subscription_cards')
      .select('id, state, selected_recipient_type')
      .eq('id', cardId)
      .maybeSingle();
    if (cardErr) { res.status(500).json({ success: false, error: cardErr.message }); return; }
    if (!card) { res.status(404).json({ success: false, error: 'Card not found' }); return; }
    if (!card.selected_recipient_type) {
      res.status(409).json({ success: false, error: 'No selection to undo' });
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

    // Reopen the card
    await supabaseAdmin
      .from('subscription_cards')
      .update({
        state: 'published',
        closed_at: null,
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

export default router;
