import { createHash, randomBytes } from 'crypto';
import { supabaseAdmin } from '../supabase';
import { chat, providerProblem, type AiProviderRow, type ChatMessage } from './aiProviders';

/**
 * Squad Bots — the registry every bot's home app (SquadHire, Squad CRM, …)
 * reads its settings from, and the AI gateway it can talk through.
 *
 * SquadHub decides, per bot: is it on, which AI provider and model does it
 * use, what are its instructions and which knowledge is its own. The "all
 * paused" switch overrides every bot to off.
 */

export type SquadBotStatus = 'off' | 'practice' | 'approval' | 'live';
export type SquadBotHomeApp = 'squadhire' | 'squad_crm' | 'other';

export interface SquadBotRow {
  id: string;
  slug: string;
  internal_name: string;
  public_name: string;
  description: string;
  home_app: SquadBotHomeApp;
  status: SquadBotStatus;
  provider_id: string | null;
  model: string | null;
  instructions: string;
  max_tokens: number;
  api_key_prefix: string | null;
  api_key_created_at: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

// Everything but the key hash, which never leaves the server.
export const BOT_COLUMNS =
  'id, slug, internal_name, public_name, description, home_app, status, provider_id, model, instructions, max_tokens, api_key_prefix, api_key_created_at, sort_order, created_at, updated_at';

export const HIRING_BOT_SLUG = 'squad-hiring-bot';

export async function allPaused(): Promise<boolean> {
  const { data } = await supabaseAdmin.from('squad_bot_settings').select('all_paused').maybeSingle();
  return data?.all_paused === true;
}

/** The status the bot actually runs with: the emergency stop turns every bot off. */
export function effectiveStatus(bot: Pick<SquadBotRow, 'status'>, paused: boolean): SquadBotStatus {
  return paused ? 'off' : bot.status;
}

export async function listProviders(): Promise<AiProviderRow[]> {
  const { data, error } = await supabaseAdmin.from('ai_providers').select('*').order('created_at');
  if (error) throw new Error(error.message);
  return (data ?? []) as AiProviderRow[];
}

export interface ResolvedAi {
  provider: AiProviderRow;
  model: string;
  usesDefaultProvider: boolean;
}

/**
 * The provider and model a bot uses: its own choice, else the default
 * provider; its own model, else that provider's default model.
 */
export function resolveAi(bot: Pick<SquadBotRow, 'provider_id' | 'model'>, providers: AiProviderRow[]): ResolvedAi | { error: string } {
  const own = bot.provider_id ? providers.find((p) => p.id === bot.provider_id) : undefined;
  const provider = own ?? providers.find((p) => p.is_default);
  if (!provider) return { error: 'No AI provider is set for this bot and there is no default provider' };
  const model = (bot.model || provider.default_model || '').trim();
  if (!model) return { error: `Pick a model for this bot — ${provider.name} has no default model` };
  return { provider, model, usesDefaultProvider: !own };
}

/** A new per-bot API key. Only its hash is stored; the key is shown once. */
export function generateBotApiKey(): { key: string; hash: string; prefix: string } {
  const key = `sbk_${randomBytes(24).toString('base64url')}`;
  return { key, hash: hashBotApiKey(key), prefix: key.slice(0, 10) };
}

export function hashBotApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export async function findBotByApiKey(key: string): Promise<SquadBotRow | null> {
  if (!key.startsWith('sbk_')) return null;
  const { data } = await supabaseAdmin
    .from('squad_bots')
    .select(BOT_COLUMNS)
    .eq('api_key_hash', hashBotApiKey(key))
    .maybeSingle();
  return (data as SquadBotRow | null) ?? null;
}

export interface BotReplyResult {
  text: string;
  provider: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
}

/**
 * Ask the bot's AI for a reply, and log the call. Callers check the bot's
 * status first — this runs whatever the status, so the admin "Try it" box
 * works on a bot that is still off.
 */
export async function runBotReply(
  bot: SquadBotRow,
  input: { messages: ChatMessage[]; context?: string },
  opts: { source: 'app' | 'admin_test'; status: SquadBotStatus },
): Promise<BotReplyResult> {
  const providers = await listProviders();
  const resolved = resolveAi(bot, providers);
  const started = Date.now();

  const log = (row: Record<string, unknown>) =>
    supabaseAdmin
      .from('squad_bot_runs')
      .insert({ bot_id: bot.id, source: opts.source, bot_status: opts.status, latency_ms: Date.now() - started, ...row })
      .then(({ error }) => {
        if (error) console.error('[squad-bots] run log failed:', error.message);
      });

  if ('error' in resolved) {
    await log({ ok: false, error: resolved.error });
    throw new Error(resolved.error);
  }
  const { provider, model } = resolved;
  const system = [bot.instructions.trim(), input.context?.trim()].filter(Boolean).join('\n\n');

  try {
    const result = await chat(provider, { model, system, messages: input.messages, maxTokens: bot.max_tokens });
    await log({
      ok: true,
      provider_slug: provider.slug,
      model,
      input_tokens: result.inputTokens,
      output_tokens: result.outputTokens,
    });
    return { text: result.text, provider: provider.slug, model, inputTokens: result.inputTokens, outputTokens: result.outputTokens };
  } catch (err: any) {
    const message = String(err?.message ?? err).slice(0, 500);
    await log({ ok: false, provider_slug: provider.slug, model, error: message });
    throw new Error(message);
  }
}

/** Is this provider ready to use? Shown next to each provider in admin. */
export function providerReadiness(provider: AiProviderRow): { ready: boolean; problem: string | null } {
  const problem = providerProblem(provider);
  return { ready: !problem, problem };
}

/** The bot a slug names, or null. */
export async function botIdForSlug(slug: string): Promise<string | null> {
  const { data } = await supabaseAdmin.from('squad_bots').select('id').eq('slug', slug).maybeSingle();
  return data?.id ?? null;
}

/**
 * Does this bot live in SquadHire? Its knowledge is then pushed to SquadHire's
 * Knowledge Center. Knowledge with no bot is treated as the hiring bot's, as
 * all knowledge was before bots existed.
 */
export async function isSquadhireBot(botId: string | null | undefined): Promise<boolean> {
  if (!botId) return true;
  const { data } = await supabaseAdmin.from('squad_bots').select('home_app').eq('id', botId).maybeSingle();
  return data?.home_app === 'squadhire';
}
