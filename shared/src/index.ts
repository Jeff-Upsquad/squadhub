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
  created_by: string;
  created_at: string;
  updated_at: string;
  position: number;
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
  position: number;
  created_by: string;
  created_at: string;
  updated_at: string;
  // Joined
  lists?: List[];
}

export interface List {
  id: string;
  space_id: string;
  folder_id: string | null;
  name: string;
  position: number;
  default_view: ListView;
  created_by: string;
  created_at: string;
  updated_at: string;
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
  workspace_id: string;
  name: string;
  permissions: RolePermissions;
}

export interface RolePermissions {
  can_manage_channels: boolean;
  can_delete_messages: boolean;
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
