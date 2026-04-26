import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { config } from '../config';
import { supabaseAdmin } from '../supabase';
import { notifySquadhireOfManualAssignment } from '../utils/squadhireWebhook';

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
    if (!partner || partner.user_type !== 'partner') {
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

    // Use talent_id as the external_recipient_id placeholder. When
    // SquadHire later sends a response callback, its handler can match
    // by external_user_id and update the same row in place.
    const { error: insErr } = await supabaseAdmin
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
        },
        { onConflict: 'card_id,external_system,external_recipient_id', ignoreDuplicates: true },
      );
    if (insErr) {
      res.status(500).json({ success: false, error: insErr.message });
      return;
    }

    // Best-effort notify SquadHire so it surfaces the card in the
    // talent's subscription tab. Don't block the response on it.
    notifySquadhireOfManualAssignment(cardId, talent_id).catch((err) => {
      console.error('[assign-talent] notify failed', err);
    });

    res.json({ success: true });
  } catch (err: any) {
    console.error('Assign talent error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

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
      .select('id, display_name, email, tier, country_id')
      .eq('user_type', 'partner')
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

    // SquadHire owns this endpoint; we just proxy. The base URL points
    // at the webhook ingest path; talent search lives under /external.
    const origin = new URL(baseUrl).origin;
    const url = new URL('/external/talents/search', origin);
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
      const body = (await upstream.json().catch(() => ({}))) as any;
      const list = Array.isArray(body?.data)
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

export default router;
