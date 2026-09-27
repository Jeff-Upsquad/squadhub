import { describe, expect, it, vi } from 'vitest';

vi.mock('../supabase', () => ({ supabaseAdmin: {} }));

import { API_KEY_ENV_PATTERN, isAllowedBaseUrl, providerProblem, type AiProviderRow } from '../services/aiProviders';
import { effectiveStatus, generateBotApiKey, hashBotApiKey, resolveAi } from '../services/squadBots';

function provider(overrides: Partial<AiProviderRow>): AiProviderRow {
  return {
    id: 'p1',
    slug: 'claude',
    name: 'Claude',
    kind: 'anthropic',
    base_url: null,
    api_key_env: 'ANTHROPIC_API_KEY',
    default_model: 'claude-opus-5',
    is_enabled: true,
    is_default: true,
    ...overrides,
  };
}

describe('resolveAi', () => {
  const claude = provider({});
  const openrouter = provider({ id: 'p2', slug: 'openrouter', kind: 'openai_compatible', is_default: false, default_model: 'llama-x' });

  it('uses the default provider and its model when the bot picks neither', () => {
    expect(resolveAi({ provider_id: null, model: null }, [claude, openrouter])).toEqual({
      provider: claude,
      model: 'claude-opus-5',
      usesDefaultProvider: true,
    });
  });

  it("uses the bot's own provider and model", () => {
    expect(resolveAi({ provider_id: 'p2', model: 'my-model' }, [claude, openrouter])).toMatchObject({
      provider: openrouter,
      model: 'my-model',
      usesDefaultProvider: false,
    });
  });

  it('falls back to the default provider when the chosen one is gone', () => {
    expect(resolveAi({ provider_id: 'deleted', model: null }, [claude])).toMatchObject({ provider: claude });
  });

  it('asks for a model when neither the bot nor the provider has one', () => {
    const noModel = provider({ default_model: null });
    expect(resolveAi({ provider_id: null, model: null }, [noModel])).toHaveProperty('error');
  });
});

describe('effectiveStatus', () => {
  it('turns every bot off while all bots are paused', () => {
    expect(effectiveStatus({ status: 'live' }, true)).toBe('off');
    expect(effectiveStatus({ status: 'live' }, false)).toBe('live');
  });
});

describe('provider safety', () => {
  it('only accepts AI key variable names', () => {
    expect(API_KEY_ENV_PATTERN.test('ANTHROPIC_API_KEY')).toBe(true);
    expect(API_KEY_ENV_PATTERN.test('AI_LOCAL_API_KEY')).toBe(true);
    expect(API_KEY_ENV_PATTERN.test('SUPABASE_SERVICE_ROLE_KEY')).toBe(false);
    expect(API_KEY_ENV_PATTERN.test('SQUADBOOKS_ADMIN_API_KEY')).toBe(false);
  });

  it('allows https, and plain http only for localhost', () => {
    expect(isAllowedBaseUrl('https://openrouter.ai/api/v1')).toBe(true);
    expect(isAllowedBaseUrl('http://localhost:11434/v1')).toBe(true);
    expect(isAllowedBaseUrl('http://example.com/v1')).toBe(false);
    expect(isAllowedBaseUrl('not a url')).toBe(false);
  });

  it('reports a missing key', () => {
    delete process.env.AI_MISSING_API_KEY;
    expect(providerProblem(provider({ api_key_env: 'AI_MISSING_API_KEY' }))).toMatch(/not set/);
  });
});

describe('bot API keys', () => {
  it('stores only a hash, and the hash matches the key', () => {
    const { key, hash, prefix } = generateBotApiKey();
    expect(key.startsWith('sbk_')).toBe(true);
    expect(prefix).toBe(key.slice(0, 10));
    expect(hash).toBe(hashBotApiKey(key));
    expect(hash).not.toContain(key);
  });
});
