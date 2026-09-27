import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { billingSettingsSchema, billingVendor, getProviderBilling } from '../services/aiProviderBilling';
import type { AiProviderRow } from '../services/aiProviders';

let sequence = 0;
function provider(overrides: Partial<AiProviderRow> = {}): AiProviderRow {
  return {
    id: `billing-test-${++sequence}`, slug: 'claude', name: 'Claude', kind: 'anthropic',
    base_url: null, api_key_env: 'ANTHROPIC_API_KEY', default_model: 'model', is_enabled: true, is_default: true,
    ...overrides,
  };
}
const page = (amount: string, has_more = false, next_page: string | null = null) => ({
  data: [{ results: [{ amount, currency: 'USD' }] }], has_more, next_page,
});
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const snapshot = { balance_usd: 20, spend_usd: 8, as_of: '2026-08-15T12:00:00.000Z' };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-27T10:00:00Z'));
  vi.stubEnv('ANTHROPIC_ADMIN_API_KEY', 'anthropic-admin-secret');
  vi.stubEnv('OPENAI_ADMIN_API_KEY', 'openai-admin-secret');
  vi.stubEnv('OPENROUTER_MANAGEMENT_API_KEY', 'openrouter-management-secret');
  vi.stubEnv('OPENROUTER_API_KEY', 'openrouter-inference-secret');
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

describe('provider billing', () => {
  it('sums every Anthropic page and converts decimal cents to USD', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response(page('123.45', true, 'next'))).mockResolvedValueOnce(response(page('200')));
    vi.stubGlobal('fetch', fetcher);
    const result = await getProviderBilling(provider());
    expect(result.spend).toMatchObject({ scope: 'organization', source: 'provider', period_start: '2026-09-01T00:00:00.000Z' });
    expect(result.spend?.usd).toBeCloseTo(3.2345, 8);
    expect(result.balance).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(2);
    const url = fetcher.mock.calls[1][0] as URL;
    expect(url.searchParams.get('page')).toBe('next');
    expect(url.searchParams.get('starting_at')).toBe('2026-09-01T00:00:00.000Z');
    expect(fetcher.mock.calls[0][1]).toMatchObject({ redirect: 'error', headers: { 'x-api-key': 'anthropic-admin-secret' } });
  });

  it('keeps OpenAI dollar amounts in dollars and queries the current UTC month', async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ data: [{ results: [{ amount: { value: 42.75, currency: 'usd' } }] }], has_more: false }));
    vi.stubGlobal('fetch', fetcher);
    const result = await getProviderBilling(provider({ kind: 'openai_compatible', base_url: 'https://api.openai.com/v1', api_key_env: 'OPENAI_API_KEY' }));
    expect(result.spend?.usd).toBe(42.75);
    expect((fetcher.mock.calls[0][0] as URL).searchParams.get('start_time')).toBe(String(Date.parse('2026-09-01T00:00:00Z') / 1000));
  });

  it('shows an actual zero only after a valid complete report', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ data: [], has_more: false })));
    expect((await getProviderBilling(provider())).spend?.usd).toBe(0);
  });

  it.each([
    {},
    { data: [], has_more: true, next_page: null },
    { data: [{ results: [{ amount: '', currency: 'USD' }] }], has_more: false },
    { data: [{ results: [{ amount: '20', currency: 'EUR' }] }], has_more: false },
  ])('does not turn malformed or incomplete reports into zero spend: %j', async (body) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(body)));
    const result = await getProviderBilling(provider());
    expect(result.spend).toBeNull();
    expect(result.messages.join(' ')).toContain('Could not refresh');
  });

  it('rejects repeated pagination cursors without returning a partial total', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(response(page('100', true, 'repeat')))));
    expect((await getProviderBilling(provider())).spend).toBeNull();
  });

  it('preserves the original manual timestamp and month on a failed fetch', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ error: 'secret-response' }, 403)));
    const result = await getProviderBilling(provider({ billing_settings: { mode: 'prepaid', key_env: null, manual: snapshot } }));
    expect(result.balance).toMatchObject({ usd: 20, source: 'manual', as_of: snapshot.as_of });
    expect(result.spend).toMatchObject({ usd: 8, source: 'manual', period_start: '2026-08-01T00:00:00.000Z' });
    expect(JSON.stringify(result)).not.toMatch(/secret-response|admin-secret/);
  });

  it('uses the OpenRouter account balance, never the key spending limit', async () => {
    const fetcher = vi.fn().mockImplementation((url: string) => Promise.resolve(response(url.endsWith('/credits')
      ? { data: { total_credits: 100, total_usage: 25 } }
      : { data: { usage_monthly: 9, limit_remaining: 999 } })));
    vi.stubGlobal('fetch', fetcher);
    const result = await getProviderBilling(provider({ kind: 'openai_compatible', base_url: 'https://openrouter.ai/api/v1/', api_key_env: 'OPENROUTER_API_KEY', is_enabled: false }));
    expect(result.balance).toMatchObject({ usd: 75, scope: 'account' });
    expect(result.spend).toMatchObject({ usd: 9, scope: 'api_key' });
    expect(fetcher.mock.calls[0][1].headers.Authorization).toBe('Bearer openrouter-management-secret');
    expect(fetcher.mock.calls[1][1].headers.Authorization).toBe('Bearer openrouter-inference-secret');
  });

  it('can still show key spend when OpenRouter account billing is unavailable', async () => {
    vi.stubEnv('OPENROUTER_MANAGEMENT_API_KEY', '');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ data: { usage_monthly: 0, limit_remaining: 50 } })));
    const result = await getProviderBilling(provider({ kind: 'openai_compatible', base_url: 'https://openrouter.ai/api/v1', api_key_env: 'OPENROUTER_API_KEY' }));
    expect(result.balance).toBeNull();
    expect(result.spend?.usd).toBe(0);
    expect(result.messages.join(' ')).toContain('management key');
  });

  it('does not send billing keys to custom URLs or lookalike hosts', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    for (const base_url of ['https://api.anthropic.com.evil.test', 'https://proxy.test', 'http://api.anthropic.com', 'https://api.anthropic.com/custom']) {
      const p = provider({ base_url, billing_settings: { mode: 'prepaid', key_env: 'ANTHROPIC_ADMIN_API_KEY', manual: snapshot } });
      expect(billingVendor(p)).toBeNull();
      expect((await getProviderBilling(p)).balance?.source).toBe('manual');
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('does not implicitly associate a custom account with the default account billing key', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const result = await getProviderBilling(provider({ api_key_env: 'AI_OTHER_ACCOUNT_API_KEY' }));
    expect(result.spend).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('isolates failures including timeouts', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('timeout', 'TimeoutError')));
    expect((await getProviderBilling(provider())).messages.join(' ')).toContain('Could not refresh');
  });

  it('coalesces concurrent loads, expires the cache, and honors configuration/key changes', async () => {
    const fetcher = vi.fn().mockImplementation(() => Promise.resolve(response(page('100'))));
    vi.stubGlobal('fetch', fetcher);
    const p = provider();
    await Promise.all([getProviderBilling(p), getProviderBilling(p)]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_001);
    await getProviderBilling(p);
    expect(fetcher).toHaveBeenCalledTimes(2);
    vi.stubEnv('ANTHROPIC_ADMIN_API_KEY', 'rotated-secret');
    await getProviderBilling(p);
    expect(fetcher).toHaveBeenCalledTimes(3);
    await getProviderBilling({ ...p, billing_settings: { mode: 'prepaid', key_env: null, manual: snapshot } });
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
});

