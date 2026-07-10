import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { config } from '../config';
import { supabaseAdmin } from '../supabase';

/**
 * Assignments — admin offer / counter-offer management.
 *
 * SquadHire (Profiles) is CANONICAL for the offer negotiation, and the admin
 * reads it LIVE (the "synced, not mirrored, fetched live" requirement): there
 * is NO local mirror. GET /:id/offers fetches the snapshot straight from
 * Profiles; every write is a signed proxy to its admin-mirror webhook
 * (/api/webhooks/squadhub/cards/offers) with actor {type:'admin',
 * source:'squadhub'} (Profiles applies it canonically + notifies the talent).
 *
 * Resilience mirrors job-cards-admin-candidates.ts: per-call timeout + a
 * circuit breaker. With no mirror, a degraded upstream yields an empty list
 * tagged source:'unavailable' (the UI shows a "temporarily unavailable" note)
 * rather than stale data.
 */

const router = Router();
router.use(requireAuth);
router.use(requireAdmin);

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

async function assignmentCardExists(cardId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('subscription_cards')
    .select('id, card_type')
    .eq('id', cardId)
    .maybeSingle();
  return !!data && (data as any).card_type === 'assignment';
}

// ============================================================
// GET /admin/subscription-cards/:id/offers — live offer negotiations.
// Fetched LIVE from SquadHire (no mirror). source:'unavailable' on a degraded
// upstream so the UI can show a retry note instead of stale data.
// ============================================================
router.get('/:id/offers', async (req: Request, res: Response) => {
  try {
    const cardId = req.params.id as string;
    if (!(await assignmentCardExists(cardId))) {
      res.status(404).json({ success: false, error: 'Assignment card not found' });
      return;
    }
    if (!configured() || breakerIsOpen()) {
      res.json({ success: true, source: 'unavailable', offers: [] });
      return;
    }
    try {
      const snap = await fetchOffersSnapshot(cardId);
      recordSuccess();
      res.json({ success: true, source: 'live', offers: snap?.offers ?? [] });
    } catch (err) {
      recordFailure();
      console.error('[assignment-offers] live offers fetch failed:', (err as Error)?.message);
      res.json({ success: true, source: 'unavailable', offers: [] });
    }
  } catch (err: any) {
    console.error('List assignment offers error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

const counterSchema = z.object({
  amount: z.object({ amount: z.number().nonnegative() }).passthrough(),
  note: z.string().trim().max(2000).optional(),
});
const actionSchema = z.object({ note: z.string().trim().max(2000).optional() });

// POST /:id/offers/:offerId/counter — admin counters the talent's figure.
router.post('/:id/offers/:offerId/counter', async (req: Request, res: Response) => {
  const parsed = counterSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    return;
  }
  await proxyOfferAction(req, res, {
    op: 'counter',
    external_id: req.params.id,
    offer_id: req.params.offerId,
    amount: parsed.data.amount,
    ...(parsed.data.note ? { note: parsed.data.note } : {}),
  });
});

// POST /:id/offers/:offerId/accept — admin accepts (accept + select the talent).
router.post('/:id/offers/:offerId/accept', async (req: Request, res: Response) => {
  const parsed = actionSchema.safeParse(req.body ?? {});
  await proxyOfferAction(req, res, {
    op: 'accept',
    external_id: req.params.id,
    offer_id: req.params.offerId,
    ...(parsed.success && parsed.data.note ? { note: parsed.data.note } : {}),
  });
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
