import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
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
      // Task-creation tracking (tasks.created_via) — identifies the menu-bar companion.
      'X-Client-Source': 'companion',
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
  default_task_type_id?: string | null;
}

export interface FolderLite {
  id: string;
  name: string;
  lists?: ListLite[];
  default_task_type_id?: string | null;
}

export interface SpaceStatus {
  id: string;
  space_id: string;
  name: string;
  color: string;
  position: number;
  is_default: boolean;
  category: string;
}

export interface SpaceLite {
  id: string;
  name: string;
  color?: string | null;
  lists?: ListLite[];
  folders?: FolderLite[];
  default_task_type_id?: string | null;
  /** Present on GET /pm/spaces/:id (space_statuses join). */
  space_statuses?: SpaceStatus[];
}

export interface WorkspaceLite {
  id: string;
  name: string;
}

export interface PersonalListResponse {
  space: { id: string; name: string; default_task_type_id?: string | null };
  list: { id: string; name: string; default_task_type_id?: string | null };
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

export interface TaskTag {
  id: string;
  workspace_id: string;
  group_id: string;
  name: string;
  color: string;
}

export interface LabelPickerGroup {
  group: { id: string; name: string; is_default: boolean };
  labels: TaskTag[];
}

export interface LabelPickerData {
  groups: LabelPickerGroup[];
  can_create: boolean;
}

export interface TaskType {
  id: string;
  key: string;
  name: string;
  description: string | null;
  group_name?: string | null;
  icon: string;
  color: string;
  position: number;
  is_default: boolean;
  is_system: boolean;
  is_enabled: boolean;
}

/** GET /pm/task-types — task types the caller can use when creating a task. */
export function fetchTaskTypes(): Promise<TaskType[]> {
  return apiJson<TaskType[]>('/pm/task-types');
}

export interface EffectiveStatusGroupRow {
  id: string;
  group_id: string;
  key: string | null;
  name: string;
  description: string | null;
  color: string;
  position: number;
  is_default: boolean;
  is_placeholder?: boolean;
  category: string;
  section: string | null;
  section_label: string | null;
  section_emoji: string | null;
  section_color?: string | null;
  section_position?: number | null;
}

export interface EffectiveStatusGroupResponse {
  group: { id: string; key: string; name: string } | null;
  statuses: EffectiveStatusGroupRow[];
}

/** GET /pm/status-groups/effective — resolves effective status group for a list/space. */
export function fetchEffectiveStatusGroup(params?: {
  spaceId?: string | null;
  listId?: string | null;
}): Promise<EffectiveStatusGroupResponse> {
  const qs = new URLSearchParams();
  if (params?.spaceId) qs.set('space_id', params.spaceId);
  if (params?.listId) qs.set('list_id', params.listId);
  const suffix = qs.toString();
  return apiJson<EffectiveStatusGroupResponse>(`/pm/status-groups/effective${suffix ? `?${suffix}` : ''}`);
}

export interface CreateTaskPayload {
  list_id: string;
  title: string;
  description?: string;
  status?: string;
  priority?: TaskPriority;
  work_date?: string | null;
  start_date?: string | null;
  due_date?: string | null;
  task_type_id?: string | null;
  assignee_ids?: string[];
  time_estimate?: number;
  start_timer?: boolean;
}

/** Record a manual time entry. Durations are seconds; estimates are minutes. */
export function logTaskTime(taskId: string, durationSeconds: number, startedAt: string): Promise<{ id: string }> {
  return apiJson<{ id: string }>(`/pm/tasks/${taskId}/time-entries`, {
    method: 'POST',
    body: JSON.stringify({ started_at: startedAt, duration_seconds: durationSeconds, source: 'manual' }),
  });
}

/** GET /pm/labels?list_id=xxx — labels visible for a list's workspace (draft mode). */
export function fetchLabelsForList(listId: string): Promise<LabelPickerData> {
  return apiJson<LabelPickerData>(`/pm/labels?list_id=${encodeURIComponent(listId)}`);
}

/** POST /pm/tasks/:id/labels — attach a label to a task. */
export function attachTaskLabel(taskId: string, tagId: string): Promise<TaskTag> {
  return apiJson<TaskTag>(`/pm/tasks/${taskId}/labels`, {
    method: 'POST',
    body: JSON.stringify({ tag_id: tagId }),
  });
}

/** PUT /pm/tasks/:id — update status (used for complete-on-add). */
export function updateTaskStatus(taskId: string, status: string): Promise<{ id: string }> {
  return apiJson<{ id: string }>(`/pm/tasks/${taskId}`, {
    method: 'PUT',
    body: JSON.stringify({ status }),
  });
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

// ── Work / Break / No-work session timer (server-backed via /timer/*) ────────
// Mirrors the web app's RailTimer / useTimer: one running session per
// workspace+context, where context is 'partners' for partner user types and
// 'teammates' for everyone else. The companion polls /timer/active + /timer/stats
// and drives switches through /timer/start (which auto-stops the prior session)
// and /timer/stop. Keeping the same context the web app uses is what makes the
// menu-bar + notch clock reflect exactly what the user is tracking in SquadHub.
export type TimerType = 'work' | 'break' | 'no_work';

/** User types that live in the 'partners' timer context (mirrors shared PARTNER_USER_TYPES). */
const PARTNER_USER_TYPES = ['partner', 'partner_employee'];
export function timerContextForUserType(userType: string | null | undefined): string {
  return userType && PARTNER_USER_TYPES.includes(userType) ? 'partners' : 'teammates';
}

export interface TimerSession {
  id: string;
  user_id: string;
  workspace_id: string;
  context: string;
  date: string;
  timer_type: TimerType;
  start_time: string;
  end_time: string | null;
}

export interface ActiveTimer {
  session: TimerSession | null;
  elapsed_seconds: number;
}

export interface DailySummary {
  total_work_seconds: number;
  total_break_seconds: number;
  total_no_work_seconds: number;
  session_count?: number;
  first_start?: string | null;
  last_stop?: string | null;
}

export interface TimerStats {
  today: DailySummary | null;
  active_timer: TimerSession | null;
  office_timing: { office_hours_total_seconds: number } | null;
}

/** GET /timer/active — the single running work/break/no-work session, if any. */
export function fetchActiveTimer(workspaceId: string, context: string): Promise<ActiveTimer> {
  return apiJson<ActiveTimer>(
    `/timer/active?workspace_id=${encodeURIComponent(workspaceId)}&context=${encodeURIComponent(context)}`,
  );
}

/** GET /timer/stats — today's work/break/no-work totals + office-hours commitment. */
export function fetchTimerStats(workspaceId: string, context: string): Promise<TimerStats> {
  return apiJson<TimerStats>(
    `/timer/stats?workspace_id=${encodeURIComponent(workspaceId)}&context=${encodeURIComponent(context)}`,
  );
}

/** POST /timer/start — switch to work/break/no-work (auto-stops the current session). */
export function startTimerSession(timerType: TimerType, workspaceId: string, context: string): Promise<TimerSession> {
  return apiJson<TimerSession>('/timer/start', {
    method: 'POST',
    body: JSON.stringify({ timer_type: timerType, workspace_id: workspaceId, context }),
  });
}

/** POST /timer/stop — stop the running session (clock off entirely). */
export function stopTimerSession(sessionId: string | undefined, workspaceId: string, context: string): Promise<TimerSession> {
  return apiJson<TimerSession>('/timer/stop', {
    method: 'POST',
    body: JSON.stringify({ session_id: sessionId, workspace_id: workspaceId, context }),
  });
}

interface PresignResponse {
  upload_url: string;
  public_url: string;
  key: string;
  expires_in: number;
}

/**
 * Attach a file to an existing task, mirroring the web app's direct-to-R2 flow:
 *   1. presign  → server hands back a short-lived R2 PUT URL,
 *   2. PUT       → upload the raw bytes straight to R2 (NOT via apiFetch — no
 *                  auth header, and the Content-Type must match what was signed),
 *   3. confirm   → server HEAD-validates the object and writes the DB row.
 * Throws on any step so the caller can surface a per-file failure.
 */
/** Upload stages reported to the UI. The native PUT has no byte progress, so
 * `put` carries a size-based estimate the caller can animate across. */
export type UploadStage = { stage: 'presign' | 'read' | 'put' | 'confirm' | 'done'; estimateMs?: number };

export async function uploadTaskAttachment(
  taskId: string,
  file: File,
  onStage?: (s: UploadStage) => void,
): Promise<void> {
  const contentType = file.type || 'application/octet-stream';

  const presign = await apiJson<PresignResponse>('/pm/task-attachments/presign', {
    method: 'POST',
    body: JSON.stringify({
      task_id: taskId,
      filename: file.name,
      content_type: contentType,
      file_size: file.size,
    }),
  });
  onStage?.({ stage: 'presign' });

  // Use Tauri's native HTTP client (reqwest) rather than the webview's fetch:
  // the direct-to-R2 PUT is cross-origin and R2's bucket CORS doesn't allow the
  // desktop webview origin, so a browser fetch is blocked by the preflight.
  // The native client isn't subject to CORS and sends exactly the headers we set.
  const bytes = new Uint8Array(await file.arrayBuffer());
  onStage?.({ stage: 'read' });
  // ~1.5 MB/s is a conservative uplink guess; clamp so tiny files still animate.
  onStage?.({ stage: 'put', estimateMs: Math.min(12_000, Math.max(700, file.size / 1500)) });
  const put = await tauriFetch(presign.upload_url, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: bytes,
  });
  if (!put.ok) {
    throw new Error(`Upload failed (${put.status})`);
  }

  onStage?.({ stage: 'confirm' });

  await apiJson('/pm/task-attachments/confirm', {
    method: 'POST',
    body: JSON.stringify({
      task_id: taskId,
      object_key: presign.key,
      file_name: file.name,
      mime_type: contentType,
    }),
  });
  onStage?.({ stage: 'done' });
}