describe('billing settings validation', () => {
  it('only allows dedicated billing credential variables', () => {
    for (const key_env of ['ANTHROPIC_ADMIN_API_KEY', 'AI_SECOND_ACCOUNT_BILLING_API_KEY', 'OPENAI_ADMIN_API_KEY', 'OPENROUTER_MANAGEMENT_API_KEY']) {
      expect(billingSettingsSchema.safeParse({ mode: 'unknown', key_env, manual: null }).success).toBe(true);
    }
    for (const key_env of ['SUPABASE_SERVICE_ROLE_KEY', 'ANTHROPIC_API_KEY', 'sk-ant-secret']) {
      expect(billingSettingsSchema.safeParse({ mode: 'unknown', key_env, manual: null }).success).toBe(false);
    }
  });
  it('accepts zero and negative credit balances, rejects negative spend and future snapshots', () => {
    const settings = { mode: 'prepaid', key_env: null, manual: { ...snapshot, balance_usd: -1, spend_usd: 0 } };
    expect(billingSettingsSchema.safeParse(settings).success).toBe(true);
    expect(billingSettingsSchema.safeParse({ ...settings, manual: { ...snapshot, spend_usd: -1 } }).success).toBe(false);
    expect(billingSettingsSchema.safeParse({ ...settings, manual: { ...snapshot, as_of: '2099-01-01T00:00:00Z' } }).success).toBe(false);
  });
});
