// ============================================================
// SquadHub Shared Types
// Used by both the server and web frontend
// ============================================================

// ---- Users ----
export type UserType = 'internal' | 'client' | 'client_staff' | 'partner' | 'partner_employee';

// Roles that act with partner-level access. Use this anywhere you'd otherwise
// hardcode 'partner' in role checks, so adding sub-roles in future is trivial.
export const PARTNER_USER_TYPES: readonly UserType[] = ['partner', 'partner_employee'] as const;

export interface User {
  id: string;
  email: string;
  display_name: string;
  avatar_url: string | null;
  is_admin: boolean;
  status: 'active' | 'pending' | 'rejected' | 'banned' | 'suspended';
  user_type: UserType;
  created_at: string;
  // Optional workspace-scoped joins (only present on specific endpoints).
  workspace_role?: 'super_admin' | 'admin' | 'member' | 'guest' | null;
  custom_role?: { id: string; name: string; color: string } | null;
  secondary_roles?: { id: string; name: string; color: string }[];
}

// ---- Workspaces ----
export interface Workspace {
  id: string;
  name: string;
  slug: string;
  owner_id: string;
  created_at: string;
}

export interface WorkspaceMember {
  id: string;
  workspace_id: string;
  user_id: string;
  role: 'super_admin' | 'admin' | 'member' | 'guest';
  role_id: string | null;
  // Joined fields
  custom_role?: Role;
  secondary_roles?: Role[];
}

// ---- Departments (internal-team org structure) ----
export interface DepartmentMember {
  id: string;
  department_id: string;
  user_id: string;
  created_at: string;
  // Joined on list/assign endpoints.
  user?: Pick<User, 'id' | 'display_name' | 'email' | 'avatar_url'>;
}

export interface Department {
  id: string;
  name: string;
  description: string | null;
  color: string;
  position: number;
  created_at: string;
  updated_at?: string;
  // Joined on the list endpoint.
  members?: DepartmentMember[];
  member_count?: number;
}

// ---- Channels ----
export interface Channel {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  is_private: boolean;
  created_by: string;
  created_at: string;
}

// ---- Messages ----
export type MessageType = 'text' | 'image' | 'audio' | 'video' | 'file';

export interface Message {
  id: string;
  channel_id: string | null;
  dm_conversation_id: string | null;
  sender_id: string;
  content: string | null;
  type: MessageType;
  file_url: string | null;
  file_name?: string | null;
  file_size?: number | null;
  file_mime?: string | null;
  duration_ms?: number | null;
  parent_message_id?: string | null;
  mentions?: string[];
  unfurl?: MessageUnfurl | null;
  reply_count?: number;
  created_at: string;
  updated_at: string;
  is_deleted: boolean;
  // Joined fields (populated by API)
  sender?: User;
  reactions?: Reaction[];
}

export interface MessageUnfurl {
  url: string;
  title?: string;
  description?: string;
  image?: string;
  site_name?: string;
}

// ---- DMs ----
export interface DmConversation {
  id: string;
  workspace_id: string;
  created_at: string;
  participants?: User[];
}

export interface DmParticipant {
  conversation_id: string;
  user_id: string;
}

// ---- Reactions ----
export interface Reaction {
  id: string;
  message_id: string;
  user_id: string;
  emoji: string;
}

// ---- Threads ----
export interface MessageThread {
  parent_message_id: string;
  reply_message_id: string;
}

// ---- Resource Access Control ----
export type ResourceType = 'channel' | 'space' | 'folder' | 'list';
export type AccessLevel = 'viewer' | 'commenter' | 'member' | 'manager';

export interface ResourceMembership {
  id: string;
  resource_type: ResourceType;
  resource_id: string;
  user_id: string;
  access_level: AccessLevel;
  invited_by: string | null;
  created_at: string;
  // Joined
  user?: User;
}

// ---- Project Management ----
export type TaskPriority = 'emergency' | 'urgent' | 'high' | 'normal' | 'low' | 'none';
export type StatusCategory = 'todo' | 'active' | 'done' | 'closed';
export type ListView = 'list' | 'board';
export type ResourceStatus = 'active' | 'inactive';

// ---- Task status catalog (for task_type = 'task') ----
// tasks.status holds one of these keys for `task` task-type. Other task types
// continue to use per-space space_statuses. The `category` field maps each key
// back to the legacy 4-bucket category so existing board grouping + notification
// triggers keep working.
export type TaskStatusKey =
  | 'open' | 'empty'
  | 'scheduled' | 'reminder' | 'back_burner' | 'up_next' | 'this_week' | 'tomorrow' | 'front_burner' | 'today'
  | 'priority' | 'high_priority' | 'over_due' | 'urgent' | 'emergency' | 'focus_now'
  | 'active' | 'in_progress' | 'time_tracked' | 'active_daily'
  | 'routines' | 'imp_routines'
  | 'on_hold' | 'waiting_on_dependency' | 'follow_ups' | 'help' | 'unblocked'
  | 'closed';

export type TaskStatusGroup =
  | 'not_started'
  | 'scheduled_queued'
  | 'priority_urgency'
  | 'in_motion'
  | 'routines'
  | 'blocked_paused'
  | 'done';

export interface TaskStatusDef {
  key: TaskStatusKey;
  label: string;
  description: string;
  group: TaskStatusGroup;
  groupLabel: string;
  groupEmoji: string;
  category: StatusCategory;
  color: string;
}

