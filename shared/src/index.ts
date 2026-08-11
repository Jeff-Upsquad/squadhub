// ============================================================
// SquadHub Shared Types
// Used by both the server and web frontend
// ============================================================

export {
  KNOWN_CALLING_CODES,
  normalizeNationalNumber,
  formatStoredPhone,
  splitStoredPhone,
  normalizeStoredPhone,
  isValidNationalNumber,
  isValidStoredPhone,
} from './phone';

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
  // When set, this channel is linked to a PM container (space/folder/list) or a
  // CRM entity (deal/contact/lead). Container headers open PM links in a side
  // panel; CRM links appear under "CRM Chats" in the home sidebar.
  linked_resource_type?:
    | 'space'
    | 'folder'
    | 'list'
    | 'crm_deal'
    | 'crm_contact'
    | 'crm_lead'
    | null;
  linked_resource_id?: string | null;
  /** Human label for CRM-linked channels (deal/contact name). */
  linked_label?: string | null;
  /** Secondary line for CRM-linked channels (stage, date, etc.). */
  linked_subtitle?: string | null;
}

/** CRM entity kinds that can host a SquadHub team-chat channel. */
export type CrmChatEntityType = 'crm_deal' | 'crm_contact' | 'crm_lead';

export interface CrmChatListItem {
  channel_id: string;
  channel_name: string;
  entity_type: CrmChatEntityType;
  entity_id: string;
  label: string;
  subtitle: string | null;
  closed: boolean;
  unread_count: number;
  last_message_at: string | null;
  last_message_preview: string | null;
}

/** One entry in a contact's CRM-chat group (the side-panel switcher). */
export interface CrmChatGroupItem {
  channel_id: string;
  channel_name: string;
  entity_type: CrmChatEntityType;
  entity_id: string;
  label: string;
  subtitle: string | null;
  last_message_at: string | null;
  active: boolean;
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
  // When set, this message is an interactive meeting poll card — MessageBubble
  // renders <MeetingPollCard> instead of text content (see migration 139).
  meeting_event_id?: string | null;
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
export type ListView = 'list' | 'board' | 'whiteboard';
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
  /** When true, this space's tasks collapse into one "Grouped tasks under {name}" row on Home. */
  group_tasks?: boolean;
  /** Members auto-added to any task created under this space (nearest-wins down the tree). */
  auto_assignee_ids?: string[];
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
  /** When true, this folder's tasks collapse into one "Grouped tasks under {name}" row on Home. */
  group_tasks?: boolean;
  /** Members auto-added to any task created under this folder (nearest-wins down the tree). */
  auto_assignee_ids?: string[];
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
  /** When true, this list's tasks collapse into one "Grouped tasks under {name}" row on Home. */
  group_tasks?: boolean;
  /** Members auto-added to any task created under this list. */
  auto_assignee_ids?: string[];
  // Joined
  task_count?: number;
  profile?: CustomProfile;
}

// ---- Named list views (multiple views per list) ----
// A list can hold multiple named views. `view_type` reuses the ListView union.
// For 'list' / 'board' views, `config` holds the saved filter + group-by + sort.
// For 'whiteboard' views, `config` is unused — the canvas lives in the
// `whiteboards` table keyed by the view id. Views are shared on the list;
// `is_private` scopes a view to its `owner_id`.
// groupBy/sortBy are kept as loose strings here so shared stays decoupled from
// the web layer's grouping unions (web casts to its own ListGroupBy / SortBy).
export interface ListViewFilters {
  statusCategories?: string[];
  priorities?: TaskPriority[];
  assigneeIds?: string[];
  tagIds?: string[];
  dueDate?: string[];
}

export interface ListViewConfig {
  filters?: ListViewFilters;
  groupBy?: string;
  sortBy?: string;
}

export interface ListViewRow {
  id: string;
  list_id: string;
  view_type: ListView;
  name: string;
  position: number;
  is_default: boolean;
  is_private: boolean;
  owner_id: string | null;
  config: ListViewConfig;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// ---- Whiteboard (FigJam-style list view) ----
// A list's whiteboard is persisted as a single app-owned JSONB blob
// (list_whiteboards.data). The shape is owned by the whiteboard view; the
// server stores it opaquely and does not validate the contents.
// 'task' is a dedicated card that REFERENCES an existing task (added via the
// element edit bar's "Mention a task"); the others are free-form elements.
export type WhiteboardNodeType = 'sticky' | 'text' | 'shape' | 'task';
export type WhiteboardShape =
  | 'rect' | 'roundRect' | 'ellipse' | 'diamond'
  | 'triangle' | 'triangleDown' | 'parallelogram'
  | 'pentagon' | 'hexagon' | 'chevron' | 'cylinder';

export interface WhiteboardNodeData {
  text: string;
  color?: string;
  shape?: WhiteboardShape;
  // Text formatting set from the element's floating edit bar.
  bold?: boolean;
  // Text colour set from the edit bar; unset falls back to the theme default.
  textColor?: string;
  fontSize?: 'sm' | 'md' | 'lg';
  align?: 'left' | 'center' | 'right';
  // Set once the element is converted to a task from its edit bar. taskId links
  // the element to a real task; taskNumber mirrors tasks.display_number for the
  // "#N" badge; done mirrors the task's completion (toggled by the element's
  // checkbox). All cleared on "Unlink" (the task itself is NOT deleted).
  taskId?: string | null;
  taskNumber?: number | null;
  done?: boolean;
  // True when the element MENTIONS (references) a pre-existing task rather than
  // having been converted into a freshly-created one. Mentions render as a
  // dedicated 'task' card whose text is a read-only reference: editing it does
  // NOT rename the linked task (which may live in another list).
  taskMention?: boolean;
  // Source-location breadcrumb (e.g. "Space · Folder · List") shown on a mention
  // card when the referenced task lives in a different list.
  taskList?: string | null;
  [key: string]: unknown;
}

export interface WhiteboardNode {
  id: string;
  type: WhiteboardNodeType;
  position: { x: number; y: number };
  width?: number | null;
  height?: number | null;
  zIndex?: number | null;
  data: WhiteboardNodeData;
}

export type WhiteboardLineType = 'straight' | 'bezier' | 'smoothstep';

export interface WhiteboardEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  label?: string;
  type?: string;
  // Line appearance set from the edge toolbar. arrowStart/arrowEnd toggle the
  // arrowheads; lineType picks straight / curved / elbow routing; waypoint (flow
  // coords) is a dragged midpoint that bends the line through that point.
  data?: { lineType?: WhiteboardLineType; arrowStart?: boolean; arrowEnd?: boolean; waypoint?: { x: number; y: number } | null };
}

export interface WhiteboardData {
  nodes: WhiteboardNode[];
  edges: WhiteboardEdge[];
  viewport?: { x: number; y: number; zoom: number };
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
  // Mirror link: a task materialised from a "disappearing card" source. NULL on
  // ordinary tasks. source_kind is 'course' | 'meeting'; source_id is the
  // lms_assignment / meeting id; source_user_id is the owning user (a meeting
  // fans out to one mirror task per participant). See taskMirror service.
  source_kind?: string | null;
  source_id?: string | null;
  source_user_id?: string | null;
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
  // Resolved by hydrateLists: the nearest ancestor container (list → folder →
  // space) with group_tasks ON, used to collapse this task into a single
  // "Grouped tasks under {name}" row on Home. Null when no ancestor is grouped.
  group_container?: { type: 'list' | 'folder' | 'space'; id: string; name: string } | null;
  // Every grouped container this task belongs to — its PRIMARY list chain plus
  // any secondary "ALSO IN" list (task_list_links) whose chain has group_tasks ON.
  // Set by GET /pm/tasks/my so Home can collapse a multi-homed task into each of
  // its groups. Falls back to [group_container] for endpoints that don't compute it.
  group_containers?: { type: 'list' | 'folder' | 'space'; id: string; name: string }[];
  parent_task?: { id: string; title: string } | null;
  // Hydrated on GET /pm/tasks/:id for spawned routine copies.
  routine_template?: { id: string; title: string; recurrence: TaskRecurrence | null } | null;
  // Multi-homing: when this task is rendered inside a list it was ADDED to
  // (via task_list_links) rather than its primary list, this flags the row so
  // the UI can mark it as linked. Set by GET /pm/tasks?list_id= for that view.
  linked_in_list?: boolean;
}

