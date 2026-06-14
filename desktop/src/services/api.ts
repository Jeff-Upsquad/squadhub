import { useAuthStore } from '../stores/authStore';
import { refreshTokens } from './auth';

const API_URL = 'https://api.squadhub.in';

/**
 * Authenticated fetch against the SquadHub API. Attaches the stored access
 * token and, on a 401, transparently refreshes the token once (mirrors the web
 * app's axios interceptor) before retrying.
 */
export async function apiFetch(
  path: string,
  init: RequestInit = {},
  allowRetry = true,
): Promise<Response> {
  const accessToken = useAuthStore.getState().accessToken;
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(init.headers || {}),
    },
  });

  if (res.status === 401 && allowRetry) {
    const { refreshToken, updateTokens, logout } = useAuthStore.getState();
    if (refreshToken) {
      const refreshed = await refreshTokens(refreshToken);
      if (refreshed.success && refreshed.data) {
        await updateTokens(refreshed.data.access_token, refreshed.data.refresh_token);
        return apiFetch(path, init, false);
      }
    }
    await logout();
  }

  return res;
}

export interface PersonalListResponse {
  space: { id: string; name: string };
  list: { id: string; name: string };
}

/** GET /pm/personal — get-or-create the user's private personal space + list. */
export async function fetchPersonalList(): Promise<PersonalListResponse> {
  const res = await apiFetch('/pm/personal');
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.success) {
    throw new Error(json.error || 'Failed to load your personal list');
  }
  return json.data as PersonalListResponse;
}

/** POST /pm/tasks — create a task in the given list, assigned to the current user. */
export async function createTask(listId: string, title: string): Promise<void> {
  const userId = useAuthStore.getState().userId;
  const res = await apiFetch('/pm/tasks', {
    method: 'POST',
    body: JSON.stringify({
      list_id: listId,
      title,
      assignee_ids: userId ? [userId] : [],
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.success) {
    throw new Error(json.error || 'Failed to create task');
  }
}