export const TASK_STATUS_CATALOG: TaskStatusDef[] = [
  // Not Started → todo
  { key: 'open', label: 'OPEN', description: 'Newly created task, not yet triaged or planned.', group: 'not_started', groupLabel: 'Not Started', groupEmoji: '📥', category: 'todo', color: '#9ca3af' },
  { key: 'empty', label: 'EMPTY', description: 'Placeholder task with no details filled in yet.', group: 'not_started', groupLabel: 'Not Started', groupEmoji: '📥', category: 'todo', color: '#d1d5db' },

  // Scheduled / Queued → active
  { key: 'scheduled', label: 'SCHEDULED', description: 'Has a specific date/time set.', group: 'scheduled_queued', groupLabel: 'Scheduled / Queued', groupEmoji: '📅', category: 'active', color: '#60a5fa' },
  { key: 'reminder', label: 'REMINDER', description: 'A nudge to do or check something later.', group: 'scheduled_queued', groupLabel: 'Scheduled / Queued', groupEmoji: '📅', category: 'active', color: '#93c5fd' },
  { key: 'back_burner', label: 'BACK BURNER', description: 'Low priority; get to it eventually.', group: 'scheduled_queued', groupLabel: 'Scheduled / Queued', groupEmoji: '📅', category: 'active', color: '#a8a29e' },
  { key: 'up_next', label: 'UP NEXT', description: 'Next in line after current work wraps up.', group: 'scheduled_queued', groupLabel: 'Scheduled / Queued', groupEmoji: '📅', category: 'active', color: '#38bdf8' },
  { key: 'this_week', label: 'THIS WEEK', description: 'To be handled sometime this week.', group: 'scheduled_queued', groupLabel: 'Scheduled / Queued', groupEmoji: '📅', category: 'active', color: '#22d3ee' },
  { key: 'tomorrow', label: 'TOMORROW', description: 'Planned for the next day.', group: 'scheduled_queued', groupLabel: 'Scheduled / Queued', groupEmoji: '📅', category: 'active', color: '#06b6d4' },
  { key: 'front_burner', label: 'FRONT BURNER', description: 'Moving up the queue; becoming relevant soon.', group: 'scheduled_queued', groupLabel: 'Scheduled / Queued', groupEmoji: '📅', category: 'active', color: '#f59e0b' },
  { key: 'today', label: 'TODAY', description: 'Must be addressed today.', group: 'scheduled_queued', groupLabel: 'Scheduled / Queued', groupEmoji: '📅', category: 'active', color: '#f97316' },

  // Priority & Urgency → active (most urgent first)
  { key: 'focus_now', label: 'FOCUS NOW', description: 'Requires your undivided attention right now.', group: 'priority_urgency', groupLabel: 'Priority & Urgency', groupEmoji: '⚡', category: 'active', color: '#e11d48' },
  { key: 'emergency', label: 'EMERGENCY', description: 'Critical; drop everything.', group: 'priority_urgency', groupLabel: 'Priority & Urgency', groupEmoji: '⚡', category: 'active', color: '#b91c1c' },
  { key: 'urgent', label: 'URGENT', description: 'Needs immediate action.', group: 'priority_urgency', groupLabel: 'Priority & Urgency', groupEmoji: '⚡', category: 'active', color: '#ef4444' },
  { key: 'over_due', label: 'OVER DUE', description: 'Deadline has already passed.', group: 'priority_urgency', groupLabel: 'Priority & Urgency', groupEmoji: '⚡', category: 'active', color: '#dc2626' },
  { key: 'high_priority', label: 'HIGH PRIORITY', description: 'Very important; needs attention soon.', group: 'priority_urgency', groupLabel: 'Priority & Urgency', groupEmoji: '⚡', category: 'active', color: '#f97316' },
  { key: 'priority', label: 'PRIORITY', description: 'Important; above normal.', group: 'priority_urgency', groupLabel: 'Priority & Urgency', groupEmoji: '⚡', category: 'active', color: '#fb923c' },

  // In Motion → active
  { key: 'active', label: 'ACTIVE', description: 'Currently being worked on.', group: 'in_motion', groupLabel: 'In Motion', groupEmoji: '🏃', category: 'active', color: '#22c55e' },
  { key: 'in_progress', label: 'IN PROGRESS', description: 'Work has started and is ongoing.', group: 'in_motion', groupLabel: 'In Motion', groupEmoji: '🏃', category: 'active', color: '#16a34a' },
  { key: 'time_tracked', label: 'TIME TRACKED', description: 'Timer is running / hours being logged against it.', group: 'in_motion', groupLabel: 'In Motion', groupEmoji: '🏃', category: 'active', color: '#0d9488' },
  { key: 'active_daily', label: 'ACTIVE DAILY', description: 'Touched every day until resolved.', group: 'in_motion', groupLabel: 'In Motion', groupEmoji: '🏃', category: 'active', color: '#14b8a6' },

  // Routines → active
  { key: 'routines', label: 'ROUTINES', description: 'Regular recurring task.', group: 'routines', groupLabel: 'Routines', groupEmoji: '🔁', category: 'active', color: '#a855f7' },
  { key: 'imp_routines', label: 'IMP ROUTINES', description: 'Important recurring task that cannot be missed.', group: 'routines', groupLabel: 'Routines', groupEmoji: '🔁', category: 'active', color: '#7c3aed' },

  // Blocked / Paused → active
  { key: 'on_hold', label: 'ON HOLD', description: 'Intentionally paused for now.', group: 'blocked_paused', groupLabel: 'Blocked / Paused', groupEmoji: '⏸️', category: 'active', color: '#78716c' },
  { key: 'waiting_on_dependency', label: 'WAITING ON – DEPENDANCY', description: 'Blocked until something/someone else moves.', group: 'blocked_paused', groupLabel: 'Blocked / Paused', groupEmoji: '⏸️', category: 'active', color: '#6b7280' },
  { key: 'follow_ups', label: 'FOLLOW UPS', description: 'Awaiting a reply; check back periodically.', group: 'blocked_paused', groupLabel: 'Blocked / Paused', groupEmoji: '⏸️', category: 'active', color: '#4b5563' },
  { key: 'help', label: 'HELP', description: 'Stuck; needs input or assistance from someone.', group: 'blocked_paused', groupLabel: 'Blocked / Paused', groupEmoji: '⏸️', category: 'active', color: '#a16207' },
  { key: 'unblocked', label: 'UNBLOCKED', description: 'Was blocked, now free to resume.', group: 'blocked_paused', groupLabel: 'Blocked / Paused', groupEmoji: '⏸️', category: 'active', color: '#84cc16' },

  // Closed → closed
  { key: 'closed', label: 'CLOSED', description: 'Completed and archived.', group: 'done', groupLabel: 'Closed', groupEmoji: '✅', category: 'closed', color: '#10b981' },
];

const TASK_STATUS_BY_KEY: Record<string, TaskStatusDef> = TASK_STATUS_CATALOG.reduce(
  (m, d) => { m[d.key] = d; return m; },
  {} as Record<string, TaskStatusDef>
);

export function getTaskStatusDef(key: string | null | undefined): TaskStatusDef | null {
  if (!key) return null;
  return TASK_STATUS_BY_KEY[key] || null;
}

export function getTaskStatusCategory(key: string | null | undefined): StatusCategory | null {
  const def = getTaskStatusDef(key);
  return def ? def.category : null;
}

export interface Space {
  id: string;
  workspace_id: string;
  name: string;
  color: string;
  icon: string;
  description: string | null;
  is_private: boolean;
  status: ResourceStatus;
  is_locked: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
  position: number;
  client_id?: string | null;
  /** 'personal' = a private per-user space backing the My Tasks view, hidden from the normal Spaces sidebar. */
  kind?: 'normal' | 'personal';
  my_access_level?: AccessLevel;
  // Joined
  statuses?: SpaceStatus[];
  folders?: Folder[];
  lists?: List[]; // lists directly under space (no folder)
}

export interface SpaceStatus {
  id: string;
  space_id: string;
  name: string;
  color: string;
  position: number;
  is_default: boolean;
  category: StatusCategory;
}

export interface Folder {
  id: string;
  space_id: string;
  name: string;
  is_private: boolean;
  status: ResourceStatus;
  is_locked: boolean;
  position: number;
  created_by: string;
  created_at: string;
  updated_at: string;
  my_access_level?: AccessLevel;
  profile_id?: string | null;
  profile_version?: number | null;
  client_id?: string | null;
  client_space_template_id?: string | null;
  client_space_template_version?: number | null;
  parent_folder_id?: string | null;
  folder_type?: string | null;
  // Joined
  lists?: List[];
  profile?: CustomProfile;
  client_space_template?: ClientSpaceTemplate;
  client?: Client;
}

export interface List {
  id: string;
  space_id: string;
  folder_id: string | null;
  name: string;
  is_private: boolean;
  status: ResourceStatus;
  is_locked: boolean;
  position: number;
  default_view: ListView;
  created_by: string;
  created_at: string;
  updated_at: string;
  my_access_level?: AccessLevel;
  profile_id?: string | null;
  profile_version?: number | null;
  // Joined
  task_count?: number;
  profile?: CustomProfile;
}

