import { afterEach, expect, it, vi } from 'vitest';

vi.mock('../config', () => ({ config: {
  supabaseUrl: 'https://identity.example', supabaseAnonKey: 'public-key', supabaseServiceRoleKey: 'test-service-key',
} }));
import { createAuthClient } from '../supabase';

afterEach(() => vi.unstubAllGlobals());

it('refreshes only the supplied credential across expired sessions and different users', async () => {
  const seen: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_input, init) => {
    const token = JSON.parse(init.body).refresh_token;
    seen.push(token);
    return new Response(JSON.stringify({
      access_token: `access-${token}`, refresh_token: `rotated-${token}`,
      expires_in: 1, token_type: 'bearer', user: { id: token },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }));
  const first = await createAuthClient().auth.refreshSession({ refresh_token: 'first-user' });
  expect(first.error).toBeNull();
  const results = await Promise.all([
    createAuthClient().auth.refreshSession({ refresh_token: 'rotated-first-user' }),
    createAuthClient().auth.refreshSession({ refresh_token: 'second-user' }),
  ]);
  expect(results.every(result => result.error === null)).toBe(true);
  expect(seen).toEqual(['first-user', 'rotated-first-user', 'second-user']);
  expect(results.map(result => result.data.user?.id)).toEqual(['rotated-first-user', 'second-user']);
});