// A resolved space → folder → list path for one of the lists a task belongs to.
// Returned by GET /pm/tasks/:id/lists — the first entry is the task's primary
// list (tasks.list_id), the rest are secondary lists from task_list_links.
export interface TaskListPath {
  list_id: string;
  list_name: string;
  folder_id: string | null;
  folder_name: string | null;
  space_id: string | null;
  space_name: string | null;
  space_color: string | null;
  // True for the task's primary list (cannot be removed), false for added lists.
  is_primary: boolean;
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
  kind?: 'work_block_occurrence' | 'date_occurrence' | 'group_block';
  // Date-derived rows only: true when the source date carries no time-of-day
  // (midnight local) — the calendar renders these in its all-day strip.
  all_day?: boolean;
  date_field?: 'work' | 'due' | 'start';
  // Group blocks (kind='group_block') schedule a whole multi-home group as ONE
  // combined block sized to the sum of its tasks' estimates. Stored in the
  // separate group_day_plans table (keyed by container, not task), so `task` is
  // null and `container` + `member_count` carry what the block needs to render.
  container?: { type: 'list' | 'folder' | 'space'; id: string; name: string };
  member_count?: number;
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

// A sub-item of a work-block time entry: a task worked on and/or completed
// during the run, shown nested under the block in the Time Sheet.
export interface WorkBlockChildEntry {
  task_id: string;
  title: string;
  seconds: number;
  completed: boolean;
}

export interface TaskTimeEntry {
  id: string;
  task_id: string;
  user_id: string;
  workspace_id: string;
  started_at: string;
  stopped_at: string;
  duration_seconds: number;
  source: 'timer' | 'manual' | 'work_block';
  // Set for source='work_block' — links the entry back to its work_block_run.
  work_block_run_id?: string | null;
  created_at: string;
  // Joined — task + its list/folder/space + parent (for UI breadcrumbs)
  task?: Pick<Task, 'id' | 'title' | 'list_id' | 'time_tracked'> & {
    list?: { id: string; name: string } | null;
    folder?: { id: string; name: string } | null;
    space?: { id: string; name: string } | null;
    parent_task?: { id: string; title: string } | null;
  };
  // For source='work_block': tasks worked on / completed during the run.
  children?: WorkBlockChildEntry[];
}

// A "Label" in product terms. Physical table is `task_tags` (see migration 135).
export interface TaskTag {
  id: string;
  workspace_id: string;
  group_id: string;
  name: string;
  color: string;
  // Joined on some endpoints (e.g. admin label list / picker).
  group?: Pick<LabelGroup, 'id' | 'name' | 'is_default'> | null;
}

// ---- Labels (groups, gating, requests) ----
// A named bucket of labels. The per-workspace default group is "General"
// (`is_default = true`) and is visible to everyone; every other group is
// visible only to admins and the roles/users assigned to it.
export interface LabelGroup {
  id: string;
  workspace_id: string;
  name: string;
  is_default: boolean;
  position: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface LabelGroupRoleAccess {
  id: string;
  group_id: string;
  role_id: string;
  created_at: string;
  role?: Pick<Role, 'id' | 'name' | 'color'> | null;
}

export interface LabelGroupUserAccess {
  id: string;
  group_id: string;
  user_id: string;
  created_at: string;
  user?: Pick<User, 'id' | 'display_name' | 'email'> | null;
}

// Admin view of a group with its visibility-gating access rows and its labels.
export interface LabelGroupWithAccess extends LabelGroup {
  role_access: LabelGroupRoleAccess[];
  user_access: LabelGroupUserAccess[];
  labels: TaskTag[];
}

// Who (besides admins) may create labels — workspace-scoped grants.
export interface LabelCreateAccess {
  roles: Array<{ id: string; role_id: string; role?: Pick<Role, 'id' | 'name' | 'color'> | null }>;
  users: Array<{ id: string; user_id: string; user?: Pick<User, 'id' | 'display_name' | 'email'> | null }>;
}

export type LabelRequestStatus = 'pending' | 'approved' | 'rejected';

export interface LabelRequest {
  id: string;
  workspace_id: string;
  requested_by: string | null;
  name: string;
  suggested_group_id: string | null;
  note: string | null;
  status: LabelRequestStatus;
  resolved_by: string | null;
  resolved_label_id: string | null;
  created_at: string;
  updated_at: string;
  // Joined for the admin inbox.
  requester?: Pick<User, 'id' | 'display_name' | 'email'> | null;
  suggested_group?: Pick<LabelGroup, 'id' | 'name'> | null;
}

// Shape returned by GET /pm/labels — the Task Details picker payload.
export interface LabelPickerGroup {
  group: Pick<LabelGroup, 'id' | 'name' | 'is_default'>;
  labels: TaskTag[];
}

export interface LabelPickerData {
  groups: LabelPickerGroup[];
  can_create: boolean;
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

export interface Role {
  id: string;
  name: string;
  color: string;
  permissions: RolePermissions;
  is_default: boolean;
  is_system?: boolean;
  system_key?: SystemRoleKey | null;
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
  // Elapsed time — edit/remove a design/video space's idle-day elapsed hours
  // (the "Squad manager" role gets this). Resolved against the PRIMARY role.
  can_edit_elapsed_time: boolean;
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
  | 'reaction_added'
  | 'meeting_invited'
  | 'meeting_suggestion'
  | 'meeting_suggestion_resolved'
  | 'meeting_confirmed'
  | 'meeting_cancelled'
  | 'lms_assigned'
  | 'lms_updated'
  | 'lms_shared'
  | 'lms_review_requested'
  | 'lms_review_decided'
  | 'lms_comment';

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

// Per-user pinned mini-apps (global, not workspace-scoped). Apps are keyed by
// slug rather than a UUID, so they live in their own `app_favorites` table.
export interface AppFavorite {
  id: string;
  user_id: string;
  app_slug: string;
  created_at: string;
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

// ---- Shared Tree (partner-tier AREAS roots) ----
// Enriched, navigable version of the shared-with-me items: folders/lists shared
// with a partner (whose parent area isn't shared) returned as ready-to-render
// roots. Client folders carry the design/video spaces individually granted.
export interface SharedTree {
  clientFolders: (Folder & { childSpaces: Folder[] })[];
  folders: Folder[];
  lists: List[];
}

// ---- Meeting / Event scheduler (migration 139) ----
export type MeetingKind = 'virtual' | 'in_person' | 'event';
export type MeetingEventStatus = 'open' | 'confirmed' | 'cancelled';
export type MeetingLinkProviderId = 'jitsi' | 'google_meet' | 'zoom';
export type MeetingVoteValue = 'yes' | 'no' | 'maybe';
export type MeetingSuggestionStatus = 'pending' | 'accepted' | 'rejected';
export type MeetingSuggestionResponse = 'confirm' | 'reject';

export interface MeetingEvent {
  id: string;
  title: string;
  kind: MeetingKind;
  agenda: string | null;
  duration_min: number | null; // null => a "dates only" meeting
  timezone: string;
  status: MeetingEventStatus;
  link_provider: MeetingLinkProviderId | null;
  link_url: string | null;
  link_meta: Record<string, unknown>;
  origin_channel_id: string | null;
  origin_dm_conversation_id: string | null;
  confirmed_slot_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface MeetingSlot {
  id: string;
  meeting_event_id: string;
  slot_date: string;          // YYYY-MM-DD (meeting-local)
  start_min: number | null;   // minute-of-day 0..1439; null => dates-only
  end_min: number | null;
  is_suggestion: boolean;
  suggested_by: string | null;
  suggestion_status: MeetingSuggestionStatus | null;
  sort_order: number;
  created_at: string;
}

export interface MeetingGuest {
  meeting_event_id: string;
  user_id: string;
  role: 'host' | 'guest';
  responded: boolean;
  invited_at: string;
  user?: User; // joined by API
}

export interface MeetingEventAttachment {
  id: string;
  meeting_event_id: string;
  file_url: string;
  file_name: string | null;
  file_size: number | null;
  file_mime: string | null;
  uploaded_by: string | null;
  uploaded_at: string;
}

// Lightweight reference used for vote-count hover tooltips & guest rows.
export interface MeetingVoterRef {
  user_id: string;
  display_name: string | null;
  avatar_url?: string | null;
}

// Per-slot aggregate the card/detail UI renders directly.
export interface MeetingSlotSummary {
  slot: MeetingSlot;
  counts: { yes: number; no: number; maybe: number };
  voters: { yes: MeetingVoterRef[]; no: MeetingVoterRef[]; maybe: MeetingVoterRef[] };
  my_vote: MeetingVoteValue | null;
  // Present only for is_suggestion slots.
  suggestion?: {
    status: MeetingSuggestionStatus;
    suggested_by: MeetingVoterRef | null;
    confirms: MeetingVoterRef[];
    rejects: MeetingVoterRef[];
    my_response: MeetingSuggestionResponse | null;
  };
}

// Full payload from GET /meeting-events/:id and the meeting_event_updated socket push.
export interface MeetingEventDetail {
  event: MeetingEvent;
  slots: MeetingSlotSummary[];
  guests: MeetingGuest[];
  attachments: MeetingEventAttachment[];
}

export interface MeetingLinkProviderInfo {
  id: MeetingLinkProviderId;
  label: string;
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
  // Content-free nudge: an admin triggered/edited a Feature Tip — clients
  // re-fetch GET /feature-tips/pending. No payload (no per-user fan-out).
  feature_tips_changed: () => void;
  // Live meeting state (votes/suggestions/status) pushed to everyone in the
  // meeting:{id} room — keeps the mini-app detail and every in-chat card synced.
  meeting_event_updated: (detail: MeetingEventDetail) => void;
}

export interface ClientToServerEvents {
  join_workspace: (workspace_id: string) => void;
  join_channel: (channel_id: string) => void;
  leave_channel: (channel_id: string) => void;
  send_message: (data: { channel_id?: string; dm_conversation_id?: string; content: string; type: MessageType; file_url?: string }) => void;
  typing: (data: { channel_id?: string; dm_conversation_id?: string }) => void;
  stop_typing: (data: { channel_id?: string; dm_conversation_id?: string }) => void;
  // A meeting detail view or in-chat poll card subscribes/unsubscribes to live updates.
  join_meeting: (meeting_event_id: string) => void;
  leave_meeting: (meeting_event_id: string) => void;
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

// ---- Daily Timesheet ----
export type TimesheetTargetKind = 'hours' | 'item';
// on_time = submitted on the sheet's own date; late = backfilled on a later day;
// no_submission = end-of-day placeholder for a missed working day.
export type TimesheetStatus = 'on_time' | 'late' | 'no_submission';

// Admin-set, per-user/per-client target. `label` names an item target
// (e.g. "Designs"); for hours targets it is cosmetic.
export interface TimesheetTarget {
  id: string;
  user_id: string;
  client_id: string;
  kind: TimesheetTargetKind;
  label: string;
  per_day: number;
  per_week: number;
  per_month: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  // Joined
  client?: { id: string; business_name: string } | null;
}

// One progress line on a timesheet — a client+kind target with the
// auto-computed (and possibly user-adjusted) achievement for day/week/month.
export interface TimesheetProgressLine {
  client_id: string;
  client_name: string;
  kind: TimesheetTargetKind;
  label: string;
  target_day: number;
  target_week: number;
  target_month: number;
  achieved_day: number;
  achieved_week: number;
  achieved_month: number;
  // The system-computed day value before any manual adjustment (audit trail).
  auto_day: number;
}

// A completed task surfaced in the "review" list, grouped by client.
export interface TimesheetCompletedTask {
  id: string;
  title: string;
  client_id: string | null;
  client_name: string | null;
  time_tracked_seconds: number;
}

export interface Timesheet {
  id: string;
  user_id: string;
  date: string;
  submitted_at: string | null;
  status: TimesheetStatus;
  summary: string;
  tracked_work_seconds: number;
  office_hours_total_seconds: number;
  completed_task_ids: string[];
  progress: TimesheetProgressLine[];
  created_at: string;
  // Joined
  user?: User;
}

// Payload returned by GET /timesheet/today — the live state used to render the
// tab before submission (or the stored snapshot, if already submitted).
export interface TimesheetTodayResponse {
  date: string;
  is_holiday: boolean;
  is_backfill: boolean;          // date is a past working day with no submission
  already_submitted: boolean;
  timesheet: Timesheet | null;   // existing row if submitted (or placeholder)
  progress: TimesheetProgressLine[];
  completed_tasks: TimesheetCompletedTask[];
  tracked_work_seconds: number;
  office_timing: OfficeTimingSummary | null;
}

export interface TimesheetDashboardDay {
  date: string;
  status: TimesheetStatus | 'holiday';
  submitted_at?: string | null;
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
export type SubscriptionTier = 'Junior' | 'Pro' | 'Top Talents';
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
  /**
   * Minimum customer (business) price for this plan in this country.
   * During bidding, the business cannot offer/bid below this amount; the
   * talent floor is this amount after the plan margin is applied.
   */
  price: number;
  /** Margin admin keeps from the customer's proposed price; partner price = proposed - margin. */
  margin_value: number;
  margin_type: 'fixed' | 'percent';
  created_at: string;
  updated_at: string;
  // Joined
  country?: Country;
}

/** Per-tier pricing stored in subscription_cards.tier_pricing JSONB for
 *  multi-tier draft cards: `{ [tier]: { proposed_price, markup, ... } }`.
 *  Client-stated budgets may live per tier as `client_budget` (when the
 *  brief named different amounts per level) and/or as the scalar
 *  subscription_cards.client_budget when a single amount applies. */
export interface SubscriptionCardTierPricing {
  proposed_price?: number | null;
  /** Adjusted margin override; null/undefined = use the plan catalog margin. */
  markup?: number | null;
  /** Finalized monthly price for this tier; falls back to proposed_price. */
  subscription_price?: number | null;
  /** Client's stated budget for this experience level from their brief. */
  client_budget?: number | null;
}

// ---- Pricing resolution helpers (single source of truth) ----
// Model:
//   Plan price         — catalog MINIMUM business bid (SubscriptionPlanPricing.price)
//   Proposed price     — what the client asked for in the brief
//   Subscription price — the FINALIZED monthly price the client pays
//   Plan margin        — catalog default (margin_value + margin_type)
//   Adjusted margin    — per-card FIXED override (markup); null = use plan margin
//   Final margin       — adjusted if set, else plan margin (recomputed on each bid base)
//   Partner price      — partner_price_override, else finalized - final margin
//
// Bidding: margin rules stay the same for every counter.
//   fixed  — absolute cut is constant
//   percent — percent is re-applied to the new business amount; the rupee
//             cut is rounded UP to the nearest hundred (ceil-to-100).

type CardPriceFields = {
  subscription_price?: number | null;
  proposed_price?: number | null;
  markup?: number | null;
  partner_price_override?: number | null;
};
export type PlanMarginFields = {
  margin_value?: number | null;
  margin_type?: 'fixed' | 'percent' | null;
  /** Catalog minimum business price (subscription_plan_pricing.price). */
  price?: number | null;
};

/** Round a positive amount UP to the nearest hundred (₹/currency units).
 *  0 stays 0; negatives clamp to 0. Used for percent-margin rupee cuts. */
export function ceilToHundred(amount: number): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return Math.ceil(amount / 100) * 100;
}

/** Absolute margin amount for a catalog margin row against a business price.
 *  Percent margins: (base × pct / 100), then ceil up to the nearest hundred. */
export function resolvePlanMargin(
  pricing: PlanMarginFields | null | undefined,
  basePrice: number | null,
): number | null {
  if (!pricing || pricing.margin_value == null) return null;
  if (pricing.margin_type === 'percent') {
    if (basePrice == null) return null;
    return ceilToHundred((basePrice * pricing.margin_value) / 100);
  }
  return pricing.margin_value;
}

/** Finalized monthly client price: the finalized subscription price if set,
 *  else the proposed price. null when neither is a positive amount. */
export function resolveFinalizedPrice(card: CardPriceFields): number | null {
  if (card.subscription_price != null && card.subscription_price > 0) return card.subscription_price;
  if (card.proposed_price != null && card.proposed_price > 0) return card.proposed_price;
  return null;
}

/**
 * Final margin against a business (customer) base price.
 * - Card `markup` is always a FIXED absolute override (does not re-percent).
 * - Otherwise the plan margin is applied (percent re-calcs + ceil-to-100).
 */
export function resolveFinalMargin(
  card: CardPriceFields,
  pricing: PlanMarginFields | null | undefined,
  basePrice: number | null,
): number | null {
  if (card.markup != null) return card.markup;
  return resolvePlanMargin(pricing, basePrice);
}

/** Partner (talent) price from a business amount using the card/plan margin. */
export function partnerPriceFromCustomer(
  customerPrice: number,
  card: CardPriceFields,
  pricing?: PlanMarginFields | null,
): number {
  const margin = resolveFinalMargin(card, pricing, customerPrice) ?? 0;
  return Math.max(0, customerPrice - margin);
}

/**
 * Reverse: business (customer) amount implied by a talent bid, keeping the
 * same margin rule. Fixed markup/plan margin adds back; percent solves for
 * the smallest business amount whose partner side equals the talent bid.
 */
export function customerPriceFromPartner(
  partnerPrice: number,
  card: CardPriceFields,
  pricing?: PlanMarginFields | null,
): number {
  if (partnerPrice < 0 || !Number.isFinite(partnerPrice)) return 0;
  // Absolute fixed margin (card override or plan fixed).
  if (card.markup != null) return partnerPrice + card.markup;
  if (!pricing || pricing.margin_value == null || pricing.margin_value === 0) {
    return partnerPrice;
  }
  if (pricing.margin_type !== 'percent') {
    return partnerPrice + pricing.margin_value;
  }
  // Percent with ceil-to-100: search upward from the naive inverse.
  const pct = pricing.margin_value;
  if (pct >= 100) return partnerPrice; // degenerate — margin would eat everything
  let guess = Math.ceil(partnerPrice / (1 - pct / 100));
  // Walk up until partnerPriceFromCustomer(guess) >= partnerPrice, then
  // tighten so the derived partner lands on the talent figure when possible.
  for (let i = 0; i < 500; i++) {
    const derived = partnerPriceFromCustomer(guess, card, pricing);
    if (derived === partnerPrice) return guess;
    if (derived < partnerPrice) {
      guess += 1;
      continue;
    }
    // derived > partnerPrice: step back while still meeting the talent ask.
    while (guess > partnerPrice) {
      const prev = guess - 1;
      if (partnerPriceFromCustomer(prev, card, pricing) < partnerPrice) break;
      guess = prev;
    }
    return guess;
  }
  return guess;
}

/** Partner price: the override if set, else finalized price minus final
 *  margin. null when there's no finalized price to compute from. */
export function resolvePartnerPrice(
  card: CardPriceFields,
  pricing?: PlanMarginFields | null,
): number | null {
  if (card.partner_price_override != null) return card.partner_price_override;
  const finalized = resolveFinalizedPrice(card);
  if (finalized == null) return null;
  return partnerPriceFromCustomer(finalized, card, pricing);
}

/**
 * Catalog minimum business bid for a plan/country pricing row.
 * null when no catalog price is set.
 */
export function resolveMinCustomerPrice(
  pricing: PlanMarginFields | null | undefined,
): number | null {
  if (!pricing || pricing.price == null || pricing.price <= 0) return null;
  return pricing.price;
}

/**
 * Catalog minimum talent bid = partner side of the min customer price
 * under the same margin rules (override markup / plan margin).
 */
export function resolveMinPartnerPrice(
  card: CardPriceFields,
  pricing: PlanMarginFields | null | undefined,
): number | null {
  const minCustomer = resolveMinCustomerPrice(pricing);
  if (minCustomer == null) return null;
  if (card.partner_price_override != null) return card.partner_price_override;
  return partnerPriceFromCustomer(minCustomer, card, pricing);
}

/** Validate a business-side bid against the catalog floor. */
export function isCustomerBidAtOrAboveMin(
  customerBid: number,
  pricing: PlanMarginFields | null | undefined,
): boolean {
  const min = resolveMinCustomerPrice(pricing);
  if (min == null) return customerBid > 0;
  return customerBid >= min;
}

/** Validate a talent-side bid against the catalog floor (after margin). */
export function isPartnerBidAtOrAboveMin(
  partnerBid: number,
  card: CardPriceFields,
  pricing: PlanMarginFields | null | undefined,
): boolean {
  const min = resolveMinPartnerPrice(card, pricing);
  if (min == null) return partnerBid > 0;
  return partnerBid >= min;
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
  /** Soft ref → Squad CRM crm_leads.id (persisted on first successful match). */
  crm_lead_id?: string | null;
  /** Soft ref → SquadHire business_users.id (persisted on first successful match). */
  squadhire_business_user_id?: string | null;
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
  /** Public R2 URL of the client's recorded requirement voice note (optional). */
  requirement_voice_url: string | null;
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
// stays (Junior|Pro|Top Talents) — do not conflate them.
// The 'Elite' -> 'Top Talents' rename is complete: data is backfilled and the
// CHECK constraints no longer accept 'Elite'. isTopTalentsTier() is kept as a
// helper so callers don't hardcode the top-bracket literal everywhere.
export type PartnerTier = 'Junior' | 'Pro' | 'Top Talents' | 'Custom';
export const PARTNER_TIERS: PartnerTier[] = ['Junior', 'Pro', 'Top Talents', 'Custom'];

export function isTopTalentsTier(t: string | null | undefined): boolean {
  return t === 'Top Talents';
}

export type SubscriptionCardState = 'draft' | 'published' | 'assigned' | 'closed';
/**
 * Product line a card belongs to. `subscription` (default) is the recurring
 * plan brief; `assignment` is a one-off freelance project (project budget +
 * scope + timeline instead of a weekly plan); `hiring` is reserved. The same
 * cards table + lifecycle serve all three — talent clients tag by this and the
 * business portal shows assignments in a separate section.
 */
export type SubscriptionCardType = 'subscription' | 'assignment' | 'hiring';
export const SUBSCRIPTION_CARD_TYPES: SubscriptionCardType[] = ['subscription', 'assignment', 'hiring'];

/**
 * Project-specific fields for card_type = 'assignment' (stored in the
 * subscription_cards.assignment_details JSONB). The budget reuses
 * proposed_price and the scope reuses notes / requirement_note, so this only
 * carries what has no dedicated column.
 */
export interface AssignmentDetails {
  /** Free-text timeline, e.g. "4 weeks", "2 months". */
  duration?: string | null;
  /** ISO date the engagement should start. */
  start_date?: string | null;
  /** ISO date the work is due by. */
  deadline?: string | null;
  /** Optional engagement shape, e.g. "one-off", "ongoing". */
  scope_type?: string | null;
  /**
   * How the assignment is priced when broadcast to talents.
   * `priced` (default) — the client budget (proposed_price) is shown to talents
   * as the offered price; they can accept, decline, or counter-offer.
   * `unpriced` — no price is shown; talents submit an offer, and the business
   * reviews/counters/accepts. Drives the offer/negotiation flow in SquadHire.
   */
  pricing_mode?: AssignmentPricingMode | null;
}
export type AssignmentPricingMode = 'priced' | 'unpriced';
export const ASSIGNMENT_PRICING_MODES: AssignmentPricingMode[] = ['priced', 'unpriced'];
/**
 * `broadcast` (default) — at publish time the server fans out to all matching
 * partners and SquadHire broadcasts to its talents. `manual` — no fan-out;
 * the card is visible in admin Subscription Cards lists but recipients must be
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
  /** Direct Hub contact link (Stage B). Null on legacy cards pre-migration 168. */
  lead_submission_id?: string | null;
  state: SubscriptionCardState;
  /** Product line: 'subscription' (default), 'assignment' (freelance) or 'hiring'. */
  card_type: SubscriptionCardType;
  /** Project fields for assignment cards. Null on subscription / hiring cards. */
  assignment_details?: AssignmentDetails | null;
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
  /** Customer's proposed monthly price from the brief (INR). null = none. */
  proposed_price: number | null;
  /** Finalized monthly price the client pays (INR). null = use proposed_price. */
  subscription_price: number | null;
  /**
   * Client's stated monthly budget from their brief (INR). Scalar when a single
   * amount applies (or all levels share one); per-level amounts also live on
   * tier_pricing.<tier>.client_budget.
   */
  client_budget?: number | null;
  /** Adjusted margin (INR/month). null = use the plan catalog margin. */
  markup: number | null;
  /** Per-tier pricing for multi-tier draft cards: { [tier]: {...} }. */
  tier_pricing?: Record<string, SubscriptionCardTierPricing>;
  published_at: string | null;
  published_by: string | null;
  closed_at: string | null;
  /** Set when an admin recalled a card with acceptances. Acceptees keep
   *  seeing the card with a "Recalled" tag; pending recipients are dropped. */
  recalled_at?: string | null;
  /** Soft-delete: set when the card is moved to the admin Trash. While set,
   *  the card is hidden from every card list and can be restored or purged
   *  from Trash. Null for live cards. */
  deleted_at?: string | null;
  /** Admin user id that moved the card to Trash. Null for live cards. */
  deleted_by?: string | null;
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

// ---------------------------------------------------------------------------
// Design Space public share links
//
// A persistent, unguessable tokenized link that lets a CLIENT view a design
// space (Dashboard / Reports / Completed) without logging in, and optionally
// submit a new request. Managed by a manager: enable / disable / delete.
// Backed by `design_space_share_links`. Mirrors the card-share pattern but is
// persistent (no expiry / single-use) and toggleable.
// ---------------------------------------------------------------------------

/** Derived design-space status lane (matches web's RequestStatus). */
export type DesignShareStatusLane = 'queued' | 'progress' | 'review' | 'done';

export interface DesignSpaceShareLink {
  token: string; // = design_space_share_links.id (the UUID token)
  url: string; // absolute public URL — /space/:token
  enabled: boolean;
}

/** A single task as exposed on the public design-space view (read-only). */
export interface DesignShareTask {
  id: string;
  title: string;
  status: DesignShareStatusLane; // derived lane
  time_tracked: number; // seconds
  priority: TaskPriority;
  due_date: string | null;
  category: string | null; // from metadata.category
  list_name: string | null;
  display_number: number | null;
  created_at: string;
  assignees: { display_name: string | null; avatar_url: string | null }[];
}

export interface DesignSharePlan {
  daily_hours: number | null;
  weekly_hours: number | null;
  monthly_hours: number | null;
}

export interface DesignShareDailyPoint {
  date: string; // YYYY-MM-DD (IST)
  total_work_seconds: number;
}

/**
 * One space (a design/video sub-folder) under the shared client folder, with
 * its own dashboard data. The public view shows a dropdown to switch spaces.
 */
export interface DesignShareSpace {
  id: string; // the space (child folder) id — also the POST /request target
  name: string;
  template_slug: string | null;
  is_video: boolean;
  tasks: DesignShareTask[];
  plan: DesignSharePlan;
  time_summary: DesignShareDailyPoint[];
  // Design/video brief field definitions, so the public "new request" form can
  // mirror the internal New Design Task form. Same shape the internal form uses.
  fields: TaskTypeField[];
}

/**
 * Payload returned by GET /design-share/:token. The link lives at the CLIENT
 * FOLDER level, so it exposes the client name plus every design/video space
 * under that folder.
 */
export interface DesignSharePayload {
  valid: boolean; // false → token unknown / deleted
  disabled?: boolean; // token exists but link is disabled
  client?: { name: string }; // = the client folder's name
  spaces?: DesignShareSpace[]; // ordered; empty if the client has no spaces yet
}

/** Body for POST /design-share/:token/request (client submits a brief). */
export interface DesignShareRequestInput {
  space_id: string; // which space (child folder) the request is for
  title: string;
  description: string;
  priority?: TaskPriority;
  due_date?: string | null;
  // Custom design-field values keyed by field.key (+ `${key}_other`), exactly
  // as the internal form writes to task.metadata.custom.
  custom?: Record<string, unknown>;
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
  /** Soft ref → Squad CRM crm_leads.id (persisted on first successful match). */
  crm_lead_id?: string | null;
  /** Soft ref → SquadHire business_users.id (persisted on first successful match). */
  squadhire_business_user_id?: string | null;
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
  card?: { id: string; state: string; published_at: string | null; card_code: string | null; linked_folder_id: string | null; linked_at: string | null; proposed_price: number | null; subscription_price: number | null; markup: number | null; partner_price_override: number | null; cancelled_at: string | null; paused_at: string | null; selected_recipient_id: string | null; needs_broadcast: boolean } | null;
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
// Orthogonal to `kind`: 'learning' is the default course/post catalog;
// 'sop' surfaces the item under the "Systems & Processes" section and hides
// the course-style progress chrome (see migration 118).
export type LmsTrack = 'learning' | 'sop';
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
  // 'learning' (default) or 'sop' — see LmsTrack / migration 118.
  track: LmsTrack;
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
  // Contributor "submit for review" flow (migration 165). When origin_item_id
  // is set this item is a draft CLONE proposing changes to that live item.
  origin_item_id?: string | null;
  review_state?: LmsReviewState;
  review_note?: string | null;
  submitted_by?: string | null;
  submitted_at?: string | null;
  // Optional emoji icon for the catalog card / reader header (migration 170).
  icon?: string | null;
  // Joined (populated by API as needed)
  category?: LmsCategory | null;
  lessons?: LmsLesson[];
  audience_types?: UserType[];
  audience_user_ids?: string[];
  assignment_count?: number;
  // The requesting user's effective access level (populated by the web/collab
  // API — see LmsAccessLevel / getItemAccess).
  my_access?: LmsAccessLevel;
}

export interface LmsLesson {
  id: string;
  item_id: string;
  title: string;
  summary: string | null;
  // Inactive lessons are hidden from learners but stay visible/editable in the
  // admin editor. Existing rows default to active (see migration 100).
  is_active: boolean;
  // Notion-style page tree (migration 170). parent_lesson_id NULL = top-level
  // page; `position` orders siblings within the same parent. `icon` = emoji.
  parent_lesson_id?: string | null;
  icon?: string | null;
  position: number;
  created_at: string;
  updated_at: string;
  blocks?: LmsContentBlock[];
  // Per-page access overrides (migration 171). A page inherits the item's
  // sharing; these rows HIDE it from specific roles/users. Populated by the
  // editor APIs. (is_active doubles as the page's draft flag — false = draft.)
  access_overrides?: LmsLessonAccessOverride[];
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

// ---- Image annotations (markings on screenshots) ----
// Non-destructive overlay drawn on top of an `image` block. Stored as JSON in
// LmsContentBlock.metadata.annotations (no schema change — `metadata` is a
// freeform JSONB column). All geometry is in PERCENT (0–100) of the image's
// natural width/height so markings scale responsively across desktop/mobile.
export type AnnotationColor = 'red' | 'amber' | 'green' | 'blue' | 'ink';

interface AnnotationBase {
  id: string;
  color: AnnotationColor;
}

// Highlight box around a region. x/y = top-left corner; w/h = size (all %).
export interface RectAnnotation extends AnnotationBase {
  type: 'rect';
  x: number;
  y: number;
  w: number;
  h: number;
}

// Arrow pointing at something. (x1,y1) = tail, (x2,y2) = head (arrowhead end).
export interface ArrowAnnotation extends AnnotationBase {
  type: 'arrow';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

// Free text callout anchored at (x,y) top-left. wPct caps width so it wraps.
export interface TextAnnotation extends AnnotationBase {
  type: 'text';
  x: number;
  y: number;
  text: string;
  wPct?: number;
}

// Numbered step badge — a small circle with a label, centered at (x,y).
export interface BadgeAnnotation extends AnnotationBase {
  type: 'badge';
  x: number;
  y: number;
  label: string;
}

export type Annotation = RectAnnotation | ArrowAnnotation | TextAnnotation | BadgeAnnotation;

// Lives at LmsContentBlock.metadata.annotations.
export interface ImageAnnotationData {
  version: 1;
  // Natural pixel dims captured at author time — used for the SVG viewBox
  // aspect ratio (keeps arrowheads/badges round) and to recompute % on edit.
  naturalWidth?: number;
  naturalHeight?: number;
  annotations: Annotation[];
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
  // Optional deadline (migration 111). Drives the Home "Courses" secondary
  // card, which surfaces non-completed assignments due today or overdue.
  due_date: string | null;
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
// Content sharing & access levels (migration 165)
//
// Each item can be shared with any user or role at one of four levels.
// Ranking: admin > contributor > commenter > viewer. A user's effective
// access is the highest grant across direct shares, role shares, ownership,
// global-admin, and (legacy) assignment.
// ============================================================
export type LmsAccessLevel = 'viewer' | 'commenter' | 'contributor' | 'admin';
export type LmsPrincipalType = 'user' | 'role';
export type LmsReviewState = 'none' | 'draft' | 'submitted' | 'changes_requested';

export interface LmsItemShare {
  id: string;
  item_id: string;
  principal_type: LmsPrincipalType;
  principal_id: string;
  access_level: LmsAccessLevel;
  granted_by: string | null;
  created_at: string;
  updated_at: string;
  // Joined for display (one of these, keyed by principal_type)
  user?: Pick<User, 'id' | 'display_name' | 'email' | 'avatar_url' | 'user_type'> | null;
  role?: Pick<Role, 'id' | 'name' | 'color'> | null;
}

// One grant in a replace-set PUT (admin/collab share management).
export interface LmsShareInput {
  principal_type: LmsPrincipalType;
  principal_id: string;
  access_level: LmsAccessLevel;
}

// Per-page (lesson) access override (migration 171). Presence = the principal
// is EXCLUDED (hidden) from that page, even though they can access the item.
export interface LmsLessonAccessOverride {
  principal_type: LmsPrincipalType;
  principal_id: string;
  mode: 'exclude';
  // Joined for display (one of these, keyed by principal_type)
  user?: Pick<User, 'id' | 'display_name' | 'email' | 'avatar_url'> | null;
  role?: Pick<Role, 'id' | 'name' | 'color'> | null;
}

// Staff-only comment on a page (lesson) of an item. Visible to commenter+.
export interface LmsItemComment {
  id: string;
  item_id: string;
  lesson_id: string | null;
  parent_id: string | null;
  author_id: string;
  body: string;
  resolved_at: string | null;
  resolved_by: string | null;
  created_at: string;
  updated_at: string;
  // Joined
  author?: Pick<User, 'id' | 'display_name' | 'avatar_url' | 'user_type'> | null;
}

// A pending contributor submission, as surfaced in the admin Review Queue.
export interface LmsReviewSubmission {
  id: string;            // the draft/clone item id
  origin_item_id: string | null;
  kind: LmsItemKind;
  track: LmsTrack;
  title: string;
  slug: string;
  review_state: LmsReviewState;
  review_note: string | null;
  submitted_at: string | null;
  submitted_by: string | null;
  submitter?: Pick<User, 'id' | 'display_name' | 'avatar_url' | 'email'> | null;
  // The live item this proposes to change (null for brand-new content).
  origin?: Pick<LmsItem, 'id' | 'title' | 'slug' | 'status'> | null;
}

// ============================================================
// Meetings (migration 112)
//
// A lightweight meeting record. Drives the Home "Meetings" secondary card,
// which surfaces the current user's scheduled meetings (as creator or
// attendee) whose scheduled_at is today or overdue. A meeting drops off the
// card once it is marked done or cancelled.
// ============================================================

export type MeetingStatus = 'scheduled' | 'done' | 'cancelled';

export interface Meeting {
  id: string;
  title: string;
  scheduled_at: string;        // TIMESTAMPTZ
  duration_min: number;
  location: string | null;
  status: MeetingStatus;
  attendee_ids: string[];
  created_by: string | null;
  created_at: string;
  updated_at: string;
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

// ============================================================
// ---- Feature Tips (admin-triggered tooltips / coachmarks) ----
// An admin authors a "tip" announcing a new feature, optionally anchored to a
// UI element on a target screen. Tips are pushed to users (new + existing);
// each user must actively accept ("OK/Got it") or can Dismiss (snooze 3h →
// re-appears until accepted). All acknowledgement state is server-side — never
// localStorage. Re-triggering reissues a tip (a new revision) to everyone or
// just the un-accepted, preserving per-round acceptance history.
// ============================================================

export type FeatureTipStatus = 'accepted' | 'dismissed';
export type TriggerScope = 'everyone' | 'unaccepted';

/** Surface a tip is authored for. 'web' = the browser app, 'app' = the native
 *  partner Android app. A tip only ever shows on its own platform; the two are
 *  managed from separate admin sections and target platform-specific screens. */
export type TipPlatform = 'web' | 'app';

/** Audience filter for a tip. `{}` (empty) ⇒ ALL active users. Otherwise a user
 *  is in the audience if they match ANY specified key (filters are OR-unioned). */
export interface FeatureTipAudience {
  user_types?: UserType[];
  workspace_roles?: ('super_admin' | 'admin' | 'member' | 'guest')[];
  role_ids?: string[];
  department_ids?: string[];
  user_ids?: string[];
}

/** One step of a guided tour. Same placement shape as a single-card tip. */
export interface FeatureTipStep {
  title: string;
  body: string;
  /** Target screen key (a web HomeView, or 'apps' for the Apps module). */
  target_view: string | null;
  /** `data-tip-anchor` key of the element to spotlight on that screen. */
  target_anchor: string | null;
}

export interface FeatureTip {
  id: string;
  /** Which app this tip targets. Defaults to 'web' for tips created before the
   *  platform split. App tips render in the native partner app's overlay. */
  platform: TipPlatform;
  title: string;
  body: string;
  /** Target screen key (a web HomeView). Null ⇒ centered "What's New" card. */
  target_view: string | null;
  /** `data-tip-anchor` key of the element to spotlight. Null ⇒ centered card. */
  target_anchor: string | null;
  /** Ordered steps for a multi-step guided tour. Null/empty ⇒ single card built
   *  from the top-level title/body/target_view/target_anchor. */
  steps: FeatureTipStep[] | null;
  audience: FeatureTipAudience;
  is_active: boolean;
  current_revision: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  last_triggered_at: string | null;
}

/** Slim payload returned to clients by GET /feature-tips/pending. */
export interface PendingFeatureTip {
  id: string;
  title: string;
  body: string;
  target_view: string | null;
  target_anchor: string | null;
  /** Ordered steps when this tip is a guided tour; null/empty ⇒ single card. */
  steps: FeatureTipStep[] | null;
  revision: number;
}

export interface FeatureTipRosterRow {
  user: Pick<User, 'id' | 'display_name' | 'email' | 'avatar_url'>;
  /** 'snoozed' = dismissed and still within the 3h window; 'pending' = in the
   *  audience but no current-revision ack (or snooze elapsed). */
  status: 'accepted' | 'snoozed' | 'pending';
  accepted_at: string | null;
  dismissed_until: string | null;
}

export interface FeatureTipRoster {
  revision: number;
  counts: { accepted: number; snoozed: number; pending: number; total: number };
  rows: FeatureTipRosterRow[];
}

/** Canonical catalog of screens a tip can navigate to ("Show me" guided nav).
 *  `value` matches a web `HomeView` that renders a real view in the home rail
 *  section. Shared so web (overlay), admin (editor dropdown) and server stay in
 *  sync. External link-outs (e.g. SquadBooks) are intentionally excluded. */
export const NAVIGABLE_TIP_VIEWS: { value: string; label: string }[] = [
  { value: 'hub', label: 'Home' },
  { value: 'chat', label: 'Chat' },
  { value: 'tasks', label: 'Tasks' },
  { value: 'my-tasks', label: 'My Tasks' },
  { value: 'inbox', label: 'Inbox' },
  { value: 'day-planner', label: 'Day Planner' },
  { value: 'routines', label: 'Routines' },
  { value: 'checkin', label: 'Daily Check-In' },
  { value: 'check-ins', label: 'Check-Ins' },
  { value: 'time-management', label: 'Time Management' },
  { value: 'sales-leads', label: 'Sales Leads' },
  { value: 'clips', label: 'Squad Clips' },
  // 'apps' is not a HomeView — it opens the Apps module (the rail's grid icon),
  // whose side menu hosts the star/pin control. Handled specially by the web nav.
  { value: 'apps', label: 'Apps (module)' },
  // NOTE: 'cashbook' is intentionally excluded — it only renders for partner /
  // client users (internal users fall through to Home), so guided nav there
  // would silently mis-navigate. Tip authors target Cash Book via an anchor on a
  // partner/client audience instead.
];

/** Starter catalog of stable `data-tip-anchor` keys. Convention: "<area>.<element>",
 *  kebab-case. The web app tags these elements; the admin editor offers them for
 *  autocomplete (admins may also type a not-yet-shipped key — it degrades to a
 *  centered card until the element exists). Grow this list as features ship. */
export const TIP_ANCHOR_KEYS: readonly string[] = [
  'rail.home',
  'rail.inbox',
  'rail.tasks',
  'rail.docs',
  'rail.cal',
  'rail.apps',
  'rail.learning',
  'rail.more',
  'rail.timesheet',
  'action.new-task',
  'home.apps', // Home sidebar "Apps" section (pinned mini apps)
  'apps.star', // star/pin toggle on an app row in the Apps module side menu
] as const;

// ============================================================
// APP (native partner Android app) tip catalogs
// ============================================================
// The phone app has a different surface than the web: a bottom tab bar (Home /
// Chat / Inbox / More) and drill-in sections rather than a left rail. These
// catalogs mirror the app's real navigation routes and `Modifier.tipAnchor`
// keys so the admin "App Tooltips" editor offers only valid app placements.

/** Screens an app tip can navigate to ("Show me" / guided-tour auto-nav). Each
 *  `value` maps to a navigation route the native app knows how to open. */
export const APP_NAV_TIP_VIEWS: { value: string; label: string }[] = [
  { value: 'home', label: 'Home' },
  { value: 'chat', label: 'Chat' },
  { value: 'inbox', label: 'Inbox' },
  { value: 'more', label: 'More / Account' },
  { value: 'my-tasks', label: 'My Tasks' },
  { value: 'new-tasks', label: 'Review (New Tasks)' },
  { value: 'check-in', label: 'Daily Check-In' },
  { value: 'tasks', label: 'Tasks' },
];

/** Stable `Modifier.tipAnchor` keys the native app tags. Convention mirrors web:
 *  "<area>.<element>", kebab-case. An anchor not currently on screen degrades to
 *  a centered "What's new" card, so targeting a hidden element is always safe. */
export const APP_TIP_ANCHOR_KEYS: readonly string[] = [
  'nav.home', // Home bottom-tab item
  'nav.chat', // Chat bottom-tab item
  'nav.inbox', // Inbox bottom-tab item
  'nav.more', // More bottom-tab item
  'home.profile', // profile avatar on the Home header
  'home.checkin', // Daily Check-In shortcut card on Home
] as const;
// ---------------------------------------------------------------------------
// Candidates mini app
//
// DTOs for the "Candidates" mini app. SquadHub renders a thin UI and proxies
// reads/writes to SquadHire (Profiles), which owns the data (lead_submissions /
// lead_notes). These mirror SquadHire's shapes; the proxy validates responses
// against them at the boundary as a tolerant reader (unknown fields ignored,
// optional fields tolerate absence), so additive SquadHire changes never break
// the UI.
// ---------------------------------------------------------------------------

/**
 * Permission tier a user/role holds for a candidate category (view < edit <
 * full). view = read-only, edit = update status/notes, full = incl. delete.
 */
export type CandidatePermission = 'view' | 'edit' | 'full';
/** Candidate category → the current user's permission tier (absent = no access). */
export type CandidateAccessMap = Partial<Record<string, CandidatePermission>>;

export interface CandidateLinkedTalent {
  id: string;
  full_name: string;
  onboarding_completed?: boolean;
  skip_onboarding?: boolean;
}

export interface CandidateOnboardingProgress {
  signed_up: boolean;
  onboarding_completed: boolean;
  onboarding_bypassed?: boolean;
  basic_profile_completed: boolean;
  job_profile_completed: boolean;
  portfolio_completed: boolean;
}

/** A row in the candidate list. */
export interface CandidateListItem {
  id: string;
  form_type: string;
  status: string;
  name: string;
  email: string | null;
  phone: string;
  form_data: Record<string, unknown>;
  auto_approved: boolean;
  created_at: string;
  linked_talent: CandidateLinkedTalent | null;
}

/** Full candidate detail (superset of the list row). */
export interface Candidate extends CandidateListItem {
  resume_url?: string | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  admin_notes?: string | null;
  archive_reason?: string | null;
  profile_type?: string | null;
  profile_type_custom?: string | null;
  onboarding_progress?: CandidateOnboardingProgress;
  deleted_at?: string | null;
}

export interface CandidateNote {
  id: string;
  lead_id: string;
  content: string;
  created_by: string;
  /** Email of the SquadHub user who wrote the note (X-SquadHub-Actor). Null for
   *  legacy notes and notes authored directly in the SquadHire CRM. */
  author_email?: string | null;
  /** Display name of that user (X-SquadHub-Actor-Name); preferred over email in
   *  the UI. Null when the user has no profile name. */
  author_name?: string | null;
  created_at: string;
  updated_at: string;
}

export interface CandidatesListResponse {
  leads: CandidateListItem[];
  total: number;
  page: number;
  limit: number;
  total_pages: number;
}

/** Onboarding tab row — a signed-up candidate with onboarding progress. */
export interface OnboardingListItem extends CandidateListItem {
  onboarding_progress: CandidateOnboardingProgress;
}
export interface OnboardingListResponse {
  leads: OnboardingListItem[];
  total: number;
  page: number;
  limit: number;
  total_pages: number;
}

/** Interview Responses tab — a first-level interview invitation. */
export interface InterviewInvitation {
  id: string;
  lead_id: string;
  lead_name: string;
  lead_phone: string;
  lead_email: string | null;
  form_type: string;
  created_at: string;
  expires_at: string;
  submitted_at: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  response_count: number;
}
export interface InterviewInvitationsResponse {
  invitations: InterviewInvitation[];
  total: number;
  page: number;
  limit: number;
  total_pages: number;
}

// ---- Job Cards ----
// The hiring service: businesses hire candidates into full-time/placed roles.
// SquadHub owns business/brand/job profiles + job cards + stage + offer
// TEMPLATES; SquadHire (Profiles) owns per-candidate funnel events
// (applications, interviews, offers, Q&A), mirrored back via the inbound
// events webhook. Tables live in migrations 158–162; these types mirror the
// applied DDL exactly.

/** Canonical stored card state — deliberately small. The nine admin pipeline
 *  tabs are DERIVED buckets (JobCardStage) computed from state + lifecycle
 *  stamps + candidate rollup counters (see server utils/jobStage.ts). */
export type JobCardState = 'new' | 'onboarding' | 'published' | 'closed';

/** Derived admin pipeline bucket. Precedence (first match wins):
 *  trash → archive → cancelled → placed → hired → offer → interview →
 *  short_listing → screening (keys on screening_started_at, NOT applicant
 *  counts — contract §5) → broadcasted (published) → onboarding → new. */
export type JobCardStage =
  | 'new'
  | 'onboarding'
  | 'broadcasted'
  | 'screening'
  | 'short_listing'
  | 'interview'
  | 'offer'
  | 'hired'
  | 'placed'
  | 'cancelled'
  | 'archive'
  | 'trash';
export const JOB_CARD_STAGES: JobCardStage[] = [
  'new', 'onboarding', 'broadcasted', 'screening', 'short_listing',
  'interview', 'offer', 'hired', 'placed', 'cancelled', 'archive', 'trash',
];

export type JobCardSource = 'internal_brief' | 'shared_form' | 'landing_page_form';
export type JobEmploymentType = 'full_time' | 'part_time' | 'contract' | 'internship';
export type JobWorkMode = 'onsite' | 'remote' | 'hybrid';
export type JobSalaryPeriod = 'monthly' | 'annual';
export type JobCardClosedReason = 'filled' | 'cancelled' | 'expired';

/**
 * Candidate preference / match rules. Key vocabulary is BINDING per the
 * cross-repo contract (§3, Profiles' matcher wins): job_profiles.
 * preference_rules and job_cards.rule_overrides use the same keys, and
 * mergeJobRules() output maps 1:1 onto the webhook match_rules.
 */
export interface JobMatchRules {
  /** SquadHire category UUIDs (Designer / Video Editor). Sourced from
   *  job_profiles.squadhire_category_ids by the payload builder. */
  category_ids?: string[];
  target_tiers?: string[];
  min_experience_years?: number;
  max_experience_years?: number;
  target_languages?: string[];
  target_country_names?: string[];
  /** Region/state names ("blank = anywhere" on the Profiles matcher). */
  target_regions?: string[];
  min_age?: number;
  max_age?: number;
  target_genders?: string[];
  target_districts?: string[];
}

/** Card-level overrides over the job profile's preference_rules. A key
 *  present here wins; an EXPLICIT null means "clear this rule" (the profile
 *  default is dropped from the effective rules). */
export type JobRuleOverrides = { [K in keyof JobMatchRules]?: JobMatchRules[K] | null };

export interface BusinessProfilePhoto {
  url: string;
  caption?: string | null;
}

export interface BusinessProfile {
  id: string;
  lead_submission_id: string | null;
  client_id: string | null;
  name: string;
  about: string | null;
  industry: string | null;
  company_size: string | null; // e.g. '11-50'
  website: string | null;
  socials: Record<string, string>; // {linkedin, instagram, ...}
  logo_url: string | null;
  photos: BusinessProfilePhoto[];
  culture: string | null;
  perks: string[];
  founded_year: number | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  // Joined (detail endpoint)
  locations?: BusinessLocation[];
  brands?: BrandProfile[];
  job_profiles?: JobProfile[];
}

export interface BusinessLocation {
  id: string;
  business_profile_id: string;
  label: string; // 'Head Office'
  address: string;
  city: string | null;
  region: string | null;
  country_id: string | null;
  postal_code: string | null;
  google_maps_url: string | null;
  latitude: number | null;
  longitude: number | null;
  is_primary: boolean;
  created_at: string;
  updated_at: string;
}

export interface BrandProfile {
  id: string;
  business_profile_id: string;
  name: string;
  about: string | null;
  industry: string | null;
  website: string | null;
  socials: Record<string, string>;
  logo_url: string | null;
  photos: BusinessProfilePhoto[];
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface JobWorkingHours {
  start?: string; // '09:30'
  end?: string; // '18:00'
  timezone?: string; // 'Asia/Kolkata'
}

export interface JobProfile {
  id: string;
  business_profile_id: string;
  /** NULL = job hangs directly off the business profile; set = off a brand. */
  brand_profile_id: string | null;
  title: string;
  description: string | null;
  responsibilities: string[];
  requirements: string[];
  skills: string[];
  min_experience_years: number | null;
  max_experience_years: number | null;
  education: string | null;
  employment_type: JobEmploymentType;
  work_mode: JobWorkMode;
  location_id: string | null;
  working_days: string[];
  working_hours: JobWorkingHours | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string;
  salary_period: JobSalaryPeriod;
  benefits: string[];
  growth_path: string | null;
  /** Default candidate preference rules (JobMatchRules vocabulary). Cards
   *  override these key-by-key via job_cards.rule_overrides. */
  preference_rules: JobMatchRules;
  squadhire_category_ids: string[];
  status: 'active' | 'archived';
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  // Joined
  business_profile?: BusinessProfile | null;
  brand_profile?: BrandProfile | null;
  location?: BusinessLocation | null;
}

export interface JobCard {
  id: string;
  lead_submission_id: string | null;
  client_id: string | null;
  /** NULL while state='new' (brief exists, onboarding not done yet). */
  job_profile_id: string | null;
  source: JobCardSource;
  state: JobCardState;
  // Brief snapshot (pre-onboarding; the linked job profile supersedes these).
  role_service_type: string | null; // 'Designers' | 'Editors'
  brief_note: string | null;
  customer_name: string | null;
  customer_company: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  customer_location: string | null;
  // Offered package on the card (can differ from the profile's advertised range).
  package_min: number | null;
  package_max: number | null;
  package_currency: string;
  package_period: JobSalaryPeriod;
  package_notes: string | null;
  openings_count: number;
  expected_joining_date: string | null;
  expires_at: string | null;
  /** Card-level overrides over the profile's preference_rules (explicit null
   *  = clear). Effective rules computed by mergeJobRules() — never stored. */
  rule_overrides: JobRuleOverrides;
  distribution: SubscriptionCardDistribution;
  squadhire_match_preview: { count: number; talents: Array<{ talent_user_id: string; talent_name: string }>; refreshed_at: string } | null;
  // Lifecycle stamps (subscription_cards vocabulary).
  published_at: string | null;
  published_by: string | null;
  recalled_at: string | null;
  archived_at: string | null;
  paused_at: string | null;
  cancelled_at: string | null;
  closed_at: string | null;
  closed_reason: JobCardClosedReason | null;
  deleted_at: string | null;
  deleted_by: string | null;
  verified_by: string | null;
  verified_at: string | null;
  /** Stamped from SquadHire's job_screening_started event; the "Applicant
   *  Screening" tab keys on this (contract §5). */
  screening_started_at: string | null;
  // Outbound sync bookkeeping (own sweeper — startJobSyncSweeper).
  squadhire_synced_at: string | null;
  squadhire_sync_attempts: number;
  squadhire_sync_last_error: string | null;
  // Candidate rollups (recomputed by recountJobCardRollups — never incremental).
  applicants_count: number;
  screening_count: number;
  shortlisted_count: number;
  interview_count: number;
  offer_count: number;
  hired_count: number;
  placed_count: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  // Derived / joined
  stage?: JobCardStage;
  job_profile?: JobProfile | null;
  business_profile?: BusinessProfile | null;
  brand_profile?: BrandProfile | null;
}

export interface JobCardEvent {
  id: string;
  card_id: string;
  event_type: string;
  actor_id: string | null;
  actor_type: 'admin' | 'business' | 'talent' | 'system' | null;
  actor_label: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export type JobCandidateStatus =
  | 'matched'
  | 'applied'
  | 'screening'
  | 'shortlisted'
  | 'interview'
  | 'offer'
  | 'offer_accepted'
  | 'hired'
  | 'joined'
  | 'rejected'
  | 'withdrawn'
  | 'on_hold';

export interface JobCardCandidate {
  id: string;
  card_id: string;
  external_system: string; // 'squadhire'
  external_candidate_id: string; // Profiles' job_candidates row id
  talent_user_id: string; // Profiles' talent user id
  talent_name: string | null;
  talent_email: string | null;
  talent_phone: string | null;
  status: JobCandidateStatus;
  applied_at: string | null;
  screening_started_at: string | null;
  shortlisted_at: string | null;
  first_interview_at: string | null;
  offered_at: string | null;
  offer_accepted_at: string | null;
  hired_at: string | null;
  joining_date: string | null;
  joined_at: string | null;
  rejected_at: string | null;
  rejection_stage: string | null;
  rejection_reason: string | null;
  snapshot: Record<string, unknown>; // last full candidate payload from Profiles
  created_at: string;
  updated_at: string;
}

export type JobInterviewMode = 'virtual' | 'physical';
export type JobInterviewStatus = 'proposed' | 'scheduled' | 'completed' | 'cancelled' | 'no_show';
export type JobInterviewOutcome = 'selected' | 'rejected' | 'on_hold';

export interface JobInterviewLocationSnapshot {
  label?: string | null;
  address?: string | null;
  city?: string | null;
  region?: string | null;
  google_maps_url?: string | null;
}

export interface JobInterview {
  id: string;
  card_id: string;
  candidate_id: string;
  external_interview_id: string; // Profiles' invite id (idempotency key)
  /** Profiles' interview_rounds.id — present only on the live-read path; the
   *  admin uses it to target a round for edit/reschedule (mirror rows omit it). */
  external_round_id?: string | null;
  round_number: number;
  round_label: string | null; // 'HR Round', 'Portfolio Review'
  mode: JobInterviewMode;
  scheduled_at: string | null;
  /** Round window end — for reschedule prefill (live-read path only). */
  window_end?: string | null;
  duration_minutes: number | null;
  meeting_provider?: string | null;
  /** Stored for admin visibility; reveal-on-start gating happens on Profiles. */
  meeting_link: string | null;
  meeting_link_revealed_at: string | null;
  location_id: string | null;
  location_snapshot: JobInterviewLocationSnapshot | null;
  status: JobInterviewStatus;
  outcome: JobInterviewOutcome | null;
  outcome_notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface JobInterviewSlot {
  id: string;
  interview_id: string;
  external_slot_id: string;
  starts_at: string;
  ends_at: string | null;
  status: 'proposed' | 'accepted' | 'declined' | 'expired';
  created_at: string;
}

/** Ordered editable template section; body_html carries {{merge}} fields. */
export interface OfferTemplateSection {
  key: string;
  title: string;
  body_html: string;
}

export interface OfferTemplateMergeField {
  key: string;
  label: string;
  source: 'candidate' | 'card' | 'business' | 'manual';
}

/** Default compensation row, e.g. {component: 'Training Period', cadence: 'per_month'}. */
export interface OfferCompensationRow {
  key: string;
  component: string;
  cadence: 'per_month' | 'per_annum';
}

export interface OfferTemplateSignatory {
  name?: string | null;
  title?: string | null;
  signature_image_url?: string | null;
}

/** Canonical on SquadHub ONLY (contract §1): admin authors templates here;
 *  SquadHire's business composer pulls them via the signed integration GET. */
export interface OfferLetterTemplate {
  id: string;
  name: string;
  description: string | null;
  /** Optional link — a template authored alongside a job profile. NULL = generic. */
  job_profile_id: string | null;
  sections: OfferTemplateSection[];
  merge_fields: OfferTemplateMergeField[];
  compensation_schema: OfferCompensationRow[];
  signatory: OfferTemplateSignatory;
  is_default: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export type JobOfferDeliveryMode = 'platform' | 'manual_email';
export type JobOfferStatus =
  | 'draft'
  | 'sent'
  | 'viewed'
  | 'negotiation_requested'
  | 'countered'
  | 'accepted'
  | 'declined'
  | 'withdrawn'
  | 'expired';

export interface JobOfferCompensationComponent {
  amount?: number | null;
  cadence?: 'per_month' | 'per_annum';
}

/** {currency, training:{amount,cadence}, probation:{...}, confirmed:{...}} */
export interface JobOfferCompensation {
  currency?: string;
  training?: JobOfferCompensationComponent | null;
  probation?: JobOfferCompensationComponent | null;
  confirmed?: JobOfferCompensationComponent | null;
}

export interface JobOffer {
  id: string;
  card_id: string;
  candidate_id: string;
  external_offer_id: string | null; // Profiles' offer id
  template_id: string | null;
  delivery_mode: JobOfferDeliveryMode;
  /** Merged snapshot at send time — immutable per revision. */
  rendered_body_html: string | null;
  compensation: JobOfferCompensation;
  total_ctc: number | null;
  ctc_currency: string;
  position_title: string | null;
  effective_date: string | null;
  join_by_date: string | null;
  joining_date: string | null;
  offer_expires_at: string | null;
  /** Bumped per counteroffer. */
  revision: number;
  /** Final counteroffer — no further negotiation. */
  is_final: boolean;
  status: JobOfferStatus;
  created_by_side: 'admin' | 'business';
  created_at: string;
  updated_at: string;
}

export interface JobOfferEvent {
  id: string;
  offer_id: string;
  external_event_id: string | null; // Profiles' offer_events id (replay guard)
  event_type: string; // sent|viewed|negotiation_requested|countered|final_countered|accepted|declined|withdrawn|expired|question_asked|question_answered
  actor_type: 'admin' | 'business' | 'talent' | 'system' | null;
  actor_label: string | null;
  metadata: Record<string, unknown>; // e.g. {asked_amount, note}
  created_at: string;
}

export interface JobCardQuestion {
  id: string;
  card_id: string;
  /** Published Q&A lives on the profile (survives card re-publishes). */
  job_profile_id: string | null;
  external_question_id: string; // Profiles' question id
  talent_user_id: string | null;
  talent_name: string | null;
  question: string;
  answer: string | null;
  /** answered ⇒ published (contract §7). */
  answered_at: string | null;
  answered_by_label: string | null;
  /** Moderation tombstone — survives event replays. */
  deleted_at: string | null;
  deleted_by: string | null;
  created_at: string;
  updated_at: string;
}
