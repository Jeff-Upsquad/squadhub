import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { supabaseAdmin } from '../supabase';
import { API_KEY_ENV_PATTERN, isAllowedBaseUrl, type AiProviderRow } from '../services/aiProviders';
import {
  BOT_COLUMNS,
  allPaused,
  effectiveStatus,
  generateBotApiKey,
  listProviders,
  providerReadiness,
  resolveAi,
  runBotReply,
  type SquadBotRow,
} from '../services/squadBots';

/**
 * Admin control room for Squad Bots: bots, their on/off status, AI provider
 * and model, per-bot API keys, the emergency stop, and the shared AI provider
 * list. Knowledge is edited in Resources (knowledge track) and linked here.
 */

const router = Router();
router.use(requireAuth);
router.use(requireAdmin);

function sendError(res: Response, err: unknown, label: string) {
  if (err instanceof z.ZodError) {
    res.status(400).json({ success: false, error: err.errors[0]?.message ?? 'Invalid input' });
    return;
  }
  console.error(`[squad-bots-admin] ${label}:`, err);
  res.status(500).json({ success: false, error: 'Internal server error' });
}

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'bot';
}

function presentProvider(p: AiProviderRow) {
  return { ...p, ...providerReadiness(p) };
}

function presentAi(bot: SquadBotRow, providers: AiProviderRow[]) {
  const resolved = resolveAi(bot, providers);
  if ('error' in resolved) return { provider_name: null, model: null, uses_default_provider: !bot.provider_id, problem: resolved.error };
  const { ready, problem } = providerReadiness(resolved.provider);
  return {
    provider_name: resolved.provider.name,
    model: resolved.model,
    uses_default_provider: resolved.usesDefaultProvider,
    problem: ready ? null : problem,
  };
}

// ------------------------------------------------------------
// Overview
// ------------------------------------------------------------

// GET /admin/squad-bots — every bot with its status, AI, knowledge count and
// today's activity, plus the provider list and the emergency stop.
router.get('/', async (_req: Request, res: Response) => {
  try {
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);

    const [botsRes, providers, paused, knowledgeRes, runsRes] = await Promise.all([
      supabaseAdmin.from('squad_bots').select(BOT_COLUMNS).order('sort_order').order('created_at'),
      listProviders(),
      allPaused(),
      supabaseAdmin.from('lms_items').select('bot_id, status').eq('track', 'knowledge').is('origin_item_id', null),
      supabaseAdmin.from('squad_bot_runs').select('bot_id, ok').gte('created_at', startOfDay.toISOString()),
    ]);
    if (botsRes.error) throw new Error(botsRes.error.message);

    const knowledge = new Map<string, { total: number; published: number }>();
    for (const k of knowledgeRes.data ?? []) {
      if (!k.bot_id) continue;
      const entry = knowledge.get(k.bot_id) ?? { total: 0, published: 0 };
      entry.total += 1;
      if (k.status === 'published') entry.published += 1;
      knowledge.set(k.bot_id, entry);
    }
    const runs = new Map<string, { total: number; failed: number }>();
    for (const r of runsRes.data ?? []) {
      const entry = runs.get(r.bot_id) ?? { total: 0, failed: 0 };
      entry.total += 1;
      if (!r.ok) entry.failed += 1;
      runs.set(r.bot_id, entry);
    }

    const bots = ((botsRes.data ?? []) as SquadBotRow[]).map((bot) => ({
      ...bot,
      effective_status: effectiveStatus(bot, paused),
      ai: presentAi(bot, providers),
      knowledge: knowledge.get(bot.id) ?? { total: 0, published: 0 },
      runs_today: runs.get(bot.id) ?? { total: 0, failed: 0 },
    }));

    res.json({
      success: true,
      data: { bots, providers: providers.map(presentProvider), settings: { all_paused: paused } },
    });
  } catch (err) {
    sendError(res, err, 'list');
  }
});

