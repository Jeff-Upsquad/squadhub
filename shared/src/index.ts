// ============================================================
// SquadHub Shared Types
// Used by both the server and web frontend
// ============================================================

// ---- Users ----
export type UserType = 'internal' | 'client' | 'client_staff' | 'partner';

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
export type TaskPriority = 'emergency' | 'urgent' | 'high' | 'normal' | 'low' | 'none';
export type StatusCategory = 'todo' | 'active' | 'done' | 'closed';
export type ListView = 'list' | 'board';
export type ResourceStatus = 'active' | 'inactive';

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
  attachments?: { name: string; size: string }[];
  custom?: Record<string, unknown>;
  [key: string]: unknown;
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
  task_type_id: string | null;
  time_estimate: number | null;
  time_tracked: number;
  metadata: TaskMetadata;
  display_number: number | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  // Joined
  status?: SpaceStatus;
  task_type?: TaskType;
  assignees?: User[];
  tags?: TaskTag[];
  subtasks?: Task[];
  comment_count?: number;
  creator?: User;
  list?: { id: string; name: string } | null;
  space?: { id: string; name: string } | null;
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
export type RoleHomeView = 'member' | 'user' | 'guest';

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
export type SubscriptionTier = 'Junior' | 'Pro' | 'Elite';
export type SubscriptionSlug = 'designer' | 'video_editor';
export type DeliverableKind = 'hours' | 'item';
export type CurrencyCode = 'INR' | 'USD';
export type ClientStatus = 'active' | 'paused' | 'cancelled';
export type SubmissionStatus = 'pending' | 'approved' | 'rejected';
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
  created_at: string;
  updated_at: string;
  // Joined
  pricing?: SubscriptionPlanPricing[];
  deliverables?: SubscriptionPlanDeliverable[];
}

export interface SubscriptionPlanPricing {
  id: string;
  plan_id: string;
  country_id: string;
  price: number;
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
  business_address: string;
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
  created_at: string;
  updated_at: string;
  // Joined
  subscription?: Subscription;
  plan?: SubscriptionPlanRow;
  deliverables?: ClientSubscriptionDeliverable[];
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
  position: number;
  created_at: string;
  updated_at: string;
  blocks?: LmsContentBlock[];
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

export interface ChatPushToken {
  id: string;
  user_id: string;
  token: string;
  app_variant: ChatAppVariant;
  platform: 'ios' | 'android';
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
