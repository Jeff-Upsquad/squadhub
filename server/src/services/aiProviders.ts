import Anthropic from '@anthropic-ai/sdk';

/**
 * One way to call any AI provider a Squad Bot is set to use.
 *
 * Two kinds cover almost everything:
 *  - 'anthropic'          → the Claude API, through the official SDK.
 *  - 'openai_compatible'  → any /chat/completions API: OpenAI, OpenRouter,
 *                           Groq, Together, or a self-hosted Ollama / vLLM
 *                           serving an open-source model.
 *
 * API keys are never stored in the database. A provider row names the
 * environment variable that holds its key, and only variables that look like
 * AI keys are allowed, so an admin can't point a provider at an unrelated
 * server secret.
 */

export type AiProviderKind = 'anthropic' | 'openai_compatible';

export interface AiProviderRow {
  id: string;
  slug: string;
  name: string;
  kind: AiProviderKind;
  base_url: string | null;
  api_key_env: string | null;
  default_model: string | null;
  is_enabled: boolean;
  is_default: boolean;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  model: string;
  system: string;
  messages: ChatMessage[];
  maxTokens: number;
}

export interface ChatResult {
  text: string;
  inputTokens: number | null;
  outputTokens: number | null;
}

const REQUEST_TIMEOUT_MS = 120_000;

// ANTHROPIC_API_KEY, OPENAI_API_KEY, … or any AI_<NAME>_API_KEY.
export const API_KEY_ENV_PATTERN =
  /^(ANTHROPIC|OPENAI|OPENROUTER|GROQ|TOGETHER|MISTRAL|DEEPSEEK|FIREWORKS|GEMINI|AI_[A-Z0-9_]+)_API_KEY$/;

/** https anywhere; plain http only for a model server on this machine (e.g. Ollama). */
export function isAllowedBaseUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol === 'https:') return true;
    return url.protocol === 'http:' && ['localhost', '127.0.0.1', 'host.docker.internal'].includes(url.hostname);
  } catch {
    return false;
  }
}

/** The provider's key from the environment, or null when it has none (e.g. local Ollama). */
export function providerApiKey(provider: Pick<AiProviderRow, 'api_key_env'>): string | null {
  const env = provider.api_key_env;
  if (!env || !API_KEY_ENV_PATTERN.test(env)) return null;
  return process.env[env] || null;
}

/** Why this provider can't be used right now, or null when it's ready. */
export function providerProblem(provider: AiProviderRow): string | null {
  if (!provider.is_enabled) return `${provider.name} is turned off`;
  if (provider.kind === 'openai_compatible' && !provider.base_url) return `${provider.name} has no base URL`;
  if (provider.api_key_env && !providerApiKey(provider)) {
    return `${provider.api_key_env} is not set on the server`;
  }
  if (provider.kind === 'anthropic' && !providerApiKey(provider)) {
    return `${provider.name} needs an API key variable (e.g. ANTHROPIC_API_KEY)`;
  }
  return null;
}

const anthropicClients = new Map<string, Anthropic>();
function anthropicClient(apiKey: string, baseURL: string | null): Anthropic {
  const cacheKey = `${apiKey}|${baseURL ?? ''}`;
  let client = anthropicClients.get(cacheKey);
  if (!client) {
    client = new Anthropic({ apiKey, ...(baseURL ? { baseURL } : {}), timeout: REQUEST_TIMEOUT_MS });
    anthropicClients.set(cacheKey, client);
  }
  return client;
}

export async function chat(provider: AiProviderRow, req: ChatRequest): Promise<ChatResult> {
  const problem = providerProblem(provider);
  if (problem) throw new Error(problem);
  return provider.kind === 'anthropic' ? chatAnthropic(provider, req) : chatOpenAiCompatible(provider, req);
}

async function chatAnthropic(provider: AiProviderRow, req: ChatRequest): Promise<ChatResult> {
  const client = anthropicClient(providerApiKey(provider)!, provider.base_url);
  // Streamed so a large max_tokens never trips the SDK's non-streaming timeout guard.
  const message = await client.messages
    .stream({
      model: req.model,
      max_tokens: req.maxTokens,
      ...(req.system ? { system: req.system } : {}),
      messages: req.messages,
    })
    .finalMessage();

  if (message.stop_reason === 'refusal') {
    throw new Error('Claude declined to answer this request');
  }
  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
  return {
    text,
    inputTokens: message.usage?.input_tokens ?? null,
    outputTokens: message.usage?.output_tokens ?? null,
  };
}

async function chatOpenAiCompatible(provider: AiProviderRow, req: ChatRequest): Promise<ChatResult> {
  const endpoint = `${provider.base_url!.replace(/\/+$/, '')}/chat/completions`;
  const apiKey = providerApiKey(provider);
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: req.model,
      max_tokens: req.maxTokens,
      messages: [
        ...(req.system ? [{ role: 'system', content: req.system }] : []),
        ...req.messages,
      ],
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${provider.name} responded ${res.status}: ${body.slice(0, 300)}`);
  }
  const body = (await res.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  return {
    text: body.choices?.[0]?.message?.content ?? '',
    inputTokens: body.usage?.prompt_tokens ?? null,
    outputTokens: body.usage?.completion_tokens ?? null,
  };
}