export interface TaskMetadata {
  format?: string;
  audience?: string;
  tone?: string;
  category?: string;
  references?: string[];
  /** @deprecated File attachments now live in the `task_attachments` table — see TaskAttachment. */
  attachments?: { name: string; size: string }[];
  custom?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface TaskAttachment {
  id: string;
  task_id: string;
  object_key: string;
  file_url: string;
  file_name: string;
  file_size: number;
  mime_type: string;
  uploaded_by: string;
  uploaded_at: string;
}

export type TaskFieldType = 'text' | 'textarea' | 'select' | 'multi_select' | 'number' | 'date' | 'url' | 'checkbox';

export interface TaskTypeFieldOption {
  label: string;
  value: string;
  color?: string;
}

export interface TaskTypeField {
  id: string;
  task_type_id: string;
  key: string;
  label: string;
  field_type: TaskFieldType;
  options: TaskTypeFieldOption[];
  is_required: boolean;
  help_text: string | null;
  help_url: string | null;
  allow_other: boolean;
  placeholder: string | null;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface TaskTypeRoleAccess {
  id: string;
  task_type_id: string;
  role_id: string;
  created_at: string;
  role?: Pick<Role, 'id' | 'name' | 'color'>;
}

export interface TaskTypeUserAccess {
  id: string;
  task_type_id: string;
  user_id: string;
  created_at: string;
  user?: Pick<User, 'id' | 'display_name' | 'email'>;
}

export interface TaskType {
  id: string;
  key: string;
  name: string;
  description: string | null;
  icon: string;
  color: string;
  position: number;
  is_default: boolean;
  is_system: boolean;
  is_enabled: boolean;
  created_at: string;
  updated_at: string;
  fields?: TaskTypeField[];
  role_access?: TaskTypeRoleAccess[];
  user_access?: TaskTypeUserAccess[];
}

export interface TaskChecklistItem {
  id: string;
  checklist_id: string;
  content: string;
  is_done: boolean;
  position: number;
  assigned_to: string | null;
  due_date: string | null;
  completed_at: string | null;
  completed_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface TaskChecklist {
  id: string;
  task_id: string;
  title: string;
  position: number;
  created_by: string;
  created_at: string;
  updated_at: string;
  items?: TaskChecklistItem[];
}

export interface Task {
  id: string;
  list_id: string;
  parent_task_id: string | null;
  title: string;
  description: string | null;
  status_id: string;
  priority: TaskPriority;
  position: number;
  due_date: string | null;
  work_date: string | null;
  start_date: string | null;
  focused_at: string | null;
  snoozed_until: string | null;
  task_type_id: string | null;
  time_estimate: number | null;
  time_tracked: number;
  metadata: TaskMetadata;
  display_number: number | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  // Routines: a non-null rule marks this task as a routine TEMPLATE
  // (hidden from normal task views; the nightly spawner copies it).
  recurrence?: TaskRecurrence | null;
  recurrence_paused?: boolean;
  // Set on spawned copies: which template they came from + the occurrence date.
  recurring_parent_id?: string | null;
  recurrence_instance_date?: string | null;
  // Joined
  status?: SpaceStatus;
  task_type?: TaskType;
  assignees?: User[];
  tags?: TaskTag[];
  subtasks?: Task[];
  comment_count?: number;
  creator?: User;
  list?: { id: string; name: string } | null;
  folder?: { id: string; name: string } | null;
  space?: { id: string; name: string } | null;
  parent_task?: { id: string; title: string } | null;
  // Hydrated on GET /pm/tasks/:id for spawned routine copies.
  routine_template?: { id: string; title: string; recurrence: TaskRecurrence | null } | null;
}

// Per-user, per-day calendar block placed on the Day Planner's hourly grid.
// A task can appear on different users' day plans independently.
export interface TaskDayPlan {
  id: string;
  task_id: string;
  user_id: string;
  plan_date: string;          // YYYY-MM-DD
  start_minute: number;       // 0..1439, minute-of-day in the user's local tz
  duration_minutes: number;
  created_at: string;
  updated_at: string;
  // Synthesized rows merged into GET /pm/day-plans (not real task_day_plans
  // rows): work-block occurrences fired by recurrence rules, and date-derived
  // occurrences from a task's work/due/start date landing on the viewed day.
  virtual?: boolean;
  kind?: 'work_block_occurrence' | 'date_occurrence';
  // Date-derived rows only: true when the source date carries no time-of-day
  // (midnight local) — the calendar renders these in its all-day strip.
  all_day?: boolean;
  date_field?: 'work' | 'due' | 'start';
  // Joined task summary so the calendar block can render without a second fetch.
  task?: Pick<Task, 'id' | 'title' | 'priority' | 'status_id' | 'time_estimate' | 'list_id'> & {
    // TEXT status (catalog key like 'closed' or legacy 'done'/'todo'). Used to
    // grey out blocks for completed tasks. Not on the base Task type today.
    status?: string | null;
    list?: { id: string; name: string } | null;
    // Flattened task_types join from the day-plans hydrate.
    task_type_key?: string | null;
    task_type_color?: string | null;
  };
}

export interface TaskTimeEntry {
  id: string;
  task_id: string;
  user_id: string;
  workspace_id: string;
  started_at: string;
  stopped_at: string;
  duration_seconds: number;
  source: 'timer' | 'manual';
  created_at: string;
  // Joined — task + its list/folder/space + parent (for UI breadcrumbs)
  task?: Pick<Task, 'id' | 'title' | 'list_id' | 'time_tracked'> & {
    list?: { id: string; name: string } | null;
    folder?: { id: string; name: string } | null;
    space?: { id: string; name: string } | null;
    parent_task?: { id: string; title: string } | null;
  };
}

export interface TaskTag {
  id: string;
  workspace_id: string;
  name: string;
  color: string;
}

export interface TaskComment {
  id: string;
  task_id: string;
  user_id: string;
  content: string;
  created_at: string;
  updated_at: string;
  // Joined
  user?: User;
}

// ---- Roles & Permissions ----
export type SystemRoleKey = 'member' | 'user' | 'guest';
export type RoleHomeView = 'member' | 'user' | 'guest' | 'designer' | 'video_editor' | 'accountant';

export interface Role {
  id: string;
  name: string;
  color: string;
  permissions: RolePermissions;
  is_default: boolean;
  is_system?: boolean;
  system_key?: SystemRoleKey | null;
  home_view: RoleHomeView;
  created_at: string;
  updated_at: string;
}

export interface RolePermissions {
  // Channel & Structure
  can_create_channels: boolean;
  can_create_lists: boolean;
  can_create_folders: boolean;
  can_create_spaces: boolean;
  // Archive Controls
  can_archive_lists: boolean;
  can_archive_spaces: boolean;
  can_archive_folders: boolean;
  // Message Controls
  can_delete_messages: boolean;
  can_edit_messages: boolean;
  can_send_dms: boolean;
  // Administration
  can_manage_channels: boolean;
  can_manage_members: boolean;
  can_manage_tasks: boolean;
  can_manage_roles: boolean;
  can_view_admin_panel: boolean;
  can_manage_workspace: boolean;
  // Time Logs — resolved against the PRIMARY role only
  can_edit_time_logs: boolean;
  time_edit_window_hours: number; // 0 = unlimited when toggle is on
  [key: string]: boolean | number;
}

// ---- Notifications ----
export type NotificationType =
  | 'message_mention'
  | 'dm_received'
  | 'task_assigned'
  | 'task_updated'
  | 'task_commented'
  | 'task_due_soon'
  | 'mention'
  | 'reaction_added';

export interface Notification {
  id: string;
  user_id: string;
  type: NotificationType;
  reference_id: string;
  reference_type: string;
  actor_id: string | null;
  title: string;
  body: string | null;
  metadata: Record<string, unknown>;
  is_read: boolean;
  created_at: string;
}

// ---- Favorites ----
export type FavoriteItemType = 'channel' | 'list' | 'folder' | 'space';

export interface Favorite {
  id: string;
  user_id: string;
  workspace_id: string;
  item_type: FavoriteItemType;
  item_id: string;
  created_at: string;
  item_name?: string;
  space_id?: string | null;
}

// ---- Shared With Me ----
export interface SharedWithMeItem {
  id: string;
  resource_type: 'list' | 'folder';
  resource_id: string;
  resource_name: string;
  access_level: AccessLevel;
  space_id: string;
  folder_id: string | null;
  invited_by: string | null;
  created_at: string;
}

// ---- Socket.io Events ----
export interface ServerToClientEvents {
  new_message: (message: Message) => void;
  thread_reply: (message: Message) => void;
  message_updated: (message: Message) => void;
  message_deleted: (data: { message_id: string; channel_id?: string; dm_conversation_id?: string }) => void;
  new_reaction: (reaction: Reaction & { message_id: string }) => void;
  user_typing: (data: { user_id: string; channel_id?: string; dm_conversation_id?: string }) => void;
  user_stop_typing: (data: { user_id: string; channel_id?: string; dm_conversation_id?: string }) => void;
  user_online: (data: { user_id: string }) => void;
  user_offline: (data: { user_id: string }) => void;
  online_users: (data: { user_ids: string[] }) => void;
  new_notification: (notification: Notification) => void;
}

export interface ClientToServerEvents {
  join_workspace: (workspace_id: string) => void;
  join_channel: (channel_id: string) => void;
  leave_channel: (channel_id: string) => void;
  send_message: (data: { channel_id?: string; dm_conversation_id?: string; content: string; type: MessageType; file_url?: string }) => void;
  typing: (data: { channel_id?: string; dm_conversation_id?: string }) => void;
  stop_typing: (data: { channel_id?: string; dm_conversation_id?: string }) => void;
}

// ---- API Response Types ----
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  cursor?: string;
  has_more: boolean;
}

// ---- Auth ----
export interface AuthTokens {
  access_token: string;
  refresh_token: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  display_name: string;
}

// ---- Daily Check-In ----
export type CheckInStatus = 'on_time' | 'late' | 'no_checkin';

export interface CheckIn {
  id: string;
  user_id: string;
  date: string;
  submitted_at: string | null;
  status: CheckInStatus;
  completed_items: string[];
  role_id: string | null;
  created_at: string;
  // Joined
  user?: User;
}

export interface CheckInConfigItem {
  id: string;
  label: string;
  description: string;
  isRequired: boolean;
  order: number;
}

export interface CheckInConfig {
  id: string;
  role_id: string;
  items: CheckInConfigItem[];
  updated_at: string;
  // Joined
  role?: Role;
}

export interface Holiday {
  id: string;
  name: string;
  date: string | null;
  is_recurring: boolean;
  recurring_month: number | null;
  recurring_day: number | null;
  created_at: string;
}

export interface UserCheckInSettings {
  id: string;
  user_id: string;
  deadline_time: string;
  created_at: string;
  updated_at: string;
}

export interface WorkingDaysConfig {
  id: string;
  working_days: number[];
  updated_at: string;
}

export interface UserOfficeTiming {
  id: string;
  user_id: string;
  label: string;
  from_time: string; // 'HH:MM'
  to_time: string;   // 'HH:MM'
  working_days: number[];
  max_break_minutes: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface OfficeTimingSummary {
  label: string;
  from_time: string;
  to_time: string;
  working_days: number[];
  max_break_minutes: number;
  office_hours_total_seconds: number;
}

export interface CheckInDashboardDay {
  date: string;
  status: CheckInStatus | 'holiday';
  submitted_at?: string | null;
}

export interface CheckInDashboardSummary {
  total_working_days: number;
  on_time: number;
  late: number;
  missed: number;
  holidays: number;
  attendance_rate: number;
}

// ---- Time Tracking ----
export type TimerType = 'work' | 'break' | 'no_work';

export interface TimerSession {
  id: string;
  user_id: string;
  date: string;
  timer_type: TimerType;
  start_time: string;
  end_time: string | null;
  duration_seconds: number | null;
  is_auto_stopped: boolean;
  created_at: string;
  user?: User;
}

export interface DailyTimeSummary {
  id: string;
  user_id: string;
  date: string;
  total_work_seconds: number;
  total_break_seconds: number;
  total_no_work_seconds: number;
  session_count: number;
  first_start: string | null;
  last_stop: string | null;
  updated_at: string;
  user?: User;
}

export interface ActiveTimerResponse {
  session: TimerSession | null;
  elapsed_seconds: number;
}

export interface TimeStatsResponse {
  today: DailyTimeSummary | null;
  active_timer: TimerSession | null;
  week_summaries: DailyTimeSummary[];
  office_timing?: OfficeTimingSummary | null;
  today_sessions?: TimerSession[];
  time_log_edit?: {
    can_edit: boolean;
    window_hours: number; // 0 = unlimited
  };
}

export interface TeamTimerStatus {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  active_timer: TimerSession | null;
  today_summary: DailyTimeSummary | null;
}

// ---- Mini App Access Management ----
export interface MiniApp {
  id: string;
  slug: string;
  name: string;
  description: string;
  icon: string;
  is_enabled: boolean;
  created_at: string;
  updated_at: string;
  // Joined
  role_access?: MiniAppRoleAccess[];
  user_access?: MiniAppUserAccess[];
}

export interface MiniAppRoleAccess {
  id: string;
  mini_app_id: string;
  role_id: string;
  created_at: string;
  // Joined
  role?: Role;
}

export interface MiniAppUserAccess {
  id: string;
  mini_app_id: string;
  user_id: string;
  created_at: string;
  // Joined
  user?: User;
}

// ---- Custom Profiles ----
export interface CustomProfile {
  id: string;
  slug: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  target_type: 'folder' | 'list';
  template: CustomProfileTemplate;
  version: number;
  is_enabled: boolean;
  created_at: string;
  updated_at: string;
  // Joined
  role_access?: CustomProfileRoleAccess[];
  user_access?: CustomProfileUserAccess[];
  instance_count?: number;
  outdated_instance_count?: number;
}

export interface CustomProfileTemplate {
  default_view?: ListView;
  lists?: { name: string; position: number; default_view?: ListView }[];
}

export interface CustomProfileRoleAccess {
  id: string;
  profile_id: string;
  role_id: string;
  created_at: string;
  // Joined
  role?: Role;
}

export interface CustomProfileUserAccess {
  id: string;
  profile_id: string;
  user_id: string;
  created_at: string;
  // Joined
  user?: User;
}

// ---- Client Spaces ----
export interface ClientSpaceTemplate {
  id: string;
  slug: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  template: {
    lists?: { name: string; position: number; default_view?: ListView }[];
  };
  version: number;
  is_enabled: boolean;
  created_at: string;
  updated_at: string;
  // Joined
  role_access?: ClientSpaceTemplateRoleAccess[];
  user_access?: ClientSpaceTemplateUserAccess[];
  instance_count?: number;
}

export interface ClientSpaceTemplateRoleAccess {
  id: string;
  template_id: string;
  role_id: string;
  created_at: string;
  role?: Role;
}

export interface ClientSpaceTemplateUserAccess {
  id: string;
  template_id: string;
  user_id: string;
  created_at: string;
  user?: User;
}

/**
 * @deprecated replaced by role_id in migration 020. Kept as a type
 * alias so older callers type-check while we finish the rollout.
 */
export type ClientAccessLevel = 'member' | 'admin';

export interface ClientUserAccess {
  id: string;
  client_id: string;
  user_id: string;
  role_id: string | null;
  created_by: string;
  created_at: string;
  // Joined
  user?: User;
  client?: Client;
  role?: Role;
}

// Note: `Client` interface is defined in the Clients section below.

// ---- Invitations ----
export type InvitationStatus = 'pending' | 'accepted' | 'expired';

export interface Invitation {
  id: string;
  email: string;
  role_id: string | null;
  invited_by: string;
  status: InvitationStatus;
  user_type: UserType;
  client_id: string | null;
  invited_at: string;
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
  // Joined
  role?: Role;
  invited_by_user?: Pick<User, 'id' | 'display_name'>;
  client?: Pick<Client, 'id' | 'business_name'>;
}

// ---- Partner-Client Assignments ----
export interface PartnerClientAssignment {
  id: string;
  user_id: string;
  client_id: string;
  role: string | null;
  created_at: string;
  updated_at: string;
  // Joined
  user?: User;
  client?: Client;
}

// ---- Clients Mini-App ----
export type SubscriptionPlan = 'Starter' | 'Basic' | 'Plus' | 'Pro' | 'Personal';
export type SubscriptionTier = 'Junior' | 'Pro' | 'Elite' | 'Top Talents';
export type SubscriptionSlug = 'designer' | 'video_editor' | 'accountant';
export type DeliverableKind = 'hours' | 'item';
export type CurrencyCode = 'INR' | 'USD';

// Formats a price in the given currency — "₹3,000" or "$30".
export function formatPrice(amount: number, currency: CurrencyCode): string {
  const sym = currency === 'USD' ? '$' : '\u20B9';
  const locale = currency === 'USD' ? 'en-US' : 'en-IN';
  return `${sym}${amount.toLocaleString(locale)}`;
}

export type ClientStatus = 'active' | 'paused' | 'cancelled';
export type SubmissionStatus =
  | 'new'
  | 'in_progress'
  | 'selection'
  | 'converted'
  | 'onboarding'
  | 'closed';

export const PIPELINE_STATUSES: SubmissionStatus[] = [
  'new',
  'in_progress',
  'selection',
  'converted',
  'onboarding',
  'closed',
];

export const TERMINAL_STATUSES: SubmissionStatus[] = ['converted', 'onboarding', 'closed'];

export type ClientSubscriptionStatus = 'active' | 'paused' | 'cancelled';

export interface Country {
  id: string;
  name: string;
  currency: CurrencyCode;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface Subscription {
  id: string;
  slug: SubscriptionSlug;
  name: string;
  description: string | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
  // Joined
  plans?: SubscriptionPlanRow[];
  deliverable_types?: SubscriptionDeliverableType[];
}

export interface SubscriptionPlanRow {
  id: string;
  subscription_id: string;
  plan: SubscriptionPlan;
  tier: SubscriptionTier;
  is_active: boolean;
  sort_order: number;
  daily_hours: number | null;
  weekly_hours: number | null;
  monthly_hours: number | null;
  created_at: string;
  updated_at: string;
  // Joined
  pricing?: SubscriptionPlanPricing[];
  partner_pricing?: SubscriptionPlanPartnerPricing[];
  deliverables?: SubscriptionPlanDeliverable[];
}

export interface SubscriptionPlanPartnerPricing {
  id: string;
  plan_id: string;
  country_id: string;
  price: number;
  created_at: string;
  updated_at: string;
  // Joined
  country?: Country;
}

export interface SubscriptionPlanPricing {
  id: string;
  plan_id: string;
  country_id: string;
  /** Minimum customer price for this plan in this country (was "customer price" in v1). */
  price: number;
  /** Margin admin keeps from the customer's proposed price; partner price = proposed - margin. */
  margin_value: number;
  margin_type: 'fixed' | 'percent';
  created_at: string;
  updated_at: string;
  // Joined
  country?: Country;
}

export interface SubscriptionDeliverableType {
  id: string;
  subscription_id: string;
  name: string;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface SubscriptionPlanDeliverable {
  id: string;
  plan_id: string;
  kind: DeliverableKind;
  deliverable_type_id: string | null;
  per_day: number;
  per_week: number;
  per_month: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
  // Joined
  deliverable_type?: SubscriptionDeliverableType | null;
}

export interface ClientSubscriptionDeliverable {
  id: string;
  client_subscription_id: string;
  source_plan_deliverable_id: string | null;
  kind: DeliverableKind;
  deliverable_type_id: string | null;
  per_day: number;
  per_week: number;
  per_month: number;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  // Joined
  deliverable_type?: SubscriptionDeliverableType | null;
}

export function formatDeliverableCadence(
  perDay: number,
  perWeek: number,
  perMonth: number,
  unit: string,
): string {
  return `${perDay} ${unit}/day · ${perWeek} ${unit}/week · ${perMonth} ${unit}/month`;
}

export interface SalesPerson {
  id: string;
  display_name: string;
  email: string;
  avatar_url: string | null;
}

export interface ClientSubmission {
  id: string;
  business_name: string;
  contact_person: string;
  designation: string | null;
  contact_number: string;
  email: string;
  business_address: string | null;
  gst_registered: boolean;
  gst_number: string | null;
  accounts_email: string | null;
  country_id: string;
  status: SubmissionStatus;
  created_at: string;
  primary_sales_person_id: string | null;
  secondary_sales_person_id: string | null;
  onboarding_link_id: string | null;
  // Joined
  country?: Country;
  primary_sales_person?: SalesPerson | null;
  secondary_sales_person?: SalesPerson | null;
  selected_subscriptions?: ClientSubmissionSubscription[];
  brands?: ClientSubmissionBrand[];
}

// Source of a brief-form submission. 'shared_form' = squadhub.in/connect
// (a link sent to a specific lead). 'landing_page_form' = a future
// embedded form on upsquadconnect.com.
export type BrandSource = 'shared_form' | 'landing_page_form';

// Service-type slug stored on the brand. Lets the brief form rehydrate
// Step 1 roles on autofill without a label<->slug reverse map.
export type BrandServiceType = 'designer' | 'video_editor' | 'designer_video_editor' | 'accountant';

export interface ClientSubmissionBrand {
  id: string;
  submission_id: string;
  brand_name: string;
  business_nature: string | null;
  business_note: string | null;
  /**
   * Legacy brand-level requirement note. As of migration 083 the source of
   * truth moves to subscription_cards (one note + hours per role). New
   * /connect submissions write null here; rows from before still hold their
   * old value and the admin UI falls back to displaying it.
   */
  requirement_note: string | null;
  service_type: BrandServiceType | null;
  target_languages: string[];
  working_days: string[];
  country_id: string | null;
  target_tiers: string[];
  business_location: string | null;
  source: BrandSource;
  created_at: string;
  updated_at: string;
  // Joined
  target_regions?: string[];
  /** Slim view of the brand's subscription_cards, used by the admin New
   *  Clients slider to render per-role requirement notes + hours. */
  cards?: ClientSubmissionBrandCard[];
}

/** Slim card shape returned alongside the brand in the New Clients
 *  endpoint. Not the full SubscriptionCard — just the fields the slider
 *  needs to surface per-role requirement details. */
export interface ClientSubmissionBrandCard {
  id: string;
  service_type: string | null;
  requirement_note: string | null;
  hours_note: string | null;
  state: string;
  created_at: string;
}

export interface ClientSubmissionSubscription {
  id: string;
  submission_id: string;
  subscription_id: string;
  plan_id: string;
  created_at: string;
  // Joined
  subscription?: Subscription;
  plan?: SubscriptionPlanRow;
  /**
   * State of the linked subscription_card (1:1 by submission_subscription_id).
   * null when no card row exists yet. Powers the "Cancel" button — the staged
   * sub is deleted while draft/none, and the card is closed once published.
   */
  card_state?: SubscriptionCardState | null;
}

// ---- Subscription Cards ----
// Partners have their own tier including 'Custom'. subscription_plans.tier
// stays (Junior|Pro|Elite|Top Talents) — do not conflate them.
// 'Elite' is being renamed to 'Top Talents' (Phase 1: both values are accepted;
// Phase 2 backfills data; Phase 3 drops 'Elite'). isTopTalentsTier() normalises
// legacy values from both repos (Squad Hub 'Elite' + Profiles 'elite') so callers
// don't have to repeat that tolerance everywhere.
export type PartnerTier = 'Junior' | 'Pro' | 'Elite' | 'Top Talents' | 'Custom';
export const PARTNER_TIERS: PartnerTier[] = ['Junior', 'Pro', 'Elite', 'Top Talents', 'Custom'];

export function isTopTalentsTier(t: string | null | undefined): boolean {
  return t === 'Top Talents' || t === 'Elite' || t === 'elite';
}

export type SubscriptionCardState = 'draft' | 'published' | 'assigned' | 'closed';
/**
 * `broadcast` (default) — at publish time the server fans out to all matching
 * partners and SquadHire broadcasts to its talents. `manual` — no fan-out;
 * the card is visible in admin Published Cards lists but recipients must be
 * hand-picked via the assign endpoints.
 */
export type SubscriptionCardDistribution = 'broadcast' | 'manual';
export type RecipientStatus = 'pending' | 'accepted' | 'rejected';
export type WeekDay = 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun';
export const WEEK_DAYS: WeekDay[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export interface SubscriptionCardCustomDeliverable {
  id: string;
  name: string;
  kind: DeliverableKind;
  per_day: number;
  per_week: number;
  per_month: number;
  /**
   * For kind='item', the picked deliverable type (FK to subscription_deliverable_types).
   * Optional/null on legacy rows that pre-date this field. UI falls back to `name`.
   */
  deliverable_type_id?: string | null;
}

export interface SubscriptionCardTargetRegion {
  country_id: string;
  region: string;
}

export interface SubscriptionCard {
  id: string;
  submission_subscription_id: string;
  state: SubscriptionCardState;
  distribution: SubscriptionCardDistribution;
  working_days: WeekDay[];
  brand_name: string | null;
  business_nature: string | null;
  notes: string | null;
  target_tiers: PartnerTier[];
  min_experience_years: number;
  target_languages: string[];
  custom_deliverables: SubscriptionCardCustomDeliverable[];
  /**
   * IDs (FK on subscription_plan_deliverables) of the plan's default
   * deliverables that the sales user has explicitly disabled for this client.
   * Empty by default. The partner UI filters them out; if no hours-kind
   * default remains, the partner sees "No hourly commitment".
   */
  disabled_default_deliverable_ids: string[];
  target_country_ids: string[];
  target_regions: SubscriptionCardTargetRegion[];
  // SquadHire (Profiles) targeting — UUIDs from SquadHire's categories table.
  // No SquadHub-side FK. Empty means the card is not published to SquadHire.
  squadhire_category_ids: string[];
  /** Per-card override of the plan's default partner price. null = use default. */
  partner_price_override: number | null;
  published_at: string | null;
  published_by: string | null;
  closed_at: string | null;
  /** Set when an admin recalled a card with acceptances. Acceptees keep
   *  seeing the card with a "Recalled" tag; pending recipients are dropped. */
  recalled_at?: string | null;
  /** Secondary cards link to a primary card via parent_card_id. Primary
   *  cards have parent_card_id = null. */
  parent_card_id?: string | null;
  /** Human-readable unique code (e.g. CARD-A3X9K2) generated on assign. Used to link this card to a space. */
  card_code: string | null;
  /** FK to folders(id) — the client-space folder this card is linked to. Null means not linked. */
  linked_folder_id: string | null;
  /** When the card was linked to a space. Null if not yet linked. */
  linked_at: string | null;
  created_at: string;
  updated_at: string;
  // Derived
  recipient_counts?: {
    partners: { pending: number; accepted: number; rejected: number };
    talents: { accepted: number; rejected: number };
  };
  // Joined
  submission_subscription?: ClientSubmissionSubscription;
  submission?: Pick<ClientSubmission, 'id' | 'business_name' | 'country_id' | 'country'> | null;
}

/**
 * Per-card client pre-fill share link (24h, single-use). A salesperson
 * generates a tokenised link for a form-request DRAFT card; the client opens
 * it unauthenticated, confirms the pre-filled brief + their contact, and the
 * SAME card is updated on submit. Backed by `subscription_card_share_links`.
 */
export type CardShareLinkStatus = 'active' | 'expired' | 'completed' | 'revoked';

export interface CardShareLink {
  token: string; // = subscription_card_share_links.id (the UUID token)
  url: string; // absolute public URL — /card/:token
  expires_at: string;
  completed_at?: string | null;
  revoked_at?: string | null;
  status: CardShareLinkStatus;
}

/** Safe, client-visible pre-fill payload returned by GET /leads/card-link/:token. */
export interface CardSharePrefill {
  brand_name: string | null;
  business_nature: string | null;
  business_note: string | null; // card.notes
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  business_location: string | null;
  service_type: string | null; // display label, read-only (role is immutable)
  working_days: string[];
  languages: string[];
  country_id: string | null;
  state_regions: string[];
  requirement_note: string | null;
  hours_note: string | null;
}

export interface CardShareLinkValidation {
  valid: boolean;
  expired: boolean;
  completed: boolean;
  expires_at?: string;
  prefill?: CardSharePrefill;
}

/**
 * A SquadHire category as seen by the SquadHub admin UI. Served by
 * /admin/integrations/squadhire/categories (a signed read-through to
 * Profiles). `id` is a UUID from Profiles' DB — never used as a FK here.
 */
export interface SquadHireCategory {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  sort_order: number;
}

export interface SubscriptionCardRecipient {
  id: string;
  card_id: string;
  partner_id: string;
  status: RecipientStatus;
  responded_at: string | null;
  created_at: string;
  // Joined
  card?: SubscriptionCard;
}

export interface SupportedLanguage {
  code: string;
  name: string;
}

export const SUPPORTED_LANGUAGES: SupportedLanguage[] = [
  { code: 'en', name: 'English' },
  { code: 'hi', name: 'Hindi' },
  { code: 'ta', name: 'Tamil' },
  { code: 'te', name: 'Telugu' },
  { code: 'kn', name: 'Kannada' },
  { code: 'ml', name: 'Malayalam' },
  { code: 'mr', name: 'Marathi' },
  { code: 'gu', name: 'Gujarati' },
  { code: 'bn', name: 'Bengali' },
  { code: 'pa', name: 'Punjabi' },
  { code: 'ur', name: 'Urdu' },
  { code: 'es', name: 'Spanish' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'ar', name: 'Arabic' },
  { code: 'zh', name: 'Chinese' },
  { code: 'ja', name: 'Japanese' },
  { code: 'id', name: 'Bahasa Indonesia' },
  { code: 'fil', name: 'Filipino' },
];

export interface Client {
  id: string;
  submission_id: string | null;
  business_name: string;
  contact_person: string;
  designation: string | null;
  contact_number: string;
  email: string;
  business_address: string;
  gst_registered: boolean;
  gst_number: string | null;
  accounts_email: string | null;
  country_id: string;
  status: ClientStatus;
  created_at: string;
  updated_at: string;
  primary_sales_person_id: string | null;
  secondary_sales_person_id: string | null;
  // Joined
  country?: Country;
  subscriptions?: ClientSubscription[];
  primary_sales_person?: SalesPerson | null;
  secondary_sales_person?: SalesPerson | null;
  linkedCards?: { id: string; state: string; published_at: string | null; card_code: string | null; linked_folder_id: string | null; linked_at: string | null }[];
}

export type OnboardingLinkStatus = 'active' | 'used' | 'expired';

export interface OnboardingLink {
  id: string;
  created_by: string;
  primary_sales_person_id: string;
  secondary_sales_person_id: string | null;
  submission_id: string | null;
  expires_at: string;
  created_at: string;
  // Derived
  status?: OnboardingLinkStatus;
  url?: string;
  // Joined
  created_by_user?: SalesPerson | null;
  primary_sales_person?: SalesPerson | null;
  secondary_sales_person?: SalesPerson | null;
  submission?: ClientSubmission | null;
}

export interface ClientSubscription {
  id: string;
  client_id: string;
  subscription_id: string;
  plan_id: string;
  status: ClientSubscriptionStatus;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  // Joined
  subscription?: Subscription;
  plan?: SubscriptionPlanRow;
  deliverables?: ClientSubscriptionDeliverable[];
  card?: { id: string; state: string; published_at: string | null; card_code: string | null; linked_folder_id: string | null; linked_at: string | null } | null;
}

// ---- Cash Book ----
export type CashBookEntryType = 'cash_in' | 'cash_out';
export type CashBookPaymentMode = 'cash' | 'upi' | 'bank_transfer' | 'cheque' | 'other';
export type CashBookUserRole = 'client_admin' | 'staff';
export type CheckType = 'collection' | 'deposit';
export type CheckStatus = 'received' | 'deposited' | 'cleared' | 'bounced';

export interface CashBookClientAccess {
  id: string;
  client_id: string;
  is_enabled: boolean;
  enabled_by: string;
  created_at: string;
  updated_at: string;
  // Joined
  client?: Client;
}

export interface CashBookPartnerAccess {
  id: string;
  user_id: string;
  client_id: string;
  is_enabled: boolean;
  enabled_by: string | null;
  created_at: string;
  updated_at: string;
  // Joined
  user?: Pick<User, 'id' | 'display_name' | 'email'>;
  client?: Pick<Client, 'id' | 'business_name'>;
}

export interface CashBookUser {
  id: string;
  user_id: string;
  client_id: string;
  role: CashBookUserRole;
  is_active: boolean;
  invited_by: string | null;
  created_at: string;
  updated_at: string;
  // Joined
  user?: Pick<User, 'id' | 'display_name' | 'email'>;
}

export interface CashBookCategory {
  id: string;
  client_id: string;
  name: string;
  type: 'cash_in' | 'cash_out' | 'both';
  is_active: boolean;
  position: number;
  created_at: string;
}

export interface CashBookEntry {
  id: string;
  client_id: string;
  user_id: string;
  local_id: string | null;
  entry_type: CashBookEntryType;
  amount: number;
  entry_date: string;
  description: string | null;
  category_id: string | null;
  party_name: string | null;
  payment_mode: CashBookPaymentMode;
  photo_url: string | null;
  photo_key: string | null;
  is_posted: boolean;
  posted_by: string | null;
  posted_at: string | null;
  is_deleted: boolean;
  version: number;
  server_updated_at: string;
  created_at: string;
  updated_at: string;
  // Joined
  user?: Pick<User, 'id' | 'display_name'>;
  category?: CashBookCategory;
}

export interface CheckEntry {
  id: string;
  client_id: string;
  user_id: string;
  local_id: string | null;
  check_type: CheckType;
  check_number: string;
  bank_name: string;
  amount: number;
  check_date: string;
  party_name: string;
  status: CheckStatus;
  deposit_date: string | null;
  clearance_date: string | null;
  bounce_reason: string | null;
  photo_url: string | null;
  photo_key: string | null;
  description: string | null;
  is_posted: boolean;
  posted_by: string | null;
  posted_at: string | null;
  is_deleted: boolean;
  version: number;
  server_updated_at: string;
  created_at: string;
  updated_at: string;
  // Joined
  user?: Pick<User, 'id' | 'display_name'>;
}

export interface CashBookEntryAudit {
  id: string;
  entry_id: string;
  entry_table: 'cash_book_entries' | 'check_entries';
  changed_by: string;
  action: 'create' | 'update' | 'delete' | 'post' | 'unpost';
  changes: Record<string, { old: unknown; new: unknown }>;
  created_at: string;
}

export interface CashBookDailyBalance {
  client_id: string;
  balance_date: string;
  opening_balance: number;
  total_cash_in: number;
  total_cash_out: number;
  closing_balance: number;
  last_computed_at: string;
}

export interface CashBookDashboard {
  date: string;
  opening_balance: number;
  total_cash_in: number;
  total_cash_out: number;
  closing_balance: number;
  entry_count: number;
}

export interface CashBookSyncRequest {
  last_synced_at: string | null;
  push: {
    entries: {
      created: Partial<CashBookEntry>[];
      updated: Partial<CashBookEntry>[];
      deleted: { server_id: string; version: number }[];
    };
    checks: {
      created: Partial<CheckEntry>[];
      updated: Partial<CheckEntry>[];
      deleted: { server_id: string; version: number }[];
    };
  };
}

export interface CashBookSyncPushResult {
  created: { local_id: string; server_id: string; status: 'ok' | 'error'; error?: string }[];
  updated: { server_id: string; status: 'ok' | 'conflict'; server_version?: unknown }[];
  deleted: { server_id: string; status: 'ok' | 'error' }[];
}

export interface CashBookSyncResponse {
  synced_at: string;
  pull: {
    entries: {
      created_or_updated: CashBookEntry[];
      deleted_ids: string[];
    };
    checks: {
      created_or_updated: CheckEntry[];
      deleted_ids: string[];
    };
    categories: CashBookCategory[];
  };
  push_results: {
    entries: CashBookSyncPushResult;
    checks: CashBookSyncPushResult;
  };
}

// ============================================================
// Learning Management System
// ============================================================

export type LmsItemKind = 'post' | 'course';
export type LmsItemStatus = 'draft' | 'published' | 'archived';
export type LmsAssignmentStatus = 'not_started' | 'in_progress' | 'completed';
export type LmsBlockType =
  | 'text'
  | 'image'
  | 'video_upload'
  | 'video_embed'
  | 'audio'
  | 'pdf'
  | 'quiz';

export interface LmsCategory {
  id: string;
  name: string;
  slug: string;
  color: string;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface LmsItem {
  id: string;
  kind: LmsItemKind;
  title: string;
  slug: string;
  summary: string | null;
  cover_image_url: string | null;
  category_id: string | null;
  status: LmsItemStatus;
  published_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  // Joined (populated by API as needed)
  category?: LmsCategory | null;
  lessons?: LmsLesson[];
  audience_types?: UserType[];
  audience_user_ids?: string[];
  assignment_count?: number;
}

export interface LmsLesson {
  id: string;
  item_id: string;
  title: string;
  summary: string | null;
  // Inactive lessons are hidden from learners but stay visible/editable in the
  // admin editor. Existing rows default to active (see migration 100).
  is_active: boolean;
  position: number;
  created_at: string;
  updated_at: string;
  blocks?: LmsContentBlock[];
  // Lesson-level audience override. Empty on both = visible to everyone
  // enrolled in the course; otherwise the lesson is hidden from users who
  // don't match a type or aren't listed individually. (Populated by admin API.)
  audience_types?: UserType[];
  audience_user_ids?: string[];
}

export interface LmsContentBlock {
  id: string;
  lesson_id: string;
  type: LmsBlockType;
  position: number;
  text_content: unknown | null;   // Tiptap JSON doc
  file_url: string | null;
  file_name: string | null;
  file_size: number | null;
  mime_type: string | null;
  embed_url: string | null;
  embed_provider: string | null;
  caption: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  // Only for quiz blocks
  quiz_questions?: LmsQuizQuestion[];
}

export interface LmsQuizOption {
  id: string;
  text: string;
}

export interface LmsQuizQuestion {
  id: string;
  block_id: string;
  position: number;
  prompt: string;
  options: LmsQuizOption[];
  correct_option_id: string;
  explanation: string | null;
}

export interface LmsAssignment {
  id: string;
  item_id: string;
  user_id: string;
  status: LmsAssignmentStatus;
  progress_percent: number;
  assigned_at: string;
  started_at: string | null;
  completed_at: string | null;
  // Joined
  item?: LmsItem;
  user?: User;
  completed_lesson_ids?: string[];
}

export interface LmsLessonProgress {
  assignment_id: string;
  lesson_id: string;
  completed_at: string;
}

export interface LmsQuizAttempt {
  id: string;
  assignment_id: string;
  block_id: string;
  answers: Record<string, string>;
  score_percent: number;
  passed: boolean;
  submitted_at: string;
}

// Payload shapes for admin audience PUT
export interface LmsAudienceInput {
  user_types: UserType[];
  user_ids: string[];
}

// ============================================================
// Squad Chat (WhatsApp-style messaging, two Android apps)
// Tables live in chat_* schema; isolated from workspace messages.
// ============================================================

export type ChatAppVariant = 'clients' | 'team';
export type ChatMessageType = 'text' | 'voice' | 'image' | 'video' | 'document' | 'system';
export type ChatConversationType = 'group' | 'dm';
export type ChatMessageLocalState = 'queued' | 'sending' | 'sent' | 'failed';

export interface ChatGroup {
  id: string;
  name: string;
  description: string | null;
  avatar_url: string | null;
  app_scope: ChatAppVariant;
  created_by: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  // Joined (optional)
  member_count?: number;
  unread_count?: number;
  last_message?: ChatMessage | null;
  my_is_group_admin?: boolean;
  my_last_read_at?: string | null;
}

export interface ChatGroupMember {
  id: string;
  group_id: string;
  user_id: string;
  is_group_admin: boolean;
  joined_at: string;
  last_read_at: string | null;
  muted_until: string | null;
  // Joined
  user?: Pick<User, 'id' | 'display_name' | 'avatar_url' | 'user_type' | 'is_admin'>;
}

export interface ChatDmConversation {
  id: string;
  user1_id: string;
  user2_id: string;
  last_message_at: string | null;
  created_at: string;
  // Joined
  other_user?: Pick<User, 'id' | 'display_name' | 'avatar_url' | 'user_type' | 'is_admin'>;
  unread_count?: number;
  last_message?: ChatMessage | null;
}

export interface ChatMessageReceipt {
  message_id: string;
  user_id: string;
  delivered_at: string | null;
  read_at: string | null;
}

export interface ChatMessage {
  id: string;
  group_id: string | null;
  dm_conversation_id: string | null;
  sender_id: string | null;
  client_temp_id: string | null;
  content: string | null;
  type: ChatMessageType;
  file_url: string | null;
  file_name: string | null;
  file_size: number | null;
  file_mime: string | null;
  duration_ms: number | null;
  width: number | null;
  height: number | null;
  parent_message_id: string | null;
  mentions: string[];
  edited_at: string | null;
  deleted_at: string | null;
  created_at: string;
  // Joined
  sender?: Pick<User, 'id' | 'display_name' | 'avatar_url' | 'user_type' | 'is_admin'> | null;
  parent?: Pick<ChatMessage, 'id' | 'sender_id' | 'content' | 'type' | 'file_url' | 'deleted_at'> & {
    sender?: Pick<User, 'id' | 'display_name'> | null;
  } | null;
  receipts?: ChatMessageReceipt[];
  // Client-side only (never returned from server)
  local_state?: ChatMessageLocalState;
}

export type ChatPushProvider = 'expo' | 'fcm';

export interface ChatPushToken {
  id: string;
  user_id: string;
  token: string;
  app_variant: ChatAppVariant;
  platform: 'ios' | 'android';
  provider: ChatPushProvider;
  last_seen_at: string;
  created_at: string;
}

export interface ChatAppConfig {
  variant: ChatAppVariant;
  min_version: string;
  download_url: string | null;
  updated_by: string | null;
  updated_at: string;
}

// ---- Squad Chat request/response payloads ----

export interface ChatSendMessageRequest {
  group_id?: string;
  dm_conversation_id?: string;
  client_temp_id: string;
  content?: string;
  type: ChatMessageType;
  file_url?: string;
  file_name?: string;
  file_size?: number;
  file_mime?: string;
  duration_ms?: number;
  width?: number;
  height?: number;
  parent_message_id?: string;
  mentions?: string[];
}

export interface ChatPresignRequest {
  conversation_type: ChatConversationType;
  conversation_id: string;
  filename: string;
  content_type: string;
  file_size: number;
  file_category: 'image' | 'audio' | 'video' | 'file';
}

export interface ChatPresignResponse {
  upload_url: string;
  public_url: string;
  key: string;
  expires_in: number;
}

export interface ChatReceiptsDeliveredRequest {
  message_ids: string[];
}

export interface ChatReceiptsReadRequest {
  conversation_type: ChatConversationType;
  conversation_id: string;
  up_to_message_id: string;
}

export interface ChatPushRegisterRequest {
  token: string;
  app_variant: ChatAppVariant;
  platform: 'ios' | 'android';
  provider?: ChatPushProvider;
}

export interface ChatCreateDmRequest {
  other_user_id: string;
}

// ---- Squad Chat socket events ----
// Merged into ServerToClientEvents/ClientToServerEvents via intersection
// at the socket.io consumer so one connection handles both surfaces.

export interface ChatServerToClientEvents {
  chat_message_new: (message: ChatMessage) => void;
  chat_message_edit: (message: ChatMessage) => void;
  chat_message_delete: (data: { id: string; group_id?: string; dm_conversation_id?: string }) => void;
  chat_receipt_update: (data: {
    message_id: string;
    user_id: string;
    delivered_at: string | null;
    read_at: string | null;
  }) => void;
  chat_typing_start: (data: {
    user_id: string;
    conversation_type: ChatConversationType;
    conversation_id: string;
  }) => void;
  chat_typing_stop: (data: {
    user_id: string;
    conversation_type: ChatConversationType;
    conversation_id: string;
  }) => void;
  chat_group_member_added: (data: { group_id: string; member: ChatGroupMember }) => void;
  chat_group_member_removed: (data: { group_id: string; user_id: string }) => void;
  chat_group_updated: (group: ChatGroup) => void;
}

export interface ChatClientToServerEvents {
  chat_typing: (data: { conversation_type: ChatConversationType; conversation_id: string }) => void;
  chat_stop_typing: (data: { conversation_type: ChatConversationType; conversation_id: string }) => void;
  chat_mark_read: (data: {
    conversation_type: ChatConversationType;
    conversation_id: string;
    up_to_message_id: string;
  }) => void;
}

// ============================================================
// Profile Access — local mirror of SquadHire's talent_access_grants
// ============================================================

export type ProfileAccessGrantStatus = 'active' | 'expired' | 'revoked';

export interface ProfileAccessGrantCategory {
  id: string;
  name: string;
  slug: string;
}

export interface ProfileAccessGrant {
  id: string;
  email: string;
  expires_at: string;
  revoked_at: string | null;
  notes: string | null;
  created_by: string | null;
  category_ids: string[];
  profiles_grant_id: string | null;
  profiles_synced_at: string | null;
  profiles_sync_attempts: number;
  profiles_sync_last_error: string | null;
  created_at: string;
  updated_at: string;
  // Computed server-side from expires_at + revoked_at — not a column.
  status?: ProfileAccessGrantStatus;
  // Hydrated by joining against the cached SquadHire categories list.
  categories?: ProfileAccessGrantCategory[];
}

export interface CreateProfileAccessGrantInput {
  email: string;
  category_ids: string[];
  expires_at?: string;
  notes?: string | null;
}

export interface UpdateProfileAccessGrantInput {
  category_ids?: string[];
  expires_at?: string;
  notes?: string | null;
}

export interface ExtendProfileAccessGrantInput {
  days: number;
}

// ============================================================
// Routines / recurring tasks
//
// Same recurrence dialect as work_blocks (see migration 091), but for
// tasks the rule lives on the task row itself and a `kind` is always a
// real cadence — "does not repeat" is recurrence = null, not kind='none'.
// All date strings are YYYY-MM-DD and are evaluated in IST on the server.
// ============================================================

export type TaskRecurrenceKind = 'daily' | 'weekdays' | 'weekly' | 'monthly';

export interface TaskRecurrence {
  kind: TaskRecurrenceKind;
  weekdays?: number[];      // kind='weekly', 0=Sun..6=Sat
  day_of_month?: number;    // kind='monthly', 1..28
  starts_on?: string;       // YYYY-MM-DD, inclusive
  ends_on?: string | null;  // YYYY-MM-DD, inclusive; null/absent = forever
}

// Day-of-week (0=Sun..6=Sat) for a YYYY-MM-DD string, timezone-proof:
// the string is interpreted as a plain calendar date, not a UTC instant
// shifted into the local zone.
function dowOfDateStr(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map((n) => parseInt(n, 10));
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function taskRecurrenceOccursOn(
  rule: TaskRecurrence | null | undefined,
  dateStr: string,
): boolean {
  if (!rule) return false;
  if (rule.starts_on && dateStr < rule.starts_on) return false;
  if (rule.ends_on && dateStr > rule.ends_on) return false;
  if (rule.kind === 'daily') return true;
  const dow = dowOfDateStr(dateStr);
  if (rule.kind === 'weekdays') return dow >= 1 && dow <= 5;
  if (rule.kind === 'weekly') return Array.isArray(rule.weekdays) && rule.weekdays.includes(dow);
  if (rule.kind === 'monthly') {
    const dom = parseInt(dateStr.slice(8, 10), 10);
    return typeof rule.day_of_month === 'number' && rule.day_of_month === dom;
  }
  return false;
}

// First date >= fromStr the rule fires on, or null if it never does
// (rule ended, or weekly with no weekdays selected).
export function nextTaskRecurrenceDate(
  rule: TaskRecurrence | null | undefined,
  fromStr: string,
): string | null {
  if (!rule) return null;
  const [y, m, d] = fromStr.split('-').map((n) => parseInt(n, 10));
  const cursor = new Date(Date.UTC(y, m - 1, d));
  // 62 days covers the worst gap for any supported cadence (monthly).
  for (let i = 0; i < 62; i++) {
    const key = cursor.toISOString().slice(0, 10);
    if (rule.ends_on && key > rule.ends_on) return null;
    if (taskRecurrenceOccursOn(rule, key)) return key;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return null;
}

const RECURRENCE_DOW_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function describeTaskRecurrence(rule: TaskRecurrence | null | undefined): string {
  if (!rule) return 'Does not repeat';
  if (rule.kind === 'daily') return 'Every day';
  if (rule.kind === 'weekdays') return 'Every weekday';
  if (rule.kind === 'weekly') {
    if (!rule.weekdays || rule.weekdays.length === 0) return 'Weekly';
    const sorted = [...rule.weekdays].sort();
    return `Weekly on ${sorted.map((d) => RECURRENCE_DOW_NAMES[d]).join(', ')}`;
  }
  if (rule.kind === 'monthly') {
    if (typeof rule.day_of_month !== 'number') return 'Monthly';
    const n = rule.day_of_month;
    const suffix = n % 10 === 1 && n !== 11 ? 'st'
      : n % 10 === 2 && n !== 12 ? 'nd'
      : n % 10 === 3 && n !== 13 ? 'rd'
      : 'th';
    return `Monthly on the ${n}${suffix}`;
  }
  return 'Repeats';
}
