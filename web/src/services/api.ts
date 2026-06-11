import axios, { AxiosError, AxiosRequestConfig } from 'axios';
import { useAuthStore } from '../stores/authStore';

// API client configured to talk to our backend
const api = axios.create({
  baseURL: '/', // In dev, Vite proxy sends /auth, /workspaces, etc. to localhost:4000
  headers: { 'Content-Type': 'application/json' },
});

// Attach auth token to every request
api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

type RetriableConfig = AxiosRequestConfig & { _retried?: boolean };

// Shared in-flight refresh promise so concurrent 401s trigger exactly one /auth/refresh.
let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  if (refreshPromise) return refreshPromise;

  const { refreshToken, updateTokens, logout } = useAuthStore.getState();
  if (!refreshToken) {
    logout();
    return null;
  }

  refreshPromise = (async () => {
    try {
      // Use bare axios (not `api`) to avoid recursion through the interceptor.
      const res = await axios.post('/auth/refresh', { refresh_token: refreshToken });
      const newAccess = res.data?.data?.access_token as string | undefined;
      const newRefresh = res.data?.data?.refresh_token as string | undefined;
      if (!newAccess || !newRefresh) {
        logout();
        return null;
      }
      updateTokens(newAccess, newRefresh);
      return newAccess;
    } catch {
      logout();
      return null;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

function jwtExpMs(token: string): number {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return (payload.exp ?? 0) * 1000;
  } catch {
    return 0;
  }
}

/**
 * Returns an access token valid for at least `minTtlMs`, refreshing through
 * the shared in-flight machinery when needed. Used for cross-app token handoff
 * (Squad Clips iframe) — hands out ONLY the access token, never the refresh
 * token (it rotates; concurrent use elsewhere would kill this session).
 */
export async function getFreshAccessToken(minTtlMs = 120_000): Promise<string | null> {
  const { accessToken } = useAuthStore.getState();
  if (accessToken && jwtExpMs(accessToken) - Date.now() > minTtlMs) return accessToken;
  return refreshAccessToken();
}

// Handle 401 — attempt a one-shot refresh+retry; logout only if refresh fails.
api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as RetriableConfig | undefined;
    const status = error.response?.status;

    if (status !== 401 || !original) {
      return Promise.reject(error);
    }

    const url = original.url || '';
    if (url.includes('/auth/refresh') || url.includes('/auth/login')) {
      useAuthStore.getState().logout();
      return Promise.reject(error);
    }

    if (original._retried) {
      useAuthStore.getState().logout();
      return Promise.reject(error);
    }

    const newToken = await refreshAccessToken();
    if (!newToken) {
      return Promise.reject(error);
    }

    original._retried = true;
    original.headers = { ...(original.headers || {}), Authorization: `Bearer ${newToken}` };
    return api.request(original);
  },
);

export default api;
