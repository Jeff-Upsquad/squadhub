// ============================================================
// SquadHub Shared Types
// Used by both the server and web frontend
// ============================================================

// ---- Users ----
export interface User {
  id: string;
  email: string;
  display_name: string;
  avatar_url: string | null;
  role: string;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
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
  created_at: string;
  updated_at: string;
  is_deleted: boolean;
  // Joined fields (populated by API)
  sender?: User;
  reactions?: Reaction[];
  reply_count?: number;
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
export type TaskPriority = 'urgent' | 'high' | 'normal' | 'low' | 'none';
export type StatusCategory = 'todo' | 'active' | 'done' | 'closed';
export type ListView = 'list' | 'board';

export interface Space {
  id: string;
  workspace_id: string;
  name: string;
  color: string;
  icon: string;
  description: string | null;
  is_private: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
  position: number;
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
  position: number;
  created_by: string;
  created_at: string;
  updated_at: string;
  my_access_level?: AccessLevel;
  // Joined
  lists?: List[];
}

export interface List {
  id: string;
  space_id: string;
  folder_id: string | null;
  name: string;
  is_private: boolean;
  position: number;
  default_view: ListView;
  created_by: string;
  created_at: string;
  updated_at: string;
  my_access_level?: AccessLevel;
  // Joined
  task_count?: number;
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
  created_by: string;
  created_at: string;
  updated_at: string;
  // Joined
  status?: SpaceStatus;
  assignees?: User[];
  tags?: TaskTag[];
  subtasks?: Task[];
  comment_count?: number;
  creator?: User;
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
export interface Role {
  id: string;
  name: string;
  color: string;
  permissions: RolePermissions;
  is_default: boolean;
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
  [key: string]: boolean;
}

// ---- Notifications ----
export type NotificationType =
  | 'message_mention'
  | 'dm_received'
  | 'task_assigned'
  | 'task_updated'
  | 'reaction_added';

export interface Notification {
  id: string;
  user_id: string;
  type: NotificationType;
  reference_id: string;
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
}

// ---- Socket.io Events ----
export interface ServerToClientEvents {
  new_message: (message: Message) => void;
  message_updated: (message: Message) => void;
  message_deleted: (data: { message_id: string; channel_id?: string; dm_conversation_id?: string }) => void;
  new_reaction: (reaction: Reaction & { message_id: string }) => void;
  user_typing: (data: { user_id: string; channel_id?: string; dm_conversation_id?: string }) => void;
  user_stop_typing: (data: { user_id: string; channel_id?: string; dm_conversation_id?: string }) => void;
  user_online: (data: { user_id: string }) => void;
  user_offline: (data: { user_id: string }) => void;
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

// ---- Invitations ----
export type InvitationStatus = 'pending' | 'accepted' | 'expired';

export interface Invitation {
  id: string;
  email: string;
  role_id: string | null;
  invited_by: string;
  status: InvitationStatus;
  invited_at: string;
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
  // Joined
  role?: Role;
  invited_by_user?: Pick<User, 'id' | 'display_name'>;
}

// ---- Clients Mini-App ----
export type SubscriptionSquad = 'Content Squad' | 'Accounts & Finance Squad' | 'Marketing Squad' | 'Tech Squad' | 'Legal Squad' | 'Hiring & HR Squad';
export type SubscriptionLevel = 'Junior' | 'Pro' | 'Elite';
export type SubscriptionPlan = 'Starter' | 'Basic' | 'Plus' | 'Pro' | 'Personal';
export type ClientStatus = 'active' | 'paused' | 'cancelled';
export type SubmissionStatus = 'pending' | 'approved' | 'rejected';
export type ClientSubscriptionStatus = 'active' | 'paused' | 'cancelled';

export interface Subscription {
  id: string;
  name: string;
  squad: SubscriptionSquad;
  level: SubscriptionLevel;
  plan: SubscriptionPlan;
  price: number;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
}

export interface ClientSubmission {
  id: string;
  business_name: string;
  contact_person: string;
  designation: string | null;
  contact_number: string;
  email: string;
  business_address: string;
  gst_registered: boolean;
  gst_number: string | null;
  accounts_email: string | null;
  status: SubmissionStatus;
  created_at: string;
}

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
  status: ClientStatus;
  created_at: string;
  updated_at: string;
  // Joined
  subscriptions?: ClientSubscription[];
}

export interface ClientSubscription {
  id: string;
  client_id: string;
  subscription_id: string;
  status: ClientSubscriptionStatus;
  created_at: string;
  updated_at: string;
  // Joined
  subscription?: Subscription;
}
