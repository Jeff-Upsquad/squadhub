import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requireMiniAppOrAdmin } from '../middleware/miniApp';
import { config } from '../config';
import { supabaseAdmin } from '../supabase';
import { expandBusinessBid, loadCardBidPricing } from '../utils/cardBidPricing';
import { lockAcceptedBidPrice } from '../utils/lockAcceptedBidPrice';
import { buildSquadhirePayloadForCard, deliverCardToSquadhire } from '../utils/squadhireWebhook';

/**
 * Card offers / bids — admin management for subscription + assignment cards.
 *
 * SquadHire (Profiles) is CANONICAL for the offer negotiation, and the admin
 * reads it LIVE (the "synced, not mirrored, fetched live" requirement): there
 * is NO local mirror. GET /:id/offers fetches the snapshot straight from
 * Profiles; every write is a signed proxy to its admin-mirror webhook
 * (/api/webhooks/squadhub/cards/offers) with actor {type:'admin',
 * source:'squadhub'} (Profiles applies it canonically + notifies the talent).
 *
 * Margin stays constant across counters:
 *   fixed  — absolute cut is unchanged
 *   percent — % re-applies to the new business amount; ₹ cut ceils to ₹100
 * Catalog min price is the business bid floor; talent floor is min − margin.
 *
 * Accept ≠ Select: accepting a bid only locks the figure + shortlists; Select
 * stays on the recipients funnel.
 *
 * Resilience mirrors job-cards-admin-candidates.ts: per-call timeout + a
 * circuit breaker. With no mirror, a degraded upstream yields an empty list
 * tagged source:'unavailable' (the UI shows a "temporarily unavailable" note)
 * rather than stale data.
 */

const router = Router();
router.use(requireAuth);
// Internal admins, plus anyone granted the Leads mini app — the web app
// renders these same modules for the team (see migration 164).
router.use(requireMiniAppOrAdmin('leads'));

const UPSTREAM_BASE_PATH = '/api/webhooks/squadhub/cards';
const LIVE_TIMEOUT_MS = 5_000;
const WRITE_TIMEOUT_MS = 6_000;

// ---- Circuit breaker (module-level, shared across requests) -----------------
const FAILURE_THRESHOLD = 4;
const OPEN_MS = 30_000;
const breaker = { failures: 0, openUntil: 0 };
const breakerIsOpen = () => Date.now() < breaker.openUntil;
function recordSuccess() {
  breaker.failures = 0;
  breaker.openUntil = 0;
}
function recordFailure() {
  breaker.failures += 1;
  if (breaker.failures >= FAILURE_THRESHOLD) {
    breaker.openUntil = Date.now() + OPEN_MS;
    console.error(`[assignment-offers] circuit breaker OPEN for ${OPEN_MS}ms after ${breaker.failures} failures`);
  }
}

function configured(): boolean {
  return !!(config.squadhireWebhookUrl && config.squadhireWebhookSecret);
}

function buildUrl(suffix: string): string {
  const url = new URL(config.squadhireWebhookUrl);
  url.pathname = `${UPSTREAM_BASE_PATH}${suffix}`;
  url.search = '';
  return url.toString();
}

interface OffersSnapshot {
  external_id: string;
  card_id: string;
  offers: unknown[];
}

/** Pull the live offers snapshot from Profiles. null on 4xx; throws on 5xx/timeout. */
async function fetchOffersSnapshot(externalId: string): Promise<OffersSnapshot | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LIVE_TIMEOUT_MS);
  try {
    const upstream = await fetch(buildUrl('/offers-snapshot'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-SquadHub-Signature': config.squadhireWebhookSecret,
      },
      body: JSON.stringify({ external_id: externalId, source: 'squadhub' }),
      signal: controller.signal,
    });
    if (upstream.status >= 500) throw new Error(`upstream ${upstream.status}`);
    if (!upstream.ok) return null;
    const json = (await upstream.json()) as { snapshot?: OffersSnapshot };
    return json?.snapshot ?? null;
  } finally {
    clearTimeout(timer);
  }
}

