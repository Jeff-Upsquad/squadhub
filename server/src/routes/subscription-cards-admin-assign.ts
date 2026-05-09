import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { config } from '../config';
import { supabaseAdmin } from '../supabase';
import { PARTNER_USER_TYPES } from '@squadhub/shared';
import { sharePartnerWithCardClient } from '../utils/sharePartnerWithClient';
import {
  notifySquadhireOfManualAssignment,
  notifySquadhireOfManualRemoval,
  buildSquadhirePayloadForCard,
  deliverCardToSquadhire,
} from '../utils/squadhireWebhook';

/**
 * Manual recipient assignment for soft-published (or any published)
 * subscription cards. Counterpart to the auto-fan-out that runs at
 * publish time when distribution='broadcast'.
 *
 * Routes are mounted at /admin so the URL set is:
 *   POST /admin/subscription-cards/:id/assign-partner
 *   POST /admin/subscription-cards/:id/assign-talent
 *   GET  /admin/partners/search
 *   GET  /admin/talents/search
 *
 * All gated by requireAuth + requireAdmin (consistent with the rest of
 * /admin/*).
 */

const router = Router();
router.use(requireAuth);
router.use(requireAdmin);

// ============================================================
// POST /admin/subscription-cards/:id/assign-partner
// ============================================================
const assignPartnerSchema = z.object({
  partner_id: z.string().uuid(),
});