// PUT /admin/squad-bots/settings — the emergency stop for every bot.
router.put('/settings', async (req: Request, res: Response) => {
  try {
    const body = z.object({ all_paused: z.boolean() }).parse(req.body);
    const { data, error } = await supabaseAdmin
      .from('squad_bot_settings')
      .upsert({
        id: true,
        all_paused: body.all_paused,
        paused_at: body.all_paused ? new Date().toISOString() : null,
        paused_by: body.all_paused ? req.userId : null,
      })
      .select('all_paused')
      .single();
    if (error) throw new Error(error.message);
    res.json({ success: true, data });
  } catch (err) {
    sendError(res, err, 'settings');
  }
});

// ------------------------------------------------------------
// AI providers
// ------------------------------------------------------------

const apiKeyEnvSchema = z
  .string()
  .trim()
  .regex(API_KEY_ENV_PATTERN, 'Key variable must be an AI key name like ANTHROPIC_API_KEY, OPENAI_API_KEY or AI_<NAME>_API_KEY');
const baseUrlSchema = z
  .string()
  .trim()
  .refine(isAllowedBaseUrl, 'Base URL must be https (plain http is allowed only for localhost)');

const providerCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  kind: z.enum(['anthropic', 'openai_compatible']),
  base_url: baseUrlSchema.nullable().optional(),
  api_key_env: apiKeyEnvSchema.nullable().optional(),
  default_model: z.string().trim().max(200).nullable().optional(),
  is_enabled: z.boolean().optional(),
});

router.post('/providers', async (req: Request, res: Response) => {
  try {
    const body = providerCreateSchema.parse(req.body);
    if (body.kind === 'openai_compatible' && !body.base_url) {
      res.status(400).json({ success: false, error: 'An OpenAI-compatible provider needs a base URL' });
      return;
    }
    let slug = slugify(body.name);
    const { data: clash } = await supabaseAdmin.from('ai_providers').select('id').eq('slug', slug).maybeSingle();
    if (clash) slug = `${slug}-${Date.now().toString(36)}`;
    const { data, error } = await supabaseAdmin
      .from('ai_providers')
      .insert({
        slug,
        name: body.name,
        kind: body.kind,
        base_url: body.base_url || null,
        api_key_env: body.api_key_env || null,
        default_model: body.default_model || null,
        is_enabled: body.is_enabled ?? true,
      })
      .select('*')
      .single();
    if (error) throw new Error(error.message);
    res.json({ success: true, data: presentProvider(data as AiProviderRow) });
  } catch (err) {
    sendError(res, err, 'create provider');
  }
});

router.patch('/providers/:id', async (req: Request, res: Response) => {
  try {
    const body = providerCreateSchema.partial().parse(req.body);
    const patch: Record<string, unknown> = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.kind !== undefined) patch.kind = body.kind;
    if (body.base_url !== undefined) patch.base_url = body.base_url || null;
    if (body.api_key_env !== undefined) patch.api_key_env = body.api_key_env || null;
    if (body.default_model !== undefined) patch.default_model = body.default_model || null;
    if (body.is_enabled !== undefined) patch.is_enabled = body.is_enabled;

    const { data: current } = await supabaseAdmin.from('ai_providers').select('*').eq('id', req.params.id).maybeSingle();
    if (!current) {
      res.status(404).json({ success: false, error: 'Provider not found' });
      return;
    }
    if (current.is_default && patch.is_enabled === false) {
      res.status(400).json({ success: false, error: 'Make another provider the default before turning this one off' });
      return;
    }
    const next = { ...current, ...patch };
    if (next.kind === 'openai_compatible' && !next.base_url) {
      res.status(400).json({ success: false, error: 'An OpenAI-compatible provider needs a base URL' });
      return;
    }

    const { data, error } = await supabaseAdmin.from('ai_providers').update(patch).eq('id', req.params.id).select('*').single();
    if (error) throw new Error(error.message);
    res.json({ success: true, data: presentProvider(data as AiProviderRow) });
  } catch (err) {
    sendError(res, err, 'update provider');
  }
});