/** Signed write proxy to Profiles' admin offers webhook. Blocked while degraded. */
async function proxyOfferAction(req: Request, res: Response, body: Record<string, unknown>): Promise<void> {
  if (!configured()) {
    res.status(503).json({ success: false, error: 'SquadHire integration is not configured on this server' });
    return;
  }
  if (breakerIsOpen()) {
    res.status(503).json({ success: false, error: 'SquadHire is temporarily unavailable — try again shortly' });
    return;
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-SquadHub-Signature': config.squadhireWebhookSecret,
  };
  if (req.userEmail) headers['X-SquadHub-Actor'] = req.userEmail;
  if (req.userName) headers['X-SquadHub-Actor-Name'] = req.userName;

  const payload = {
    ...body,
    source: 'squadhub',
    actor: { type: 'admin', email: req.userEmail ?? null, name: req.userName ?? null },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WRITE_TIMEOUT_MS);
  const startedAt = Date.now();
  try {
    const upstream = await fetch(buildUrl('/offers'), {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const text = await upstream.text();
    if (upstream.status >= 500) {
      recordFailure();
      console.error(`[assignment-offers] upstream POST /offers → ${upstream.status} (${Date.now() - startedAt}ms)`);
    } else {
      recordSuccess();
    }
    res.status(upstream.status).type('application/json').send(text);
  } catch (err) {
    recordFailure();
    console.error(`[assignment-offers] upstream POST /offers failed (${Date.now() - startedAt}ms):`, (err as Error)?.message);
    res.status(502).json({ success: false, error: 'SquadHire is unreachable' });
  } finally {
    clearTimeout(timer);
  }
}

const OFFERABLE_TYPES = new Set(['subscription', 'assignment']);

async function offerableCardExists(cardId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('subscription_cards')
    .select('id, card_type')
    .eq('id', cardId)
    .maybeSingle();
  return !!data && OFFERABLE_TYPES.has((data as any).card_type as string);
}

// ============================================================
// GET /admin/subscription-cards/:id/offers — live offer negotiations.
// Fetched LIVE from SquadHire (no mirror). source:'unavailable' on a degraded
// upstream so the UI can show a retry note instead of stale data.
// ============================================================
router.get('/:id/offers', async (req: Request, res: Response) => {
  try {
    const cardId = req.params.id as string;
    if (!(await offerableCardExists(cardId))) {
      res.status(404).json({ success: false, error: 'Card not found' });
      return;
    }
    // Always attach bid floors / margin rules so the admin UI can enforce
    // and explain them even when SquadHire is momentarily unavailable.
    let bidPricing: Awaited<ReturnType<typeof loadCardBidPricing>> = null;
    try {
      bidPricing = await loadCardBidPricing(cardId);
    } catch (err) {
      console.error('[assignment-offers] bid pricing load failed:', (err as Error)?.message);
    }
    const bidPricingPayload = bidPricing
      ? {
          min_customer_price: bidPricing.min_customer_price,
          min_partner_price: bidPricing.min_partner_price,
          margin_type: bidPricing.margin_type,
          margin_value: bidPricing.margin_value,
        }
      : null;

    if (!configured() || breakerIsOpen()) {
      res.json({ success: true, source: 'unavailable', offers: [], bid_pricing: bidPricingPayload });
      return;
    }
    try {
      const snap = await fetchOffersSnapshot(cardId);
      recordSuccess();
      // If bidding has started and this card originally had a fixed margin,
      // push the percent-derived margin to SquadHire so subsequent counters
      // use percent (talent price stays proportional, never drops to zero).
      // Fire-and-forget — the bid_pricing we already return is already percent-derived.
      if (snap?.offers && snap.offers.length > 0 && bidPricing && bidPricing.margin_type === 'percent') {
        // Check if original was fixed by re-reading raw pricing (best-effort).
        // If webhook still has fixed, this delivery will flip it to percent.
        buildSquadhirePayloadForCard(cardId)
          .then((payload) => {
            if (payload) return deliverCardToSquadhire(cardId, payload);
          })
          .catch(() => {});
      }
      res.json({
        success: true,
        source: 'live',
        offers: snap?.offers ?? [],
        bid_pricing: bidPricingPayload,
      });
    } catch (err) {
      recordFailure();
      console.error('[assignment-offers] live offers fetch failed:', (err as Error)?.message);
      res.json({ success: true, source: 'unavailable', offers: [], bid_pricing: bidPricingPayload });
    }
  } catch (err: any) {
    console.error('List assignment offers error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

const OFFER_STEP = 500;
const counterSchema = z.object({
  amount: z
    .object({
      amount: z
        .number()
        .positive()
        .refine((n) => Math.round(n) === n && n % OFFER_STEP === 0, {
          message: `Amount must be a positive multiple of ₹${OFFER_STEP}`,
        }),
    })
    .passthrough(),
  note: z.string().trim().max(2000).optional(),
});
const actionSchema = z.object({ note: z.string().trim().max(2000).optional() });
const sendSchema = z.object({
  recipient_id: z.string().min(1),
  amount: z
    .object({
      amount: z
        .number()
        .positive()
        .refine((n) => Math.round(n) === n && n % OFFER_STEP === 0, {
          message: `Amount must be a positive multiple of ₹${OFFER_STEP}`,
        }),
    })
    .passthrough(),
  note: z.string().trim().max(2000).optional(),
});

/** Admin amounts are business-side. Expand with live margin + enforce min. */
async function businessAmountOrReject(
  res: Response,
  cardId: string,
  rawAmount: { amount: number } & Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  try {
    const ctx = await loadCardBidPricing(cardId);
    if (!ctx) {
      res.status(404).json({ success: false, error: 'Card not found' });
      return null;
    }
    const expanded = expandBusinessBid(rawAmount.amount, ctx);
    return {
      ...rawAmount,
      amount: expanded.amount,
      partner_amount: expanded.partner_amount,
      margin_amount: expanded.margin_amount,
      margin_type: expanded.margin_type,
      margin_value: expanded.margin_value,
      side: expanded.side,
    };
  } catch (err: any) {
    res.status(400).json({ success: false, error: err?.message || 'Invalid bid amount' });
    return null;
  }
}

// POST /:id/offers/send — admin sends an offer to a talent (auto-shortlists).
router.post('/:id/offers/send', async (req: Request, res: Response) => {
  const parsed = sendSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    return;
  }
  const amount = await businessAmountOrReject(res, req.params.id as string, parsed.data.amount);
  if (!amount) return;
  await proxyOfferAction(req, res, {
    op: 'send',
    external_id: req.params.id,
    recipient_id: parsed.data.recipient_id,
    amount,
    ...(parsed.data.note ? { note: parsed.data.note } : {}),
  });
});

// POST /:id/offers/:offerId/counter — admin counters the talent's figure.
router.post('/:id/offers/:offerId/counter', async (req: Request, res: Response) => {
  const parsed = counterSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    return;
  }
  const amount = await businessAmountOrReject(res, req.params.id as string, parsed.data.amount);
  if (!amount) return;
  await proxyOfferAction(req, res, {
    op: 'counter',
    external_id: req.params.id,
    offer_id: req.params.offerId,
    amount,
    ...(parsed.data.note ? { note: parsed.data.note } : {}),
  });
});

// POST /:id/offers/:offerId/accept — admin accepts the bid (does NOT select).
// On success we also freeze the accepted figure onto the card so admin +
// Leads show the final agreed price even before Select/Assign.
router.post('/:id/offers/:offerId/accept', async (req: Request, res: Response) => {
  const parsed = actionSchema.safeParse(req.body ?? {});
  const cardId = req.params.id as string;
  const offerId = req.params.offerId as string;

  // Custom proxy so we can lock prices after a successful accept.
  if (!configured()) {
    res.status(503).json({ success: false, error: 'SquadHire integration is not configured on this server' });
    return;
  }
  if (breakerIsOpen()) {
    res.status(503).json({ success: false, error: 'SquadHire is temporarily unavailable — try again shortly' });
    return;
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-SquadHub-Signature': config.squadhireWebhookSecret,
  };
  if (req.userEmail) headers['X-SquadHub-Actor'] = req.userEmail;
  if (req.userName) headers['X-SquadHub-Actor-Name'] = req.userName;

  const payload = {
    op: 'accept',
    external_id: cardId,
    offer_id: offerId,
    source: 'squadhub',
    actor: { type: 'admin', email: req.userEmail ?? null, name: req.userName ?? null },
    ...(parsed.success && parsed.data.note ? { note: parsed.data.note } : {}),
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WRITE_TIMEOUT_MS);
  const startedAt = Date.now();
  try {
    const upstream = await fetch(buildUrl('/offers'), {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const text = await upstream.text();
    if (upstream.status >= 500) {
      recordFailure();
      console.error(`[assignment-offers] upstream POST /offers accept → ${upstream.status} (${Date.now() - startedAt}ms)`);
    } else {
      recordSuccess();
      if (upstream.ok) {
        // Await so admin/Leads refetch sees subscription_price + partner override.
        try {
          await lockAcceptedBidPrice({ cardId, offerId });
        } catch (err) {
          console.error('[assignment-offers] lock bid price after accept failed', err);
        }
      }
    }
    res.status(upstream.status).type('application/json').send(text);
  } catch (err) {
    recordFailure();
    console.error(`[assignment-offers] upstream POST /offers accept failed (${Date.now() - startedAt}ms):`, (err as Error)?.message);
    res.status(502).json({ success: false, error: 'SquadHire is unreachable' });
  } finally {
    clearTimeout(timer);
  }
});

// POST /:id/offers/:offerId/decline — admin declines the talent's offer.
router.post('/:id/offers/:offerId/decline', async (req: Request, res: Response) => {
  const parsed = actionSchema.safeParse(req.body ?? {});
  await proxyOfferAction(req, res, {
    op: 'decline',
    external_id: req.params.id,
    offer_id: req.params.offerId,
    ...(parsed.success && parsed.data.note ? { note: parsed.data.note } : {}),
  });
});

export default router;
