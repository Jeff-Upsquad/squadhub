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

/**
 * Thin wrapper over apiFetch for the API's standard `{ success, data, error }`
 * envelope: returns `data` on success, throws the server's error otherwise.
 */
async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await apiFetch(path, init);
  const json = await res.json().catch(() => ({} as any));
  if (!res.ok || !json.success) {
    throw new Error(json.error || `Request failed (${res.status})`);
  }
  return json.data as T;
}

export type TaskPriority = 'emergency' | 'urgent' | 'high' | 'normal' | 'low' | 'none';

export interface AssignableUser {
  id: string;
  display_name: string;
  email: string;
  avatar_url: string | null;
}

export type AccessLevel = 'viewer' | 'commenter' | 'member' | 'manager';

export interface ListLite {
  id: string;
  name: string;
  is_locked?: boolean;
  my_access_level?: AccessLevel;
}

export interface FolderLite {
  id: string;
  name: string;
  lists?: ListLite[];
}

export interface SpaceLite {
  id: string;
  name: string;
  color?: string | null;
  lists?: ListLite[];
  folders?: FolderLite[];
}

export interface WorkspaceLite {
  id: string;
  name: string;
}

export interface PersonalListResponse {
  space: { id: string; name: string };
  list: { id: string; name: string };
}

/** GET /pm/personal — get-or-create the user's private personal space + list. */
export function fetchPersonalList(): Promise<PersonalListResponse> {
  return apiJson<PersonalListResponse>('/pm/personal');
}

/** GET /workspaces — the workspace(s) the current user belongs to. */
export function fetchWorkspaces(): Promise<WorkspaceLite[]> {
  return apiJson<WorkspaceLite[]>('/workspaces');
}

/** GET /pm/spaces — top-level spaces in a workspace (no nested lists/folders). */
export function fetchSpaces(workspaceId: string): Promise<SpaceLite[]> {
  return apiJson<SpaceLite[]>(`/pm/spaces?workspace_id=${encodeURIComponent(workspaceId)}`);
}

/** GET /pm/spaces/:id — a single space hydrated with its folders + lists. */
export function fetchSpace(spaceId: string): Promise<SpaceLite> {
  return apiJson<SpaceLite>(`/pm/spaces/${spaceId}`);
}

/** GET /pm/lists/:id/assignable-users — users who can be assigned tasks in a list. */
export function fetchAssignableUsers(listId: string): Promise<AssignableUser[]> {
  return apiJson<AssignableUser[]>(`/pm/lists/${listId}/assignable-users`);
}

export interface CreateTaskPayload {
  list_id: string;
  title: string;
  description?: string;
  priority?: TaskPriority;
  work_date?: string | null;
  assignee_ids?: string[];
}

/** POST /pm/tasks — create a task; returns the created task (we need its id). */
export function createTask(payload: CreateTaskPayload): Promise<{ id: string }> {
  return apiJson<{ id: string }>('/pm/tasks', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/** PATCH /pm/tasks/:id/focus — set/clear the server-side focus star (focused_at). */
export async function setTaskFocus(taskId: string, focused: boolean): Promise<void> {
  await apiJson(`/pm/tasks/${taskId}/focus`, {
    method: 'PATCH',
    body: JSON.stringify({ focused }),
  });
}
