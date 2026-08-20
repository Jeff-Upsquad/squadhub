import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requireMiniAppOrAdmin } from '../middleware/miniApp';
import { config } from '../config';
import { supabaseAdmin } from '../supabase';
import { logCardEvent, type CardEventType } from '../utils/cardEvents';

/**
 * Client View — Leads / admin acting as the business on a published card.
 *
 * SquadHire is canonical for review, select, and intro rooms. These routes
 * proxy the signed Client View webhooks and write a local activity row so the
 * feed shows who actually took the action (not the business user).
 *
 * Chat is opened/sent as the acting SquadHub user. The talent sees this
 * person's name, never the business company name.
 */

const router = Router();
router.use(requireAuth);
router.use(requireMiniAppOrAdmin('leads'));

const WRITE_TIMEOUT_MS = 8_000;
// Reads assemble the customer's whole screen upstream (card + every recipient's
// profile, tier, and live bid), so they get a longer budget than a write. They
// are idempotent, so waiting costs nothing but time.
const READ_TIMEOUT_MS = 20_000;

function configured(): boolean {
  return !!(config.squadhireWebhookUrl && config.squadhireWebhookSecret);
}

function buildUrl(suffix: string): string {
  const url = new URL(config.squadhireWebhookUrl);
  url.pathname = `/api/webhooks/squadhub/cards/client-view${suffix}`;
  url.search = '';
  return url.toString();
}

function actorPayload(req: Request) {
  return {
    email: req.userEmail ?? null,
    name: req.userName ?? req.userEmail ?? null,
    id: req.userId ?? null,
  };
}

async function cardExists(cardId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('subscription_cards')
    .select('id')
    .eq('id', cardId)
    .maybeSingle();
  return !!data;
}

async function proxy(
  req: Request,
  res: Response,
  suffix: string,
  body: Record<string, unknown>,
  opts?: { eventType?: CardEventType; metadata?: Record<string, unknown>; timeoutMs?: number },
): Promise<void> {
  if (!configured()) {
    res.status(503).json({ success: false, error: 'SquadHire integration is not configured on this server' });
    return;
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-SquadHub-Signature': config.squadhireWebhookSecret,
  };
  if (req.userEmail) headers['X-SquadHub-Actor'] = req.userEmail;
  if (req.userName) headers['X-SquadHub-Actor-Name'] = req.userName;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts?.timeoutMs ?? WRITE_TIMEOUT_MS);
  try {
    const upstream = await fetch(buildUrl(suffix), {
      method: 'POST',
      headers,
      body: JSON.stringify({ ...body, actor: actorPayload(req) }),
      signal: controller.signal,
    });
    const text = await upstream.text();
    if (upstream.ok && opts?.eventType) {
      await logCardEvent({
        cardId: req.params.id as string,
        eventType: opts.eventType,
        actorId: req.userId ?? null,
        actorType: 'admin',
        actorLabel: req.userName || req.userEmail || null,
        metadata: opts.metadata ?? {},
      });
    }
    res.status(upstream.status).type('application/json').send(text || '{}');
  } catch (err) {
    console.error('[client-view] upstream failed', suffix, (err as Error)?.message);
    res.status(502).json({ success: false, error: 'SquadHire is unreachable' });
  } finally {
    clearTimeout(timer);
  }
}

// recipient_id targets one exact row — a grouped brief holds a row per tier
// card for the same talent, so the talent id alone is ambiguous there.
const reviewSchema = z
  .object({
    talent_user_id: z.string().uuid(),
    recipient_id: z.string().uuid().optional(),
    action: z.enum(['shortlist', 'reject', 'unshortlist']),
    talent_name: z.string().trim().max(200).optional(),
  })
  .strict();

const selectSchema = z
  .object({
    talent_user_id: z.string().uuid(),
    recipient_id: z.string().uuid().optional(),
    talent_name: z.string().trim().max(200).optional(),
  })
  .strict();

const openChatSchema = z
  .object({
    talent_user_id: z.string().uuid(),
    talent_name: z.string().trim().max(200).optional(),
  })
  .strict();

const listMessagesSchema = z
  .object({
    conversation_id: z.string().uuid(),
    after: z.string().uuid().optional(),
    limit: z.number().int().min(1).max(100).optional(),
  })
  .strict();

const sendMessageSchema = z
  .object({
    conversation_id: z.string().uuid(),
    body: z.string().trim().min(1).max(4000),
    talent_user_id: z.string().uuid().optional(),
    talent_name: z.string().trim().max(200).optional(),
  })
  .strict();

const paymentLinkSchema = z
  .object({
    recipient_id: z.string().uuid(),
    talent_name: z.string().trim().max(200).optional(),
  })
  .strict();

const REVIEW_EVENT: Record<'shortlist' | 'reject' | 'unshortlist', CardEventType> = {
  shortlist: 'client_shortlisted',
  reject: 'client_rejected',
  unshortlist: 'client_unshortlisted',
};

// POST /admin/subscription-cards/:id/client-view/review
router.post('/:id/client-view/review', async (req: Request, res: Response) => {
  const parsed = reviewSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: parsed.error.issues[0]?.message || 'Invalid body' });
    return;
  }
  const cardId = req.params.id as string;
  if (!(await cardExists(cardId))) {
    res.status(404).json({ success: false, error: 'Card not found' });
    return;
  }
  await proxy(req, res, '/review', {
    external_id: cardId,
    talent_user_id: parsed.data.talent_user_id,
    recipient_id: parsed.data.recipient_id,
    action: parsed.data.action,
  }, {
    eventType: REVIEW_EVENT[parsed.data.action],
    metadata: {
      talent_user_id: parsed.data.talent_user_id,
      talent_name: parsed.data.talent_name ?? null,
      action: parsed.data.action,
    },
  });
});

