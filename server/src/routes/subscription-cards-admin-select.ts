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
// POST /admin/subscription-cards/:id/assign
//
// Batch-assign multiple accepted recipients. Card transitions
// from published → assigned on first call. Subsequent calls add
// more selections (re-stamps passed_over on non-selected).
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
      .select('id, state')
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

    // Transition card to assigned
    const cardUpdate: Record<string, unknown> = { state: 'assigned' };
    if (card.state === 'published') cardUpdate.assigned_at = now;
    await supabaseAdmin
      .from('subscription_cards')
      .update(cardUpdate)
      .eq('id', cardId);

    // Notify SquadHire. Fire-and-forget.
    notifySquadhireOfSelection(cardId, talent_ids, now).catch((err) => {
      console.error('[assign] notify squadhire failed', err);
    });

    res.json({ success: true });
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

export default router;
