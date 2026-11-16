import axios, { AxiosError, AxiosRequestConfig } from 'axios';
import { useAuthStore } from '../stores/authStore';

// API client configured to talk to our backend
const api = axios.create({
  baseURL: '/', // In dev, Vite proxy sends /auth, /workspaces, etc. to localhost:4000
  headers: { 'Content-Type': 'application/json' },
});

// Client platform for task-creation tracking (tasks.created_via). The full
// desktop-app shell is a Tauri wrapper around this same web build, so detect
// it via the Tauri bridge; otherwise split mobile browsers (responsive shell)
// from desktop by UA. Sent as X-Client-Source; the server falls back to its
// own UA heuristics when the header is absent.
function getClientSource(): string {
  if (typeof window !== 'undefined' && (window as any).__TAURI__ !== undefined) return 'desktop_app';
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
  return /Mobi|Android|iPhone|iPad|Mobile/i.test(ua) ? 'mobile_web' : 'web';
}

// Attach auth token + client source to every request
api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  config.headers['X-Client-Source'] = getClientSource();
  config.headers['X-Timezone-Offset'] = String(-new Date().getTimezoneOffset());
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

  const refresh = async () => {
    // Other tabs persist rotated tokens to the same key. Re-read under the
    // browser lock before exchanging a single-use refresh credential.
    await useAuthStore.persist.rehydrate();
    const current = useAuthStore.getState();
    if (current.refreshToken !== refreshToken) return current.accessToken;
    try {
      // Use bare axios (not `api`) to avoid recursion through the interceptor.
      const res = await axios.post('/auth/refresh', { refresh_token: refreshToken }, { timeout: 15_000 });
      const newAccess = res.data?.data?.access_token as string | undefined;
      const newRefresh = res.data?.data?.refresh_token as string | undefined;
      // A logout or a different sign-in may have happened while awaiting HTTP.
      if (useAuthStore.getState().refreshToken !== refreshToken) return useAuthStore.getState().accessToken;
      if (!newAccess || !newRefresh) {
        throw new Error('Session refresh returned an incomplete response');
      }
      updateTokens(newAccess, newRefresh);
      return newAccess;
    } catch (error) {
      // A network outage is not evidence that the saved session is invalid.
      if (useAuthStore.getState().refreshToken !== refreshToken) return useAuthStore.getState().accessToken;
      if (!axios.isAxiosError(error) || ![401, 403].includes(error.response?.status ?? 0)) throw error;
      logout();
      return null;
    }
  };
  refreshPromise = (async () => {
    if (typeof navigator !== 'undefined' && navigator.locks) {
      return await navigator.locks.request('squadhub-session-refresh', refresh);
    }
    return refresh();
  })().finally(() => { refreshPromise = null; });

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
  return refreshAccessToken().catch(() => null);
}

// Handle 401 — attempt a one-shot refresh+retry; logout only if credentials are rejected.
api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as RetriableConfig | undefined;
    const status = error.response?.status;

    if (status === 422 && original && (error.response?.data as any)?.code === 'REMINDER_SCHEDULE_REQUIRED') {
      const { requestReminderSchedule } = await import('../components/pm/ReminderScheduleDialog');
      const due = await requestReminderSchedule((error.response?.data as any)?.suggested_date);
      if (!due) return Promise.reject(new axios.CanceledError('Reminder creation cancelled'));
      const body = typeof original.data === 'string' ? JSON.parse(original.data) : original.data;
      return api.request({ ...original, data: { ...body, due_date: due } });
    }
    if (status !== 401 || !original) {
      return Promise.reject(error);
    }

    const url = original.url || '';
    // /auth/sso/squadhire carries a single-use code. Its 401 means the code was
    // spent or expired — nothing to do with the session in this browser — so
    // don't retry it (that would burn the code) and don't sign anyone out.
    if (url.includes('/auth/sso/squadhire')) {
      return Promise.reject(error);
    }

    if (url.includes('/auth/refresh') || url.includes('/auth/login')) {
      useAuthStore.getState().logout();
      return Promise.reject(error);
    }

    if (original._retried) {
      return Promise.reject(error);
    }

    // A late 401 may belong to a request sent before another request refreshed.
    const currentToken = useAuthStore.getState().accessToken;
    const newToken = currentToken && original.headers?.Authorization !== `Bearer ${currentToken}`
      ? currentToken : await refreshAccessToken();
    if (!newToken) {
      return Promise.reject(error);
    }

    original._retried = true;
    original.headers = { ...(original.headers || {}), Authorization: `Bearer ${newToken}` };
    return api.request(original);
  },
);

export default api;