// POST /admin/squad-bots/providers/:id/default — the provider every bot uses
// unless it picks its own.
router.post('/providers/:id/default', async (req: Request, res: Response) => {
  try {
    const { data: target } = await supabaseAdmin.from('ai_providers').select('id, is_enabled').eq('id', req.params.id).maybeSingle();
    if (!target) {
      res.status(404).json({ success: false, error: 'Provider not found' });
      return;
    }
    if (!target.is_enabled) {
      res.status(400).json({ success: false, error: 'Turn this provider on before making it the default' });
      return;
    }
    // Clear first: the unique index allows only one default at a time.
    const cleared = await supabaseAdmin.from('ai_providers').update({ is_default: false }).eq('is_default', true);
    if (cleared.error) throw new Error(cleared.error.message);
    const { error } = await supabaseAdmin.from('ai_providers').update({ is_default: true }).eq('id', req.params.id);
    if (error) throw new Error(error.message);
    res.json({ success: true });
  } catch (err) {
    sendError(res, err, 'set default provider');
  }
});

router.delete('/providers/:id', async (req: Request, res: Response) => {
  try {
    const { data: target } = await supabaseAdmin.from('ai_providers').select('is_default').eq('id', req.params.id).maybeSingle();
    if (target?.is_default) {
      res.status(400).json({ success: false, error: 'The default provider cannot be deleted' });
      return;
    }
    // Bots using it fall back to the default provider (provider_id → NULL).
    const { error } = await supabaseAdmin.from('ai_providers').delete().eq('id', req.params.id);
    if (error) throw new Error(error.message);
    res.json({ success: true });
  } catch (err) {
    sendError(res, err, 'delete provider');
  }
});

// ------------------------------------------------------------
// Bots
// ------------------------------------------------------------

const homeAppSchema = z.enum(['squadhire', 'squad_crm', 'other']);
const statusSchema = z.enum(['off', 'practice', 'approval', 'live']);

router.post('/', async (req: Request, res: Response) => {
  try {
    const body = z
      .object({
        internal_name: z.string().trim().min(1).max(100),
        public_name: z.string().trim().min(1).max(100).optional(),
        description: z.string().trim().max(1000).optional(),
        home_app: homeAppSchema.optional(),
      })
      .parse(req.body);
    let slug = slugify(body.internal_name);
    const { data: clash } = await supabaseAdmin.from('squad_bots').select('id').eq('slug', slug).maybeSingle();
    if (clash) slug = `${slug}-${Date.now().toString(36)}`;
    const { data: last } = await supabaseAdmin.from('squad_bots').select('sort_order').order('sort_order', { ascending: false }).limit(1).maybeSingle();

    const { data, error } = await supabaseAdmin
      .from('squad_bots')
      .insert({
        slug,
        internal_name: body.internal_name,
        public_name: body.public_name || 'Squad Bot',
        description: body.description ?? '',
        home_app: body.home_app ?? 'other',
        status: 'off',
        sort_order: (last?.sort_order ?? 0) + 1,
      })
      .select(BOT_COLUMNS)
      .single();
    if (error) throw new Error(error.message);
    res.json({ success: true, data });
  } catch (err) {
    sendError(res, err, 'create bot');
  }
});