router.post('/subscription-cards/:id/assign-partner', async (req: Request, res: Response) => {
  try {
    const parsed = assignPartnerSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0]?.message ?? 'Invalid body' });
      return;
    }
    const cardId = req.params.id as string;
    const { partner_id } = parsed.data;

    const { data: card, error: cardErr } = await supabaseAdmin
      .from('subscription_cards')
      .select('id, state')
      .eq('id', cardId)
      .maybeSingle();
    if (cardErr) {
      res.status(500).json({ success: false, error: cardErr.message });
      return;
    }
    if (!card) {
      res.status(404).json({ success: false, error: 'Card not found' });
      return;
    }
    if (card.state !== 'published') {
      res.status(409).json({ success: false, error: 'Card must be published before assigning recipients' });
      return;
    }

    const { data: partner } = await supabaseAdmin
      .from('users')
      .select('id, user_type, status')
      .eq('id', partner_id)
      .maybeSingle();
    if (!partner || !PARTNER_USER_TYPES.includes(partner.user_type)) {
      res.status(400).json({ success: false, error: 'Target user is not a partner' });
      return;
    }

    // Don't overwrite an existing auto-matched row — that would flip
    // assigned_manually to true on a recipient who actually arrived via
    // broadcast, distorting analytics. ON CONFLICT DO NOTHING keeps the
    // first-write-wins semantics.
    const { error: insErr } = await supabaseAdmin
      .from('subscription_card_recipients')
      .upsert(
        {
          card_id: cardId,
          partner_id,
          status: 'pending',
          assigned_manually: true,
        },
        { onConflict: 'card_id,partner_id', ignoreDuplicates: true },
      );
    if (insErr) {
      res.status(500).json({ success: false, error: insErr.message });
      return;
    }

    res.json({ success: true });
  } catch (err: any) {
    console.error('Assign partner error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

// ============================================================
// POST /admin/subscription-cards/:id/assign-talent
// ============================================================
const assignTalentSchema = z.object({
  talent_id: z.string().min(1),
  talent_email: z.string().email().optional(),
  talent_name: z.string().min(1).max(200).optional(),
});

router.post('/subscription-cards/:id/assign-talent', async (req: Request, res: Response) => {
  try {
    const parsed = assignTalentSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0]?.message ?? 'Invalid body' });
      return;
    }
    const cardId = req.params.id as string;
    const { talent_id, talent_name } = parsed.data;

    const { data: card, error: cardErr } = await supabaseAdmin
      .from('subscription_cards')
      .select('id, state, distribution, squadhire_synced_at, squadhire_category_ids')
      .eq('id', cardId)
      .maybeSingle();
    if (cardErr) {
      res.status(500).json({ success: false, error: cardErr.message });
      return;
    }
    if (!card) {
      res.status(404).json({ success: false, error: 'Card not found' });
      return;
    }
    if (card.state !== 'published') {
      res.status(409).json({ success: false, error: 'Card must be published before assigning recipients' });
      return;
    }

    const isManual = card.distribution === 'manual';
    const categoryIds = Array.isArray(card.squadhire_category_ids)
      ? (card.squadhire_category_ids as string[])
      : [];

    // For manual cards we just queue — no SquadHire round-trip yet. The
    // dedicated /broadcast-pending endpoint will lazy-deliver and notify
    // when the admin explicitly releases this batch.
    //
    // For broadcast cards we keep the inline lazy-deliver + per-talent
    // notify, because admins expect the talent to see the card right away.
    if (!isManual && !card.squadhire_synced_at) {
      if (categoryIds.length === 0) {
        res.status(409).json({
          success: false,
          error: 'Card has no SquadHire categories. Add categories before assigning talent.',
        });
        return;
      }

      const payload = await buildSquadhirePayloadForCard(cardId);
      if (payload) {
        await deliverCardToSquadhire(cardId, payload);
      }

      const { data: recheck } = await supabaseAdmin
        .from('subscription_cards')
        .select('squadhire_synced_at')
        .eq('id', cardId)
        .maybeSingle();
      if (!recheck?.squadhire_synced_at) {
        res.status(503).json({
          success: false,
          error: 'Card could not be synced to SquadHire. The system will retry automatically — please try assigning again in a few minutes.',
        });
        return;
      }
    } else if (isManual && categoryIds.length === 0) {
      // Manual cards still need categories; the broadcast step will lazy-deliver.
      res.status(409).json({
        success: false,
        error: 'Card has no SquadHire categories. Add categories before assigning talent.',
      });
      return;
    }

    const { data: existing } = await supabaseAdmin
      .from('subscription_card_external_recipients')
      .select('id')
      .eq('card_id', cardId)
      .eq('external_user_id', talent_id)
      .limit(1)
      .maybeSingle();

    if (existing) {
      res.json({ success: true });
      return;
    }

    const { data: inserted, error: insErr } = await supabaseAdmin
      .from('subscription_card_external_recipients')
      .upsert(
        {
          card_id: cardId,
          external_system: 'squadhire',
          external_recipient_id: talent_id,
          external_user_id: talent_id,
          talent_name: talent_name ?? null,
          status: 'pending',
          responded_at: null,
          assigned_manually: true,
          notified_at: isManual ? null : new Date().toISOString(),
        },
        { onConflict: 'card_id,external_system,external_recipient_id', ignoreDuplicates: true },
      )
      .select('id')
      .single();
    if (insErr) {
      res.status(500).json({ success: false, error: insErr.message });
      return;
    }

    if (isManual) {
      // Queued only. Admin will release via /broadcast-pending.
      res.json({ success: true, queued: true });
      return;
    }

    const recipientRowId = inserted?.id as string | undefined;
    const outcome = await notifySquadhireOfManualAssignment(cardId, talent_id, recipientRowId);

    if (outcome.delivered) {
      res.json({ success: true });
    } else {
      res.json({
        success: true,
        warning: 'Assignment saved but SquadHire notification failed. The talent may not see the card immediately — the system will retry automatically.',
      });
    }
  } catch (err: any) {
    console.error('Assign talent error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

// ============================================================
// DELETE /admin/subscription-cards/:id/recipients/:partnerId
// Removes a partner recipient row regardless of how it got there
// (broadcast fan-out or hand-pick). Idempotent — 404 if the card is
// gone, 200 with deleted=0 if the row was already missing.
// ============================================================
router.delete(
  '/subscription-cards/:id/recipients/:partnerId',
  async (req: Request, res: Response) => {
    try {
      const cardId = req.params.id as string;
      const partnerId = req.params.partnerId as string;

      const { data: card, error: cardErr } = await supabaseAdmin
        .from('subscription_cards')
        .select('id')
        .eq('id', cardId)
        .maybeSingle();
      if (cardErr) {
        res.status(500).json({ success: false, error: cardErr.message });
        return;
      }
      if (!card) {
        res.status(404).json({ success: false, error: 'Card not found' });
        return;
      }

      const { error: delErr, count } = await supabaseAdmin
        .from('subscription_card_recipients')
        .delete({ count: 'exact' })
        .eq('card_id', cardId)
        .eq('partner_id', partnerId);
      if (delErr) {
        res.status(500).json({ success: false, error: delErr.message });
        return;
      }

      res.json({ success: true, deleted: count ?? 0 });
    } catch (err: any) {
      console.error('Remove partner recipient error:', err);
      res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
    }
  },
);

// ============================================================
// DELETE /admin/subscription-cards/:id/external-recipients/:talentId
// Removes a talent (external) recipient row and best-effort notifies
// SquadHire so the card disappears from the talent's subscription tab.
// ============================================================
router.delete(
  '/subscription-cards/:id/external-recipients/:talentId',
  async (req: Request, res: Response) => {
    try {
      const cardId = req.params.id as string;
      const talentId = req.params.talentId as string;

      const { data: card, error: cardErr } = await supabaseAdmin
        .from('subscription_cards')
        .select('id')
        .eq('id', cardId)
        .maybeSingle();
      if (cardErr) {
        res.status(500).json({ success: false, error: cardErr.message });
        return;
      }
      if (!card) {
        res.status(404).json({ success: false, error: 'Card not found' });
        return;
      }

      const { error: delErr, count } = await supabaseAdmin
        .from('subscription_card_external_recipients')
        .delete({ count: 'exact' })
        .eq('card_id', cardId)
        .eq('external_system', 'squadhire')
        .eq('external_user_id', talentId);
      if (delErr) {
        res.status(500).json({ success: false, error: delErr.message });
        return;
      }

      // Best-effort SquadHire mirror — fire-and-forget. We don't block on this:
      // even if SquadHire's recipient row sticks around, the SquadHub-side
      // truth is gone, and the next admin retry can replay the call.
      notifySquadhireOfManualRemoval(cardId, talentId).catch((err) => {
        console.error('[remove-talent] notify failed', err);
      });

      res.json({ success: true, deleted: count ?? 0 });
    } catch (err: any) {
      console.error('Remove talent recipient error:', err);
      res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
    }
  },
);

// ============================================================
// GET /admin/partners/search?q=...
// ============================================================
router.get('/partners/search', async (req: Request, res: Response) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length === 0) {
      res.json({ success: true, data: [] });
      return;
    }
    const escaped = q.replace(/[%_]/g, '\\$&');
    const pattern = `%${escaped}%`;

    const { data, error } = await supabaseAdmin
      .from('users')
      .select('id, display_name, email, tier, country_id, user_type')
      .in('user_type', PARTNER_USER_TYPES as readonly string[])
      .eq('status', 'active')
      .or(`display_name.ilike.${pattern},email.ilike.${pattern}`)
      .limit(20);
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.json({
      success: true,
      data: (data || []).map((u: any) => ({
        id: u.id,
        name: u.display_name || u.email,
        email: u.email,
        tier: u.tier ?? null,
        country_id: u.country_id ?? null,
        user_type: u.user_type,
      })),
    });
  } catch (err: any) {
    console.error('Partner search error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

// ============================================================
// GET /admin/talents/search?q=...
// Proxies to SquadHire's talent search API. Returns 503 if SquadHire
// is unreachable so the picker UI can show a clean "couldn't load
// talents" message rather than a hung spinner.
// ============================================================
const TALENT_SEARCH_TIMEOUT_MS = 5_000;

router.get('/talents/search', async (req: Request, res: Response) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length === 0) {
      res.json({ success: true, data: [] });
      return;
    }

    const baseUrl = config.squadhireWebhookUrl;
    if (!baseUrl || !config.squadhireWebhookSecret) {
      res.status(503).json({ success: false, error: 'SquadHire is not configured' });
      return;
    }

    // SquadHire owns this endpoint; we just proxy. The webhook URL points at
    // .../api/webhooks/squadhub/cards — derive the talent search path from
    // the same origin, mirroring the convention used by the categories proxy
    // (server/src/routes/integrations/squadhire-categories.ts).
    const url = new URL(baseUrl);
    url.pathname = '/api/integrations/squadhub/talents/search';
    url.search = '';
    url.searchParams.set('q', q);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TALENT_SEARCH_TIMEOUT_MS);

    try {
      const upstream = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'X-SquadHub-Signature': config.squadhireWebhookSecret,
        },
        signal: controller.signal,
      });
      if (!upstream.ok) {
        res.status(503).json({ success: false, error: `SquadHire returned ${upstream.status}` });
        return;
      }
      // SquadHire returns { talents: [...] } to mirror the categories shape.
      // Tolerate { data: [...] } or a bare array for forward-compat.
      const body = (await upstream.json().catch(() => ({}))) as any;
      const list = Array.isArray(body?.talents)
        ? body.talents
        : Array.isArray(body?.data)
          ? body.data
          : Array.isArray(body)
            ? body
            : [];
      res.json({
        success: true,
        data: list.map((t: any) => ({
          id: String(t.id),
          name: t.name ?? t.display_name ?? '',
          email: t.email ?? null,
          country: t.country ?? t.country_name ?? null,
          tier: t.tier ?? null,
        })),
      });
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(503).json({ success: false, error: `Couldn't reach SquadHire: ${msg}` });
    } finally {
      clearTimeout(timer);
    }
  } catch (err: any) {
    console.error('Talent search error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

// ============================================================
// POST /admin/subscription-cards/:id/auto-accept-partner
//
// Accept a soft-published card on behalf of a partner-employee
// recipient. Use case: an admin hand-picks an internal partner-employee
// for a manual-distribution card and wants to skip the manual-accept
// step (the admin and the partner-employee are effectively the same
// operational unit, so the round-trip adds friction without value).
//
// Gated to:
//   - card.state === 'published' AND card.distribution === 'manual'
//   - target user.user_type === 'partner_employee'
//   - existing recipient row in status 'pending' (idempotent on 'accepted',
//     409 on 'rejected')
//
// Side effect: shares the partner with the card's owning client via
// partner_client_assignments, mirroring the regular partner accept flow.
// ============================================================
const autoAcceptPartnerSchema = z.object({
  partner_id: z.string().uuid(),
});

router.post(
  '/subscription-cards/:id/auto-accept-partner',
  async (req: Request, res: Response) => {
    try {
      const parsed = autoAcceptPartnerSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({
          success: false,
          error: parsed.error.issues[0]?.message ?? 'Invalid body',
        });
        return;
      }
      const cardId = req.params.id as string;
      const { partner_id } = parsed.data;

      // Three independent lookups — fire in parallel, validate sequentially
      // so error precedence stays consistent (card → partner → recipient).
      const [
        { data: card, error: cardErr },
        { data: partner, error: partnerErr },
        { data: recipient, error: recErr },
      ] = await Promise.all([
        supabaseAdmin
          .from('subscription_cards')
          .select('id, state, distribution')
          .eq('id', cardId)
          .maybeSingle(),
        supabaseAdmin
          .from('users')
          .select('id, user_type')
          .eq('id', partner_id)
          .maybeSingle(),
        supabaseAdmin
          .from('subscription_card_recipients')
          .select('id, status')
          .eq('card_id', cardId)
          .eq('partner_id', partner_id)
          .maybeSingle(),
      ]);
      if (cardErr) {
        res.status(500).json({ success: false, error: cardErr.message });
        return;
      }
      if (!card) {
        res.status(404).json({ success: false, error: 'Card not found' });
        return;
      }
      if (card.state !== 'published') {
        res.status(409).json({ success: false, error: 'Card must be published' });
        return;
      }
      if (card.distribution !== 'manual') {
        res.status(409).json({
          success: false,
          error: 'Auto-accept only applies to soft-published (manual) cards',
        });
        return;
      }
      if (partnerErr) {
        res.status(500).json({ success: false, error: partnerErr.message });
        return;
      }
      if (!partner) {
        res.status(404).json({ success: false, error: 'Partner not found' });
        return;
      }
      if (partner.user_type !== 'partner_employee') {
        res.status(400).json({
          success: false,
          error: 'Auto-accept is only available for partner-employee users',
        });
        return;
      }
      if (recErr) {
        res.status(500).json({ success: false, error: recErr.message });
        return;
      }
      if (!recipient) {
        res.status(404).json({
          success: false,
          error: 'Partner is not a recipient on this card. Assign them first.',
        });
        return;
      }
      if (recipient.status === 'accepted') {
        // Re-share with the client in case the prior run failed that step.
        await sharePartnerWithCardClient(partner_id, cardId);
        res.json({ success: true, alreadyAccepted: true });
        return;
      }
      if (recipient.status === 'rejected') {
        res.status(409).json({
          success: false,
          error: 'Partner has already rejected this card',
        });
        return;
      }

      // Conditional update guards against the partner accepting/rejecting
      // between our read and our write. If the row is no longer 'pending',
      // count comes back 0 and we surface a 409 instead of clobbering it.
      const now = new Date().toISOString();
      const { error: updErr, count } = await supabaseAdmin
        .from('subscription_card_recipients')
        .update({ status: 'accepted', responded_at: now }, { count: 'exact' })
        .eq('id', recipient.id)
        .eq('status', 'pending');
      if (updErr) {
        res.status(500).json({ success: false, error: updErr.message });
        return;
      }
      if (!count) {
        res.status(409).json({
          success: false,
          error: 'Recipient status changed before auto-accept could complete. Please refresh and try again.',
        });
        return;
      }

      await sharePartnerWithCardClient(partner_id, cardId);

      res.json({ success: true });
    } catch (err: any) {
      console.error('Auto-accept partner error:', err);
      res.status(500).json({
        success: false,
        error: err?.message || 'Internal server error',
      });
    }
  },
);

export default router;
