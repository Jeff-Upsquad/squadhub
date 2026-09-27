import { createHash } from 'crypto';
import { z } from 'zod';
import type { AiProviderBilling, AiProviderBillingMetric } from '@squadhub/shared';
import { providerApiKey, type AiProviderRow } from './aiProviders';

export const BILLING_KEY_ENV_PATTERN = /^(ANTHROPIC_ADMIN|OPENAI_ADMIN|OPENROUTER_MANAGEMENT|AI_[A-Z0-9_]+_BILLING)_API_KEY$/;
export const billingSettingsSchema = z.object({
  mode: z.enum(['unknown', 'prepaid', 'pay_as_you_go']),
  key_env: z.string().trim().regex(BILLING_KEY_ENV_PATTERN, 'Use ANTHROPIC_ADMIN_API_KEY, OPENAI_ADMIN_API_KEY, OPENROUTER_MANAGEMENT_API_KEY or AI_<NAME>_BILLING_API_KEY').nullable(),
  manual: z.object({
    balance_usd: z.number().finite().min(-1e9).max(1e9).nullable(),
    spend_usd: z.number().finite().min(0).max(1e9).nullable(),
    as_of: z.string().datetime().refine((value) => Date.parse(value) <= Date.now(), 'The recorded date cannot be in the future'),
  }).nullable(),
});

type Vendor = 'anthropic' | 'openai' | 'openrouter';
export function billingVendor(p: AiProviderRow): Vendor | null {
  // Privileged billing credentials must never follow a custom inference URL.
  const base = p.base_url?.replace(/\/+$/, '');
  if (p.kind === 'anthropic' && (!base || base === 'https://api.anthropic.com')) return 'anthropic';
  if (p.kind === 'openai_compatible' && base === 'https://api.openai.com/v1') return 'openai';
  if (p.kind === 'openai_compatible' && base === 'https://openrouter.ai/api/v1') return 'openrouter';
  return null;
}
const billingUrls: Record<Vendor, string> = {
  anthropic: 'https://platform.claude.com/settings/billing',
  openai: 'https://platform.openai.com/settings/organization/billing/overview',
  openrouter: 'https://openrouter.ai/settings/credits',
};
function keyEnv(p: AiProviderRow, vendor: Vendor): string | null {
  if (p.billing_settings?.key_env) return p.billing_settings.key_env;
  const defaults: Record<Vendor, [string, string]> = {
    anthropic: ['ANTHROPIC_API_KEY', 'ANTHROPIC_ADMIN_API_KEY'],
    openai: ['OPENAI_API_KEY', 'OPENAI_ADMIN_API_KEY'],
    openrouter: ['OPENROUTER_API_KEY', 'OPENROUTER_MANAGEMENT_API_KEY'],
  };
  return p.api_key_env === defaults[vendor][0] ? defaults[vendor][1] : null;
}
function billingKey(env: string | null): string | null {
  return env && BILLING_KEY_ENV_PATTERN.test(env) ? process.env[env] || null : null;
}
function monthStart(date: Date): string {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)).toISOString();
}
function metric(usd: number, source: AiProviderBillingMetric['source'], scope: AiProviderBillingMetric['scope'], asOf: string, period: string | null): AiProviderBillingMetric {
  return { usd, source, scope, as_of: asOf, period_start: period };
}
async function request(url: URL | string, key: string, vendor: Vendor, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(url, {
    headers: vendor === 'anthropic'
      ? { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'User-Agent': 'SquadHub/1.0' }
      : { Authorization: `Bearer ${key}` },
    redirect: 'error',
    signal,
  });
  // Do not expose provider response bodies (which can contain credentials).
  if (!response.ok) throw new Error('Billing request failed');
  return response.json();
}
const amount = z.number().finite();
const costPageSchema = z.object({
  data: z.array(z.object({ results: z.array(z.unknown()) })),
  has_more: z.boolean(),
  next_page: z.string().nullable().optional(),
});
async function monthSpend(vendor: 'anthropic' | 'openai', key: string, now: Date, signal: AbortSignal): Promise<number> {
  const url = new URL(vendor === 'anthropic'
    ? 'https://api.anthropic.com/v1/organizations/cost_report'
    : 'https://api.openai.com/v1/organization/costs');
  const start = monthStart(now);
  url.searchParams.set('bucket_width', '1d');
  url.searchParams.set('limit', '31');
  if (vendor === 'anthropic') {
    url.searchParams.set('starting_at', start);
    url.searchParams.set('ending_at', now.toISOString());
  } else {
    url.searchParams.set('start_time', String(Date.parse(start) / 1000));
    url.searchParams.set('end_time', String(Math.floor(now.getTime() / 1000)));
  }
  let total = 0;
  const pages = new Set<string>();
  for (let i = 0; i < 50; i++) {
    const page = costPageSchema.parse(await request(url, key, vendor, signal));
    for (const bucket of page.data) {
      for (const raw of bucket.results) {
        if (vendor === 'anthropic') {
          const row = z.object({ amount: z.string().regex(/^-?\d+(\.\d+)?$/), currency: z.literal('USD') }).parse(raw);
          // Anthropic reports decimal cents; OpenAI reports dollars.
          total += amount.parse(Number(row.amount)) / 100;
        } else {
          const row = z.object({ amount: z.object({ value: amount, currency: z.literal('usd') }) }).parse(raw);
          total += row.amount.value;
        }
      }
    }
    if (!page.has_more) return amount.parse(total);
    if (!page.next_page || pages.has(page.next_page)) throw new Error('Incomplete billing report');
    pages.add(page.next_page);
    url.searchParams.set('page', page.next_page);
  }
  throw new Error('Incomplete billing report');
}