// GET /admin/squad-bots/:id — one bot with its knowledge and recent activity.
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { data: bot } = await supabaseAdmin.from('squad_bots').select(BOT_COLUMNS).eq('id', req.params.id).maybeSingle();
    if (!bot) {
      res.status(404).json({ success: false, error: 'Bot not found' });
      return;
    }
    const [providers, paused, knowledgeRes, runsRes] = await Promise.all([
      listProviders(),
      allPaused(),
      supabaseAdmin
        .from('lms_items')
        .select('id, title, status, updated_at, knowledge_categories')
        .eq('track', 'knowledge')
        .eq('bot_id', req.params.id)
        .is('origin_item_id', null)
        .order('updated_at', { ascending: false }),
      supabaseAdmin
        .from('squad_bot_runs')
        .select('id, source, bot_status, provider_slug, model, ok, error, input_tokens, output_tokens, latency_ms, created_at')
        .eq('bot_id', req.params.id)
        .order('created_at', { ascending: false })
        .limit(25),
    ]);
    const row = bot as SquadBotRow;
    res.json({
      success: true,
      data: {
        ...row,
        effective_status: effectiveStatus(row, paused),
        all_paused: paused,
        ai: presentAi(row, providers),
        providers: providers.map(presentProvider),
        knowledge_items: knowledgeRes.data ?? [],
        recent_runs: runsRes.data ?? [],
      },
    });
  } catch (err) {
    sendError(res, err, 'get bot');
  }
});

router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const body = z
      .object({
        internal_name: z.string().trim().min(1).max(100).optional(),
        public_name: z.string().trim().min(1).max(100).optional(),
        description: z.string().trim().max(1000).optional(),
        home_app: homeAppSchema.optional(),
        status: statusSchema.optional(),
        provider_id: z.string().uuid().nullable().optional(),
        model: z.string().trim().max(200).nullable().optional(),
        instructions: z.string().max(50_000).optional(),
        max_tokens: z.number().int().min(1).max(64_000).optional(),
      })
      .parse(req.body);
    const patch: Record<string, unknown> = { ...body };
    if (body.model !== undefined) patch.model = body.model || null;

    const { data, error } = await supabaseAdmin
      .from('squad_bots')
      .update(patch)
      .eq('id', req.params.id)
      .select(BOT_COLUMNS)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) {
      res.status(404).json({ success: false, error: 'Bot not found' });
      return;
    }
    res.json({ success: true, data });
  } catch (err) {
    sendError(res, err, 'update bot');
  }
});

// POST /admin/squad-bots/:id/api-key — a new key for the bot's home app.
// Replaces any earlier key; the key is returned once and never shown again.
router.post('/:id/api-key', async (req: Request, res: Response) => {
  try {
    const { key, hash, prefix } = generateBotApiKey();
    const { data, error } = await supabaseAdmin
      .from('squad_bots')
      .update({ api_key_hash: hash, api_key_prefix: prefix, api_key_created_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .select('id')
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) {
      res.status(404).json({ success: false, error: 'Bot not found' });
      return;
    }
    res.json({ success: true, data: { api_key: key, api_key_prefix: prefix } });
  } catch (err) {
    sendError(res, err, 'api key');
  }
});

router.delete('/:id/api-key', async (req: Request, res: Response) => {
  try {
    const { error } = await supabaseAdmin
      .from('squad_bots')
      .update({ api_key_hash: null, api_key_prefix: null, api_key_created_at: null })
      .eq('id', req.params.id);
    if (error) throw new Error(error.message);
    res.json({ success: true });
  } catch (err) {
    sendError(res, err, 'revoke api key');
  }
});

// POST /admin/squad-bots/:id/test — "Try it": one message through the bot's
// current provider, model and instructions. Works while the bot is off.
router.post('/:id/test', async (req: Request, res: Response) => {
  try {
    const body = z.object({ message: z.string().trim().min(1).max(4000) }).parse(req.body);
    const { data: bot } = await supabaseAdmin.from('squad_bots').select(BOT_COLUMNS).eq('id', req.params.id).maybeSingle();
    if (!bot) {
      res.status(404).json({ success: false, error: 'Bot not found' });
      return;
    }
    const row = bot as SquadBotRow;
    try {
      const reply = await runBotReply(
        row,
        { messages: [{ role: 'user', content: body.message }] },
        { source: 'admin_test', status: effectiveStatus(row, await allPaused()) },
      );
      res.json({ success: true, data: reply });
    } catch (err: any) {
      res.status(502).json({ success: false, error: err?.message ?? 'The AI provider failed' });
    }
  } catch (err) {
    sendError(res, err, 'test bot');
  }
});

export default router;