// POST /admin/subscription-cards/:id/client-view/select
router.post('/:id/client-view/select', async (req: Request, res: Response) => {
  const parsed = selectSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: parsed.error.issues[0]?.message || 'Invalid body' });
    return;
  }
  const cardId = req.params.id as string;
  if (!(await cardExists(cardId))) {
    res.status(404).json({ success: false, error: 'Card not found' });
    return;
  }
  await proxy(req, res, '/select', {
    external_id: cardId,
    talent_user_id: parsed.data.talent_user_id,
    recipient_id: parsed.data.recipient_id,
  }, {
    eventType: 'client_selected',
    metadata: {
      talent_user_id: parsed.data.talent_user_id,
      talent_name: parsed.data.talent_name ?? null,
    },
  });
});

// POST /admin/subscription-cards/:id/client-view/conversations
router.post('/:id/client-view/conversations', async (req: Request, res: Response) => {
  const parsed = openChatSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: parsed.error.issues[0]?.message || 'Invalid body' });
    return;
  }
  const cardId = req.params.id as string;
  if (!(await cardExists(cardId))) {
    res.status(404).json({ success: false, error: 'Card not found' });
    return;
  }
  await proxy(req, res, '/conversations', {
    external_id: cardId,
    talent_user_id: parsed.data.talent_user_id,
  }, {
    eventType: 'client_chat_opened',
    metadata: {
      talent_user_id: parsed.data.talent_user_id,
      talent_name: parsed.data.talent_name ?? null,
    },
  });
});

// POST /admin/subscription-cards/:id/client-view/conversations/messages
router.post('/:id/client-view/conversations/messages', async (req: Request, res: Response) => {
  const parsed = listMessagesSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: parsed.error.issues[0]?.message || 'Invalid body' });
    return;
  }
  const cardId = req.params.id as string;
  if (!(await cardExists(cardId))) {
    res.status(404).json({ success: false, error: 'Card not found' });
    return;
  }
  await proxy(req, res, '/conversations/messages', {
    conversation_id: parsed.data.conversation_id,
    after: parsed.data.after,
    limit: parsed.data.limit,
  });
});

// POST /admin/subscription-cards/:id/client-view/conversations/send
router.post('/:id/client-view/conversations/send', async (req: Request, res: Response) => {
  const parsed = sendMessageSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: parsed.error.issues[0]?.message || 'Invalid body' });
    return;
  }
  const cardId = req.params.id as string;
  if (!(await cardExists(cardId))) {
    res.status(404).json({ success: false, error: 'Card not found' });
    return;
  }
  const preview = parsed.data.body.length > 160 ? `${parsed.data.body.slice(0, 157)}…` : parsed.data.body;
  await proxy(req, res, '/conversations/send', {
    conversation_id: parsed.data.conversation_id,
    body: parsed.data.body,
  }, {
    eventType: 'client_chat_message',
    metadata: {
      conversation_id: parsed.data.conversation_id,
      talent_user_id: parsed.data.talent_user_id ?? null,
      talent_name: parsed.data.talent_name ?? null,
      preview,
    },
  });
});

// GET /admin/subscription-cards/:id/client-view/card
// The card + its recipients in the business portal's own shape (photo, tier,
// category, live bid figure, "New" markers). Read-only, so a SquadHire outage
// degrades to an empty screen rather than an error page.
router.get('/:id/client-view/card', async (req: Request, res: Response) => {
  const cardId = req.params.id as string;
  if (!(await cardExists(cardId))) {
    res.status(404).json({ success: false, error: 'Card not found' });
    return;
  }
  await proxy(req, res, '/card', { external_id: cardId }, { timeoutMs: READ_TIMEOUT_MS });
});

// GET /admin/subscription-cards/:id/client-view/payments
router.get('/:id/client-view/payments', async (req: Request, res: Response) => {
  const cardId = req.params.id as string;
  if (!(await cardExists(cardId))) {
    res.status(404).json({ success: false, error: 'Card not found' });
    return;
  }
  await proxy(req, res, '/payments', { external_id: cardId }, { timeoutMs: READ_TIMEOUT_MS });
});

// POST /admin/subscription-cards/:id/client-view/unselect
// Undo the business's pick. SquadHire applies the same guards the customer
// gets: refused once the subscription is live or the card has been paid for.
router.post('/:id/client-view/unselect', async (req: Request, res: Response) => {
  const cardId = req.params.id as string;
  if (!(await cardExists(cardId))) {
    res.status(404).json({ success: false, error: 'Card not found' });
    return;
  }
  const talentName = typeof req.body?.talent_name === 'string' ? req.body.talent_name.slice(0, 200) : null;
  await proxy(req, res, '/unselect', { external_id: cardId }, {
    eventType: 'client_unselected',
    metadata: { talent_name: talentName },
  });
});

// POST /admin/subscription-cards/:id/client-view/payments/link
// Mints (or resumes) the hosted payment link for the selected talent so it can
// be passed to the client. The Hub never collects the payment itself.
router.post('/:id/client-view/payments/link', async (req: Request, res: Response) => {
  const parsed = paymentLinkSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: parsed.error.issues[0]?.message || 'Invalid body' });
    return;
  }
  const cardId = req.params.id as string;
  if (!(await cardExists(cardId))) {
    res.status(404).json({ success: false, error: 'Card not found' });
    return;
  }
  await proxy(req, res, '/payments/link', {
    external_id: cardId,
    recipient_id: parsed.data.recipient_id,
  }, {
    eventType: 'client_payment_link',
    metadata: {
      recipient_id: parsed.data.recipient_id,
      talent_name: parsed.data.talent_name ?? null,
    },
  });
});

export default router;
