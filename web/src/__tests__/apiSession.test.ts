import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import axios, { AxiosError, AxiosHeaders } from 'axios';

const auth = vi.hoisted(() => {
  const state = { accessToken: 'old-access', refreshToken: 'old-refresh', updateTokens: vi.fn(), logout: vi.fn() };
  return { state, rehydrate: vi.fn() };
});
vi.mock('../stores/authStore', () => ({ useAuthStore: {
  getState: () => auth.state, persist: { rehydrate: auth.rehydrate },
} }));
import api, { getFreshAccessToken } from '../services/api';

const rejected = (status: number, config: any = {}) => new AxiosError('rejected', undefined, config, undefined, {
  status, statusText: 'rejected', data: {}, headers: {}, config,
});
beforeEach(() => {
  vi.clearAllMocks();
  auth.state.accessToken = 'old-access'; auth.state.refreshToken = 'old-refresh';
  auth.rehydrate.mockResolvedValue(undefined);
  auth.state.updateTokens.mockImplementation((accessToken, refreshToken) => Object.assign(auth.state, { accessToken, refreshToken }));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each([429, 503, 400])('keeps credentials after a temporary or malformed refresh failure (%i)', async status => {
  vi.spyOn(axios, 'post').mockRejectedValue(rejected(status));
  expect(await getFreshAccessToken()).toBeNull();
  expect(auth.state.logout).not.toHaveBeenCalled();
});
it('logs out when refresh credentials are explicitly rejected', async () => {
  vi.spyOn(axios, 'post').mockRejectedValue(rejected(401));
  expect(await getFreshAccessToken()).toBeNull();
  expect(auth.state.logout).toHaveBeenCalledOnce();
});
it('coalesces parallel refreshes', async () => {
  const post = vi.spyOn(axios, 'post').mockResolvedValue({ data: { data: { access_token: 'fresh', refresh_token: 'rotated' } } });
  expect(await Promise.all([getFreshAccessToken(), getFreshAccessToken()])).toEqual(['fresh', 'fresh']);
  expect(post).toHaveBeenCalledOnce();
});
it('uses tokens persisted by another tab while waiting for the browser lock', async () => {
  vi.stubGlobal('navigator', { locks: { request: vi.fn(async (_name, callback) => {
    auth.rehydrate.mockImplementationOnce(async () => {
      auth.state.accessToken = 'other-tab-access'; auth.state.refreshToken = 'other-tab-refresh';
    });
    return callback();
  }) } });
  const post = vi.spyOn(axios, 'post');
  expect(await getFreshAccessToken()).toBe('other-tab-access');
  expect(post).not.toHaveBeenCalled();
});
it('does not restore a session after logout during refresh', async () => {
  vi.spyOn(axios, 'post').mockImplementation(async () => {
    auth.state.accessToken = null as any; auth.state.refreshToken = null as any;
    return { data: { data: { access_token: 'fresh', refresh_token: 'rotated' } } };
  });
  expect(await getFreshAccessToken()).toBeNull();
  expect(auth.state.updateTokens).not.toHaveBeenCalled();
});
it('retries a delayed 401 with the already refreshed token without rotating again', async () => {
  const post = vi.spyOn(axios, 'post');
  let calls = 0;
  await api.get('/tasks', { adapter: async config => {
    if (++calls === 1) {
      auth.state.accessToken = 'fresh';
      throw rejected(401, config);
    }
    expect(AxiosHeaders.from(config.headers).get('Authorization')).toBe('Bearer fresh');
    return { data: {}, status: 200, statusText: 'OK', headers: {}, config };
  } });
  expect(calls).toBe(2);
  expect(post).not.toHaveBeenCalled();
});
