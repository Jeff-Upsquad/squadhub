import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../../supabase';
import { loadPages } from '../../services/squadhireTraining';
import {
  allPaused,
  effectiveStatus,
  findBotByApiKey,
  listProviders,
  resolveAi,
  runBotReply,
  type SquadBotRow,
} from '../../services/squadBots';

/**
 * The API a Squad Bot's home app (SquadHire, Squad CRM, …) calls.
 *
 * Auth: `Authorization: Bearer sbk_…` — the per-bot key generated in SquadHub
 * admin. A key only ever reaches its own bot's settings and knowledge.
 *
 *   GET  /integrations/squad-bots/config     status, names, AI provider/model, instructions
 *   GET  /integrations/squad-bots/knowledge  the bot's published knowledge
 *   POST /integrations/squad-bots/reply      an AI reply through the bot's provider
 *
 * `status` tells the home app what to do with a reply:
 *   off       → do nothing (reply returns 423 without calling the AI)
 *   practice  → generate and log, but never send
 *   approval  → hold the reply for a person to approve
 *   live      → send it
 */

type BotRequest = Request & { squadBot?: SquadBotRow };

const router = Router();

async function requireBotKey(req: BotRequest, res: Response, next: NextFunction): Promise<void> {
  const header = req.header('authorization') ?? '';
  const key = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!key) {
    res.status(401).json({ success: false, error: 'Missing bot API key' });
    return;
  }
  const bot = await findBotByApiKey(key);
  if (!bot) {
    res.status(401).json({ success: false, error: 'Invalid bot API key' });
    return;
  }
  req.squadBot = bot;
  next();
}

router.use(requireBotKey);

router.get('/config', async (req: BotRequest, res: Response) => {
  try {
    const bot = req.squadBot!;
    const [paused, providers] = await Promise.all([allPaused(), listProviders()]);
    const resolved = resolveAi(bot, providers);
    res.json({
      success: true,
      data: {
        slug: bot.slug,
        internal_name: bot.internal_name,
        public_name: bot.public_name,
        status: effectiveStatus(bot, paused),
        all_paused: paused,
        ai:
          'error' in resolved
            ? { provider: null, provider_kind: null, model: null, error: resolved.error }
            : { provider: resolved.provider.slug, provider_kind: resolved.provider.kind, model: resolved.model, error: null },
        instructions: bot.instructions,
        max_tokens: bot.max_tokens,
        updated_at: bot.updated_at,
      },
    });
  } catch (err) {
    console.error('[squad-bots integration] config:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.get('/knowledge', async (req: BotRequest, res: Response) => {
  try {
    const { data: items, error } = await supabaseAdmin
      .from('lms_items')
      .select('id, title, summary, icon, knowledge_categories, updated_at')
      .eq('track', 'knowledge')
      .eq('status', 'published')
      .eq('bot_id', req.squadBot!.id)
      .is('origin_item_id', null)
      .order('updated_at', { ascending: false });
    if (error) throw new Error(error.message);
    const withPages = await Promise.all(
      (items ?? []).map(async (item) => ({ ...item, pages: await loadPages(item.id) })),
    );
    res.json({ success: true, data: withPages });
  } catch (err) {
    console.error('[squad-bots integration] knowledge:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

const replySchema = z.object({
  messages: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().min(1).max(100_000) }))
    .min(1)
    .max(200),
  // Extra, per-conversation context from the home app (who the person is,
  // relevant knowledge it retrieved, …). Added after the bot's instructions.
  context: z.string().max(200_000).optional(),
});

router.post('/reply', async (req: BotRequest, res: Response) => {
  let body: z.infer<typeof replySchema>;
  try {
    body = replySchema.parse(req.body);
  } catch (err) {
    const message = err instanceof z.ZodError ? err.errors[0]?.message : 'Invalid request';
    res.status(400).json({ success: false, error: message });
    return;
  }
  if (body.messages[0].role !== 'user') {
    res.status(400).json({ success: false, error: 'The first message must be from the user' });
    return;
  }

  const bot = req.squadBot!;
  const status = effectiveStatus(bot, await allPaused());
  if (status === 'off') {
    res.status(423).json({ success: false, error: 'This bot is turned off', status });
    return;
  }
  try {
    const reply = await runBotReply(bot, body, { source: 'app', status });
    res.json({ success: true, data: { status, public_name: bot.public_name, ...reply } });
  } catch (err: any) {
    res.status(502).json({ success: false, error: err?.message ?? 'The AI provider failed', status });
  }
});

export default router;
