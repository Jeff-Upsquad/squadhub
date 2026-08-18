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
  opts?: { eventType?: CardEventType; metadata?: Record<string, unknown> },
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
  const timer = setTimeout(() => controller.abort(), WRITE_TIMEOUT_MS);
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

const reviewSchema = z
  .object({
    talent_user_id: z.string().uuid(),
    action: z.enum(['shortlist', 'reject', 'unshortlist']),
    talent_name: z.string().trim().max(200).optional(),
  })
  .strict();

const selectSchema = z
  .object({
    talent_user_id: z.string().uuid(),
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

export default router;
