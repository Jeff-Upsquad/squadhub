import { beforeEach, describe, expect, it, vi } from 'vitest';
import axios, { AxiosError } from 'axios';

const auth = vi.hoisted(() => ({
  accessToken: 'saved-access', refreshToken: 'saved-refresh',
  updateTokens: vi.fn(), logout: vi.fn(),
}));
vi.mock('../../web/src/stores/authStore', () => ({ useAuthStore: { getState: () => auth } }));
import api, { getFreshAccessToken } from '../../web/src/services/api';

beforeEach(() => {
  vi.clearAllMocks();
  api.defaults.adapter = async (config) => {
    throw new AxiosError('Unauthorized', 'ERR_BAD_REQUEST', config, undefined, {
      status: 401, statusText: 'Unauthorized', headers: {}, config, data: {},
    });
  };
});

describe('session refresh during an outage', () => {
  it('keeps token handoff callers safe when the service cannot be reached', async () => {
    axios.defaults.adapter = async (config) => {
      throw new AxiosError('Timed out', 'ECONNABORTED', config);
    };
    await expect(getFreshAccessToken()).resolves.toBeNull();
    expect(auth.logout).not.toHaveBeenCalled();
  });

  it('bounds refresh requests and preserves the session on timeout', async () => {
    axios.defaults.adapter = async (config) => {
      expect(config.timeout).toBe(15_000);
      throw new AxiosError('Timed out', 'ECONNABORTED', config);
    };
    await expect(api.get('/workspaces')).rejects.toMatchObject({ code: 'ECONNABORTED' });
    expect(auth.logout).not.toHaveBeenCalled();
    expect(auth.updateTokens).not.toHaveBeenCalled();
  });

  it('preserves the session when the refresh service is unavailable', async () => {
    axios.defaults.adapter = async (config) => {
      throw new AxiosError('Unavailable', 'ERR_BAD_RESPONSE', config, undefined, {
        status: 503, statusText: 'Unavailable', headers: {}, config, data: {},
      });
    };
    await expect(api.get('/workspaces')).rejects.toMatchObject({ response: { status: 503 } });
    expect(auth.logout).not.toHaveBeenCalled();
  });

  it('still clears a session when the refresh token is rejected', async () => {
    axios.defaults.adapter = async (config) => {
      throw new AxiosError('Unauthorized', 'ERR_BAD_REQUEST', config, undefined, {
        status: 401, statusText: 'Unauthorized', headers: {}, config, data: {},
      });
    };
    await expect(api.get('/workspaces')).rejects.toMatchObject({ response: { status: 401 } });
    expect(auth.logout).toHaveBeenCalledOnce();
  });
});