async function fetchBilling(p: AiProviderRow, now: Date): Promise<AiProviderBilling> {
  const vendor = billingVendor(p);
  const result: AiProviderBilling = { balance: null, spend: null, billing_url: vendor ? billingUrls[vendor] : null, messages: [] };
  const snapshot = p.billing_settings?.manual;
  if (snapshot) {
    if (snapshot.balance_usd !== null) result.balance = metric(snapshot.balance_usd, 'manual', 'account', snapshot.as_of, null);
    if (snapshot.spend_usd !== null) result.spend = metric(snapshot.spend_usd, 'manual', 'account', snapshot.as_of, monthStart(new Date(snapshot.as_of)));
  }
  if (!vendor) {
    result.messages.push('Automatic billing is unavailable for this provider. Record figures from your billing console in Edit billing.');
    return result;
  }
  const env = keyEnv(p, vendor);
  const key = billingKey(env);
  const asOf = now.toISOString();
  const signal = AbortSignal.timeout(10_000);
  if (vendor === 'openrouter') {
    // Key usage and account credits have distinct scopes and credentials.
    const inferenceKey = providerApiKey(p);
    await Promise.all([
      (async () => {
        if (!key) {
          result.messages.push('Connect an OpenRouter management key in Edit billing to see account credits.');
          return;
        }
        try {
          const body = z.object({ data: z.object({ total_credits: amount, total_usage: amount }) }).parse(await request('https://openrouter.ai/api/v1/credits', key, vendor, signal));
          result.balance = metric(body.data.total_credits - body.data.total_usage, 'provider', 'account', asOf, null);
        } catch {
          result.messages.push('Could not refresh account credits. Check the management key and try again.');
        }
      })(),
      (async () => {
        if (!inferenceKey) {
          result.messages.push('Connect the provider API key to see monthly spend for this key.');
          return;
        }
        try {
          const body = z.object({ data: z.object({ usage_monthly: amount }) }).parse(await request('https://openrouter.ai/api/v1/key', inferenceKey, vendor, signal));
          result.spend = metric(body.data.usage_monthly, 'provider', 'api_key', asOf, monthStart(now));
        } catch {
          result.messages.push('Could not refresh spend. Check the provider API key and try again.');
        }
      })(),
    ]);
  } else {
    if (!key) {
      result.messages.push(`Connect ${vendor === 'anthropic' ? 'an Anthropic' : 'an OpenAI'} admin key in Edit billing to see organization spend, or record it manually.`);
    } else {
      try {
        result.spend = metric(await monthSpend(vendor, key, now, signal), 'provider', 'organization', asOf, monthStart(now));
      } catch {
        result.messages.push('Could not refresh spend. Check the billing key permissions and try again.');
      }
    }
    if (!result.balance && p.billing_settings?.mode !== 'pay_as_you_go') {
      result.messages.push('Credit balance is not available through this integration. Record it from the billing console in Edit billing.');
    }
    if (vendor === 'anthropic' && result.spend?.source === 'provider') result.messages.push('Reported spend excludes Priority Tier charges.');
  }
  return result;
}

// Brief cache coalesces concurrent loads and respects provider reporting limits.
// Configuration and credential changes get a fresh entry, including key rotation.
const cache = new Map<string, { expires: number; promise: Promise<AiProviderBilling> }>();
export async function getProviderBilling(p: AiProviderRow): Promise<AiProviderBilling> {
  const vendor = billingVendor(p);
  const digest = createHash('sha256').update(JSON.stringify([p, vendor ? billingKey(keyEnv(p, vendor)) : null, providerApiKey(p)])).digest('hex');
  const now = Date.now();
  for (const [key, entry] of cache) if (entry.expires <= now) cache.delete(key);
  const existing = cache.get(digest);
  if (existing) return existing.promise;
  if (cache.size >= 500) cache.delete(cache.keys().next().value!);
  const promise = fetchBilling(p, new Date(now));
  cache.set(digest, { expires: now + 60_000, promise });
  try { return await promise; } catch (error) { cache.delete(digest); throw error; }
}
