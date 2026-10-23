-- ============================================================================
-- Squad Hub SaaS — consolidated baseline schema (0001)
-- ============================================================================
-- A FRESH schema for the new SaaS Supabase project. It is NOT a replay of the
-- ~300 internal Squad Hub migrations (archived in supabase/migrations_hub_archive/
-- for reference only). Table shapes for the collaboration core were taken from
-- the Hub's live catalog (columns, constraints, indexes, trigger functions) and
-- then cut down to what the kept SaaS server code uses, plus the SaaS tenancy
-- model:
--
--   workspaces            = the ACCOUNT (kind business|talent|shared|internal_staff)
--   workspace_members     owner|admin|member|guest + is_upsquad_staff
--   shared_workspace_links shared workspace <-> participant accounts (Slack Connect)
--   plans, workspace_mini_apps, platform_audit_log, users.hub_user_id
--
-- Every collaboration table carries workspace_id NOT NULL (+ index). Child rows
-- get it from their parent through saas_fill_workspace_id(): the trigger fills
-- a NULL workspace_id from the parent row, and REJECTS a row whose supplied
-- workspace_id differs from its parent's (a cross-tenant link can't be written
-- even by a buggy route — the server uses the service-role key, so RLS does not
-- protect anything).
--
-- RLS is enabled on every table with no policies, and anon/authenticated have
-- no grants: the SaaS server is the only client (service_role).
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
SET search_path = public, extensions;

-- ---------------------------------------------------------------- tenancy core
CREATE TABLE public.plans (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL UNIQUE,
  price_inr integer NOT NULL DEFAULT 0 CHECK (price_inr >= 0),
  free_staff_seats integer NOT NULL DEFAULT 0 CHECK (free_staff_seats >= 0),
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_plans_one_default ON public.plans (is_default) WHERE is_default;


CREATE SEQUENCE public.list_whiteboard_versions_id_seq;
CREATE SEQUENCE public.message_edits_id_seq;
CREATE SEQUENCE public.whiteboard_versions_id_seq;

CREATE TABLE public.users (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  email text NOT NULL,
  display_name text NOT NULL,
  avatar_url text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'active'::text,
  user_type text NOT NULL DEFAULT 'internal'::text,
  is_admin boolean NOT NULL DEFAULT false,
  phone text,
  phone_last10 text GENERATED ALWAYS AS (NULLIF("right"(regexp_replace(COALESCE(phone, ''::text), '\D'::text, ''::text, 'g'::text), 10), ''::text)) STORED,
  work_unlocked_at timestamp with time zone,
  hub_user_id uuid UNIQUE
);
ALTER TABLE public.users ADD CONSTRAINT users_pkey PRIMARY KEY (id);

CREATE TABLE public.workspaces (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  kind text NOT NULL DEFAULT 'business'
    CHECK (kind IN ('business', 'talent', 'shared', 'internal_staff')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  owner_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  plan_id uuid REFERENCES public.plans(id) ON DELETE SET NULL,
  hub_client_id uuid,
  hub_partner_user_id uuid,
  squadhire_business_id text,
  squadhire_talent_id text,
  -- shared workspaces: the business account hosting it
  host_workspace_id uuid REFERENCES public.workspaces(id) ON DELETE SET NULL,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (kind = 'shared' OR host_workspace_id IS NULL)
);
CREATE INDEX idx_workspaces_owner ON public.workspaces (owner_user_id);
CREATE INDEX idx_workspaces_kind_status ON public.workspaces (kind, status);
CREATE INDEX idx_workspaces_host ON public.workspaces (host_workspace_id) WHERE host_workspace_id IS NOT NULL;
CREATE UNIQUE INDEX uq_workspaces_hub_client ON public.workspaces (hub_client_id) WHERE hub_client_id IS NOT NULL AND kind = 'business';
CREATE UNIQUE INDEX uq_workspaces_hub_partner ON public.workspaces (hub_partner_user_id) WHERE hub_partner_user_id IS NOT NULL AND kind = 'talent';
CREATE UNIQUE INDEX uq_workspaces_sh_business ON public.workspaces (squadhire_business_id) WHERE squadhire_business_id IS NOT NULL AND kind = 'business';
CREATE UNIQUE INDEX uq_workspaces_sh_talent ON public.workspaces (squadhire_talent_id) WHERE squadhire_talent_id IS NOT NULL AND kind = 'talent';

CREATE TABLE public.shared_workspace_links (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  shared_workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  participant_workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  -- 'host' = the business account, 'talent' = a talent account
  participant_role text NOT NULL DEFAULT 'talent' CHECK (participant_role IN ('host', 'talent', 'staff')),
  hub_card_id uuid,
  card_category text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shared_workspace_id, participant_workspace_id),
  CHECK (shared_workspace_id <> participant_workspace_id)
);
CREATE INDEX idx_swl_participant ON public.shared_workspace_links (participant_workspace_id, status);
CREATE INDEX idx_swl_card ON public.shared_workspace_links (hub_card_id) WHERE hub_card_id IS NOT NULL;

CREATE TABLE public.platform_audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  action text NOT NULL,
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE SET NULL,
  actor_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  actor_hub_user_id uuid,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_workspace ON public.platform_audit_log (workspace_id, created_at DESC);
CREATE INDEX idx_audit_created ON public.platform_audit_log (created_at DESC);


CREATE TABLE public.app_favorites (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  app_slug text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
ALTER TABLE public.app_favorites ADD CONSTRAINT app_favorites_pkey PRIMARY KEY (id);

CREATE TABLE public.channels (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  workspace_id uuid NOT NULL,
  name text NOT NULL,
  description text,
  is_private boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  deleted_at timestamp with time zone,
  linked_resource_type text,
  linked_resource_id uuid,
  linked_label text,
  linked_subtitle text,
  channel_kind text NOT NULL DEFAULT 'standard'::text
);
ALTER TABLE public.channels ADD CONSTRAINT channels_pkey PRIMARY KEY (id);

CREATE TABLE public.chat_scheduled_messages (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  channel_id uuid,
  dm_conversation_id uuid,
  parent_message_id uuid,
  content text NOT NULL,
  scheduled_at timestamp with time zone NOT NULL,
  status text NOT NULL DEFAULT 'pending'::text,
  sent_message_id uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  workspace_id uuid NOT NULL
);
ALTER TABLE public.chat_scheduled_messages ADD CONSTRAINT chat_scheduled_messages_pkey PRIMARY KEY (id);

CREATE TABLE public.checkin_configs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  role_id uuid NOT NULL,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);
ALTER TABLE public.checkin_configs ADD CONSTRAINT checkin_configs_pkey PRIMARY KEY (id);

CREATE TABLE public.checkins (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  date date NOT NULL,
  submitted_at timestamp with time zone,
  status text NOT NULL DEFAULT 'no_checkin'::text,
  completed_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  role_id uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  workspace_id uuid NOT NULL
);
ALTER TABLE public.checkins ADD CONSTRAINT checkins_pkey PRIMARY KEY (id);

CREATE TABLE public.daily_time_summaries (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  date date NOT NULL,
  total_work_seconds integer NOT NULL DEFAULT 0,
  total_break_seconds integer NOT NULL DEFAULT 0,
  total_no_work_seconds integer NOT NULL DEFAULT 0,
  session_count integer NOT NULL DEFAULT 0,
  first_start timestamp with time zone,
  last_stop timestamp with time zone,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  workspace_id uuid NOT NULL,
  context text NOT NULL DEFAULT 'default'::text
);
ALTER TABLE public.daily_time_summaries ADD CONSTRAINT daily_time_summaries_pkey PRIMARY KEY (id);

CREATE TABLE public.dm_conversations (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  workspace_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
ALTER TABLE public.dm_conversations ADD CONSTRAINT dm_conversations_pkey PRIMARY KEY (id);

CREATE TABLE public.dm_participants (
  conversation_id uuid NOT NULL,
  user_id uuid NOT NULL
);
ALTER TABLE public.dm_participants ADD CONSTRAINT dm_participants_pkey PRIMARY KEY (conversation_id, user_id);

CREATE TABLE public.favorites (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  item_type character varying(20) NOT NULL,
  item_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
ALTER TABLE public.favorites ADD CONSTRAINT favorites_pkey PRIMARY KEY (id);

CREATE TABLE public.feature_tip_states (
  tip_id uuid NOT NULL,
  user_id uuid NOT NULL,
  revision integer NOT NULL,
  status text NOT NULL,
  accepted_at timestamp with time zone,
  dismissed_until timestamp with time zone,
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);
ALTER TABLE public.feature_tip_states ADD CONSTRAINT feature_tip_states_pkey PRIMARY KEY (tip_id, user_id, revision);

CREATE TABLE public.feature_tips (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  title text NOT NULL,
  body text NOT NULL,
  target_view text,
  target_anchor text,
  audience jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT false,
  current_revision integer NOT NULL DEFAULT 1,
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  last_triggered_at timestamp with time zone,
  steps jsonb,
  platform text NOT NULL DEFAULT 'web'::text
);
ALTER TABLE public.feature_tips ADD CONSTRAINT feature_tips_pkey PRIMARY KEY (id);

CREATE TABLE public.folders (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  space_id uuid NOT NULL,
  name text NOT NULL,
  is_private boolean NOT NULL DEFAULT true,
  created_by uuid,
  "position" integer NOT NULL DEFAULT 0,
  deleted_at timestamp with time zone,
  status text NOT NULL DEFAULT 'active'::text,
  is_locked boolean NOT NULL DEFAULT false,
  folder_type text NOT NULL DEFAULT 'folder'::text,
  parent_folder_id uuid,
  group_tasks boolean NOT NULL DEFAULT false,
  auto_assignee_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  default_task_type_id uuid,
  workspace_id uuid NOT NULL
);
ALTER TABLE public.folders ADD CONSTRAINT folders_pkey PRIMARY KEY (id);

CREATE TABLE public.goal_dependencies (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  goal_id uuid NOT NULL,
  from_task_id uuid NOT NULL,
  to_task_id uuid NOT NULL,
  from_endpoint text NOT NULL DEFAULT 'end'::text,
  to_endpoint text NOT NULL DEFAULT 'start'::text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
ALTER TABLE public.goal_dependencies ADD CONSTRAINT goal_dependencies_pkey PRIMARY KEY (id);

CREATE TABLE public.goal_projects (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  name text NOT NULL,
  color text NOT NULL DEFAULT '#7c5cff'::text,
  created_by uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);
ALTER TABLE public.goal_projects ADD CONSTRAINT goal_projects_pkey PRIMARY KEY (id);

CREATE TABLE public.goal_sources (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  goal_id uuid NOT NULL,
  resource_type text NOT NULL,
  resource_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
ALTER TABLE public.goal_sources ADD CONSTRAINT goal_sources_pkey PRIMARY KEY (id);

CREATE TABLE public.goal_tasks (
  goal_id uuid NOT NULL,
  task_id uuid NOT NULL,
  scheduled boolean NOT NULL DEFAULT false,
  is_direct boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  workspace_id uuid NOT NULL
);
ALTER TABLE public.goal_tasks ADD CONSTRAINT goal_tasks_pkey PRIMARY KEY (goal_id, task_id);

CREATE TABLE public.goals (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  name text NOT NULL,
  description text NOT NULL DEFAULT ''::text,
  status text NOT NULL DEFAULT 'planned'::text,
  priority text NOT NULL DEFAULT 'normal'::text,
  assignee_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  labels text[] NOT NULL DEFAULT '{}'::text[],
  work_start_date date,
  work_end_date date,
  start_date date,
  due_date date,
  created_by uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);
ALTER TABLE public.goals ADD CONSTRAINT goals_pkey PRIMARY KEY (id);

CREATE TABLE public.group_day_plans (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  container_type text NOT NULL,
  container_id uuid NOT NULL,
  user_id uuid NOT NULL,
  plan_date date NOT NULL,
  start_minute integer NOT NULL,
  duration_minutes integer NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  workspace_id uuid NOT NULL
);
ALTER TABLE public.group_day_plans ADD CONSTRAINT group_day_plans_pkey PRIMARY KEY (id);

CREATE TABLE public.group_run_completions (
  run_id uuid NOT NULL,
  completed_task_id uuid NOT NULL,
  completed_at timestamp with time zone NOT NULL DEFAULT now()
);
ALTER TABLE public.group_run_completions ADD CONSTRAINT group_run_completions_pkey PRIMARY KEY (run_id, completed_task_id);

CREATE TABLE public.group_run_task_times (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL,
  task_id uuid NOT NULL,
  started_at timestamp with time zone NOT NULL DEFAULT now(),
  ended_at timestamp with time zone,
  duration_seconds integer,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
ALTER TABLE public.group_run_task_times ADD CONSTRAINT group_run_task_times_pkey PRIMARY KEY (id);

CREATE TABLE public.group_runs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  group_key text NOT NULL,
  group_label text NOT NULL DEFAULT ''::text,
  workspace_id uuid NOT NULL,
  started_at timestamp with time zone NOT NULL DEFAULT now(),
  ended_at timestamp with time zone,
  duration_seconds integer,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
ALTER TABLE public.group_runs ADD CONSTRAINT group_runs_pkey PRIMARY KEY (id);

CREATE TABLE public.holidays (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  date date,
  is_recurring boolean NOT NULL DEFAULT false,
  recurring_month integer,
  recurring_day integer,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
ALTER TABLE public.holidays ADD CONSTRAINT holidays_pkey PRIMARY KEY (id);

CREATE TABLE public.huddle_participants (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  huddle_id uuid NOT NULL,
  identity text NOT NULL,
  user_id uuid,
  display_name text NOT NULL,
  avatar_url text,
  joined_at timestamp with time zone NOT NULL DEFAULT now(),
  left_at timestamp with time zone
);
ALTER TABLE public.huddle_participants ADD CONSTRAINT huddle_participants_pkey PRIMARY KEY (id);

CREATE TABLE public.huddles (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  code text NOT NULL,
  room_name text NOT NULL,
  channel_id uuid,
  dm_conversation_id uuid,
  topic text,
  started_by uuid NOT NULL,
  started_at timestamp with time zone NOT NULL DEFAULT now(),
  ended_at timestamp with time zone,
  allow_guests boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  workspace_id uuid NOT NULL
);
ALTER TABLE public.huddles ADD CONSTRAINT huddles_pkey PRIMARY KEY (id);

CREATE TABLE public.label_create_role_access (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  role_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
ALTER TABLE public.label_create_role_access ADD CONSTRAINT label_create_role_access_pkey PRIMARY KEY (id);

CREATE TABLE public.label_create_user_access (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  user_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
ALTER TABLE public.label_create_user_access ADD CONSTRAINT label_create_user_access_pkey PRIMARY KEY (id);

CREATE TABLE public.label_group_role_access (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL,
  role_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
ALTER TABLE public.label_group_role_access ADD CONSTRAINT label_group_role_access_pkey PRIMARY KEY (id);

CREATE TABLE public.label_group_user_access (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL,
  user_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
ALTER TABLE public.label_group_user_access ADD CONSTRAINT label_group_user_access_pkey PRIMARY KEY (id);

CREATE TABLE public.label_groups (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  name text NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  "position" integer NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);
ALTER TABLE public.label_groups ADD CONSTRAINT label_groups_pkey PRIMARY KEY (id);

CREATE TABLE public.label_requests (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  requested_by uuid,
  name text NOT NULL,
  suggested_group_id uuid,
  note text,
  status text NOT NULL DEFAULT 'pending'::text,
  resolved_by uuid,
  resolved_label_id uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);
ALTER TABLE public.label_requests ADD CONSTRAINT label_requests_pkey PRIMARY KEY (id);

CREATE TABLE public.list_views (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  list_id uuid NOT NULL,
  view_type text NOT NULL,
  name text NOT NULL,
  "position" integer NOT NULL DEFAULT 0,
  is_default boolean NOT NULL DEFAULT false,
  is_private boolean NOT NULL DEFAULT false,
  owner_id uuid,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  workspace_id uuid NOT NULL
);
ALTER TABLE public.list_views ADD CONSTRAINT list_views_pkey PRIMARY KEY (id);

CREATE TABLE public.lists (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  folder_id uuid,
  space_id uuid,
  name text NOT NULL,
  is_private boolean NOT NULL DEFAULT true,
  created_by uuid,
  "position" integer NOT NULL DEFAULT 0,
  deleted_at timestamp with time zone,
  status text NOT NULL DEFAULT 'active'::text,
  is_locked boolean NOT NULL DEFAULT false,
  group_tasks boolean NOT NULL DEFAULT false,
  auto_assignee_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  default_task_type_id uuid,
  workspace_id uuid NOT NULL
);
ALTER TABLE public.lists ADD CONSTRAINT lists_pkey PRIMARY KEY (id);

CREATE TABLE public.meeting_event_attachments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  meeting_event_id uuid NOT NULL,
  file_url text NOT NULL,
  file_name text,
  file_size bigint,
  file_mime text,
  uploaded_by uuid,
  uploaded_at timestamp with time zone NOT NULL DEFAULT now()
);
ALTER TABLE public.meeting_event_attachments ADD CONSTRAINT meeting_event_attachments_pkey PRIMARY KEY (id);

CREATE TABLE public.meeting_event_guests (
  meeting_event_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role text NOT NULL DEFAULT 'guest'::text,
  responded boolean NOT NULL DEFAULT false,
  invited_at timestamp with time zone NOT NULL DEFAULT now()
);
ALTER TABLE public.meeting_event_guests ADD CONSTRAINT meeting_event_guests_pkey PRIMARY KEY (meeting_event_id, user_id);

CREATE TABLE public.meeting_event_slots (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  meeting_event_id uuid NOT NULL,
  slot_date date NOT NULL,
  start_min integer,
  end_min integer,
  is_suggestion boolean NOT NULL DEFAULT false,
  suggested_by uuid,
  suggestion_status text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
ALTER TABLE public.meeting_event_slots ADD CONSTRAINT meeting_event_slots_pkey PRIMARY KEY (id);

CREATE TABLE public.meeting_events (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  title text NOT NULL,
  kind text NOT NULL DEFAULT 'virtual'::text,
  agenda text,
  duration_min integer,
  timezone text NOT NULL DEFAULT 'Asia/Kolkata'::text,
  status text NOT NULL DEFAULT 'open'::text,
  link_provider text,
  link_url text,
  link_meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  origin_channel_id uuid,
  origin_dm_conversation_id uuid,
  confirmed_slot_id uuid,
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  workspace_id uuid NOT NULL
);
ALTER TABLE public.meeting_events ADD CONSTRAINT meeting_events_pkey PRIMARY KEY (id);

CREATE TABLE public.meeting_slot_votes (
  slot_id uuid NOT NULL,
  user_id uuid NOT NULL,
  vote text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);
ALTER TABLE public.meeting_slot_votes ADD CONSTRAINT meeting_slot_votes_pkey PRIMARY KEY (slot_id, user_id);

CREATE TABLE public.meeting_suggestion_responses (
  slot_id uuid NOT NULL,
  user_id uuid NOT NULL,
  response text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
ALTER TABLE public.meeting_suggestion_responses ADD CONSTRAINT meeting_suggestion_responses_pkey PRIMARY KEY (slot_id, user_id);

CREATE TABLE public.meetings (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  title text NOT NULL,
  scheduled_at timestamp with time zone NOT NULL,
  duration_min integer NOT NULL DEFAULT 30,
  location text,
  status text NOT NULL DEFAULT 'scheduled'::text,
  attendee_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  workspace_id uuid NOT NULL
);
ALTER TABLE public.meetings ADD CONSTRAINT meetings_pkey PRIMARY KEY (id);

CREATE TABLE public.message_edits (
  id bigint NOT NULL,
  message_id uuid NOT NULL,
  previous_content text NOT NULL,
  editor_id uuid,
  replaced_at timestamp with time zone NOT NULL DEFAULT now()
);
ALTER TABLE public.message_edits ADD CONSTRAINT message_edits_pkey PRIMARY KEY (id);

CREATE TABLE public.message_reads (
  user_id uuid NOT NULL,
  scope_type text NOT NULL,
  scope_id uuid NOT NULL,
  last_read_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);
ALTER TABLE public.message_reads ADD CONSTRAINT message_reads_pkey PRIMARY KEY (user_id, scope_type, scope_id);

CREATE TABLE public.message_threads (
  parent_message_id uuid NOT NULL,
  reply_message_id uuid NOT NULL
);
ALTER TABLE public.message_threads ADD CONSTRAINT message_threads_pkey PRIMARY KEY (parent_message_id, reply_message_id);

CREATE TABLE public.messages (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  channel_id uuid,
  dm_conversation_id uuid,
  sender_id uuid NOT NULL,
  content text,
  type text NOT NULL DEFAULT 'text'::text,
  file_url text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  is_deleted boolean NOT NULL DEFAULT false,
  mentions uuid[] NOT NULL DEFAULT '{}'::uuid[],
  file_name text,
  file_size bigint,
  file_mime text,
  duration_ms integer,
  unfurl jsonb,
  reply_count integer NOT NULL DEFAULT 0,
  parent_message_id uuid,
  edited_at timestamp with time zone,
  meeting_event_id uuid,
  metadata jsonb,
  huddle_id uuid,
  mention_all boolean NOT NULL DEFAULT false,
  workspace_id uuid NOT NULL
);
ALTER TABLE public.messages ADD CONSTRAINT messages_pkey PRIMARY KEY (id);

CREATE TABLE public.mini_apps (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  slug text NOT NULL,
  name text NOT NULL,
  description text DEFAULT ''::text,
  icon text DEFAULT 'puzzle'::text,
  is_enabled boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);
ALTER TABLE public.mini_apps ADD CONSTRAINT mini_apps_pkey PRIMARY KEY (id);

CREATE TABLE public.notifications (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  type text NOT NULL,
  reference_id uuid NOT NULL,
  reference_type text NOT NULL DEFAULT 'task'::text,
  actor_id uuid,
  title text NOT NULL,
  body text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  workspace_id uuid NOT NULL
);
ALTER TABLE public.notifications ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);

CREATE TABLE public.partner_app_installs (
  user_id uuid NOT NULL,
  platform text NOT NULL DEFAULT 'android'::text,
  version_name text,
  version_code integer,
  first_seen_at timestamp with time zone NOT NULL DEFAULT now(),
  last_seen_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);
ALTER TABLE public.partner_app_installs ADD CONSTRAINT partner_app_installs_pkey PRIMARY KEY (user_id);

CREATE TABLE public.partner_push_tokens (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  token text NOT NULL,
  platform text NOT NULL DEFAULT 'android'::text,
  last_seen_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
ALTER TABLE public.partner_push_tokens ADD CONSTRAINT partner_push_tokens_pkey PRIMARY KEY (id);

CREATE TABLE public.reactions (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  message_id uuid NOT NULL,
  user_id uuid NOT NULL,
  emoji text NOT NULL,
  workspace_id uuid NOT NULL
);
ALTER TABLE public.reactions ADD CONSTRAINT reactions_pkey PRIMARY KEY (id);

CREATE TABLE public.resource_memberships (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  resource_type text NOT NULL,
  resource_id uuid NOT NULL,
  user_id uuid NOT NULL,
  access_level text NOT NULL DEFAULT 'viewer'::text,
  invited_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  workspace_id uuid NOT NULL
);
ALTER TABLE public.resource_memberships ADD CONSTRAINT resource_memberships_pkey PRIMARY KEY (id);

CREATE TABLE public.roles (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  name text NOT NULL,
  permissions jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_default boolean NOT NULL DEFAULT false,
  color text NOT NULL DEFAULT '#888888'::text,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  is_system boolean NOT NULL DEFAULT false,
  system_key text
);
ALTER TABLE public.roles ADD CONSTRAINT roles_pkey PRIMARY KEY (id);

CREATE TABLE public.skill_grants (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  skill_key text NOT NULL,
  principal_type text NOT NULL,
  principal_id text NOT NULL,
  level text NOT NULL,
  granted_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);
ALTER TABLE public.skill_grants ADD CONSTRAINT skill_grants_pkey PRIMARY KEY (id);

CREATE TABLE public.space_statuses (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL,
  name text NOT NULL,
  color text NOT NULL DEFAULT '#6b7280'::text,
  "position" integer NOT NULL DEFAULT 0,
  is_default boolean NOT NULL DEFAULT false,
  category text NOT NULL DEFAULT 'active'::text,
  workspace_id uuid NOT NULL
);
ALTER TABLE public.space_statuses ADD CONSTRAINT space_statuses_pkey PRIMARY KEY (id);

CREATE TABLE public.spaces (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  workspace_id uuid NOT NULL,
  name text NOT NULL,
  color text NOT NULL DEFAULT '#8b5cf6'::text,
  icon text NOT NULL DEFAULT 'folder'::text,
  is_private boolean NOT NULL DEFAULT true,
  created_by uuid,
  "position" integer NOT NULL DEFAULT 0,
  description text,
  deleted_at timestamp with time zone,
  status text NOT NULL DEFAULT 'active'::text,
  is_locked boolean NOT NULL DEFAULT false,
  kind text NOT NULL DEFAULT 'normal'::text,
  group_tasks boolean NOT NULL DEFAULT false,
  auto_assignee_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  default_task_type_id uuid
);
ALTER TABLE public.spaces ADD CONSTRAINT spaces_pkey PRIMARY KEY (id);

CREATE TABLE public.squad_note_shares (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  note_id uuid NOT NULL,
  grantee_type text NOT NULL,
  grantee_id uuid NOT NULL,
  access_level text NOT NULL DEFAULT 'read'::text,
  granted_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
ALTER TABLE public.squad_note_shares ADD CONSTRAINT squad_note_shares_pkey PRIMARY KEY (id);

CREATE TABLE public.squad_notes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  parent_id uuid,
  root_id uuid,
  title text NOT NULL DEFAULT 'Untitled'::text,
  icon text,
  cover_url text,
  text_size text NOT NULL DEFAULT 'normal'::text,
  full_width boolean NOT NULL DEFAULT false,
  content jsonb NOT NULL DEFAULT '{"type": "doc", "content": []}'::jsonb,
  "position" integer NOT NULL DEFAULT 0,
  owner_id uuid NOT NULL,
  visibility text NOT NULL DEFAULT 'private'::text,
  created_by uuid,
  last_edited_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  deleted_at timestamp with time zone
);
ALTER TABLE public.squad_notes ADD CONSTRAINT squad_notes_pkey PRIMARY KEY (id);

CREATE TABLE public.squadhire_sso_codes (
  code text NOT NULL,
  user_id uuid NOT NULL,
  email text NOT NULL,
  display_name text,
  user_type text NOT NULL,
  redirect_uri text NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  consumed_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
ALTER TABLE public.squadhire_sso_codes ADD CONSTRAINT squadhire_sso_codes_pkey PRIMARY KEY (code);

CREATE TABLE public.status_group_assignments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
ALTER TABLE public.status_group_assignments ADD CONSTRAINT status_group_assignments_pkey PRIMARY KEY (id);

CREATE TABLE public.status_group_statuses (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL,
  name text NOT NULL,
  color text NOT NULL DEFAULT '#6b7280'::text,
  "position" integer NOT NULL DEFAULT 0,
  is_default boolean NOT NULL DEFAULT false,
  category text NOT NULL DEFAULT 'todo'::text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  key text,
  description text NOT NULL DEFAULT ''::text,
  section text,
  section_label text,
  section_emoji text,
  is_system boolean NOT NULL DEFAULT false,
  is_placeholder boolean NOT NULL DEFAULT false,
  is_archived boolean NOT NULL DEFAULT false
);
ALTER TABLE public.status_group_statuses ADD CONSTRAINT status_group_statuses_pkey PRIMARY KEY (id);

CREATE TABLE public.status_groups (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  key text NOT NULL,
  name text NOT NULL,
  description text NOT NULL DEFAULT ''::text,
  icon text NOT NULL DEFAULT 'flag'::text,
  color text NOT NULL DEFAULT '#6b7280'::text,
  "position" integer NOT NULL DEFAULT 0,
  is_default boolean NOT NULL DEFAULT false,
  is_system boolean NOT NULL DEFAULT false,
  is_enabled boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  base_group_id uuid,
  custom_sections jsonb NOT NULL DEFAULT '[]'::jsonb,
  disabled_status_keys jsonb NOT NULL DEFAULT '[]'::jsonb,
  status_replacements jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_stage_workflow boolean NOT NULL DEFAULT false
);
ALTER TABLE public.status_groups ADD CONSTRAINT status_groups_pkey PRIMARY KEY (id);

CREATE TABLE public.task_activity (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL,
  user_id uuid,
  workspace_id uuid NOT NULL,
  event_type text NOT NULL,
  field text,
  old_value jsonb,
  new_value jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
ALTER TABLE public.task_activity ADD CONSTRAINT task_activity_pkey PRIMARY KEY (id);

CREATE TABLE public.task_attachments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL,
  object_key text NOT NULL,
  file_url text NOT NULL,
  file_name text NOT NULL,
  file_size bigint NOT NULL,
  mime_type text NOT NULL,
  uploaded_by uuid NOT NULL,
  uploaded_at timestamp with time zone NOT NULL DEFAULT now(),
  workspace_id uuid NOT NULL
);
ALTER TABLE public.task_attachments ADD CONSTRAINT task_attachments_pkey PRIMARY KEY (id);

CREATE TABLE public.task_checklist_items (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  checklist_id uuid NOT NULL,
  content text NOT NULL,
  is_done boolean NOT NULL DEFAULT false,
  "position" integer NOT NULL DEFAULT 0,
  assigned_to uuid,
  due_date date,
  completed_at timestamp with time zone,
  completed_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  workspace_id uuid NOT NULL
);
ALTER TABLE public.task_checklist_items ADD CONSTRAINT task_checklist_items_pkey PRIMARY KEY (id);

CREATE TABLE public.task_checklists (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL,
  title text NOT NULL DEFAULT 'Checklist'::text,
  "position" integer NOT NULL DEFAULT 0,
  created_by uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  workspace_id uuid NOT NULL
);
ALTER TABLE public.task_checklists ADD CONSTRAINT task_checklists_pkey PRIMARY KEY (id);

CREATE TABLE public.task_comments (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  task_id uuid NOT NULL,
  user_id uuid NOT NULL,
  content text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  mentions uuid[] NOT NULL DEFAULT '{}'::uuid[],
  workspace_id uuid NOT NULL
);
ALTER TABLE public.task_comments ADD CONSTRAINT task_comments_pkey PRIMARY KEY (id);

CREATE TABLE public.task_day_plans (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL,
  user_id uuid NOT NULL,
  plan_date date NOT NULL,
  start_minute integer NOT NULL,
  duration_minutes integer NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  workspace_id uuid NOT NULL
);
ALTER TABLE public.task_day_plans ADD CONSTRAINT task_day_plans_pkey PRIMARY KEY (id);

CREATE TABLE public.task_estimate_changes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL,
  user_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  old_estimate integer,
  new_estimate integer,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
ALTER TABLE public.task_estimate_changes ADD CONSTRAINT task_estimate_changes_pkey PRIMARY KEY (id);

CREATE TABLE public.task_list_links (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL,
  list_id uuid NOT NULL,
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  workspace_id uuid NOT NULL
);
ALTER TABLE public.task_list_links ADD CONSTRAINT task_list_links_pkey PRIMARY KEY (id);

CREATE TABLE public.task_reviews (
  task_id uuid NOT NULL,
  user_id uuid NOT NULL,
  reviewed_at timestamp with time zone NOT NULL DEFAULT now(),
  workspace_id uuid NOT NULL
);
ALTER TABLE public.task_reviews ADD CONSTRAINT task_reviews_pkey PRIMARY KEY (task_id, user_id);

CREATE TABLE public.task_tag_assignments (
  task_id uuid NOT NULL,
  tag_id uuid NOT NULL
);
ALTER TABLE public.task_tag_assignments ADD CONSTRAINT task_tag_assignments_pkey PRIMARY KEY (task_id, tag_id);

CREATE TABLE public.task_tags (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  name text NOT NULL,
  color text NOT NULL DEFAULT '#6b7280'::text,
  group_id uuid NOT NULL
);
ALTER TABLE public.task_tags ADD CONSTRAINT task_tags_pkey PRIMARY KEY (id);

CREATE TABLE public.task_time_entries (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL,
  user_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  started_at timestamp with time zone NOT NULL,
  stopped_at timestamp with time zone NOT NULL,
  duration_seconds integer NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT 'timer'::text,
  work_block_run_id uuid,
  note text,
  edited_at timestamp with time zone,
  edited_by uuid
);
ALTER TABLE public.task_time_entries ADD CONSTRAINT task_time_entries_pkey PRIMARY KEY (id);

CREATE TABLE public.task_type_fields (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  task_type_id uuid NOT NULL,
  key text NOT NULL,
  label text NOT NULL,
  field_type text NOT NULL,
  options jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_required boolean NOT NULL DEFAULT false,
  help_text text,
  placeholder text,
  "position" integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  help_url text,
  allow_other boolean NOT NULL DEFAULT false
);
ALTER TABLE public.task_type_fields ADD CONSTRAINT task_type_fields_pkey PRIMARY KEY (id);

CREATE TABLE public.task_type_group_assignments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
ALTER TABLE public.task_type_group_assignments ADD CONSTRAINT task_type_group_assignments_pkey PRIMARY KEY (id);

CREATE TABLE public.task_type_group_items (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL,
  task_type_id uuid NOT NULL,
  "position" integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
ALTER TABLE public.task_type_group_items ADD CONSTRAINT task_type_group_items_pkey PRIMARY KEY (id);

CREATE TABLE public.task_type_groups (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  key text NOT NULL,
  name text NOT NULL,
  description text NOT NULL DEFAULT ''::text,
  icon text NOT NULL DEFAULT 'check-square'::text,
  color text NOT NULL DEFAULT '#6b7280'::text,
  "position" integer NOT NULL DEFAULT 0,
  is_default boolean NOT NULL DEFAULT false,
  is_system boolean NOT NULL DEFAULT false,
  is_enabled boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);
ALTER TABLE public.task_type_groups ADD CONSTRAINT task_type_groups_pkey PRIMARY KEY (id);

CREATE TABLE public.task_type_role_access (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  task_type_id uuid NOT NULL,
  role_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
ALTER TABLE public.task_type_role_access ADD CONSTRAINT task_type_role_access_pkey PRIMARY KEY (id);

CREATE TABLE public.task_type_user_access (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  task_type_id uuid NOT NULL,
  user_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
ALTER TABLE public.task_type_user_access ADD CONSTRAINT task_type_user_access_pkey PRIMARY KEY (id);

CREATE TABLE public.task_types (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  key text NOT NULL,
  name text NOT NULL,
  description text,
  icon text NOT NULL DEFAULT 'check-square'::text,
  color text NOT NULL DEFAULT '#6b7280'::text,
  "position" integer NOT NULL DEFAULT 0,
  is_default boolean NOT NULL DEFAULT false,
  is_system boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  is_enabled boolean NOT NULL DEFAULT true,
  group_name text
);
ALTER TABLE public.task_types ADD CONSTRAINT task_types_pkey PRIMARY KEY (id);

CREATE TABLE public.tasks (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  list_id uuid NOT NULL,
  title text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'todo'::text,
  priority text NOT NULL DEFAULT 'none'::text,
  assignee_ids uuid[] DEFAULT '{}'::uuid[],
  due_date timestamp with time zone,
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  time_estimate integer,
  time_tracked integer NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  display_number integer,
  task_type_id uuid,
  work_date timestamp with time zone,
  start_date timestamp with time zone,
  parent_task_id uuid,
  last_modified_by uuid,
  focused_at timestamp with time zone,
  snoozed_until timestamp with time zone,
  recurrence jsonb,
  recurrence_paused boolean NOT NULL DEFAULT false,
  recurring_parent_id uuid,
  recurrence_instance_date date,
  source_kind text,
  source_id uuid,
  source_user_id uuid,
  created_via text NOT NULL DEFAULT 'unknown'::text,
  workspace_id uuid NOT NULL
);
ALTER TABLE public.tasks ADD CONSTRAINT tasks_pkey PRIMARY KEY (id);

CREATE TABLE public.timer_sessions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  date date NOT NULL,
  timer_type text NOT NULL,
  start_time timestamp with time zone NOT NULL DEFAULT now(),
  end_time timestamp with time zone,
  duration_seconds integer,
  is_auto_stopped boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  workspace_id uuid NOT NULL,
  context text NOT NULL DEFAULT 'default'::text,
  original_start_time timestamp with time zone,
  original_end_time timestamp with time zone,
  original_duration_seconds integer
);
ALTER TABLE public.timer_sessions ADD CONSTRAINT timer_sessions_pkey PRIMARY KEY (id);

CREATE TABLE public.user_checkin_settings (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  deadline_time text NOT NULL DEFAULT '10:00'::text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);
ALTER TABLE public.user_checkin_settings ADD CONSTRAINT user_checkin_settings_pkey PRIMARY KEY (id);

CREATE TABLE public.user_office_timing (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  label text NOT NULL,
  from_time text NOT NULL,
  to_time text NOT NULL,
  working_days jsonb NOT NULL DEFAULT '[1, 2, 3, 4, 5, 6]'::jsonb,
  max_break_minutes integer NOT NULL DEFAULT 60,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);
ALTER TABLE public.user_office_timing ADD CONSTRAINT user_office_timing_pkey PRIMARY KEY (id);

CREATE TABLE public.user_view_preferences (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);
ALTER TABLE public.user_view_preferences ADD CONSTRAINT user_view_preferences_pkey PRIMARY KEY (id);

CREATE TABLE public.web_push_subscriptions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  endpoint text NOT NULL,
  p256dh text NOT NULL,
  auth text NOT NULL,
  last_seen_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
ALTER TABLE public.web_push_subscriptions ADD CONSTRAINT web_push_subscriptions_pkey PRIMARY KEY (id);

CREATE TABLE public.whiteboards (
  view_id uuid NOT NULL,
  data jsonb NOT NULL DEFAULT '{"edges": [], "nodes": []}'::jsonb,
  updated_by uuid,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  workspace_id uuid NOT NULL
);
ALTER TABLE public.whiteboards ADD CONSTRAINT whiteboards_pkey PRIMARY KEY (view_id);

CREATE TABLE public.whiteboard_versions (
  id bigint NOT NULL DEFAULT nextval('whiteboard_versions_id_seq'::regclass),
  view_id uuid NOT NULL,
  data jsonb NOT NULL,
  node_count integer,
  edge_count integer,
  updated_by uuid,
  saved_at timestamp with time zone NOT NULL DEFAULT now()
);
ALTER TABLE public.whiteboard_versions ADD CONSTRAINT whiteboard_versions_pkey PRIMARY KEY (id);

CREATE TABLE public.list_whiteboards (
  list_id uuid NOT NULL,
  data jsonb NOT NULL DEFAULT '{"edges": [], "nodes": []}'::jsonb,
  updated_by uuid,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  workspace_id uuid NOT NULL
);
ALTER TABLE public.list_whiteboards ADD CONSTRAINT list_whiteboards_pkey PRIMARY KEY (list_id);

CREATE TABLE public.list_whiteboard_versions (
  id bigint NOT NULL DEFAULT nextval('list_whiteboard_versions_id_seq'::regclass),
  list_id uuid NOT NULL,
  data jsonb NOT NULL,
  node_count integer,
  edge_count integer,
  updated_by uuid,
  saved_at timestamp with time zone NOT NULL DEFAULT now()
);
ALTER TABLE public.list_whiteboard_versions ADD CONSTRAINT list_whiteboard_versions_pkey PRIMARY KEY (id);

CREATE TABLE public.task_reminder_deliveries (
  task_id uuid NOT NULL,
  user_id uuid NOT NULL,
  due_at timestamp with time zone NOT NULL,
  delivered_at timestamp with time zone NOT NULL DEFAULT now()
);
ALTER TABLE public.task_reminder_deliveries ADD CONSTRAINT task_reminder_deliveries_pkey PRIMARY KEY (task_id, user_id, due_at);

CREATE TABLE public.work_block_completions (
  run_id uuid NOT NULL,
  completed_task_id uuid NOT NULL,
  completed_at timestamp with time zone NOT NULL DEFAULT now()
);
ALTER TABLE public.work_block_completions ADD CONSTRAINT work_block_completions_pkey PRIMARY KEY (run_id, completed_task_id);

CREATE TABLE public.work_block_links (
  work_block_task_id uuid NOT NULL,
  linked_task_id uuid NOT NULL,
  linked_by uuid NOT NULL,
  "position" integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
ALTER TABLE public.work_block_links ADD CONSTRAINT work_block_links_pkey PRIMARY KEY (work_block_task_id, linked_task_id);

CREATE TABLE public.work_block_runs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL,
  user_id uuid NOT NULL,
  started_at timestamp with time zone NOT NULL DEFAULT now(),
  ended_at timestamp with time zone,
  duration_seconds integer,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  workspace_id uuid NOT NULL
);
ALTER TABLE public.work_block_runs ADD CONSTRAINT work_block_runs_pkey PRIMARY KEY (id);

CREATE TABLE public.work_block_task_times (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL,
  task_id uuid NOT NULL,
  started_at timestamp with time zone NOT NULL DEFAULT now(),
  ended_at timestamp with time zone,
  duration_seconds integer,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
ALTER TABLE public.work_block_task_times ADD CONSTRAINT work_block_task_times_pkey PRIMARY KEY (id);

CREATE TABLE public.work_blocks (
  task_id uuid NOT NULL,
  start_minute integer NOT NULL,
  end_minute integer NOT NULL,
  recurrence jsonb NOT NULL DEFAULT '{"kind": "none"}'::jsonb,
  notify_before_min smallint NOT NULL DEFAULT 5,
  notify_on_start boolean NOT NULL DEFAULT true,
  notify_on_end boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  workspace_id uuid NOT NULL
);
ALTER TABLE public.work_blocks ADD CONSTRAINT work_blocks_pkey PRIMARY KEY (task_id);

CREATE TABLE public.working_days_config (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  working_days jsonb NOT NULL DEFAULT '[1, 2, 3, 4, 5, 6]'::jsonb,
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);
ALTER TABLE public.working_days_config ADD CONSTRAINT working_days_config_pkey PRIMARY KEY (id);

CREATE TABLE public.workspace_member_secondary_roles (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_member_id uuid NOT NULL,
  role_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
ALTER TABLE public.workspace_member_secondary_roles ADD CONSTRAINT workspace_member_secondary_roles_pkey PRIMARY KEY (id);

CREATE TABLE public.workspace_members (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  workspace_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role text NOT NULL DEFAULT 'member'::text,
  role_id uuid
);
ALTER TABLE public.workspace_members ADD CONSTRAINT workspace_members_pkey PRIMARY KEY (id);

CREATE TABLE public.workspace_mini_apps (
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  slug text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, slug),
  CHECK (slug NOT IN ('cash-book', 'cashbook'))
);

-- Workspace invitations (SaaS shape: one invitation = one workspace + role).
CREATE TABLE public.invitations (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member', 'guest')),
  user_type text NOT NULL DEFAULT 'client'
    CHECK (user_type IN ('internal', 'client', 'client_staff', 'partner', 'partner_employee')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired', 'revoked')),
  invited_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_invitations_pending ON public.invitations (workspace_id, lower(email)) WHERE status = 'pending';
CREATE INDEX idx_invitations_email ON public.invitations (lower(email));
CREATE INDEX idx_invitations_workspace ON public.invitations (workspace_id);


-- ---------------------------------------------------------------- constraints
ALTER TABLE public.app_favorites ADD CONSTRAINT app_favorites_user_id_app_slug_key UNIQUE (user_id, app_slug);
ALTER TABLE public.checkin_configs ADD CONSTRAINT checkin_configs_role_id_key UNIQUE (role_id);
ALTER TABLE public.checkins ADD CONSTRAINT checkins_user_id_date_key UNIQUE (workspace_id, user_id, date);
ALTER TABLE public.daily_time_summaries ADD CONSTRAINT daily_time_summaries_user_workspace_context_date_key UNIQUE (user_id, workspace_id, context, date);
ALTER TABLE public.favorites ADD CONSTRAINT favorites_user_id_item_type_item_id_key UNIQUE (user_id, item_type, item_id);
ALTER TABLE public.goal_dependencies ADD CONSTRAINT goal_dependencies_goal_id_from_task_id_to_task_id_key UNIQUE (goal_id, from_task_id, to_task_id);
ALTER TABLE public.goal_sources ADD CONSTRAINT goal_sources_goal_id_resource_type_resource_id_key UNIQUE (goal_id, resource_type, resource_id);
ALTER TABLE public.group_day_plans ADD CONSTRAINT group_day_plans_container_type_container_id_user_id_plan_da_key UNIQUE (container_type, container_id, user_id, plan_date);
ALTER TABLE public.huddle_participants ADD CONSTRAINT huddle_participants_huddle_id_identity_key UNIQUE (huddle_id, identity);
ALTER TABLE public.huddles ADD CONSTRAINT huddles_code_key UNIQUE (code);
ALTER TABLE public.huddles ADD CONSTRAINT huddles_room_name_key UNIQUE (room_name);
ALTER TABLE public.label_create_role_access ADD CONSTRAINT label_create_role_access_workspace_id_role_id_key UNIQUE (workspace_id, role_id);
ALTER TABLE public.label_create_user_access ADD CONSTRAINT label_create_user_access_workspace_id_user_id_key UNIQUE (workspace_id, user_id);
ALTER TABLE public.label_group_role_access ADD CONSTRAINT label_group_role_access_group_id_role_id_key UNIQUE (group_id, role_id);
ALTER TABLE public.label_group_user_access ADD CONSTRAINT label_group_user_access_group_id_user_id_key UNIQUE (group_id, user_id);
ALTER TABLE public.label_groups ADD CONSTRAINT label_groups_workspace_id_name_key UNIQUE (workspace_id, name);
ALTER TABLE public.mini_apps ADD CONSTRAINT mini_apps_slug_key UNIQUE (slug);
ALTER TABLE public.partner_push_tokens ADD CONSTRAINT partner_push_tokens_user_id_token_key UNIQUE (user_id, token);
ALTER TABLE public.reactions ADD CONSTRAINT reactions_message_id_user_id_emoji_key UNIQUE (message_id, user_id, emoji);
ALTER TABLE public.resource_memberships ADD CONSTRAINT resource_memberships_resource_type_resource_id_user_id_key UNIQUE (resource_type, resource_id, user_id);
ALTER TABLE public.roles ADD CONSTRAINT roles_name_key UNIQUE (name);
ALTER TABLE public.skill_grants ADD CONSTRAINT skill_grants_skill_key_principal_type_principal_id_key UNIQUE (skill_key, principal_type, principal_id);
ALTER TABLE public.squad_note_shares ADD CONSTRAINT squad_note_shares_note_id_grantee_type_grantee_id_key UNIQUE (note_id, grantee_type, grantee_id);
ALTER TABLE public.status_group_assignments ADD CONSTRAINT status_group_assignments_entity_type_entity_id_key UNIQUE (entity_type, entity_id);
ALTER TABLE public.status_group_statuses ADD CONSTRAINT status_group_statuses_group_id_name_key UNIQUE (group_id, name);
ALTER TABLE public.status_groups ADD CONSTRAINT status_groups_key_key UNIQUE (key);
ALTER TABLE public.task_day_plans ADD CONSTRAINT task_day_plans_task_id_user_id_plan_date_key UNIQUE (task_id, user_id, plan_date);
ALTER TABLE public.task_list_links ADD CONSTRAINT task_list_links_task_id_list_id_key UNIQUE (task_id, list_id);
ALTER TABLE public.task_type_fields ADD CONSTRAINT task_type_fields_task_type_id_key_key UNIQUE (task_type_id, key);
ALTER TABLE public.task_type_group_assignments ADD CONSTRAINT task_type_group_assignments_entity_type_entity_id_key UNIQUE (entity_type, entity_id);
ALTER TABLE public.task_type_group_items ADD CONSTRAINT task_type_group_items_group_id_task_type_id_key UNIQUE (group_id, task_type_id);
ALTER TABLE public.task_type_groups ADD CONSTRAINT task_type_groups_key_key UNIQUE (key);
ALTER TABLE public.task_type_role_access ADD CONSTRAINT task_type_role_access_task_type_id_role_id_key UNIQUE (task_type_id, role_id);
ALTER TABLE public.task_type_user_access ADD CONSTRAINT task_type_user_access_task_type_id_user_id_key UNIQUE (task_type_id, user_id);
ALTER TABLE public.task_types ADD CONSTRAINT task_types_key_key UNIQUE (key);
ALTER TABLE public.user_checkin_settings ADD CONSTRAINT user_checkin_settings_user_id_key UNIQUE (user_id);
ALTER TABLE public.user_office_timing ADD CONSTRAINT user_office_timing_user_id_key UNIQUE (user_id);
ALTER TABLE public.user_view_preferences ADD CONSTRAINT user_view_preferences_user_id_key UNIQUE (user_id);
ALTER TABLE public.users ADD CONSTRAINT users_email_key UNIQUE (email);
ALTER TABLE public.web_push_subscriptions ADD CONSTRAINT web_push_subscriptions_user_id_endpoint_key UNIQUE (user_id, endpoint);
ALTER TABLE public.workspace_member_secondary_roles ADD CONSTRAINT workspace_member_secondary_role_workspace_member_id_role_id_key UNIQUE (workspace_member_id, role_id);
ALTER TABLE public.workspace_members ADD CONSTRAINT workspace_members_workspace_id_user_id_key UNIQUE (workspace_id, user_id);
ALTER TABLE public.channels ADD CONSTRAINT channels_linked_resource_type_check CHECK (((linked_resource_type IS NULL) OR (linked_resource_type = ANY (ARRAY['space'::text, 'folder'::text, 'list'::text, 'crm_deal'::text, 'crm_contact'::text, 'crm_lead'::text]))));
ALTER TABLE public.chat_scheduled_messages ADD CONSTRAINT chat_scheduled_messages_check CHECK (((channel_id IS NOT NULL) OR (dm_conversation_id IS NOT NULL)));
ALTER TABLE public.chat_scheduled_messages ADD CONSTRAINT chat_scheduled_messages_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'sent'::text, 'canceled'::text])));
ALTER TABLE public.checkins ADD CONSTRAINT checkins_status_check CHECK ((status = ANY (ARRAY['on_time'::text, 'late'::text, 'no_checkin'::text])));
ALTER TABLE public.favorites ADD CONSTRAINT favorites_item_type_check CHECK (((item_type)::text = ANY ((ARRAY['channel'::character varying, 'space'::character varying, 'folder'::character varying, 'list'::character varying, 'note'::character varying])::text[])));
ALTER TABLE public.feature_tip_states ADD CONSTRAINT feature_tip_states_status_check CHECK ((status = ANY (ARRAY['accepted'::text, 'dismissed'::text])));
ALTER TABLE public.feature_tips ADD CONSTRAINT feature_tips_platform_check CHECK ((platform = ANY (ARRAY['web'::text, 'app'::text])));
ALTER TABLE public.folders ADD CONSTRAINT folders_folder_type_check CHECK ((folder_type = ANY (ARRAY['folder'::text, 'client'::text])));
ALTER TABLE public.folders ADD CONSTRAINT folders_status_check CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text])));
ALTER TABLE public.goal_dependencies ADD CONSTRAINT goal_dependencies_check CHECK ((from_task_id <> to_task_id));
ALTER TABLE public.goal_dependencies ADD CONSTRAINT goal_dependencies_from_endpoint_check CHECK ((from_endpoint = ANY (ARRAY['start'::text, 'end'::text])));
ALTER TABLE public.goal_dependencies ADD CONSTRAINT goal_dependencies_to_endpoint_check CHECK ((to_endpoint = ANY (ARRAY['start'::text, 'end'::text])));
ALTER TABLE public.goal_projects ADD CONSTRAINT goal_projects_color_check CHECK ((color ~ '^#[0-9a-fA-F]{6}$'::text));
ALTER TABLE public.goal_projects ADD CONSTRAINT goal_projects_name_check CHECK (((length(btrim(name)) >= 1) AND (length(btrim(name)) <= 160)));
ALTER TABLE public.goal_sources ADD CONSTRAINT goal_sources_resource_type_check CHECK ((resource_type = ANY (ARRAY['folder'::text, 'list'::text])));
ALTER TABLE public.goals ADD CONSTRAINT goals_name_check CHECK (((length(btrim(name)) >= 1) AND (length(btrim(name)) <= 500)));
ALTER TABLE public.goals ADD CONSTRAINT goals_plan_range CHECK (((due_date IS NULL) OR (start_date IS NULL) OR (due_date >= start_date)));
ALTER TABLE public.goals ADD CONSTRAINT goals_priority_check CHECK ((priority = ANY (ARRAY['emergency'::text, 'top'::text, 'urgent'::text, 'high'::text, 'normal'::text, 'low'::text, 'none'::text])));
ALTER TABLE public.goals ADD CONSTRAINT goals_status_check CHECK ((status = ANY (ARRAY['planned'::text, 'in_progress'::text, 'on_hold'::text])));
ALTER TABLE public.goals ADD CONSTRAINT goals_work_range CHECK (((work_end_date IS NULL) OR (work_start_date IS NULL) OR (work_end_date >= work_start_date)));
ALTER TABLE public.group_day_plans ADD CONSTRAINT group_day_plans_container_type_check CHECK ((container_type = ANY (ARRAY['list'::text, 'folder'::text, 'space'::text])));
ALTER TABLE public.group_day_plans ADD CONSTRAINT group_day_plans_duration_minutes_check CHECK (((duration_minutes > 0) AND (duration_minutes <= 1440)));
ALTER TABLE public.group_day_plans ADD CONSTRAINT group_day_plans_start_minute_check CHECK (((start_minute >= 0) AND (start_minute <= 1439)));
ALTER TABLE public.holidays ADD CONSTRAINT holidays_recurring_day_check CHECK (((recurring_day >= 1) AND (recurring_day <= 31)));
ALTER TABLE public.holidays ADD CONSTRAINT holidays_recurring_month_check CHECK (((recurring_month >= 1) AND (recurring_month <= 12)));
ALTER TABLE public.huddles ADD CONSTRAINT huddles_check CHECK (((channel_id IS NOT NULL) OR (dm_conversation_id IS NOT NULL)));
ALTER TABLE public.label_requests ADD CONSTRAINT label_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])));
ALTER TABLE public.list_views ADD CONSTRAINT list_views_view_type_check CHECK ((view_type = ANY (ARRAY['list'::text, 'board'::text, 'whiteboard'::text])));
ALTER TABLE public.lists ADD CONSTRAINT lists_check CHECK (((folder_id IS NOT NULL) OR (space_id IS NOT NULL)));
ALTER TABLE public.lists ADD CONSTRAINT lists_status_check CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text])));
ALTER TABLE public.meeting_event_guests ADD CONSTRAINT meeting_event_guests_role_check CHECK ((role = ANY (ARRAY['host'::text, 'guest'::text])));
ALTER TABLE public.meeting_event_slots ADD CONSTRAINT meeting_event_slots_suggestion_status_check CHECK ((suggestion_status = ANY (ARRAY['pending'::text, 'accepted'::text, 'rejected'::text])));
ALTER TABLE public.meeting_events ADD CONSTRAINT meeting_events_kind_check CHECK ((kind = ANY (ARRAY['virtual'::text, 'in_person'::text, 'event'::text])));
ALTER TABLE public.meeting_events ADD CONSTRAINT meeting_events_link_provider_check CHECK ((link_provider = ANY (ARRAY['jitsi'::text, 'google_meet'::text, 'zoom'::text])));
ALTER TABLE public.meeting_events ADD CONSTRAINT meeting_events_status_check CHECK ((status = ANY (ARRAY['open'::text, 'confirmed'::text, 'cancelled'::text])));
ALTER TABLE public.meeting_slot_votes ADD CONSTRAINT meeting_slot_votes_vote_check CHECK ((vote = ANY (ARRAY['yes'::text, 'no'::text, 'maybe'::text])));
ALTER TABLE public.meeting_suggestion_responses ADD CONSTRAINT meeting_suggestion_responses_response_check CHECK ((response = ANY (ARRAY['confirm'::text, 'reject'::text])));
ALTER TABLE public.meetings ADD CONSTRAINT meetings_status_check CHECK ((status = ANY (ARRAY['scheduled'::text, 'done'::text, 'cancelled'::text])));
ALTER TABLE public.message_reads ADD CONSTRAINT message_reads_scope_type_check CHECK ((scope_type = ANY (ARRAY['channel'::text, 'dm'::text])));
ALTER TABLE public.messages ADD CONSTRAINT messages_check CHECK (((channel_id IS NOT NULL) OR (dm_conversation_id IS NOT NULL)));
ALTER TABLE public.messages ADD CONSTRAINT messages_type_check CHECK ((type = ANY (ARRAY['text'::text, 'image'::text, 'audio'::text, 'video'::text, 'file'::text])));
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check CHECK (((type = ANY (ARRAY['announcement'::text, 'task_assigned'::text, 'task_updated'::text, 'task_completed'::text, 'task_commented'::text, 'task_due_soon'::text, 'mention'::text, 'message_mention'::text, 'thread_reply'::text, 'dm_received'::text, 'reaction_added'::text, 'lms_assigned'::text, 'lms_updated'::text, 'lms_shared'::text, 'lms_review_requested'::text, 'lms_review_decided'::text, 'lms_comment'::text, 'meeting_invited'::text, 'meeting_suggestion'::text, 'meeting_suggestion_resolved'::text, 'meeting_confirmed'::text, 'meeting_cancelled'::text, 'support_ticket_reply'::text, 'support_ticket_assigned'::text, 'sop_flag'::text, 'sop_strike'::text, 'group_meet_invite'::text, 'group_meet_rescheduled'::text, 'group_meet_cancelled'::text, 'group_meet_join'::text, 'application_approved'::text, 'application_rejected'::text, 'application_restored'::text, 'new_card'::text, 'selected'::text, 'shortlisted'::text, 'cancelled'::text, 'unassigned'::text, 'assignment_offer'::text, 'job_new_card'::text, 'job_stage'::text, 'job_interview'::text, 'job_interview_confirm'::text, 'job_interview_start'::text, 'job_offer'::text, 'job_hired'::text, 'broadcast'::text])) OR (type = 'task_reminder'::text)));
ALTER TABLE public.partner_app_installs ADD CONSTRAINT partner_app_installs_platform_check CHECK ((platform = ANY (ARRAY['ios'::text, 'android'::text])));
ALTER TABLE public.partner_push_tokens ADD CONSTRAINT partner_push_tokens_platform_check CHECK ((platform = ANY (ARRAY['ios'::text, 'android'::text])));
ALTER TABLE public.resource_memberships ADD CONSTRAINT resource_memberships_access_level_check CHECK ((access_level = ANY (ARRAY['viewer'::text, 'commenter'::text, 'member'::text, 'manager'::text])));
ALTER TABLE public.resource_memberships ADD CONSTRAINT resource_memberships_resource_type_check CHECK ((resource_type = ANY (ARRAY['channel'::text, 'space'::text, 'folder'::text, 'list'::text])));
ALTER TABLE public.skill_grants ADD CONSTRAINT skill_grants_principal_type_check CHECK ((principal_type = ANY (ARRAY['user'::text, 'role'::text, 'user_type'::text])));
ALTER TABLE public.space_statuses ADD CONSTRAINT space_statuses_category_check CHECK ((category = ANY (ARRAY['todo'::text, 'active'::text, 'done'::text, 'closed'::text])));
ALTER TABLE public.spaces ADD CONSTRAINT spaces_kind_check CHECK ((kind = ANY (ARRAY['normal'::text, 'personal'::text, 'workspace'::text])));
ALTER TABLE public.spaces ADD CONSTRAINT spaces_status_check CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text])));
ALTER TABLE public.squad_note_shares ADD CONSTRAINT squad_note_shares_access_level_check CHECK ((access_level = ANY (ARRAY['read'::text, 'edit'::text])));
ALTER TABLE public.squad_note_shares ADD CONSTRAINT squad_note_shares_grantee_type_check CHECK (grantee_type = ANY (ARRAY['user'::text, 'role'::text]));
ALTER TABLE public.squad_notes ADD CONSTRAINT squad_notes_text_size_check CHECK ((text_size = ANY (ARRAY['small'::text, 'normal'::text, 'large'::text])));
ALTER TABLE public.squad_notes ADD CONSTRAINT squad_notes_visibility_check CHECK ((visibility = ANY (ARRAY['private'::text, 'shared'::text])));
ALTER TABLE public.status_group_assignments ADD CONSTRAINT status_group_assignments_entity_type_check CHECK ((entity_type = ANY (ARRAY['space'::text, 'folder'::text, 'list'::text, 'template'::text])));
ALTER TABLE public.status_group_statuses ADD CONSTRAINT status_group_statuses_category_check CHECK ((category = ANY (ARRAY['todo'::text, 'active'::text, 'done'::text, 'closed'::text])));
ALTER TABLE public.status_groups ADD CONSTRAINT status_groups_disabled_keys_array CHECK ((jsonb_typeof(disabled_status_keys) = 'array'::text));
ALTER TABLE public.status_groups ADD CONSTRAINT status_groups_no_self_inheritance CHECK ((base_group_id IS DISTINCT FROM id));
ALTER TABLE public.status_groups ADD CONSTRAINT status_groups_replacements_object CHECK ((jsonb_typeof(status_replacements) = 'object'::text));
ALTER TABLE public.status_groups ADD CONSTRAINT status_groups_sections_array CHECK ((jsonb_typeof(custom_sections) = 'array'::text));
ALTER TABLE public.task_day_plans ADD CONSTRAINT task_day_plans_duration_minutes_check CHECK (((duration_minutes > 0) AND (duration_minutes <= 1440)));
ALTER TABLE public.task_day_plans ADD CONSTRAINT task_day_plans_start_minute_check CHECK (((start_minute >= 0) AND (start_minute <= 1439)));
ALTER TABLE public.task_time_entries ADD CONSTRAINT task_time_entries_duration_seconds_check CHECK ((duration_seconds <> 0));
ALTER TABLE public.task_time_entries ADD CONSTRAINT task_time_entries_source_check CHECK ((source = ANY (ARRAY['timer'::text, 'manual'::text, 'work_block'::text])));
ALTER TABLE public.task_type_fields ADD CONSTRAINT task_type_fields_field_type_check CHECK ((field_type = ANY (ARRAY['text'::text, 'textarea'::text, 'select'::text, 'multi_select'::text, 'number'::text, 'date'::text, 'url'::text, 'checkbox'::text])));
ALTER TABLE public.task_type_group_assignments ADD CONSTRAINT task_type_group_assignments_entity_type_check CHECK ((entity_type = ANY (ARRAY['space'::text, 'folder'::text, 'list'::text, 'template'::text])));
ALTER TABLE public.tasks ADD CONSTRAINT tasks_created_via_check CHECK ((created_via = ANY (ARRAY['web'::text, 'mobile_web'::text, 'desktop_app'::text, 'companion'::text, 'partner_app'::text, 'internal_app'::text, 'business_app'::text, 'mobile_app'::text, 'public_form'::text, 'system'::text, 'api'::text, 'unknown'::text])));
ALTER TABLE public.tasks ADD CONSTRAINT tasks_priority_check CHECK ((priority = ANY (ARRAY['emergency'::text, 'top'::text, 'urgent'::text, 'high'::text, 'normal'::text, 'low'::text, 'none'::text])));
ALTER TABLE public.timer_sessions ADD CONSTRAINT timer_sessions_timer_type_check CHECK ((timer_type = ANY (ARRAY['work'::text, 'break'::text, 'no_work'::text])));
ALTER TABLE public.user_office_timing ADD CONSTRAINT user_office_timing_break_bounds CHECK (((max_break_minutes >= 0) AND (max_break_minutes <= 720)));
ALTER TABLE public.user_office_timing ADD CONSTRAINT user_office_timing_from_format CHECK ((from_time ~ '^[0-2][0-9]:[0-5][0-9]$'::text));
ALTER TABLE public.user_office_timing ADD CONSTRAINT user_office_timing_label_len CHECK (((char_length(label) >= 1) AND (char_length(label) <= 80)));
ALTER TABLE public.user_office_timing ADD CONSTRAINT user_office_timing_range CHECK ((from_time < to_time));
ALTER TABLE public.user_office_timing ADD CONSTRAINT user_office_timing_to_format CHECK ((to_time ~ '^[0-2][0-9]:[0-5][0-9]$'::text));
ALTER TABLE public.users ADD CONSTRAINT users_status_check CHECK ((status = ANY (ARRAY['active'::text, 'pending'::text, 'rejected'::text, 'banned'::text, 'suspended'::text])));
ALTER TABLE public.users ADD CONSTRAINT users_user_type_check CHECK ((user_type = ANY (ARRAY['internal'::text, 'client'::text, 'client_staff'::text, 'partner'::text, 'partner_employee'::text])));
ALTER TABLE public.work_block_links ADD CONSTRAINT work_block_links_check CHECK ((work_block_task_id <> linked_task_id));
ALTER TABLE public.work_blocks ADD CONSTRAINT work_blocks_check CHECK ((((end_minute >= 1) AND (end_minute <= 1440)) AND (end_minute > start_minute)));
ALTER TABLE public.work_blocks ADD CONSTRAINT work_blocks_notify_before_min_check CHECK (((notify_before_min >= 0) AND (notify_before_min <= 60)));
ALTER TABLE public.work_blocks ADD CONSTRAINT work_blocks_start_minute_check CHECK (((start_minute >= 0) AND (start_minute <= 1439)));
ALTER TABLE public.workspace_members ADD CONSTRAINT workspace_members_role_check CHECK (role = ANY (ARRAY['owner'::text, 'admin'::text, 'member'::text, 'guest'::text]));
ALTER TABLE public.app_favorites ADD CONSTRAINT app_favorites_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE public.channels ADD CONSTRAINT channels_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.channels ADD CONSTRAINT channels_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.chat_scheduled_messages ADD CONSTRAINT chat_scheduled_messages_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE;
ALTER TABLE public.chat_scheduled_messages ADD CONSTRAINT chat_scheduled_messages_dm_conversation_id_fkey FOREIGN KEY (dm_conversation_id) REFERENCES dm_conversations(id) ON DELETE CASCADE;
ALTER TABLE public.chat_scheduled_messages ADD CONSTRAINT chat_scheduled_messages_parent_message_id_fkey FOREIGN KEY (parent_message_id) REFERENCES messages(id) ON DELETE CASCADE;
ALTER TABLE public.chat_scheduled_messages ADD CONSTRAINT chat_scheduled_messages_sent_message_id_fkey FOREIGN KEY (sent_message_id) REFERENCES messages(id);
ALTER TABLE public.chat_scheduled_messages ADD CONSTRAINT chat_scheduled_messages_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE public.checkin_configs ADD CONSTRAINT checkin_configs_role_id_fkey FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE;
ALTER TABLE public.checkins ADD CONSTRAINT checkins_role_id_fkey FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE SET NULL;
ALTER TABLE public.checkins ADD CONSTRAINT checkins_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE public.daily_time_summaries ADD CONSTRAINT daily_time_summaries_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.daily_time_summaries ADD CONSTRAINT daily_time_summaries_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.dm_conversations ADD CONSTRAINT dm_conversations_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.dm_participants ADD CONSTRAINT dm_participants_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES dm_conversations(id) ON DELETE CASCADE;
ALTER TABLE public.dm_participants ADD CONSTRAINT dm_participants_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE public.favorites ADD CONSTRAINT favorites_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.favorites ADD CONSTRAINT favorites_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.feature_tip_states ADD CONSTRAINT feature_tip_states_tip_id_fkey FOREIGN KEY (tip_id) REFERENCES feature_tips(id) ON DELETE CASCADE;
ALTER TABLE public.feature_tip_states ADD CONSTRAINT feature_tip_states_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE public.feature_tips ADD CONSTRAINT feature_tips_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.folders ADD CONSTRAINT folders_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);
ALTER TABLE public.folders ADD CONSTRAINT folders_default_task_type_id_fkey FOREIGN KEY (default_task_type_id) REFERENCES task_types(id) ON DELETE SET NULL;
ALTER TABLE public.folders ADD CONSTRAINT folders_parent_folder_id_fkey FOREIGN KEY (parent_folder_id) REFERENCES folders(id) ON DELETE CASCADE;
ALTER TABLE public.folders ADD CONSTRAINT folders_space_id_fkey FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE;
ALTER TABLE public.goal_dependencies ADD CONSTRAINT goal_dependencies_goal_id_fkey FOREIGN KEY (goal_id) REFERENCES goals(id) ON DELETE CASCADE;
ALTER TABLE public.goal_dependencies ADD CONSTRAINT goal_dependencies_goal_id_from_task_id_fkey FOREIGN KEY (goal_id, from_task_id) REFERENCES goal_tasks(goal_id, task_id) ON DELETE CASCADE;
ALTER TABLE public.goal_dependencies ADD CONSTRAINT goal_dependencies_goal_id_to_task_id_fkey FOREIGN KEY (goal_id, to_task_id) REFERENCES goal_tasks(goal_id, task_id) ON DELETE CASCADE;
ALTER TABLE public.goal_projects ADD CONSTRAINT goal_projects_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id);
ALTER TABLE public.goal_projects ADD CONSTRAINT goal_projects_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.goal_sources ADD CONSTRAINT goal_sources_goal_id_fkey FOREIGN KEY (goal_id) REFERENCES goals(id) ON DELETE CASCADE;
ALTER TABLE public.goal_tasks ADD CONSTRAINT goal_tasks_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.goal_tasks ADD CONSTRAINT goal_tasks_goal_id_fkey FOREIGN KEY (goal_id) REFERENCES goals(id) ON DELETE CASCADE;
ALTER TABLE public.goal_tasks ADD CONSTRAINT goal_tasks_task_id_fkey FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE;
ALTER TABLE public.goals ADD CONSTRAINT goals_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id);
ALTER TABLE public.goals ADD CONSTRAINT goals_project_id_fkey FOREIGN KEY (project_id) REFERENCES goal_projects(id) ON DELETE CASCADE;
ALTER TABLE public.goals ADD CONSTRAINT goals_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.group_day_plans ADD CONSTRAINT group_day_plans_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE public.group_run_completions ADD CONSTRAINT group_run_completions_completed_task_id_fkey FOREIGN KEY (completed_task_id) REFERENCES tasks(id) ON DELETE CASCADE;
ALTER TABLE public.group_run_completions ADD CONSTRAINT group_run_completions_run_id_fkey FOREIGN KEY (run_id) REFERENCES group_runs(id) ON DELETE CASCADE;
ALTER TABLE public.group_run_task_times ADD CONSTRAINT group_run_task_times_run_id_fkey FOREIGN KEY (run_id) REFERENCES group_runs(id) ON DELETE CASCADE;
ALTER TABLE public.group_run_task_times ADD CONSTRAINT group_run_task_times_task_id_fkey FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE;
ALTER TABLE public.group_runs ADD CONSTRAINT group_runs_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE public.group_runs ADD CONSTRAINT group_runs_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE SET NULL;
ALTER TABLE public.huddle_participants ADD CONSTRAINT huddle_participants_huddle_id_fkey FOREIGN KEY (huddle_id) REFERENCES huddles(id) ON DELETE CASCADE;
ALTER TABLE public.huddle_participants ADD CONSTRAINT huddle_participants_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.huddles ADD CONSTRAINT huddles_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE SET NULL;
ALTER TABLE public.huddles ADD CONSTRAINT huddles_dm_conversation_id_fkey FOREIGN KEY (dm_conversation_id) REFERENCES dm_conversations(id) ON DELETE SET NULL;
ALTER TABLE public.huddles ADD CONSTRAINT huddles_started_by_fkey FOREIGN KEY (started_by) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE public.label_create_role_access ADD CONSTRAINT label_create_role_access_role_id_fkey FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE;
ALTER TABLE public.label_create_role_access ADD CONSTRAINT label_create_role_access_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.label_create_user_access ADD CONSTRAINT label_create_user_access_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE public.label_create_user_access ADD CONSTRAINT label_create_user_access_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.label_group_role_access ADD CONSTRAINT label_group_role_access_group_id_fkey FOREIGN KEY (group_id) REFERENCES label_groups(id) ON DELETE CASCADE;
ALTER TABLE public.label_group_role_access ADD CONSTRAINT label_group_role_access_role_id_fkey FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE;
ALTER TABLE public.label_group_user_access ADD CONSTRAINT label_group_user_access_group_id_fkey FOREIGN KEY (group_id) REFERENCES label_groups(id) ON DELETE CASCADE;
ALTER TABLE public.label_group_user_access ADD CONSTRAINT label_group_user_access_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE public.label_groups ADD CONSTRAINT label_groups_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.label_groups ADD CONSTRAINT label_groups_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.label_requests ADD CONSTRAINT label_requests_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.label_requests ADD CONSTRAINT label_requests_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.label_requests ADD CONSTRAINT label_requests_resolved_label_id_fkey FOREIGN KEY (resolved_label_id) REFERENCES task_tags(id) ON DELETE SET NULL;
ALTER TABLE public.label_requests ADD CONSTRAINT label_requests_suggested_group_id_fkey FOREIGN KEY (suggested_group_id) REFERENCES label_groups(id) ON DELETE SET NULL;
ALTER TABLE public.label_requests ADD CONSTRAINT label_requests_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.list_views ADD CONSTRAINT list_views_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.list_views ADD CONSTRAINT list_views_list_id_fkey FOREIGN KEY (list_id) REFERENCES lists(id) ON DELETE CASCADE;
ALTER TABLE public.list_views ADD CONSTRAINT list_views_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE public.list_whiteboard_versions ADD CONSTRAINT list_whiteboard_versions_list_id_fkey FOREIGN KEY (list_id) REFERENCES lists(id) ON DELETE CASCADE;
ALTER TABLE public.list_whiteboard_versions ADD CONSTRAINT list_whiteboard_versions_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.list_whiteboards ADD CONSTRAINT list_whiteboards_list_id_fkey FOREIGN KEY (list_id) REFERENCES lists(id) ON DELETE CASCADE;
ALTER TABLE public.list_whiteboards ADD CONSTRAINT list_whiteboards_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.lists ADD CONSTRAINT lists_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);
ALTER TABLE public.lists ADD CONSTRAINT lists_default_task_type_id_fkey FOREIGN KEY (default_task_type_id) REFERENCES task_types(id) ON DELETE SET NULL;
ALTER TABLE public.lists ADD CONSTRAINT lists_folder_id_fkey FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE CASCADE;
ALTER TABLE public.lists ADD CONSTRAINT lists_space_id_fkey FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE;
ALTER TABLE public.meeting_event_attachments ADD CONSTRAINT meeting_event_attachments_meeting_event_id_fkey FOREIGN KEY (meeting_event_id) REFERENCES meeting_events(id) ON DELETE CASCADE;
ALTER TABLE public.meeting_event_attachments ADD CONSTRAINT meeting_event_attachments_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.meeting_event_guests ADD CONSTRAINT meeting_event_guests_meeting_event_id_fkey FOREIGN KEY (meeting_event_id) REFERENCES meeting_events(id) ON DELETE CASCADE;
ALTER TABLE public.meeting_event_guests ADD CONSTRAINT meeting_event_guests_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE public.meeting_event_slots ADD CONSTRAINT meeting_event_slots_meeting_event_id_fkey FOREIGN KEY (meeting_event_id) REFERENCES meeting_events(id) ON DELETE CASCADE;
ALTER TABLE public.meeting_event_slots ADD CONSTRAINT meeting_event_slots_suggested_by_fkey FOREIGN KEY (suggested_by) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.meeting_events ADD CONSTRAINT meeting_events_confirmed_slot_fk FOREIGN KEY (confirmed_slot_id) REFERENCES meeting_event_slots(id) ON DELETE SET NULL;
ALTER TABLE public.meeting_events ADD CONSTRAINT meeting_events_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.meeting_slot_votes ADD CONSTRAINT meeting_slot_votes_slot_id_fkey FOREIGN KEY (slot_id) REFERENCES meeting_event_slots(id) ON DELETE CASCADE;
ALTER TABLE public.meeting_slot_votes ADD CONSTRAINT meeting_slot_votes_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE public.meeting_suggestion_responses ADD CONSTRAINT meeting_suggestion_responses_slot_id_fkey FOREIGN KEY (slot_id) REFERENCES meeting_event_slots(id) ON DELETE CASCADE;
ALTER TABLE public.meeting_suggestion_responses ADD CONSTRAINT meeting_suggestion_responses_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE public.meetings ADD CONSTRAINT meetings_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.message_edits ADD CONSTRAINT message_edits_editor_id_fkey FOREIGN KEY (editor_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.message_edits ADD CONSTRAINT message_edits_message_id_fkey FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE;
ALTER TABLE public.message_reads ADD CONSTRAINT message_reads_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE public.message_threads ADD CONSTRAINT message_threads_parent_message_id_fkey FOREIGN KEY (parent_message_id) REFERENCES messages(id) ON DELETE CASCADE;
ALTER TABLE public.message_threads ADD CONSTRAINT message_threads_reply_message_id_fkey FOREIGN KEY (reply_message_id) REFERENCES messages(id) ON DELETE CASCADE;
ALTER TABLE public.messages ADD CONSTRAINT messages_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE;
ALTER TABLE public.messages ADD CONSTRAINT messages_dm_conversation_id_fkey FOREIGN KEY (dm_conversation_id) REFERENCES dm_conversations(id) ON DELETE CASCADE;
ALTER TABLE public.messages ADD CONSTRAINT messages_huddle_id_fkey FOREIGN KEY (huddle_id) REFERENCES huddles(id) ON DELETE SET NULL;
ALTER TABLE public.messages ADD CONSTRAINT messages_meeting_event_id_fkey FOREIGN KEY (meeting_event_id) REFERENCES meeting_events(id) ON DELETE SET NULL;
ALTER TABLE public.messages ADD CONSTRAINT messages_parent_message_id_fkey FOREIGN KEY (parent_message_id) REFERENCES messages(id) ON DELETE CASCADE;
ALTER TABLE public.messages ADD CONSTRAINT messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE public.partner_app_installs ADD CONSTRAINT partner_app_installs_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE public.partner_push_tokens ADD CONSTRAINT partner_push_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE public.reactions ADD CONSTRAINT reactions_message_id_fkey FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE;
ALTER TABLE public.reactions ADD CONSTRAINT reactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE public.resource_memberships ADD CONSTRAINT resource_memberships_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.resource_memberships ADD CONSTRAINT resource_memberships_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE public.skill_grants ADD CONSTRAINT skill_grants_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.space_statuses ADD CONSTRAINT space_statuses_space_id_fkey FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE;
ALTER TABLE public.spaces ADD CONSTRAINT spaces_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);
ALTER TABLE public.spaces ADD CONSTRAINT spaces_default_task_type_id_fkey FOREIGN KEY (default_task_type_id) REFERENCES task_types(id) ON DELETE SET NULL;
ALTER TABLE public.spaces ADD CONSTRAINT spaces_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.squad_note_shares ADD CONSTRAINT squad_note_shares_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.squad_note_shares ADD CONSTRAINT squad_note_shares_note_id_fkey FOREIGN KEY (note_id) REFERENCES squad_notes(id) ON DELETE CASCADE;
ALTER TABLE public.squad_notes ADD CONSTRAINT squad_notes_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.squad_notes ADD CONSTRAINT squad_notes_last_edited_by_fkey FOREIGN KEY (last_edited_by) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.squad_notes ADD CONSTRAINT squad_notes_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE public.squad_notes ADD CONSTRAINT squad_notes_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES squad_notes(id) ON DELETE CASCADE;
ALTER TABLE public.squad_notes ADD CONSTRAINT squad_notes_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.squadhire_sso_codes ADD CONSTRAINT squadhire_sso_codes_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE public.status_group_assignments ADD CONSTRAINT status_group_assignments_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.status_group_assignments ADD CONSTRAINT status_group_assignments_group_id_fkey FOREIGN KEY (group_id) REFERENCES status_groups(id) ON DELETE CASCADE;
ALTER TABLE public.status_group_statuses ADD CONSTRAINT status_group_statuses_group_id_fkey FOREIGN KEY (group_id) REFERENCES status_groups(id) ON DELETE CASCADE;
ALTER TABLE public.status_groups ADD CONSTRAINT status_groups_base_group_id_fkey FOREIGN KEY (base_group_id) REFERENCES status_groups(id) ON DELETE RESTRICT;
ALTER TABLE public.task_activity ADD CONSTRAINT task_activity_task_id_fkey FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE;
ALTER TABLE public.task_activity ADD CONSTRAINT task_activity_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.task_activity ADD CONSTRAINT task_activity_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.task_attachments ADD CONSTRAINT task_attachments_task_id_fkey FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE;
ALTER TABLE public.task_attachments ADD CONSTRAINT task_attachments_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES users(id);
ALTER TABLE public.task_checklist_items ADD CONSTRAINT task_checklist_items_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.task_checklist_items ADD CONSTRAINT task_checklist_items_checklist_id_fkey FOREIGN KEY (checklist_id) REFERENCES task_checklists(id) ON DELETE CASCADE;
ALTER TABLE public.task_checklist_items ADD CONSTRAINT task_checklist_items_completed_by_fkey FOREIGN KEY (completed_by) REFERENCES users(id);
ALTER TABLE public.task_checklists ADD CONSTRAINT task_checklists_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id);
ALTER TABLE public.task_checklists ADD CONSTRAINT task_checklists_task_id_fkey FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE;
ALTER TABLE public.task_comments ADD CONSTRAINT task_comments_task_id_fkey FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE;
ALTER TABLE public.task_comments ADD CONSTRAINT task_comments_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE public.task_day_plans ADD CONSTRAINT task_day_plans_task_id_fkey FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE;
ALTER TABLE public.task_day_plans ADD CONSTRAINT task_day_plans_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE public.task_estimate_changes ADD CONSTRAINT task_estimate_changes_task_id_fkey FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE;
ALTER TABLE public.task_estimate_changes ADD CONSTRAINT task_estimate_changes_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.task_estimate_changes ADD CONSTRAINT task_estimate_changes_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.task_list_links ADD CONSTRAINT task_list_links_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.task_list_links ADD CONSTRAINT task_list_links_list_id_fkey FOREIGN KEY (list_id) REFERENCES lists(id) ON DELETE CASCADE;
ALTER TABLE public.task_list_links ADD CONSTRAINT task_list_links_task_id_fkey FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE;
ALTER TABLE public.task_reminder_deliveries ADD CONSTRAINT task_reminder_deliveries_task_id_fkey FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE;
ALTER TABLE public.task_reminder_deliveries ADD CONSTRAINT task_reminder_deliveries_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE public.task_reviews ADD CONSTRAINT task_reviews_task_id_fkey FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE;
ALTER TABLE public.task_reviews ADD CONSTRAINT task_reviews_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE public.task_tag_assignments ADD CONSTRAINT task_tag_assignments_tag_id_fkey FOREIGN KEY (tag_id) REFERENCES task_tags(id) ON DELETE CASCADE;
ALTER TABLE public.task_tag_assignments ADD CONSTRAINT task_tag_assignments_task_id_fkey FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE;
ALTER TABLE public.task_tags ADD CONSTRAINT task_tags_group_id_fkey FOREIGN KEY (group_id) REFERENCES label_groups(id) ON DELETE RESTRICT;
ALTER TABLE public.task_tags ADD CONSTRAINT task_tags_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.task_time_entries ADD CONSTRAINT task_time_entries_edited_by_fkey FOREIGN KEY (edited_by) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.task_time_entries ADD CONSTRAINT task_time_entries_task_id_fkey FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE;
ALTER TABLE public.task_time_entries ADD CONSTRAINT task_time_entries_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.task_time_entries ADD CONSTRAINT task_time_entries_work_block_run_id_fkey FOREIGN KEY (work_block_run_id) REFERENCES work_block_runs(id) ON DELETE SET NULL;
ALTER TABLE public.task_time_entries ADD CONSTRAINT task_time_entries_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.task_type_fields ADD CONSTRAINT task_type_fields_task_type_id_fkey FOREIGN KEY (task_type_id) REFERENCES task_types(id) ON DELETE CASCADE;
ALTER TABLE public.task_type_group_assignments ADD CONSTRAINT task_type_group_assignments_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.task_type_group_assignments ADD CONSTRAINT task_type_group_assignments_group_id_fkey FOREIGN KEY (group_id) REFERENCES task_type_groups(id) ON DELETE CASCADE;
ALTER TABLE public.task_type_group_items ADD CONSTRAINT task_type_group_items_group_id_fkey FOREIGN KEY (group_id) REFERENCES task_type_groups(id) ON DELETE CASCADE;
ALTER TABLE public.task_type_group_items ADD CONSTRAINT task_type_group_items_task_type_id_fkey FOREIGN KEY (task_type_id) REFERENCES task_types(id) ON DELETE CASCADE;
ALTER TABLE public.task_type_role_access ADD CONSTRAINT task_type_role_access_role_id_fkey FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE;
ALTER TABLE public.task_type_role_access ADD CONSTRAINT task_type_role_access_task_type_id_fkey FOREIGN KEY (task_type_id) REFERENCES task_types(id) ON DELETE CASCADE;
ALTER TABLE public.task_type_user_access ADD CONSTRAINT task_type_user_access_task_type_id_fkey FOREIGN KEY (task_type_id) REFERENCES task_types(id) ON DELETE CASCADE;
ALTER TABLE public.task_type_user_access ADD CONSTRAINT task_type_user_access_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE public.tasks ADD CONSTRAINT tasks_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.tasks ADD CONSTRAINT tasks_last_modified_by_fkey FOREIGN KEY (last_modified_by) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.tasks ADD CONSTRAINT tasks_list_id_fkey FOREIGN KEY (list_id) REFERENCES lists(id) ON DELETE CASCADE;
ALTER TABLE public.tasks ADD CONSTRAINT tasks_parent_task_id_fkey FOREIGN KEY (parent_task_id) REFERENCES tasks(id) ON DELETE CASCADE;
ALTER TABLE public.tasks ADD CONSTRAINT tasks_recurring_parent_id_fkey FOREIGN KEY (recurring_parent_id) REFERENCES tasks(id) ON DELETE SET NULL;
ALTER TABLE public.tasks ADD CONSTRAINT tasks_task_type_id_fkey FOREIGN KEY (task_type_id) REFERENCES task_types(id) ON DELETE SET NULL;
ALTER TABLE public.timer_sessions ADD CONSTRAINT timer_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.timer_sessions ADD CONSTRAINT timer_sessions_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.user_checkin_settings ADD CONSTRAINT user_checkin_settings_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE public.user_office_timing ADD CONSTRAINT user_office_timing_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE public.user_view_preferences ADD CONSTRAINT user_view_preferences_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE public.web_push_subscriptions ADD CONSTRAINT web_push_subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE public.whiteboard_versions ADD CONSTRAINT whiteboard_versions_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.whiteboard_versions ADD CONSTRAINT whiteboard_versions_view_id_fkey FOREIGN KEY (view_id) REFERENCES list_views(id) ON DELETE CASCADE;
ALTER TABLE public.whiteboards ADD CONSTRAINT whiteboards_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.whiteboards ADD CONSTRAINT whiteboards_view_id_fkey FOREIGN KEY (view_id) REFERENCES list_views(id) ON DELETE CASCADE;
ALTER TABLE public.work_block_completions ADD CONSTRAINT work_block_completions_completed_task_id_fkey FOREIGN KEY (completed_task_id) REFERENCES tasks(id) ON DELETE CASCADE;
ALTER TABLE public.work_block_completions ADD CONSTRAINT work_block_completions_run_id_fkey FOREIGN KEY (run_id) REFERENCES work_block_runs(id) ON DELETE CASCADE;
ALTER TABLE public.work_block_links ADD CONSTRAINT work_block_links_linked_by_fkey FOREIGN KEY (linked_by) REFERENCES users(id);
ALTER TABLE public.work_block_links ADD CONSTRAINT work_block_links_linked_task_id_fkey FOREIGN KEY (linked_task_id) REFERENCES tasks(id) ON DELETE CASCADE;
ALTER TABLE public.work_block_links ADD CONSTRAINT work_block_links_work_block_task_id_fkey FOREIGN KEY (work_block_task_id) REFERENCES tasks(id) ON DELETE CASCADE;
ALTER TABLE public.work_block_runs ADD CONSTRAINT work_block_runs_task_id_fkey FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE;
ALTER TABLE public.work_block_runs ADD CONSTRAINT work_block_runs_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE public.work_block_task_times ADD CONSTRAINT work_block_task_times_run_id_fkey FOREIGN KEY (run_id) REFERENCES work_block_runs(id) ON DELETE CASCADE;
ALTER TABLE public.work_block_task_times ADD CONSTRAINT work_block_task_times_task_id_fkey FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE;
ALTER TABLE public.work_blocks ADD CONSTRAINT work_blocks_task_id_fkey FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE;
ALTER TABLE public.workspace_member_secondary_roles ADD CONSTRAINT workspace_member_secondary_roles_role_id_fkey FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE;
ALTER TABLE public.workspace_member_secondary_roles ADD CONSTRAINT workspace_member_secondary_roles_workspace_member_id_fkey FOREIGN KEY (workspace_member_id) REFERENCES workspace_members(id) ON DELETE CASCADE;
ALTER TABLE public.workspace_members ADD CONSTRAINT workspace_members_role_id_fkey FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE SET NULL;
ALTER TABLE public.workspace_members ADD CONSTRAINT workspace_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE public.workspace_members ADD CONSTRAINT workspace_members_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

-- ---------------------------------------------------------------- workspace_id FKs + indexes
ALTER TABLE public.chat_scheduled_messages ADD CONSTRAINT chat_scheduled_messages_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.checkins ADD CONSTRAINT checkins_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.folders ADD CONSTRAINT folders_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.goal_tasks ADD CONSTRAINT goal_tasks_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.group_day_plans ADD CONSTRAINT group_day_plans_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.huddles ADD CONSTRAINT huddles_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.list_views ADD CONSTRAINT list_views_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.list_whiteboards ADD CONSTRAINT list_whiteboards_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.lists ADD CONSTRAINT lists_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.meeting_events ADD CONSTRAINT meeting_events_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.meetings ADD CONSTRAINT meetings_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.messages ADD CONSTRAINT messages_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.reactions ADD CONSTRAINT reactions_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.resource_memberships ADD CONSTRAINT resource_memberships_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.space_statuses ADD CONSTRAINT space_statuses_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.task_attachments ADD CONSTRAINT task_attachments_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.task_checklist_items ADD CONSTRAINT task_checklist_items_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.task_checklists ADD CONSTRAINT task_checklists_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.task_comments ADD CONSTRAINT task_comments_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.task_day_plans ADD CONSTRAINT task_day_plans_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.task_list_links ADD CONSTRAINT task_list_links_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.task_reviews ADD CONSTRAINT task_reviews_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.tasks ADD CONSTRAINT tasks_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.whiteboards ADD CONSTRAINT whiteboards_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.work_block_runs ADD CONSTRAINT work_block_runs_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.work_blocks ADD CONSTRAINT work_blocks_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
CREATE INDEX idx_chat_scheduled_messages_workspace ON public.chat_scheduled_messages (workspace_id);
CREATE INDEX idx_checkins_workspace ON public.checkins (workspace_id);
CREATE INDEX idx_folders_workspace ON public.folders (workspace_id);
CREATE INDEX idx_goal_tasks_workspace ON public.goal_tasks (workspace_id);
CREATE INDEX idx_group_day_plans_workspace ON public.group_day_plans (workspace_id);
CREATE INDEX idx_group_runs_workspace ON public.group_runs (workspace_id);
CREATE INDEX idx_huddles_workspace ON public.huddles (workspace_id);
CREATE INDEX idx_label_create_role_access_workspace ON public.label_create_role_access (workspace_id);
CREATE INDEX idx_label_create_user_access_workspace ON public.label_create_user_access (workspace_id);
CREATE INDEX idx_list_views_workspace ON public.list_views (workspace_id);
CREATE INDEX idx_list_whiteboards_workspace ON public.list_whiteboards (workspace_id);
CREATE INDEX idx_lists_workspace ON public.lists (workspace_id);
CREATE INDEX idx_meeting_events_workspace ON public.meeting_events (workspace_id);
CREATE INDEX idx_meetings_workspace ON public.meetings (workspace_id);
CREATE INDEX idx_messages_workspace ON public.messages (workspace_id);
CREATE INDEX idx_notifications_workspace ON public.notifications (workspace_id);
CREATE INDEX idx_reactions_workspace ON public.reactions (workspace_id);
CREATE INDEX idx_resource_memberships_workspace ON public.resource_memberships (workspace_id);
CREATE INDEX idx_space_statuses_workspace ON public.space_statuses (workspace_id);
CREATE INDEX idx_task_activity_workspace ON public.task_activity (workspace_id);
CREATE INDEX idx_task_attachments_workspace ON public.task_attachments (workspace_id);
CREATE INDEX idx_task_checklist_items_workspace ON public.task_checklist_items (workspace_id);
CREATE INDEX idx_task_checklists_workspace ON public.task_checklists (workspace_id);
CREATE INDEX idx_task_comments_workspace ON public.task_comments (workspace_id);
CREATE INDEX idx_task_day_plans_workspace ON public.task_day_plans (workspace_id);
CREATE INDEX idx_task_estimate_changes_workspace ON public.task_estimate_changes (workspace_id);
CREATE INDEX idx_task_list_links_workspace ON public.task_list_links (workspace_id);
CREATE INDEX idx_task_reviews_workspace ON public.task_reviews (workspace_id);
CREATE INDEX idx_tasks_workspace ON public.tasks (workspace_id);
CREATE INDEX idx_whiteboards_workspace ON public.whiteboards (workspace_id);
CREATE INDEX idx_work_block_runs_workspace ON public.work_block_runs (workspace_id);
CREATE INDEX idx_work_blocks_workspace ON public.work_blocks (workspace_id);
ALTER TABLE public.workspace_mini_apps ADD CONSTRAINT workspace_mini_apps_slug_fkey FOREIGN KEY (slug) REFERENCES public.mini_apps(slug) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE public.workspace_members ADD COLUMN is_upsquad_staff boolean NOT NULL DEFAULT false;
ALTER TABLE public.workspace_members ALTER COLUMN role SET DEFAULT 'member';
CREATE INDEX idx_tasks_workspace_list ON public.tasks (workspace_id, list_id);
CREATE INDEX idx_notifications_user_workspace ON public.notifications (user_id, workspace_id, created_at DESC);

-- ---------------------------------------------------------------- indexes
CREATE INDEX idx_folders_deleted ON public.folders USING btree (deleted_at) WHERE (deleted_at IS NOT NULL);
CREATE INDEX idx_folders_status ON public.folders USING btree (status);
CREATE INDEX idx_folders_parent ON public.folders USING btree (parent_folder_id) WHERE (parent_folder_id IS NOT NULL);
CREATE INDEX idx_folders_space_id ON public.folders USING btree (space_id);
CREATE INDEX idx_folders_created_by ON public.folders USING btree (created_by);
CREATE INDEX idx_folders_default_task_type ON public.folders USING btree (default_task_type_id);
CREATE INDEX idx_spaces_deleted ON public.spaces USING btree (deleted_at) WHERE (deleted_at IS NOT NULL);
CREATE INDEX idx_spaces_status ON public.spaces USING btree (status);
CREATE INDEX idx_spaces_workspace_id ON public.spaces USING btree (workspace_id);
CREATE INDEX idx_spaces_created_by ON public.spaces USING btree (created_by);
CREATE INDEX idx_spaces_personal_owner ON public.spaces USING btree (created_by) WHERE (kind = 'personal'::text);
CREATE UNIQUE INDEX idx_spaces_one_personal_per_owner ON public.spaces USING btree (created_by, workspace_id) WHERE ((kind = 'personal'::text) AND (deleted_at IS NULL));
CREATE INDEX idx_spaces_default_task_type ON public.spaces USING btree (default_task_type_id);
CREATE INDEX idx_message_threads_reply_message_id ON public.message_threads USING btree (reply_message_id);
CREATE INDEX idx_tasks_list ON public.tasks USING btree (list_id);
CREATE INDEX idx_tasks_parent ON public.tasks USING btree (parent_task_id);
CREATE INDEX idx_tasks_task_type ON public.tasks USING btree (task_type_id);
CREATE INDEX idx_tasks_focused_at ON public.tasks USING btree (focused_at) WHERE (focused_at IS NOT NULL);
CREATE INDEX idx_tasks_snoozed_until ON public.tasks USING btree (snoozed_until) WHERE (snoozed_until IS NOT NULL);
CREATE INDEX idx_tasks_created_by ON public.tasks USING btree (created_by);
CREATE INDEX idx_tasks_last_modified_by ON public.tasks USING btree (last_modified_by);
CREATE INDEX idx_tasks_routine_templates ON public.tasks USING btree (id) WHERE (recurrence IS NOT NULL);
CREATE UNIQUE INDEX uq_tasks_routine_instance ON public.tasks USING btree (recurring_parent_id, recurrence_instance_date) WHERE ((recurring_parent_id IS NOT NULL) AND (recurrence_instance_date IS NOT NULL));
CREATE UNIQUE INDEX uq_tasks_source ON public.tasks USING btree (source_kind, source_id, source_user_id) WHERE (source_kind IS NOT NULL);
CREATE INDEX idx_tasks_source_kind ON public.tasks USING btree (source_kind) WHERE (source_kind IS NOT NULL);
CREATE INDEX idx_tasks_created_via ON public.tasks USING btree (created_via);
CREATE INDEX idx_reminder_tasks_due ON public.tasks USING btree (due_date, id) WHERE (due_date IS NOT NULL);
CREATE INDEX idx_lists_deleted ON public.lists USING btree (deleted_at) WHERE (deleted_at IS NOT NULL);
CREATE INDEX idx_lists_status ON public.lists USING btree (status);
CREATE INDEX idx_lists_created_by ON public.lists USING btree (created_by);
CREATE INDEX idx_lists_folder_id ON public.lists USING btree (folder_id);
CREATE INDEX idx_lists_space_id ON public.lists USING btree (space_id);
CREATE INDEX idx_lists_default_task_type ON public.lists USING btree (default_task_type_id);
CREATE UNIQUE INDEX roles_system_key_unique ON public.roles USING btree (system_key) WHERE (system_key IS NOT NULL);
CREATE INDEX idx_task_comments_user_id ON public.task_comments USING btree (user_id);
CREATE INDEX idx_task_comments_task_id ON public.task_comments USING btree (task_id);
CREATE INDEX idx_dm_conversations_workspace_id ON public.dm_conversations USING btree (workspace_id);
CREATE INDEX idx_dm_participants_user ON public.dm_participants USING btree (user_id);
CREATE INDEX idx_reactions_message ON public.reactions USING btree (message_id);
CREATE INDEX idx_reactions_user_id ON public.reactions USING btree (user_id);
CREATE INDEX idx_task_checklists_task ON public.task_checklists USING btree (task_id);
CREATE INDEX idx_task_checklists_created_by ON public.task_checklists USING btree (created_by);
CREATE UNIQUE INDEX idx_task_types_default ON public.task_types USING btree (is_default) WHERE (is_default = true);
CREATE INDEX idx_task_type_fields_type ON public.task_type_fields USING btree (task_type_id);
CREATE INDEX idx_space_statuses_space ON public.space_statuses USING btree (space_id);
CREATE INDEX idx_rm_resource ON public.resource_memberships USING btree (resource_type, resource_id);
CREATE INDEX idx_rm_user ON public.resource_memberships USING btree (user_id);
CREATE INDEX idx_rm_user_type ON public.resource_memberships USING btree (user_id, resource_type);
CREATE INDEX idx_resource_memberships_invited_by ON public.resource_memberships USING btree (invited_by);
CREATE INDEX idx_task_attachments_task_id ON public.task_attachments USING btree (task_id);
CREATE INDEX idx_task_attachments_uploaded_by ON public.task_attachments USING btree (uploaded_by);
CREATE INDEX idx_timer_sessions_user_date ON public.timer_sessions USING btree (user_id, date);
CREATE INDEX idx_timer_sessions_active ON public.timer_sessions USING btree (user_id, workspace_id, context) WHERE (end_time IS NULL);
CREATE INDEX idx_timer_sessions_workspace ON public.timer_sessions USING btree (workspace_id);
CREATE INDEX idx_user_view_prefs_user ON public.user_view_preferences USING btree (user_id);
CREATE INDEX idx_work_blocks_recurrence_kind ON public.work_blocks USING btree (((recurrence ->> 'kind'::text)));
CREATE INDEX idx_wb_runs_task ON public.work_block_runs USING btree (task_id);
CREATE INDEX idx_wb_runs_user ON public.work_block_runs USING btree (user_id, started_at DESC);
CREATE UNIQUE INDEX uq_wb_runs_one_active_per_user ON public.work_block_runs USING btree (user_id) WHERE (ended_at IS NULL);
CREATE INDEX idx_chat_sched_due ON public.chat_scheduled_messages USING btree (scheduled_at) WHERE (status = 'pending'::text);
CREATE INDEX idx_chat_sched_user ON public.chat_scheduled_messages USING btree (user_id, status);
CREATE INDEX idx_meetings_scheduled_at ON public.meetings USING btree (scheduled_at);
CREATE INDEX idx_meetings_created_by ON public.meetings USING btree (created_by);
CREATE INDEX idx_meetings_attendees ON public.meetings USING gin (attendee_ids);
CREATE INDEX idx_squad_notes_workspace ON public.squad_notes USING btree (workspace_id) WHERE (deleted_at IS NULL);
CREATE INDEX idx_squad_notes_parent ON public.squad_notes USING btree (parent_id, "position") WHERE (deleted_at IS NULL);
CREATE INDEX idx_squad_notes_root ON public.squad_notes USING btree (root_id) WHERE (deleted_at IS NULL);
CREATE INDEX idx_squad_notes_owner ON public.squad_notes USING btree (owner_id) WHERE (deleted_at IS NULL);
CREATE INDEX idx_squad_notes_trash ON public.squad_notes USING btree (workspace_id, owner_id, deleted_at DESC) WHERE (deleted_at IS NOT NULL);
CREATE INDEX idx_message_edits_message ON public.message_edits USING btree (message_id, replaced_at DESC);
CREATE INDEX idx_feature_tip_states_tip_rev ON public.feature_tip_states USING btree (tip_id, revision);
CREATE INDEX idx_feature_tip_states_user ON public.feature_tip_states USING btree (user_id);
CREATE INDEX idx_message_reads_user ON public.message_reads USING btree (user_id);
CREATE INDEX idx_feature_tips_active ON public.feature_tips USING btree (is_active) WHERE (is_active = true);
CREATE INDEX idx_feature_tips_platform_active ON public.feature_tips USING btree (platform, is_active) WHERE (is_active = true);
CREATE INDEX idx_app_favorites_user ON public.app_favorites USING btree (user_id);
CREATE INDEX idx_squad_note_shares_note ON public.squad_note_shares USING btree (note_id);
CREATE INDEX idx_squad_note_shares_grantee ON public.squad_note_shares USING btree (grantee_type, grantee_id);
CREATE INDEX idx_squadhire_sso_codes_expires ON public.squadhire_sso_codes USING btree (expires_at);
CREATE INDEX idx_task_estimate_changes_task ON public.task_estimate_changes USING btree (task_id, created_at DESC);
CREATE INDEX idx_task_estimate_changes_user ON public.task_estimate_changes USING btree (user_id, created_at DESC);
CREATE INDEX idx_web_push_subscriptions_user ON public.web_push_subscriptions USING btree (user_id);
CREATE INDEX idx_task_tags_workspace ON public.task_tags USING btree (workspace_id);
CREATE INDEX idx_task_tags_group ON public.task_tags USING btree (group_id);
CREATE UNIQUE INDEX uniq_task_tag_name ON public.task_tags USING btree (workspace_id, lower(name));
CREATE INDEX idx_label_groups_workspace ON public.label_groups USING btree (workspace_id);
CREATE UNIQUE INDEX uniq_label_group_default ON public.label_groups USING btree (workspace_id) WHERE is_default;
CREATE INDEX idx_label_group_role_access_group ON public.label_group_role_access USING btree (group_id);
CREATE INDEX idx_label_group_role_access_role ON public.label_group_role_access USING btree (role_id);
CREATE INDEX idx_label_group_user_access_group ON public.label_group_user_access USING btree (group_id);
CREATE INDEX idx_label_group_user_access_user ON public.label_group_user_access USING btree (user_id);
CREATE INDEX idx_label_requests_status ON public.label_requests USING btree (workspace_id, status);
CREATE INDEX idx_meeting_events_created_by ON public.meeting_events USING btree (created_by);
CREATE INDEX idx_meeting_events_status ON public.meeting_events USING btree (status);
CREATE INDEX idx_meeting_events_origin_channel ON public.meeting_events USING btree (origin_channel_id) WHERE (origin_channel_id IS NOT NULL);
CREATE INDEX idx_meeting_slots_event ON public.meeting_event_slots USING btree (meeting_event_id, sort_order);
CREATE INDEX idx_meeting_slots_suggestion ON public.meeting_event_slots USING btree (meeting_event_id) WHERE is_suggestion;
CREATE INDEX idx_meeting_guests_user ON public.meeting_event_guests USING btree (user_id);
CREATE INDEX idx_users_user_type ON public.users USING btree (user_type);
CREATE INDEX idx_users_is_admin ON public.users USING btree (is_admin) WHERE (is_admin = true);
CREATE INDEX idx_users_phone_last10 ON public.users USING btree (phone_last10) WHERE (phone_last10 IS NOT NULL);
CREATE INDEX idx_meeting_votes_slot ON public.meeting_slot_votes USING btree (slot_id);
CREATE INDEX idx_meeting_attachments_event ON public.meeting_event_attachments USING btree (meeting_event_id);
CREATE INDEX idx_task_list_links_list ON public.task_list_links USING btree (list_id);
CREATE INDEX idx_task_list_links_task ON public.task_list_links USING btree (task_id);
CREATE INDEX idx_group_runs_user ON public.group_runs USING btree (user_id, started_at DESC);
CREATE INDEX idx_group_runs_key ON public.group_runs USING btree (group_key, started_at DESC);
CREATE UNIQUE INDEX uq_group_runs_one_active_per_user ON public.group_runs USING btree (user_id) WHERE (ended_at IS NULL);
CREATE INDEX idx_group_day_plans_user_date ON public.group_day_plans USING btree (user_id, plan_date);
CREATE INDEX idx_task_activity_task ON public.task_activity USING btree (task_id, created_at DESC);
CREATE INDEX idx_task_activity_user ON public.task_activity USING btree (user_id, created_at DESC);
CREATE INDEX idx_group_run_task_times_run ON public.group_run_task_times USING btree (run_id);
CREATE INDEX idx_group_run_task_times_task ON public.group_run_task_times USING btree (task_id);
CREATE UNIQUE INDEX uq_group_run_task_times_one_open ON public.group_run_task_times USING btree (run_id, task_id) WHERE (ended_at IS NULL);
CREATE INDEX idx_list_views_list_pos ON public.list_views USING btree (list_id, "position");
CREATE INDEX idx_wv_view_saved ON public.whiteboard_versions USING btree (view_id, saved_at DESC);
CREATE UNIQUE INDEX huddles_active_channel_uniq ON public.huddles USING btree (channel_id) WHERE ((ended_at IS NULL) AND (channel_id IS NOT NULL));
CREATE UNIQUE INDEX huddles_active_dm_uniq ON public.huddles USING btree (dm_conversation_id) WHERE ((ended_at IS NULL) AND (dm_conversation_id IS NOT NULL));
CREATE INDEX idx_huddles_active ON public.huddles USING btree (started_at) WHERE (ended_at IS NULL);
CREATE INDEX idx_huddle_participants_huddle ON public.huddle_participants USING btree (huddle_id);
CREATE INDEX idx_channels_workspace ON public.channels USING btree (workspace_id);
CREATE INDEX idx_channels_deleted ON public.channels USING btree (deleted_at) WHERE (deleted_at IS NOT NULL);
CREATE INDEX idx_channels_created_by ON public.channels USING btree (created_by);
CREATE UNIQUE INDEX idx_channels_linked_resource ON public.channels USING btree (linked_resource_type, linked_resource_id) WHERE ((linked_resource_id IS NOT NULL) AND (deleted_at IS NULL));
CREATE INDEX idx_workspace_members_user ON public.workspace_members USING btree (user_id);
CREATE INDEX idx_workspace_members_workspace ON public.workspace_members USING btree (workspace_id);
CREATE INDEX idx_workspace_members_role_id ON public.workspace_members USING btree (role_id);
CREATE INDEX idx_checklist_items_checklist ON public.task_checklist_items USING btree (checklist_id);
CREATE INDEX idx_task_checklist_items_completed_by ON public.task_checklist_items USING btree (completed_by);
CREATE INDEX idx_task_checklist_items_assigned_to ON public.task_checklist_items USING btree (assigned_to);
CREATE INDEX idx_checkins_user_date ON public.checkins USING btree (user_id, date);
CREATE INDEX idx_checkins_date ON public.checkins USING btree (date);
CREATE INDEX idx_checkins_status ON public.checkins USING btree (status);
CREATE INDEX idx_checkins_role_id ON public.checkins USING btree (role_id);
CREATE INDEX idx_holidays_date ON public.holidays USING btree (date);
CREATE INDEX idx_holidays_recurring ON public.holidays USING btree (is_recurring);
CREATE INDEX idx_daily_time_summaries_user_date ON public.daily_time_summaries USING btree (user_id, date);
CREATE INDEX idx_daily_time_summaries_date ON public.daily_time_summaries USING btree (date);
CREATE INDEX idx_daily_time_summaries_workspace ON public.daily_time_summaries USING btree (workspace_id);
CREATE INDEX idx_task_day_plans_user_date ON public.task_day_plans USING btree (user_id, plan_date);
CREATE INDEX idx_task_day_plans_task ON public.task_day_plans USING btree (task_id);
CREATE INDEX idx_user_office_timing_user ON public.user_office_timing USING btree (user_id);
CREATE INDEX idx_ttra_type ON public.task_type_role_access USING btree (task_type_id);
CREATE INDEX idx_ttra_role ON public.task_type_role_access USING btree (role_id);
CREATE INDEX idx_ttua_type ON public.task_type_user_access USING btree (task_type_id);
CREATE INDEX idx_ttua_user ON public.task_type_user_access USING btree (user_id);
CREATE INDEX idx_wm_sec_roles_member ON public.workspace_member_secondary_roles USING btree (workspace_member_id);
CREATE INDEX idx_wm_sec_roles_role ON public.workspace_member_secondary_roles USING btree (role_id);
CREATE INDEX idx_wb_task_times_run ON public.work_block_task_times USING btree (run_id);
CREATE INDEX idx_wb_task_times_task ON public.work_block_task_times USING btree (task_id);
CREATE UNIQUE INDEX uq_wb_task_times_one_open ON public.work_block_task_times USING btree (run_id, task_id) WHERE (ended_at IS NULL);
CREATE INDEX idx_wb_completions_task ON public.work_block_completions USING btree (completed_task_id);
CREATE INDEX idx_wb_links_linked ON public.work_block_links USING btree (linked_task_id);
CREATE INDEX idx_work_block_links_linked_by ON public.work_block_links USING btree (linked_by);
CREATE INDEX idx_partner_push_tokens_user ON public.partner_push_tokens USING btree (user_id);
CREATE INDEX idx_task_reviews_user ON public.task_reviews USING btree (user_id);
CREATE INDEX idx_messages_channel_id ON public.messages USING btree (channel_id, created_at DESC);
CREATE INDEX idx_messages_dm_id ON public.messages USING btree (dm_conversation_id, created_at DESC);
CREATE INDEX idx_messages_sender ON public.messages USING btree (sender_id);
CREATE INDEX idx_messages_parent ON public.messages USING btree (parent_message_id) WHERE (parent_message_id IS NOT NULL);
CREATE INDEX idx_messages_meeting_event ON public.messages USING btree (meeting_event_id) WHERE (meeting_event_id IS NOT NULL);
CREATE INDEX idx_messages_huddle ON public.messages USING btree (huddle_id) WHERE (huddle_id IS NOT NULL);
CREATE INDEX idx_favorites_user_workspace ON public.favorites USING btree (user_id, workspace_id);
CREATE INDEX idx_favorites_item ON public.favorites USING btree (item_type, item_id);
CREATE INDEX idx_favorites_workspace_id ON public.favorites USING btree (workspace_id);
CREATE INDEX idx_task_time_entries_user_started ON public.task_time_entries USING btree (user_id, started_at DESC);
CREATE INDEX idx_task_time_entries_task ON public.task_time_entries USING btree (task_id);
CREATE INDEX idx_task_time_entries_workspace_id ON public.task_time_entries USING btree (workspace_id);
CREATE INDEX idx_task_time_entries_wb_run ON public.task_time_entries USING btree (work_block_run_id);
CREATE INDEX idx_group_run_completions_task ON public.group_run_completions USING btree (completed_task_id);
CREATE INDEX idx_skill_grants_principal ON public.skill_grants USING btree (principal_type, principal_id);
CREATE INDEX idx_notifications_user_unread ON public.notifications USING btree (user_id, is_read, created_at DESC);
CREATE INDEX idx_notifications_reference ON public.notifications USING btree (reference_id, reference_type);
CREATE INDEX idx_notifications_actor_id ON public.notifications USING btree (actor_id);
CREATE INDEX idx_notifications_created_at ON public.notifications USING btree (created_at);
CREATE INDEX idx_partner_app_installs_last_seen ON public.partner_app_installs USING btree (last_seen_at DESC);
CREATE INDEX goals_workspace_idx ON public.goals USING btree (workspace_id);
CREATE INDEX goals_project_idx ON public.goals USING btree (project_id);
CREATE INDEX goal_projects_workspace_idx ON public.goal_projects USING btree (workspace_id);
CREATE INDEX goal_tasks_task_idx ON public.goal_tasks USING btree (task_id);
CREATE INDEX goal_dependencies_goal_idx ON public.goal_dependencies USING btree (goal_id);
CREATE INDEX goal_sources_goal_idx ON public.goal_sources USING btree (goal_id);
CREATE INDEX idx_sga_group ON public.status_group_assignments USING btree (group_id);
CREATE INDEX idx_sga_entity ON public.status_group_assignments USING btree (entity_type, entity_id);
CREATE INDEX idx_status_groups_base ON public.status_groups USING btree (base_group_id);
CREATE INDEX idx_sgs_group ON public.status_group_statuses USING btree (group_id);
CREATE UNIQUE INDEX idx_sgs_group_key ON public.status_group_statuses USING btree (group_id, key);
CREATE INDEX idx_ttgi_group ON public.task_type_group_items USING btree (group_id);
CREATE INDEX idx_ttgi_type ON public.task_type_group_items USING btree (task_type_id);
CREATE INDEX idx_ttga_group ON public.task_type_group_assignments USING btree (group_id);
CREATE INDEX idx_ttga_entity ON public.task_type_group_assignments USING btree (entity_type, entity_id);

-- ---------------------------------------------------------------- functions
-- Fill-or-verify workspace_id from the parent row. TG_ARGV is a list of
-- 'parent_table:fk_column' pairs; the first non-null parent wins.
CREATE OR REPLACE FUNCTION public.saas_fill_workspace_id()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  spec text;
  parent_table text;
  fk_col text;
  fk_val uuid;
  parent_ws uuid;
  i int;
BEGIN
  FOR i IN 0 .. TG_NARGS - 1 LOOP
    spec := TG_ARGV[i];
    parent_table := split_part(spec, ':', 1);
    fk_col := split_part(spec, ':', 2);
    fk_val := (to_jsonb(NEW) ->> fk_col)::uuid;
    IF fk_val IS NOT NULL THEN
      EXECUTE format('SELECT workspace_id FROM public.%I WHERE id = $1', parent_table)
        INTO parent_ws USING fk_val;
      EXIT;
    END IF;
  END LOOP;

  IF parent_ws IS NULL THEN
    RETURN NEW;  -- no parent: the caller must have supplied workspace_id (NOT NULL enforces it)
  END IF;
  IF NEW.workspace_id IS NULL THEN
    NEW.workspace_id := parent_ws;
  ELSIF NEW.workspace_id <> parent_ws THEN
    RAISE EXCEPTION 'workspace_id % does not match parent %.% (workspace %)',
      NEW.workspace_id, parent_table, fk_val, parent_ws
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

-- notifications: derive from what the notification is about.
CREATE OR REPLACE FUNCTION public.saas_fill_notification_workspace()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE ws uuid;
BEGIN
  IF NEW.workspace_id IS NOT NULL THEN RETURN NEW; END IF;
  ws := CASE NEW.reference_type
    WHEN 'task' THEN (SELECT workspace_id FROM tasks WHERE id = NEW.reference_id)
    WHEN 'message' THEN (SELECT workspace_id FROM messages WHERE id = NEW.reference_id)
    WHEN 'channel' THEN (SELECT workspace_id FROM channels WHERE id = NEW.reference_id)
    WHEN 'meeting' THEN (SELECT workspace_id FROM meetings WHERE id = NEW.reference_id)
    WHEN 'meeting_event' THEN (SELECT workspace_id FROM meeting_events WHERE id = NEW.reference_id)
    WHEN 'huddle' THEN (SELECT workspace_id FROM huddles WHERE id = NEW.reference_id)
    WHEN 'note' THEN (SELECT workspace_id FROM squad_notes WHERE id = NEW.reference_id)
    WHEN 'goal' THEN (SELECT workspace_id FROM goals WHERE id = NEW.reference_id)
    ELSE NULL END;
  IF ws IS NULL AND NEW.metadata ? 'workspace_id' THEN
    ws := (NEW.metadata ->> 'workspace_id')::uuid;
  END IF;
  NEW.workspace_id := ws;
  RETURN NEW;
END $$;

-- resource_memberships: derive from the resource.
CREATE OR REPLACE FUNCTION public.saas_fill_membership_workspace()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE ws uuid;
BEGIN
  ws := CASE NEW.resource_type
    WHEN 'channel' THEN (SELECT workspace_id FROM channels WHERE id = NEW.resource_id)
    WHEN 'space' THEN (SELECT workspace_id FROM spaces WHERE id = NEW.resource_id)
    WHEN 'folder' THEN (SELECT workspace_id FROM folders WHERE id = NEW.resource_id)
    WHEN 'list' THEN (SELECT workspace_id FROM lists WHERE id = NEW.resource_id)
    ELSE NULL END;
  IF ws IS NULL THEN RETURN NEW; END IF;
  IF NEW.workspace_id IS NULL THEN
    NEW.workspace_id := ws;
  ELSIF NEW.workspace_id <> ws THEN
    RAISE EXCEPTION 'resource_memberships.workspace_id does not match % %', NEW.resource_type, NEW.resource_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

-- group_day_plans: container is a list, folder or space.
CREATE OR REPLACE FUNCTION public.saas_fill_group_container_workspace()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE ws uuid;
BEGIN
  ws := CASE NEW.container_type
    WHEN 'space' THEN (SELECT workspace_id FROM spaces WHERE id = NEW.container_id)
    WHEN 'folder' THEN (SELECT workspace_id FROM folders WHERE id = NEW.container_id)
    WHEN 'list' THEN (SELECT workspace_id FROM lists WHERE id = NEW.container_id)
    ELSE NULL END;
  IF ws IS NULL THEN RETURN NEW; END IF;
  IF NEW.workspace_id IS NULL THEN
    NEW.workspace_id := ws;
  ELSIF NEW.workspace_id <> ws THEN
    RAISE EXCEPTION 'group_day_plans.workspace_id does not match its container' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

-- A task moved to a list in another workspace is refused (move it with its
-- workspace only within one account).
CREATE OR REPLACE FUNCTION public.saas_guard_workspace_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id THEN
    RAISE EXCEPTION '%.workspace_id is immutable', TG_TABLE_NAME USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.auto_add_creator_as_manager()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  INSERT INTO resource_memberships (resource_type, resource_id, user_id, access_level, invited_by)
  VALUES (TG_ARGV[0], NEW.id, NEW.created_by, 'manager', NEW.created_by)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.auto_create_space_statuses()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  INSERT INTO space_statuses (space_id, name, color, position, is_default, category) VALUES
    (NEW.id, 'To Do',        '#6b7280', 0, TRUE,  'todo'),
    (NEW.id, 'In Progress',  '#2962FF', 1, FALSE, 'active'),
    (NEW.id, 'Done',         '#16a34a', 2, FALSE, 'done');
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.capture_message_edit()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.content IS DISTINCT FROM OLD.content AND OLD.content IS NOT NULL THEN
    INSERT INTO message_edits (message_id, previous_content, editor_id)
    VALUES (OLD.id, OLD.content, OLD.sender_id);
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.chat_unread_summary(p_user_id uuid)
 RETURNS TABLE(scope_type text, scope_id uuid, unread_count bigint)
 LANGUAGE sql
 STABLE
AS $function$
  WITH my_channels AS (
    SELECT rm.resource_id AS id
    FROM resource_memberships rm
    WHERE rm.user_id = p_user_id AND rm.resource_type = 'channel'
    UNION
    SELECT c.id
    FROM channels c
    WHERE c.created_by = p_user_id AND c.deleted_at IS NULL
  ),
  channel_unread AS (
    SELECT 'channel'::text AS scope_type, mc.id AS scope_id, COUNT(m.id) AS unread_count
    FROM my_channels mc
    LEFT JOIN message_reads r
      ON r.user_id = p_user_id AND r.scope_type = 'channel' AND r.scope_id = mc.id
    LEFT JOIN messages m
      ON m.channel_id = mc.id
      AND m.sender_id <> p_user_id
      AND m.is_deleted = false
      AND m.created_at > COALESCE(r.last_read_at, 'epoch'::timestamptz)
    GROUP BY mc.id
  ),
  my_dms AS (
    SELECT dp.conversation_id AS id
    FROM dm_participants dp
    WHERE dp.user_id = p_user_id
  ),
  dm_unread AS (
    SELECT 'dm'::text AS scope_type, md.id AS scope_id, COUNT(m.id) AS unread_count
    FROM my_dms md
    LEFT JOIN message_reads r
      ON r.user_id = p_user_id AND r.scope_type = 'dm' AND r.scope_id = md.id
    LEFT JOIN messages m
      ON m.dm_conversation_id = md.id
      AND m.sender_id <> p_user_id
      AND m.is_deleted = false
      AND m.created_at > COALESCE(r.last_read_at, 'epoch'::timestamptz)
    GROUP BY md.id
  )
  SELECT scope_type, scope_id, unread_count FROM channel_unread WHERE unread_count > 0
  UNION ALL
  SELECT scope_type, scope_id, unread_count FROM dm_unread WHERE unread_count > 0;
$function$;

CREATE OR REPLACE FUNCTION public.check_goal_dependency_cycle()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  perform 1 from public.goals where id = new.goal_id for update;
  if exists (
    with recursive downstream(id) as (
      select new.to_task_id
      union
      select d.to_task_id
      from public.goal_dependencies d
      join downstream x on d.from_task_id = x.id
      where d.goal_id = new.goal_id and d.id <> new.id
    )
    select 1 from downstream where id = new.from_task_id
  ) then
    raise exception 'Dependencies cannot form a cycle';
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.deliver_due_task_reminders()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE t record; recipient uuid; inserted integer; delivered integer := 0;
BEGIN
  FOR t IN
    SELECT tasks.* FROM public.tasks
    JOIN public.task_types tt ON tt.id = tasks.task_type_id AND tt.key = 'reminders'
    JOIN public.lists l ON l.id = tasks.list_id AND l.deleted_at IS NULL
    WHERE tasks.due_date <= now() AND tasks.recurrence IS NULL
      AND lower(tasks.status) NOT IN ('done', 'closed', 'cancelled', 'completed')
      AND NOT EXISTS (SELECT 1 FROM public.space_statuses ss
        WHERE ss.space_id = l.space_id AND ss.name = tasks.status AND ss.category IN ('done', 'closed'))
      AND EXISTS (
        SELECT 1 FROM unnest(array_append(coalesce(tasks.assignee_ids, ARRAY[]::uuid[]), tasks.created_by)) u
        WHERE u IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM public.task_reminder_deliveries d
          WHERE d.task_id = tasks.id AND d.user_id = u AND d.due_at = tasks.due_date
        )
      )
    ORDER BY tasks.due_date LIMIT 100 FOR UPDATE OF tasks SKIP LOCKED
  LOOP
    FOR recipient IN SELECT DISTINCT u FROM unnest(array_append(coalesce(t.assignee_ids, ARRAY[]::uuid[]), t.created_by)) u WHERE u IS NOT NULL
    LOOP
      INSERT INTO public.task_reminder_deliveries (task_id, user_id, due_at)
      VALUES (t.id, recipient, t.due_date) ON CONFLICT DO NOTHING;
      GET DIAGNOSTICS inserted = ROW_COUNT;
      IF inserted > 0 THEN
        INSERT INTO public.notifications (user_id, type, reference_id, reference_type, title, body, metadata)
        VALUES (recipient, 'task_reminder', t.id, 'task', t.title, 'Reminder due now',
          jsonb_build_object('task_id', t.id, 'due_at', t.due_date, 'list_id', t.list_id));
        delivered := delivered + 1;
      END IF;
    END LOOP;
  END LOOP;
  RETURN delivered;
END $function$;

CREATE OR REPLACE FUNCTION public.feature_tips_pending_for_user(p_user_id uuid, p_platform text DEFAULT 'web'::text)
 RETURNS TABLE(id uuid, title text, body text, target_view text, target_anchor text, steps jsonb, revision integer, audience jsonb, created_at timestamp with time zone)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT t.id, t.title, t.body, t.target_view, t.target_anchor, t.steps,
         t.current_revision, t.audience, t.created_at
  FROM feature_tips t
  LEFT JOIN feature_tip_states s
    ON s.tip_id = t.id
   AND s.user_id = p_user_id
   AND s.revision = t.current_revision
  WHERE t.is_active = true
    AND t.platform = p_platform
    AND (s.status IS DISTINCT FROM 'accepted')
    AND (
      s.tip_id IS NULL
      OR (s.status = 'dismissed'
          AND COALESCE(s.dismissed_until, 'epoch'::timestamptz) <= NOW())
    )
  ORDER BY t.created_at ASC;
$function$;

CREATE OR REPLACE FUNCTION public.find_existing_dm(p_workspace_id uuid, p_user_ids uuid[], p_count integer)
 RETURNS TABLE(id uuid)
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  RETURN QUERY
  SELECT dc.id
  FROM dm_conversations dc
  WHERE dc.workspace_id = p_workspace_id
    AND (
      SELECT COUNT(*)
      FROM dm_participants dp
      WHERE dp.conversation_id = dc.id
    ) = p_count
    AND NOT EXISTS (
      SELECT 1 FROM unnest(p_user_ids) AS uid
      WHERE uid NOT IN (
        SELECT dp.user_id FROM dm_participants dp WHERE dp.conversation_id = dc.id
      )
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_dm_received()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  sender_name TEXT;
BEGIN
  IF NEW.dm_conversation_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT display_name INTO sender_name FROM users WHERE id = NEW.sender_id;

  INSERT INTO notifications (user_id, type, reference_id, reference_type, actor_id, title, body, metadata)
  SELECT
    dp.user_id,
    'dm_received',
    NEW.id,
    'message',
    NEW.sender_id,
    COALESCE(sender_name, 'Someone') || ' sent you a message',
    LEFT(COALESCE(NEW.content, ''), 140),
    jsonb_build_object(
      'message_id', NEW.id,
      'dm_conversation_id', NEW.dm_conversation_id,
      'parent_message_id', NEW.parent_message_id
    )
  FROM dm_participants dp
  WHERE dp.conversation_id = NEW.dm_conversation_id
    AND dp.user_id <> NEW.sender_id
    AND NOT (NEW.mentions IS NOT NULL AND dp.user_id = ANY (NEW.mentions));

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_message_mention()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  sender_name TEXT;
  channel_name TEXT;
  is_dm BOOLEAN;
  has_mentions BOOLEAN;
  is_all BOOLEAN;
BEGIN
  has_mentions := NEW.mentions IS NOT NULL AND array_length(NEW.mentions, 1) IS NOT NULL;
  is_all := COALESCE(NEW.mention_all, false) AND NEW.channel_id IS NOT NULL;
  IF NOT has_mentions AND NOT is_all THEN
    RETURN NEW;
  END IF;

  SELECT display_name INTO sender_name FROM users WHERE id = NEW.sender_id;

  is_dm := NEW.dm_conversation_id IS NOT NULL;
  IF NEW.channel_id IS NOT NULL THEN
    SELECT name INTO channel_name FROM channels WHERE id = NEW.channel_id;
  END IF;

  IF has_mentions THEN
    INSERT INTO notifications (user_id, type, reference_id, reference_type, actor_id, title, body, metadata)
    SELECT DISTINCT
      m,
      'message_mention',
      NEW.id,
      'message',
      NEW.sender_id,
      COALESCE(sender_name, 'Someone') || ' mentioned you'
        || CASE
             WHEN is_dm THEN ' in a DM'
             WHEN channel_name IS NOT NULL THEN ' in #' || channel_name
             ELSE ''
           END,
      LEFT(COALESCE(NEW.content, ''), 140),
      jsonb_build_object(
        'message_id', NEW.id,
        'channel_id', NEW.channel_id,
        'dm_conversation_id', NEW.dm_conversation_id,
        'parent_message_id', NEW.parent_message_id
      )
    FROM unnest(NEW.mentions) AS m
    WHERE m IS NOT NULL AND m != NEW.sender_id;
  END IF;

  IF is_all THEN
    INSERT INTO notifications (user_id, type, reference_id, reference_type, actor_id, title, body, metadata)
    SELECT DISTINCT
      member_id,
      'message_mention',
      NEW.id,
      'message',
      NEW.sender_id,
      COALESCE(sender_name, 'Someone') || ' mentioned @all'
        || CASE WHEN channel_name IS NOT NULL THEN ' in #' || channel_name ELSE '' END,
      LEFT(COALESCE(NEW.content, ''), 140),
      jsonb_build_object(
        'message_id', NEW.id,
        'channel_id', NEW.channel_id,
        'dm_conversation_id', NEW.dm_conversation_id,
        'parent_message_id', NEW.parent_message_id,
        'mention_all', true
      )
    FROM (
      SELECT user_id AS member_id
        FROM resource_memberships
       WHERE resource_type = 'channel'
         AND resource_id = NEW.channel_id
      UNION
      SELECT created_by AS member_id
        FROM channels
       WHERE id = NEW.channel_id
         AND created_by IS NOT NULL
    ) AS members
    WHERE member_id IS NOT NULL
      AND member_id != NEW.sender_id
      AND NOT (has_mentions AND member_id = ANY (NEW.mentions));
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_task_assigned()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  actor UUID;
  actor_name TEXT;
  new_assignees UUID[];
  assignee UUID;
BEGIN
  IF TG_OP = 'INSERT' THEN
    actor := COALESCE(NEW.created_by, current_actor_id());
    new_assignees := COALESCE(NEW.assignee_ids, ARRAY[]::UUID[]);
  ELSE
    actor := COALESCE(NEW.last_modified_by, current_actor_id());
    SELECT COALESCE(ARRAY_AGG(a), ARRAY[]::UUID[]) INTO new_assignees
    FROM (
      SELECT unnest(COALESCE(NEW.assignee_ids, ARRAY[]::UUID[]))
      EXCEPT
      SELECT unnest(COALESCE(OLD.assignee_ids, ARRAY[]::UUID[]))
    ) s(a);
  END IF;

  IF actor IS NOT NULL THEN
    SELECT display_name INTO actor_name FROM users WHERE id = actor;
  END IF;

  FOREACH assignee IN ARRAY new_assignees LOOP
    IF actor IS NOT NULL AND actor = assignee THEN
      CONTINUE;
    END IF;
    INSERT INTO notifications (user_id, type, reference_id, reference_type, actor_id, title, metadata)
    VALUES (
      assignee,
      'task_assigned',
      NEW.id,
      'task',
      actor,
      COALESCE(actor_name || ' assigned you to ', 'You were assigned to ') || COALESCE(NEW.title, 'a task'),
      jsonb_build_object('task_id', NEW.id)
    );
  END LOOP;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_task_commented()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  task_title TEXT;
  task_creator UUID;
  assignee_list UUID[];
  actor_name TEXT;
  mention_set UUID[];
BEGIN
  SELECT title, created_by, assignee_ids
    INTO task_title, task_creator, assignee_list
    FROM tasks WHERE id = NEW.task_id;
  SELECT display_name INTO actor_name FROM users WHERE id = NEW.user_id;

  mention_set := COALESCE(NEW.mentions, ARRAY[]::UUID[]);

  INSERT INTO notifications (user_id, type, reference_id, reference_type, actor_id, title, body, metadata)
  SELECT DISTINCT
    m,
    'mention',
    NEW.task_id,
    'task',
    NEW.user_id,
    COALESCE(actor_name, 'Someone') || ' mentioned you on ' || COALESCE(task_title, 'a task'),
    LEFT(NEW.content, 140),
    jsonb_build_object('task_id', NEW.task_id, 'comment_id', NEW.id)
  FROM unnest(mention_set) AS m
  WHERE m IS NOT NULL AND m != NEW.user_id;

  INSERT INTO notifications (user_id, type, reference_id, reference_type, actor_id, title, body, metadata)
  SELECT
    participant.user_id,
    'task_commented',
    NEW.task_id,
    'task',
    NEW.user_id,
    COALESCE(actor_name, 'Someone') || ' commented on ' || COALESCE(task_title, 'a task'),
    LEFT(NEW.content, 140),
    jsonb_build_object('task_id', NEW.task_id, 'comment_id', NEW.id)
  FROM (
    -- UNION makes each participant unique even if they wear several hats
    -- (creator who is also an assignee and has commented before).
    SELECT task_creator AS user_id
    UNION
    SELECT unnest(COALESCE(assignee_list, ARRAY[]::UUID[])) AS user_id
    UNION
    -- The new row is already inserted when this AFTER trigger runs, so
    -- excluding the commenter's own rows yields exactly the prior
    -- commenters.
    SELECT user_id FROM task_comments
     WHERE task_id = NEW.task_id AND user_id <> NEW.user_id
  ) AS participant
  WHERE participant.user_id IS NOT NULL
    AND participant.user_id <> NEW.user_id
    AND NOT (participant.user_id = ANY(mention_set));

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_task_completed()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  actor UUID;
  actor_name TEXT;
  old_cat TEXT;
  new_cat TEXT;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  new_cat := public.task_status_category(NEW.list_id, NEW.status);
  old_cat := public.task_status_category(NEW.list_id, OLD.status);

  IF new_cat IS NULL OR new_cat NOT IN ('done', 'closed') THEN
    RETURN NEW;
  END IF;
  IF old_cat IS NOT NULL AND old_cat IN ('done', 'closed') THEN
    RETURN NEW;
  END IF;

  actor := COALESCE(NEW.last_modified_by, current_actor_id());
  IF actor IS NOT NULL THEN
    SELECT display_name INTO actor_name FROM users WHERE id = actor;
  END IF;

  INSERT INTO notifications (user_id, type, reference_id, reference_type, actor_id, title, body, metadata)
  SELECT
    participant.user_id,
    'task_completed',
    NEW.id,
    'task',
    actor,
    COALESCE(actor_name || ' completed ', 'Completed: ') || COALESCE(NEW.title, 'a task'),
    NULL,
    jsonb_build_object('task_id', NEW.id, 'old_status', OLD.status, 'new_status', NEW.status)
  FROM (
    SELECT NEW.created_by AS user_id
    UNION
    SELECT unnest(COALESCE(NEW.assignee_ids, ARRAY[]::UUID[])) AS user_id
    UNION
    SELECT user_id FROM task_comments WHERE task_id = NEW.id
  ) AS participant
  WHERE participant.user_id IS NOT NULL
    AND (actor IS NULL OR participant.user_id <> actor);

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_task_updated()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  actor UUID;
  actor_name TEXT;
  changed TEXT[] := ARRAY[]::TEXT[];
  newly_assigned UUID[];
  old_cat TEXT;
  new_cat TEXT;
BEGIN
  IF NEW.title IS DISTINCT FROM OLD.title THEN
    changed := array_append(changed, 'title');
  END IF;
  IF NEW.description IS DISTINCT FROM OLD.description THEN
    changed := array_append(changed, 'description');
  END IF;
  IF NEW.priority IS DISTINCT FROM OLD.priority THEN
    changed := array_append(changed, 'priority');
  END IF;
  IF NEW.due_date IS DISTINCT FROM OLD.due_date THEN
    changed := array_append(changed, 'due date');
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    new_cat := public.task_status_category(NEW.list_id, NEW.status);
    old_cat := public.task_status_category(NEW.list_id, OLD.status);
    IF new_cat IN ('done', 'closed')
       AND (old_cat IS NULL OR old_cat NOT IN ('done', 'closed')) THEN
      RETURN NEW;
    END IF;
    changed := array_append(changed, 'status');
  END IF;
  IF NEW.assignee_ids IS DISTINCT FROM OLD.assignee_ids THEN
    changed := array_append(changed, 'assignees');
  END IF;

  IF array_length(changed, 1) IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(ARRAY_AGG(DISTINCT a), ARRAY[]::UUID[]) INTO newly_assigned
  FROM (
    SELECT unnest(COALESCE(NEW.assignee_ids, ARRAY[]::UUID[])) AS a
    EXCEPT
    SELECT unnest(COALESCE(OLD.assignee_ids, ARRAY[]::UUID[])) AS a
  ) s;

  actor := COALESCE(NEW.last_modified_by, current_actor_id());
  IF actor IS NOT NULL THEN
    SELECT display_name INTO actor_name FROM users WHERE id = actor;
  END IF;

  INSERT INTO notifications (user_id, type, reference_id, reference_type, actor_id, title, body, metadata)
  SELECT
    participant.user_id,
    'task_updated',
    NEW.id,
    'task',
    actor,
    COALESCE(actor_name || ' updated ', 'Updated: ') || COALESCE(NEW.title, 'a task'),
    LEFT('Changed ' || array_to_string(changed, ', '), 140),
    jsonb_build_object('task_id', NEW.id, 'changed', changed)
  FROM (
    SELECT NEW.created_by AS user_id
    UNION
    SELECT unnest(COALESCE(NEW.assignee_ids, ARRAY[]::UUID[])) AS user_id
    UNION
    SELECT user_id FROM task_comments WHERE task_id = NEW.id
  ) AS participant
  WHERE participant.user_id IS NOT NULL
    AND (actor IS NULL OR participant.user_id <> actor)
    AND NOT (participant.user_id = ANY(newly_assigned));

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_thread_reply()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  root_author_id UUID;
  root_mentions UUID[];
  root_all BOOLEAN;
  root_channel_id UUID;
  sender_name TEXT;
  channel_name TEXT;
BEGIN
  IF NEW.parent_message_id IS NULL OR NEW.channel_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT sender_id, COALESCE(mentions, '{}'::uuid[]), COALESCE(mention_all, false), channel_id
    INTO root_author_id, root_mentions, root_all, root_channel_id
    FROM messages
   WHERE id = NEW.parent_message_id;

  IF root_author_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT display_name INTO sender_name FROM users WHERE id = NEW.sender_id;
  SELECT name INTO channel_name FROM channels WHERE id = NEW.channel_id;

  INSERT INTO notifications (
    user_id, type, reference_id, reference_type, actor_id, title, body, metadata
  )
  SELECT
    participant.user_id,
    'thread_reply',
    NEW.id,
    'message',
    NEW.sender_id,
    COALESCE(sender_name, 'Someone')
      || CASE
           WHEN participant.user_id = root_author_id THEN ' replied to your thread'
           ELSE ' replied in a thread you joined'
         END
      || CASE WHEN channel_name IS NOT NULL THEN ' in #' || channel_name ELSE '' END,
    LEFT(COALESCE(NEW.content, ''), 140),
    jsonb_build_object(
      'message_id', NEW.id,
      'channel_id', NEW.channel_id,
      'dm_conversation_id', NEW.dm_conversation_id,
      'parent_message_id', NEW.parent_message_id,
      'thread_role', CASE
        WHEN participant.user_id = root_author_id THEN 'starter'
        ELSE 'participant'
      END
    )
  FROM (
    SELECT sender_id AS user_id
      FROM messages
     WHERE id = NEW.parent_message_id
    UNION
    SELECT sender_id AS user_id
      FROM messages
     WHERE parent_message_id = NEW.parent_message_id
    UNION
    SELECT unnest(root_mentions) AS user_id
     WHERE array_length(root_mentions, 1) IS NOT NULL
    UNION
    SELECT user_id AS user_id
      FROM resource_memberships
     WHERE root_all
       AND resource_type = 'channel'
       AND resource_id = root_channel_id
    UNION
    SELECT created_by AS user_id
      FROM channels
     WHERE root_all
       AND id = root_channel_id
       AND created_by IS NOT NULL
  ) AS participant
  WHERE participant.user_id IS NOT NULL
    AND participant.user_id <> NEW.sender_id
    AND NOT (
      participant.user_id = ANY(COALESCE(NEW.mentions, '{}'::uuid[]))
    );

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.restore_task_status_default()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.is_default THEN
    UPDATE status_group_statuses SET is_default = TRUE WHERE id = (
      SELECT id FROM status_group_statuses WHERE group_id = OLD.group_id
      ORDER BY position, created_at LIMIT 1
    );
  END IF;
  RETURN OLD;
END;
$function$;

CREATE OR REPLACE FUNCTION public.retire_task_reminder_notifications()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.due_date IS DISTINCT FROM OLD.due_date
    OR NEW.task_type_id IS DISTINCT FROM OLD.task_type_id
    OR lower(NEW.status) IN ('done', 'closed', 'cancelled', 'completed')
    OR EXISTS (SELECT 1 FROM public.lists l JOIN public.space_statuses ss ON ss.space_id = l.space_id
      WHERE l.id = NEW.list_id AND ss.name = NEW.status AND ss.category IN ('done', 'closed')) THEN
    UPDATE public.notifications SET is_read = true
    WHERE reference_id = NEW.id AND type = 'task_reminder' AND NOT is_read;
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.seed_default_label_group()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  INSERT INTO label_groups (workspace_id, name, is_default, position)
  VALUES (NEW.id, 'General', true, 0)
  ON CONFLICT (workspace_id, name) DO NOTHING;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_squad_note_root()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.parent_id IS NULL THEN
    NEW.root_id := NEW.id;
  ELSE
    SELECT root_id INTO NEW.root_id FROM squad_notes WHERE id = NEW.parent_id;
    IF NEW.root_id IS NULL THEN
      NEW.root_id := NEW.parent_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.snapshot_list_whiteboard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  old_nodes int := CASE WHEN jsonb_typeof(OLD.data->'nodes') = 'array'
                        THEN jsonb_array_length(OLD.data->'nodes') ELSE 0 END;
  old_edges int := CASE WHEN jsonb_typeof(OLD.data->'edges') = 'array'
                        THEN jsonb_array_length(OLD.data->'edges') ELSE 0 END;
BEGIN
  IF old_nodes > 0 AND OLD.data IS DISTINCT FROM NEW.data THEN
    INSERT INTO list_whiteboard_versions (list_id, data, node_count, edge_count, updated_by)
    VALUES (OLD.list_id, OLD.data, old_nodes, old_edges, OLD.updated_by);

    DELETE FROM list_whiteboard_versions v
    WHERE v.list_id = OLD.list_id
      AND v.id NOT IN (
        SELECT id FROM list_whiteboard_versions
        WHERE list_id = OLD.list_id
        ORDER BY saved_at DESC, id DESC
        LIMIT 40
      );
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.snapshot_whiteboard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  old_nodes int := CASE WHEN jsonb_typeof(OLD.data->'nodes') = 'array'
                        THEN jsonb_array_length(OLD.data->'nodes') ELSE 0 END;
  old_edges int := CASE WHEN jsonb_typeof(OLD.data->'edges') = 'array'
                        THEN jsonb_array_length(OLD.data->'edges') ELSE 0 END;
BEGIN
  IF old_nodes > 0 AND OLD.data IS DISTINCT FROM NEW.data THEN
    INSERT INTO whiteboard_versions (view_id, data, node_count, edge_count, updated_by)
    VALUES (OLD.view_id, OLD.data, old_nodes, old_edges, OLD.updated_by);

    DELETE FROM whiteboard_versions v
    WHERE v.view_id = OLD.view_id
      AND v.id NOT IN (
        SELECT id FROM whiteboard_versions
        WHERE view_id = OLD.view_id
        ORDER BY saved_at DESC, id DESC
        LIMIT 40
      );
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_status_groups_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_task_type_groups_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.validate_inherited_task_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE g public.status_groups;
BEGIN
  SELECT * INTO g FROM status_groups WHERE id = NEW.group_id FOR UPDATE;
  IF g.key = 'task_workflow' THEN
    NEW.is_system := TRUE;
    IF EXISTS (
      SELECT 1 FROM status_group_statuses s JOIN status_groups child ON child.id = s.group_id
      WHERE child.base_group_id = g.id AND
        ((NEW.key IS NOT NULL AND s.key = NEW.key) OR lower(s.name) = lower(NEW.name))
    ) THEN
      RAISE EXCEPTION 'This status conflicts with an addition in a linked group';
    END IF;
  ELSIF g.base_group_id IS NOT NULL THEN
    NEW.is_default := FALSE;
    IF EXISTS (
      SELECT 1 FROM status_group_statuses s WHERE s.group_id = g.base_group_id AND
        ((NEW.key IS NOT NULL AND s.key = NEW.key) OR lower(s.name) = lower(NEW.name))
    ) THEN
      RAISE EXCEPTION 'This status already exists in Default Task Statuses';
    END IF;
  END IF;
  IF NEW.is_default THEN
    UPDATE status_group_statuses SET is_default = FALSE
    WHERE group_id = NEW.group_id AND id <> NEW.id AND is_default;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.key IS DISTINCT FROM OLD.key THEN
    RAISE EXCEPTION 'Status keys are immutable';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.validate_status_group_inheritance()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.key = 'task_workflow' AND
    (NEW.base_group_id IS NOT NULL OR NOT NEW.is_default OR NOT NEW.is_enabled OR NOT NEW.is_system) THEN
    RAISE EXCEPTION 'Default Task Statuses must remain the enabled system default';
  END IF;
  IF NEW.key <> 'task_workflow' AND NEW.is_default THEN
    RAISE EXCEPTION 'Default Task Statuses is the system default';
  END IF;
  IF NEW.base_group_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM status_groups WHERE id = NEW.base_group_id AND key = 'task_workflow'
  ) THEN
    RAISE EXCEPTION 'Linked status groups must use Default Task Statuses as their primary group';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.current_actor_id()
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  RETURN NULLIF(current_setting('app.actor_id', true), '')::UUID;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.task_status_category(p_list_id uuid, p_status text)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN p_status = 'closed' THEN 'closed'::text
    ELSE (
      SELECT ss.category
      FROM public.lists l
      JOIN public.space_statuses ss ON ss.space_id = l.space_id
      WHERE l.id = p_list_id AND ss.name = p_status
      LIMIT 1
    )
  END
$function$;

-- ---------------------------------------------------------------- triggers
CREATE TRIGGER trg_folder_auto_member AFTER INSERT ON public.folders FOR EACH ROW EXECUTE FUNCTION auto_add_creator_as_manager('folder');
CREATE TRIGGER trg_space_auto_member AFTER INSERT ON public.spaces FOR EACH ROW EXECUTE FUNCTION auto_add_creator_as_manager('space');
CREATE TRIGGER trg_space_statuses AFTER INSERT ON public.spaces FOR EACH ROW EXECUTE FUNCTION auto_create_space_statuses();
CREATE TRIGGER trg_notify_task_assigned AFTER INSERT OR UPDATE OF assignee_ids ON public.tasks FOR EACH ROW EXECUTE FUNCTION notify_task_assigned();
CREATE TRIGGER trg_notify_task_completed AFTER UPDATE OF status ON public.tasks FOR EACH ROW EXECUTE FUNCTION notify_task_completed();
CREATE TRIGGER trg_notify_task_updated AFTER UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION notify_task_updated();
CREATE TRIGGER trg_retire_task_reminders AFTER UPDATE OF due_date, task_type_id, status ON public.tasks FOR EACH ROW EXECUTE FUNCTION retire_task_reminder_notifications();
CREATE TRIGGER trg_list_auto_member AFTER INSERT ON public.lists FOR EACH ROW EXECUTE FUNCTION auto_add_creator_as_manager('list');
CREATE TRIGGER trg_notify_task_commented AFTER INSERT ON public.task_comments FOR EACH ROW EXECUTE FUNCTION notify_task_commented();
CREATE TRIGGER trg_task_checklists_updated_at BEFORE UPDATE ON public.task_checklists FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_task_types_updated_at BEFORE UPDATE ON public.task_types FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_task_type_fields_updated_at BEFORE UPDATE ON public.task_type_fields FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_user_view_prefs_updated_at BEFORE UPDATE ON public.user_view_preferences FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_work_blocks_updated_at BEFORE UPDATE ON public.work_blocks FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_squad_notes_set_root BEFORE INSERT OR UPDATE OF parent_id ON public.squad_notes FOR EACH ROW EXECUTE FUNCTION set_squad_note_root();
CREATE TRIGGER trg_squad_notes_updated_at BEFORE UPDATE ON public.squad_notes FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_list_views_updated_at BEFORE UPDATE ON public.list_views FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_snapshot_whiteboard BEFORE UPDATE ON public.whiteboards FOR EACH ROW EXECUTE FUNCTION snapshot_whiteboard();
CREATE TRIGGER trg_whiteboards_updated_at BEFORE UPDATE ON public.whiteboards FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_channel_auto_member AFTER INSERT ON public.channels FOR EACH ROW EXECUTE FUNCTION auto_add_creator_as_manager('channel');
CREATE TRIGGER trg_checklist_items_updated_at BEFORE UPDATE ON public.task_checklist_items FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_user_office_timing_updated_at BEFORE UPDATE ON public.user_office_timing FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_capture_message_edit BEFORE UPDATE ON public.messages FOR EACH ROW EXECUTE FUNCTION capture_message_edit();
CREATE TRIGGER trg_notify_dm_received AFTER INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION notify_dm_received();
CREATE TRIGGER trg_notify_message_mention AFTER INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION notify_message_mention();
CREATE TRIGGER trg_notify_thread_reply AFTER INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION notify_thread_reply();
CREATE TRIGGER trg_list_whiteboards_updated_at BEFORE UPDATE ON public.list_whiteboards FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_snapshot_list_whiteboard BEFORE UPDATE ON public.list_whiteboards FOR EACH ROW EXECUTE FUNCTION snapshot_list_whiteboard();
CREATE TRIGGER goal_dependency_cycle BEFORE INSERT OR UPDATE ON public.goal_dependencies FOR EACH ROW EXECUTE FUNCTION check_goal_dependency_cycle();
CREATE TRIGGER trg_status_groups_updated_at BEFORE UPDATE ON public.status_groups FOR EACH ROW EXECUTE FUNCTION update_status_groups_updated_at();
CREATE TRIGGER validate_status_group_inheritance BEFORE INSERT OR UPDATE ON public.status_groups FOR EACH ROW EXECUTE FUNCTION validate_status_group_inheritance();
CREATE TRIGGER restore_task_status_default AFTER DELETE ON public.status_group_statuses FOR EACH ROW EXECUTE FUNCTION restore_task_status_default();
CREATE TRIGGER validate_inherited_task_status BEFORE INSERT OR UPDATE ON public.status_group_statuses FOR EACH ROW EXECUTE FUNCTION validate_inherited_task_status();
CREATE TRIGGER trg_task_type_groups_updated_at BEFORE UPDATE ON public.task_type_groups FOR EACH ROW EXECUTE FUNCTION update_task_type_groups_updated_at();

CREATE TRIGGER trg_chat_scheduled_messages_workspace BEFORE INSERT OR UPDATE OF channel_id, dm_conversation_id, workspace_id ON public.chat_scheduled_messages FOR EACH ROW EXECUTE FUNCTION saas_fill_workspace_id('channels:channel_id', 'dm_conversations:dm_conversation_id');
CREATE TRIGGER trg_folders_workspace BEFORE INSERT OR UPDATE OF space_id, workspace_id ON public.folders FOR EACH ROW EXECUTE FUNCTION saas_fill_workspace_id('spaces:space_id');
CREATE TRIGGER trg_goal_tasks_workspace BEFORE INSERT OR UPDATE OF goal_id, workspace_id ON public.goal_tasks FOR EACH ROW EXECUTE FUNCTION saas_fill_workspace_id('goals:goal_id');
CREATE TRIGGER trg_group_day_plans_workspace BEFORE INSERT OR UPDATE OF container_id, container_type, workspace_id ON public.group_day_plans FOR EACH ROW EXECUTE FUNCTION saas_fill_group_container_workspace();
CREATE TRIGGER trg_huddles_workspace BEFORE INSERT OR UPDATE OF channel_id, dm_conversation_id, workspace_id ON public.huddles FOR EACH ROW EXECUTE FUNCTION saas_fill_workspace_id('channels:channel_id', 'dm_conversations:dm_conversation_id');
CREATE TRIGGER trg_list_views_workspace BEFORE INSERT OR UPDATE OF list_id, workspace_id ON public.list_views FOR EACH ROW EXECUTE FUNCTION saas_fill_workspace_id('lists:list_id');
CREATE TRIGGER trg_list_whiteboards_workspace BEFORE INSERT OR UPDATE OF list_id, workspace_id ON public.list_whiteboards FOR EACH ROW EXECUTE FUNCTION saas_fill_workspace_id('lists:list_id');
CREATE TRIGGER trg_lists_workspace BEFORE INSERT OR UPDATE OF folder_id, space_id, workspace_id ON public.lists FOR EACH ROW EXECUTE FUNCTION saas_fill_workspace_id('folders:folder_id', 'spaces:space_id');
CREATE TRIGGER trg_meeting_events_workspace BEFORE INSERT OR UPDATE OF origin_channel_id, origin_dm_conversation_id, workspace_id ON public.meeting_events FOR EACH ROW EXECUTE FUNCTION saas_fill_workspace_id('channels:origin_channel_id', 'dm_conversations:origin_dm_conversation_id');
CREATE TRIGGER trg_messages_workspace BEFORE INSERT OR UPDATE OF channel_id, dm_conversation_id, workspace_id ON public.messages FOR EACH ROW EXECUTE FUNCTION saas_fill_workspace_id('channels:channel_id', 'dm_conversations:dm_conversation_id');
CREATE TRIGGER trg_notifications_workspace BEFORE INSERT ON public.notifications FOR EACH ROW EXECUTE FUNCTION saas_fill_notification_workspace();
CREATE TRIGGER trg_reactions_workspace BEFORE INSERT OR UPDATE OF message_id, workspace_id ON public.reactions FOR EACH ROW EXECUTE FUNCTION saas_fill_workspace_id('messages:message_id');
CREATE TRIGGER trg_resource_memberships_workspace BEFORE INSERT OR UPDATE OF resource_id, resource_type, workspace_id ON public.resource_memberships FOR EACH ROW EXECUTE FUNCTION saas_fill_membership_workspace();
CREATE TRIGGER trg_space_statuses_workspace BEFORE INSERT OR UPDATE OF space_id, workspace_id ON public.space_statuses FOR EACH ROW EXECUTE FUNCTION saas_fill_workspace_id('spaces:space_id');
CREATE TRIGGER trg_task_activity_workspace BEFORE INSERT OR UPDATE OF task_id, workspace_id ON public.task_activity FOR EACH ROW EXECUTE FUNCTION saas_fill_workspace_id('tasks:task_id');
CREATE TRIGGER trg_task_attachments_workspace BEFORE INSERT OR UPDATE OF task_id, workspace_id ON public.task_attachments FOR EACH ROW EXECUTE FUNCTION saas_fill_workspace_id('tasks:task_id');
CREATE TRIGGER trg_task_checklist_items_workspace BEFORE INSERT OR UPDATE OF checklist_id, workspace_id ON public.task_checklist_items FOR EACH ROW EXECUTE FUNCTION saas_fill_workspace_id('task_checklists:checklist_id');
CREATE TRIGGER trg_task_checklists_workspace BEFORE INSERT OR UPDATE OF task_id, workspace_id ON public.task_checklists FOR EACH ROW EXECUTE FUNCTION saas_fill_workspace_id('tasks:task_id');
CREATE TRIGGER trg_task_comments_workspace BEFORE INSERT OR UPDATE OF task_id, workspace_id ON public.task_comments FOR EACH ROW EXECUTE FUNCTION saas_fill_workspace_id('tasks:task_id');
CREATE TRIGGER trg_task_day_plans_workspace BEFORE INSERT OR UPDATE OF task_id, workspace_id ON public.task_day_plans FOR EACH ROW EXECUTE FUNCTION saas_fill_workspace_id('tasks:task_id');
CREATE TRIGGER trg_task_estimate_changes_workspace BEFORE INSERT OR UPDATE OF task_id, workspace_id ON public.task_estimate_changes FOR EACH ROW EXECUTE FUNCTION saas_fill_workspace_id('tasks:task_id');
CREATE TRIGGER trg_task_list_links_workspace BEFORE INSERT OR UPDATE OF task_id, workspace_id ON public.task_list_links FOR EACH ROW EXECUTE FUNCTION saas_fill_workspace_id('tasks:task_id');
CREATE TRIGGER trg_task_reviews_workspace BEFORE INSERT OR UPDATE OF task_id, workspace_id ON public.task_reviews FOR EACH ROW EXECUTE FUNCTION saas_fill_workspace_id('tasks:task_id');
CREATE TRIGGER trg_task_time_entries_workspace BEFORE INSERT OR UPDATE OF task_id, workspace_id ON public.task_time_entries FOR EACH ROW EXECUTE FUNCTION saas_fill_workspace_id('tasks:task_id');
CREATE TRIGGER trg_tasks_workspace BEFORE INSERT OR UPDATE OF list_id, workspace_id ON public.tasks FOR EACH ROW EXECUTE FUNCTION saas_fill_workspace_id('lists:list_id');
CREATE TRIGGER trg_whiteboards_workspace BEFORE INSERT OR UPDATE OF view_id, workspace_id ON public.whiteboards FOR EACH ROW EXECUTE FUNCTION saas_fill_workspace_id('list_views:view_id');
CREATE TRIGGER trg_work_block_runs_workspace BEFORE INSERT OR UPDATE OF task_id, workspace_id ON public.work_block_runs FOR EACH ROW EXECUTE FUNCTION saas_fill_workspace_id('tasks:task_id');
CREATE TRIGGER trg_work_blocks_workspace BEFORE INSERT OR UPDATE OF task_id, workspace_id ON public.work_blocks FOR EACH ROW EXECUTE FUNCTION saas_fill_workspace_id('tasks:task_id');

-- tasks / lists / folders may move between containers only inside one workspace.
-- (Re-parenting re-runs the fill trigger, which rejects a parent in another workspace.)
CREATE TRIGGER trg_spaces_ws_immutable BEFORE UPDATE OF workspace_id ON public.spaces FOR EACH ROW EXECUTE FUNCTION saas_guard_workspace_change();
CREATE TRIGGER trg_channels_ws_immutable BEFORE UPDATE OF workspace_id ON public.channels FOR EACH ROW EXECUTE FUNCTION saas_guard_workspace_change();
CREATE TRIGGER trg_dm_conversations_ws_immutable BEFORE UPDATE OF workspace_id ON public.dm_conversations FOR EACH ROW EXECUTE FUNCTION saas_guard_workspace_change();
CREATE TRIGGER trg_workspaces_updated_at BEFORE UPDATE ON public.workspaces FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_plans_updated_at BEFORE UPDATE ON public.plans FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_swl_updated_at BEFORE UPDATE ON public.shared_workspace_links FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_invitations_updated_at BEFORE UPDATE ON public.invitations FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_seed_default_label_group AFTER INSERT ON public.workspaces FOR EACH ROW EXECUTE FUNCTION seed_default_label_group();

-- ---------------------------------------------------------------- RLS + grants (server-only)
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shared_workspace_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_mini_apps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_favorites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_scheduled_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checkin_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checkins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_time_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dm_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dm_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.favorites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feature_tip_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feature_tips ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.goal_dependencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.goal_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.goal_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.goal_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_day_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_run_completions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_run_task_times ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.holidays ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.huddle_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.huddles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.label_create_role_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.label_create_user_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.label_group_role_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.label_group_user_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.label_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.label_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.list_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_event_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_event_guests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_event_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_slot_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_suggestion_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_edits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mini_apps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_app_installs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_push_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resource_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.skill_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.space_statuses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.squad_note_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.squad_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.squadhire_sso_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.status_group_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.status_group_statuses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.status_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_checklist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_checklists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_day_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_estimate_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_list_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_tag_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_time_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_type_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_type_group_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_type_group_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_type_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_type_role_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_type_user_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.timer_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_checkin_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_office_timing ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_view_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.web_push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whiteboards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whiteboard_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.list_whiteboards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.list_whiteboard_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_reminder_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_block_completions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_block_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_block_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_block_task_times ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.working_days_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_member_secondary_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated, PUBLIC;
GRANT USAGE ON SCHEMA public TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;

-- ---------------------------------------------------------------- seed (global catalogs)
ALTER TABLE public.status_groups DISABLE TRIGGER validate_status_group_inheritance;
ALTER TABLE public.status_group_statuses DISABLE TRIGGER validate_inherited_task_status;
INSERT INTO public.roles (id, name, permissions, is_default, color, updated_at, created_at, is_system, system_key) VALUES ('1424d19e-1a33-4d70-b260-846d2072081a', 'User', '{"can_manage_roles": false, "can_manage_tasks": false, "can_edit_time_logs": false, "can_manage_members": false, "can_delete_messages": false, "can_manage_channels": false, "can_manage_workspace": false, "can_view_admin_panel": false, "time_edit_window_hours": 0}'::jsonb, false, '#0ea5e9', '2026-04-19T15:01:15.065711+00:00', '2026-04-19T15:01:15.065711+00:00', true, 'user') ON CONFLICT DO NOTHING;
INSERT INTO public.roles (id, name, permissions, is_default, color, updated_at, created_at, is_system, system_key) VALUES ('88c162e9-e63b-4cfc-90af-9a5b82499a76', 'Member', '{"can_send_dms": true, "can_create_lists": true, "can_manage_roles": false, "can_manage_tasks": true, "can_archive_lists": false, "can_create_spaces": true, "can_edit_messages": true, "can_archive_spaces": false, "can_create_folders": true, "can_edit_time_logs": true, "can_manage_members": false, "can_archive_folders": false, "can_create_channels": true, "can_delete_messages": false, "can_manage_channels": false, "can_manage_workspace": false, "can_view_admin_panel": false, "time_edit_window_hours": 0}'::jsonb, true, '#22c55e', '2026-04-22T09:50:45.91+00:00', '2026-03-19T20:13:21.16286+00:00', true, 'member') ON CONFLICT DO NOTHING;
INSERT INTO public.roles (id, name, permissions, is_default, color, updated_at, created_at, is_system, system_key) VALUES ('9c61e135-e3cd-49f7-a813-e7e7384e5d92', 'Admin', '{"can_send_dms": true, "can_create_lists": true, "can_manage_roles": true, "can_manage_tasks": true, "can_archive_lists": true, "can_create_spaces": true, "can_edit_messages": true, "can_archive_spaces": true, "can_create_folders": true, "can_edit_time_logs": true, "can_manage_members": true, "can_archive_folders": true, "can_create_channels": true, "can_delete_messages": true, "can_manage_channels": true, "can_manage_workspace": true, "can_view_admin_panel": true, "can_edit_elapsed_time": true, "time_edit_window_hours": 0}'::jsonb, false, '#d97706', '2026-09-01T03:15:55.171788+00:00', '2026-09-01T03:15:55.171788+00:00', true, 'admin') ON CONFLICT DO NOTHING;
INSERT INTO public.roles (id, name, permissions, is_default, color, updated_at, created_at, is_system, system_key) VALUES ('e6bba6c3-1093-4b10-9fe0-e5783eab6602', 'Guest', '{"can_manage_roles": false, "can_manage_tasks": false, "can_edit_time_logs": false, "can_manage_members": false, "can_delete_messages": false, "can_manage_channels": false, "can_manage_workspace": false, "can_view_admin_panel": false, "time_edit_window_hours": 0}'::jsonb, false, '#94a3b8', '2026-04-19T15:01:15.065711+00:00', '2026-04-19T15:01:15.065711+00:00', true, 'guest') ON CONFLICT DO NOTHING;
INSERT INTO public.roles (id, name, permissions, is_default, color, updated_at, created_at, is_system, system_key) VALUES ('10483793-a723-4d02-8b7d-48257a11fe21', 'Managers', '{"can_send_dms": true, "can_create_lists": true, "can_manage_roles": false, "can_manage_tasks": true, "can_archive_lists": true, "can_create_spaces": true, "can_edit_messages": true, "can_archive_spaces": true, "can_create_folders": true, "can_edit_time_logs": true, "can_manage_members": true, "can_archive_folders": true, "can_create_channels": true, "can_delete_messages": true, "can_manage_channels": true, "can_manage_workspace": false, "can_view_admin_panel": false, "can_edit_elapsed_time": true, "time_edit_window_hours": 0}'::jsonb, false, '#7c3aed', '2026-09-01T03:15:55.171788+00:00', '2026-09-01T03:15:55.171788+00:00', true, 'manager') ON CONFLICT DO NOTHING;
INSERT INTO public.roles (id, name, permissions, is_default, color, updated_at, created_at, is_system, system_key) VALUES ('318315ca-b95b-4014-a3e7-5d901c4ba6d8', 'Squad Manager', '{"can_manage_roles": false, "can_manage_tasks": false, "can_edit_time_logs": false, "can_manage_members": false, "can_delete_messages": false, "can_manage_channels": false, "can_manage_workspace": false, "can_view_admin_panel": false, "time_edit_window_hours": 0}'::jsonb, false, '#9333ea', '2026-04-19T05:09:04.705423+00:00', '2026-04-19T05:09:04.705423+00:00', true, NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.roles (id, name, permissions, is_default, color, updated_at, created_at, is_system, system_key) VALUES ('8a9f2a4a-95fc-4a58-8f83-ccfb4b664258', 'Client User', '{"can_manage_roles": false, "can_manage_tasks": false, "can_edit_time_logs": false, "can_manage_members": false, "can_delete_messages": false, "can_manage_channels": false, "can_manage_workspace": false, "can_view_admin_panel": false, "time_edit_window_hours": 0}'::jsonb, false, '#6b7280', '2026-04-19T05:09:04.705423+00:00', '2026-04-19T05:09:04.705423+00:00', true, NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.status_groups (id, key, name, description, icon, color, "position", is_default, is_system, is_enabled, created_at, updated_at, base_group_id, custom_sections, disabled_status_keys, status_replacements, is_stage_workflow) VALUES ('aece2309-f1e1-4311-b603-df8cfa6f74a4', 'design_workflow', 'Design Workflow', 'Request → lineup → assigned → work in progress → changes → review → closed. Used by designer and video editor spaces.', 'palette', '#8b5cf6', 1, false, true, false, '2026-10-05T21:42:03.951094+00:00', '2026-10-16T22:00:29.259744+00:00', NULL, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb, false) ON CONFLICT DO NOTHING;
INSERT INTO public.status_groups (id, key, name, description, icon, color, "position", is_default, is_system, is_enabled, created_at, updated_at, base_group_id, custom_sections, disabled_status_keys, status_replacements, is_stage_workflow) VALUES ('de81ee77-9db8-4114-a731-52972e26b38d', 'coding_workflow', 'Coding Workflow', 'Software development lifecycle: Urgency, In Motion, Up Next, Queued, Routines, Blocked, Not Started, Closed.', 'code', '#0ea5e9', 3, false, true, false, '2026-10-07T00:35:31.074573+00:00', '2026-10-16T22:00:29.259744+00:00', NULL, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb, false) ON CONFLICT DO NOTHING;
INSERT INTO public.status_groups (id, key, name, description, icon, color, "position", is_default, is_system, is_enabled, created_at, updated_at, base_group_id, custom_sections, disabled_status_keys, status_replacements, is_stage_workflow) VALUES ('49abd7d3-db30-4d32-8c1f-3599d6e607fd', 'general_workflow', 'General Workflow', 'Default To Do / In Progress / Done flow for areas, folders and lists.', 'flag', '#6b7280', 0, false, true, false, '2026-10-05T21:42:03.951094+00:00', '2026-10-16T22:00:29.259744+00:00', NULL, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb, false) ON CONFLICT DO NOTHING;
INSERT INTO public.status_groups (id, key, name, description, icon, color, "position", is_default, is_system, is_enabled, created_at, updated_at, base_group_id, custom_sections, disabled_status_keys, status_replacements, is_stage_workflow) VALUES ('6389d8a9-e5e8-4e10-bb1a-0d38e4341d92', 'stages_system', 'System Stages', 'Shared by every stage workflow: NEW, the Blocked / Paused placeholders, CLOSED and CANCELLED.', 'lock', '#475569', 9, false, true, false, '2026-10-08T13:19:05.477013+00:00', '2026-10-16T22:00:29.259744+00:00', NULL, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb, true) ON CONFLICT DO NOTHING;
INSERT INTO public.status_groups (id, key, name, description, icon, color, "position", is_default, is_system, is_enabled, created_at, updated_at, base_group_id, custom_sections, disabled_status_keys, status_replacements, is_stage_workflow) VALUES ('7d433f4b-58d5-4525-895d-ab76d53a996f', 'task_workflow', 'Workspace default', 'Default stages and statuses used across the workspace.', 'zap', '#e11d48', 2, true, true, true, '2026-10-05T22:18:38.699923+00:00', '2026-10-16T22:29:28.685166+00:00', NULL, '[{"key": "in_motion", "color": "#39C66B", "emoji": "\ud83c\udfc3", "label": "In progress", "position": 10}, {"key": "up_next", "color": "#3b8ee6", "emoji": "\ud83c\udfaf", "label": "Up next", "position": 20}, {"key": "scheduled_queued", "color": "#2ea3b8", "emoji": "\ud83d\udcc5", "label": "Scheduled / queued", "position": 30}, {"key": "planning", "color": "#8b6fd6", "emoji": "\ud83e\udded", "label": "Planning", "position": 40}, {"key": "blocked_paused", "color": "#FFB340", "emoji": "\u23f8\ufe0f", "label": "Blocked / paused", "position": 50}, {"key": "not_started", "color": "#A0A0A0", "emoji": "\ud83d\udce5", "label": "Not started", "position": 60}, {"key": "done", "color": "#7c3aed", "emoji": "\u2705", "label": "Closed", "position": 70}]'::jsonb, '[]'::jsonb, '{}'::jsonb, false) ON CONFLICT DO NOTHING;
INSERT INTO public.status_group_statuses (id, group_id, name, color, "position", is_default, category, created_at, key, description, section, section_label, section_emoji, is_system, is_placeholder, is_archived) VALUES ('4f536c65-d1a4-41ac-a32d-15c7700a2062', '49abd7d3-db30-4d32-8c1f-3599d6e607fd', 'To Do', '#6b7280', 0, true, 'todo', '2026-10-05T21:42:03.951094+00:00', NULL, '', NULL, NULL, NULL, false, false, false) ON CONFLICT DO NOTHING;
INSERT INTO public.status_group_statuses (id, group_id, name, color, "position", is_default, category, created_at, key, description, section, section_label, section_emoji, is_system, is_placeholder, is_archived) VALUES ('a173e5ad-ff03-4c0d-9590-91ab741cb9c5', '49abd7d3-db30-4d32-8c1f-3599d6e607fd', 'In Progress', '#3b82f6', 1, false, 'active', '2026-10-05T21:42:03.951094+00:00', NULL, '', NULL, NULL, NULL, false, false, false) ON CONFLICT DO NOTHING;
INSERT INTO public.status_group_statuses (id, group_id, name, color, "position", is_default, category, created_at, key, description, section, section_label, section_emoji, is_system, is_placeholder, is_archived) VALUES ('f09f78cc-416b-4b45-8801-23a573139e01', '49abd7d3-db30-4d32-8c1f-3599d6e607fd', 'Done', '#22c55e', 2, false, 'done', '2026-10-05T21:42:03.951094+00:00', NULL, '', NULL, NULL, NULL, false, false, false) ON CONFLICT DO NOTHING;
INSERT INTO public.status_group_statuses (id, group_id, name, color, "position", is_default, category, created_at, key, description, section, section_label, section_emoji, is_system, is_placeholder, is_archived) VALUES ('3fd868a9-0312-4f23-9557-d02adae11538', 'aece2309-f1e1-4311-b603-df8cfa6f74a4', 'New Request', '#6b7280', 0, true, 'todo', '2026-10-05T21:42:03.951094+00:00', NULL, '', NULL, NULL, NULL, false, false, false) ON CONFLICT DO NOTHING;
INSERT INTO public.status_group_statuses (id, group_id, name, color, "position", is_default, category, created_at, key, description, section, section_label, section_emoji, is_system, is_placeholder, is_archived) VALUES ('970637de-e121-4f86-b20c-64eb7ad78791', 'aece2309-f1e1-4311-b603-df8cfa6f74a4', 'Checking', '#9ca3af', 1, false, 'todo', '2026-10-05T21:42:03.951094+00:00', NULL, '', NULL, NULL, NULL, false, false, false) ON CONFLICT DO NOTHING;
INSERT INTO public.status_group_statuses (id, group_id, name, color, "position", is_default, category, created_at, key, description, section, section_label, section_emoji, is_system, is_placeholder, is_archived) VALUES ('5354e822-afa5-41a7-afa6-f3da7bb03bf5', 'aece2309-f1e1-4311-b603-df8cfa6f74a4', 'Line-up', '#38bdf8', 2, false, 'active', '2026-10-05T21:42:03.951094+00:00', NULL, '', NULL, NULL, NULL, false, false, false) ON CONFLICT DO NOTHING;
INSERT INTO public.status_group_statuses (id, group_id, name, color, "position", is_default, category, created_at, key, description, section, section_label, section_emoji, is_system, is_placeholder, is_archived) VALUES ('31bbc4d8-59be-492f-9bba-ed70e1f5a2ac', 'aece2309-f1e1-4311-b603-df8cfa6f74a4', 'Assigned', '#3b82f6', 3, false, 'active', '2026-10-05T21:42:03.951094+00:00', NULL, '', NULL, NULL, NULL, false, false, false) ON CONFLICT DO NOTHING;
INSERT INTO public.status_group_statuses (id, group_id, name, color, "position", is_default, category, created_at, key, description, section, section_label, section_emoji, is_system, is_placeholder, is_archived) VALUES ('2a8dec47-f78e-415a-9e26-20b6c0b53a0e', 'aece2309-f1e1-4311-b603-df8cfa6f74a4', 'Work in Progress', '#f59e0b', 4, false, 'active', '2026-10-05T21:42:03.951094+00:00', NULL, '', NULL, NULL, NULL, false, false, false) ON CONFLICT DO NOTHING;
INSERT INTO public.status_group_statuses (id, group_id, name, color, "position", is_default, category, created_at, key, description, section, section_label, section_emoji, is_system, is_placeholder, is_archived) VALUES ('ebacbfee-9c5a-454b-a8aa-c490cd911d2c', 'aece2309-f1e1-4311-b603-df8cfa6f74a4', 'Changes', '#f97316', 5, false, 'done', '2026-10-05T21:42:03.951094+00:00', NULL, '', NULL, NULL, NULL, false, false, false) ON CONFLICT DO NOTHING;
INSERT INTO public.status_group_statuses (id, group_id, name, color, "position", is_default, category, created_at, key, description, section, section_label, section_emoji, is_system, is_placeholder, is_archived) VALUES ('f191036e-54b6-4ed5-bf8d-9af66e04054b', 'aece2309-f1e1-4311-b603-df8cfa6f74a4', 'For Review', '#8b5cf6', 6, false, 'done', '2026-10-05T21:42:03.951094+00:00', NULL, '', NULL, NULL, NULL, false, false, false) ON CONFLICT DO NOTHING;
INSERT INTO public.status_group_statuses (id, group_id, name, color, "position", is_default, category, created_at, key, description, section, section_label, section_emoji, is_system, is_placeholder, is_archived) VALUES ('01415882-4c26-4de8-9971-ffa880c17682', 'de81ee77-9db8-4114-a731-52972e26b38d', 'FOCUS NOW', '#e11d48', 0, false, 'active', '2026-10-07T00:35:31.154858+00:00', 'focus_now', 'Requires your undivided attention right now.', 'priority_urgency', 'Priority & Urgency', '⚡', false, false, false) ON CONFLICT DO NOTHING;
INSERT INTO public.status_group_statuses (id, group_id, name, color, "position", is_default, category, created_at, key, description, section, section_label, section_emoji, is_system, is_placeholder, is_archived) VALUES ('a692553e-6472-4149-a7dd-b773ae5c00d8', '7d433f4b-58d5-4525-895d-ab76d53a996f', 'Front burner', '#39C66B', 1, false, 'active', '2026-10-05T22:18:38.699923+00:00', 'front_burner', 'Actively working on this task daily. Will complete asap.', 'in_motion', NULL, NULL, true, false, false) ON CONFLICT DO NOTHING;
INSERT INTO public.status_group_statuses (id, group_id, name, color, "position", is_default, category, created_at, key, description, section, section_label, section_emoji, is_system, is_placeholder, is_archived) VALUES ('c18b6e0b-94c8-4b76-9530-add31978056e', '7d433f4b-58d5-4525-895d-ab76d53a996f', 'Back burner', '#a8a29e', 2, false, 'active', '2026-10-05T22:18:38.699923+00:00', 'back_burner', 'Working on this task on regular intervals. Will complete eventually.', 'in_motion', NULL, NULL, true, false, false) ON CONFLICT DO NOTHING;
INSERT INTO public.status_group_statuses (id, group_id, name, color, "position", is_default, category, created_at, key, description, section, section_label, section_emoji, is_system, is_placeholder, is_archived) VALUES ('e6af44bd-08ae-4bcb-aab7-9c32f218f694', '7d433f4b-58d5-4525-895d-ab76d53a996f', 'Tomorrow', '#06b6d4', 5, false, 'active', '2026-10-05T22:18:38.699923+00:00', 'tomorrow', 'Planned for the next day.', 'up_next', NULL, NULL, true, false, false) ON CONFLICT DO NOTHING;
INSERT INTO public.status_group_statuses (id, group_id, name, color, "position", is_default, category, created_at, key, description, section, section_label, section_emoji, is_system, is_placeholder, is_archived) VALUES ('4c97ff35-c873-4287-bd3b-b975ed7d5ecc', '7d433f4b-58d5-4525-895d-ab76d53a996f', 'This week', '#22d3ee', 6, false, 'active', '2026-10-05T22:18:38.699923+00:00', 'this_week', 'To be handled sometime this week.', 'scheduled_queued', NULL, NULL, true, false, false) ON CONFLICT DO NOTHING;
INSERT INTO public.status_group_statuses (id, group_id, name, color, "position", is_default, category, created_at, key, description, section, section_label, section_emoji, is_system, is_placeholder, is_archived) VALUES ('e2c24ea1-805a-4b39-ab82-07e5ef963a3c', '7d433f4b-58d5-4525-895d-ab76d53a996f', 'Scheduled', '#60a5fa', 7, false, 'active', '2026-10-05T22:18:38.699923+00:00', 'scheduled', 'Has a specific date/time set.', 'scheduled_queued', NULL, NULL, true, false, false) ON CONFLICT DO NOTHING;
INSERT INTO public.status_group_statuses (id, group_id, name, color, "position", is_default, category, created_at, key, description, section, section_label, section_emoji, is_system, is_placeholder, is_archived) VALUES ('432c43d2-c212-4f37-b561-4efed16cd408', '7d433f4b-58d5-4525-895d-ab76d53a996f', 'Open', '#9ca3af', 16, true, 'todo', '2026-10-05T22:18:38.699923+00:00', 'open', 'Newly created task, not yet triaged or planned.', 'not_started', NULL, NULL, true, false, false) ON CONFLICT DO NOTHING;
INSERT INTO public.status_group_statuses (id, group_id, name, color, "position", is_default, category, created_at, key, description, section, section_label, section_emoji, is_system, is_placeholder, is_archived) VALUES ('ceedfa0d-51ed-4673-8cfc-04750a0787b2', '7d433f4b-58d5-4525-895d-ab76d53a996f', 'EMPTY', '#d1d5db', 128, false, 'todo', '2026-10-05T22:18:38.699923+00:00', 'empty', 'Placeholder task with no details filled in yet.', 'not_started', 'Not Started', '📥', true, false, true) ON CONFLICT DO NOTHING;
INSERT INTO public.status_group_statuses (id, group_id, name, color, "position", is_default, category, created_at, key, description, section, section_label, section_emoji, is_system, is_placeholder, is_archived) VALUES ('49d7766c-122c-4d74-93a1-9b39eab7006e', '7d433f4b-58d5-4525-895d-ab76d53a996f', 'REMINDER', '#93c5fd', 115, false, 'active', '2026-10-05T22:18:38.699923+00:00', 'reminder', 'A nudge to do or check something later.', 'scheduled_queued', 'Scheduled / Queued', '📅', true, false, true) ON CONFLICT DO NOTHING;
INSERT INTO public.status_group_statuses (id, group_id, name, color, "position", is_default, category, created_at, key, description, section, section_label, section_emoji, is_system, is_placeholder, is_archived) VALUES ('f6801e6f-0b4d-4593-84d9-8f45fcca379e', 'de81ee77-9db8-4114-a731-52972e26b38d', 'IN PROGRESS', '#16a34a', 7, false, 'active', '2026-10-07T00:35:31.624766+00:00', 'in_progress', 'Work has started and is ongoing.', 'in_motion', 'In Motion', '🏃', false, false, false) ON CONFLICT DO NOTHING;
INSERT INTO public.status_group_statuses (id, group_id, name, color, "position", is_default, category, created_at, key, description, section, section_label, section_emoji, is_system, is_placeholder, is_archived) VALUES ('41035dc6-4a41-49ad-a6a6-76b7eecd045a', '7d433f4b-58d5-4525-895d-ab76d53a996f', 'UP NEXT', '#38bdf8', 111, false, 'active', '2026-10-05T22:18:38.699923+00:00', 'up_next', 'Next in line after current work wraps up.', 'scheduled_queued', 'Scheduled / Queued', '📅', true, false, true) ON CONFLICT DO NOTHING;
INSERT INTO public.status_group_statuses (id, group_id, name, color, "position", is_default, category, created_at, key, description, section, section_label, section_emoji, is_system, is_placeholder, is_archived) VALUES ('ad65b078-f977-4912-89ff-53f7ff4ff739', 'aece2309-f1e1-4311-b603-df8cfa6f74a4', 'Closed', '#22c55e', 7, false, 'closed', '2026-10-05T21:42:03.951094+00:00', 'closed', '', NULL, NULL, NULL, true, false, false) ON CONFLICT DO NOTHING;
INSERT INTO public.status_group_statuses (id, group_id, name, color, "position", is_default, category, created_at, key, description, section, section_label, section_emoji, is_system, is_placeholder, is_archived) VALUES ('f0898ff3-d7f4-4384-8197-bfbd615a5469', 'de81ee77-9db8-4114-a731-52972e26b38d', 'ACTIVE', '#22c55e', 8, false, 'active', '2026-10-07T00:35:31.560852+00:00', 'active', 'Currently being worked on.', 'in_motion', 'In Motion', '🏃', false, false, false) ON CONFLICT DO NOTHING;
INSERT INTO public.status_group_statuses (id, group_id, name, color, "position", is_default, category, created_at, key, description, section, section_label, section_emoji, is_system, is_placeholder, is_archived) VALUES ('c44c0fd3-3c8d-47ab-92bc-76d2d8922d9c', 'de81ee77-9db8-4114-a731-52972e26b38d', 'HIGH PRIORITY', '#f97316', 11, false, 'active', '2026-10-07T00:35:31.423014+00:00', 'high_priority', 'Very important; needs attention soon.', 'up_next', 'Up Next', '🎯', false, false, false) ON CONFLICT DO NOTHING;
INSERT INTO public.status_group_statuses (id, group_id, name, color, "position", is_default, category, created_at, key, description, section, section_label, section_emoji, is_system, is_placeholder, is_archived) VALUES ('2f69afd2-670e-4b93-bdae-f7ca9083d5a2', '7d433f4b-58d5-4525-895d-ab76d53a996f', 'FOCUS NOW', '#e11d48', 100, false, 'active', '2026-10-05T22:18:38.699923+00:00', 'focus_now', 'Requires your undivided attention right now.', 'priority_urgency', 'Priority & Urgency', '⚡', true, false, true) ON CONFLICT DO NOTHING;
INSERT INTO public.status_group_statuses (id, group_id, name, color, "position", is_default, category, created_at, key, description, section, section_label, section_emoji, is_system, is_placeholder, is_archived) VALUES ('e5403691-07b6-4ebb-9461-ad739b0d00ff', '7d433f4b-58d5-4525-895d-ab76d53a996f', 'EMERGENCY', '#b91c1c', 101, false, 'active', '2026-10-05T22:18:38.699923+00:00', 'emergency', 'Critical; drop everything.', 'priority_urgency', 'Priority & Urgency', '⚡', true, false, true) ON CONFLICT DO NOTHING;
INSERT INTO public.status_group_statuses (id, group_id, name, color, "position", is_default, category, created_at, key, description, section, section_label, section_emoji, is_system, is_placeholder, is_archived) VALUES ('9987ed3e-63e3-46ad-9ead-1b1af6f57a9f', '7d433f4b-58d5-4525-895d-ab76d53a996f', 'URGENT', '#ef4444', 102, false, 'active', '2026-10-05T22:18:38.699923+00:00', 'urgent', 'Needs immediate action.', 'priority_urgency', 'Priority & Urgency', '⚡', true, false, true) ON CONFLICT DO NOTHING;
INSERT INTO public.status_group_statuses (id, group_id, name, color, "position", is_default, category, created_at, key, description, section, section_label, section_emoji, is_system, is_placeholder, is_archived) VALUES ('bf495a28-0f81-45c8-8339-d7f61bee74c3', '7d433f4b-58d5-4525-895d-ab76d53a996f', 'HIGH PRIORITY', '#f97316', 109, false, 'active', '2026-10-05T22:18:38.699923+00:00', 'high_priority', 'Very important; needs attention soon.', 'up_next', 'Up Next', '🎯', true, false, true) ON CONFLICT DO NOTHING;
INSERT INTO public.status_group_statuses (id, group_id, name, color, "position", is_default, category, created_at, key, description, section, section_label, section_emoji, is_system, is_placeholder, is_archived) VALUES ('d3ae1574-079e-4b48-b390-97679280c414', '7d433f4b-58d5-4525-895d-ab76d53a996f', 'IN PROGRESS', '#16a34a', 105, false, 'active', '2026-10-05T22:18:38.699923+00:00', 'in_progress', 'Work has started and is ongoing.', 'in_motion', 'In Motion', '🏃', true, false, true) ON CONFLICT DO NOTHING;
INSERT INTO public.status_group_statuses (id, group_id, name, color, "position", is_default, category, created_at, key, description, section, section_label, section_emoji, is_system, is_placeholder, is_archived) VALUES ('b8e2fdc6-29a6-45a1-a18e-cc8cf357cec1', '7d433f4b-58d5-4525-895d-ab76d53a996f', 'IMP ROUTINES', '#7c3aed', 120, false, 'active', '2026-10-05T22:18:38.699923+00:00', 'imp_routines', 'Important recurring task that cannot be missed.', 'routines', 'Routines', '🔁', true, false, true) ON CONFLICT DO NOTHING;
INSERT INTO public.status_group_statuses (id, group_id, name, color, "position", is_default, category, created_at, key, description, section, section_label, section_emoji, is_system, is_placeholder, is_archived) VALUES ('84f7f393-6d5e-4242-9e6b-80cff15954d1', '7d433f4b-58d5-4525-895d-ab76d53a996f', 'ROUTINES', '#a855f7', 119, false, 'active', '2026-10-05T22:18:38.699923+00:00', 'routines', 'Regular recurring task.', 'routines', 'Routines', '🔁', true, false, true) ON CONFLICT DO NOTHING;
INSERT INTO public.status_group_statuses (id, group_id, name, color, "position", is_default, category, created_at, key, description, section, section_label, section_emoji, is_system, is_placeholder, is_archived) VALUES ('b3d27373-8099-43c8-b33d-b6668e96baf3', '7d433f4b-58d5-4525-895d-ab76d53a996f', 'Normal Priority', '#3c7cfb', 110, false, 'active', '2026-10-05T22:18:38.699923+00:00', 'priority', 'Important; above normal.', 'up_next', 'Up Next', '🎯', true, false, true) ON CONFLICT DO NOTHING;
INSERT INTO public.status_group_statuses (id, group_id, name, color, "position", is_default, category, created_at, key, description, section, section_label, section_emoji, is_system, is_placeholder, is_archived) VALUES ('2bf311da-ef89-4612-bc53-34ff78258dea', 'de81ee77-9db8-4114-a731-52972e26b38d', 'EMERGENCY', '#b91c1c', 1, false, 'active', '2026-10-07T00:35:31.223706+00:00', 'emergency', 'Critical; drop everything.', 'priority_urgency', 'Priority & Urgency', '⚡', false, false, false) ON CONFLICT DO NOTHING;
INSERT INTO public.status_group_statuses (id, group_id, name, color, "position", is_default, category, created_at, key, description, section, section_label, section_emoji, is_system, is_placeholder, is_archived) VALUES ('be6e450c-5c37-4f9d-a9c8-5aa5aa46143b', 'de81ee77-9db8-4114-a731-52972e26b38d', 'READY FOR DEPLOY', '#0d9488', 4, false, 'active', '2026-10-07T00:35:31.830032+00:00', 'ready_for_deploy', 'Approved and ready for production release.', 'in_motion', 'In Motion', '🏃', false, false, false) ON CONFLICT DO NOTHING;
INSERT INTO public.status_group_statuses (id, group_id, name, color, "position", is_default, category, created_at, key, description, section, section_label, section_emoji, is_system, is_placeholder, is_archived) VALUES ('7cce23ce-3346-46d9-bf23-b6cf57c0d1f3', 'de81ee77-9db8-4114-a731-52972e26b38d', 'IN CODE REVIEW', '#8b5cf6', 5, false, 'active', '2026-10-07T00:35:31.690116+00:00', 'in_code_review', 'PR submitted; awaiting review and approval.', 'in_motion', 'In Motion', '🏃', false, false, false) ON CONFLICT DO NOTHING;
INSERT INTO public.status_group_statuses (id, group_id, name, color, "position", is_default, category, created_at, key, description, section, section_label, section_emoji, is_system, is_placeholder, is_archived) VALUES ('e946e1b6-4e36-4f5e-ad86-78bd7577ab8a', 'de81ee77-9db8-4114-a731-52972e26b38d', 'TESTING / QA', '#eab308', 6, false, 'active', '2026-10-07T00:35:31.763586+00:00', 'testing_qa', 'Under validation on staging / test environment.', 'in_motion', 'In Motion', '🏃', false, false, false) ON CONFLICT DO NOTHING;
INSERT INTO public.status_group_statuses (id, group_id, name, color, "position", is_default, category, created_at, key, description, section, section_label, section_emoji, is_system, is_placeholder, is_archived) VALUES ('42efc7bf-e935-41fd-b208-97104b570af9', 'de81ee77-9db8-4114-a731-52972e26b38d', 'BACK BURNER', '#a8a29e', 14, false, 'active', '2026-10-07T00:35:32.482231+00:00', 'back_burner', 'Low priority; get to it eventually.', 'scheduled_queued', 'Scheduled / Queued', '📅', false, false, false) ON CONFLICT DO NOTHING;
INSERT INTO public.status_group_statuses (id, group_id, name, color, "position", is_default, category, created_at, key, description, section, section_label, section_emoji, is_system, is_placeholder, is_archived) VALUES ('d0e4a1d0-c74e-4162-a3e8-ec9608431e43', 'de81ee77-9db8-4114-a731-52972e26b38d', 'THIS WEEK', '#22d3ee', 16, false, 'active', '2026-10-07T00:35:32.424415+00:00', 'this_week', 'To be handled sometime this week.', 'scheduled_queued', 'Scheduled / Queued', '📅', false, false, false) ON CONFLICT DO NOTHING;
INSERT INTO public.status_group_statuses (id, group_id, name, color, "position", is_default, category, created_at, key, description, section, section_label, section_emoji, is_system, is_placeholder, is_archived) VALUES ('87b3cb1e-1a50-4522-90a0-35524aadcb0c', 'de81ee77-9db8-4114-a731-52972e26b38d', 'IMP ROUTINES', '#7c3aed', 19, false, 'active', '2026-10-07T00:35:32.678868+00:00', 'imp_routines', 'Important recurring task that cannot be missed.', 'routines', 'Routines', '🔁', false, false, false) ON CONFLICT DO NOTHING;
INSERT INTO public.status_group_statuses (id, group_id, name, color, "position", is_default, category, created_at, key, description, section, section_label, section_emoji, is_system, is_placeholder, is_archived) VALUES ('25ce57bf-fab9-49c3-afdf-7df1711fb936', '7d433f4b-58d5-4525-895d-ab76d53a996f', 'Unblocked', '#84cc16', 15, false, 'active', '2026-10-05T22:18:38.699923+00:00', 'unblocked', 'Was blocked, now free to resume.', 'blocked_paused', NULL, NULL, true, true, false) ON CONFLICT DO NOTHING;
INSERT INTO public.status_group_statuses (id, group_id, name, color, "position", is_default, category, created_at, key, description, section, section_label, section_emoji, is_system, is_placeholder, is_archived) VALUES ('60d54325-b26e-457f-bf2c-c528495673cf', '7d433f4b-58d5-4525-895d-ab76d53a996f', 'Closed', '#10b981', 18, false, 'closed', '2026-10-05T22:18:38.699923+00:00', 'closed', 'Completed and archived.', 'done', NULL, NULL, true, false, false) ON CONFLICT DO NOTHING;
INSERT INTO public.status_group_statuses (id, group_id, name, color, "position", is_default, category, created_at, key, description, section, section_label, section_emoji, is_system, is_placeholder, is_archived) VALUES ('f937a9b7-972c-4187-acaa-f15b3b889451', '7d433f4b-58d5-4525-895d-ab76d53a996f', 'Cancelled', '#6b7280', 19, false, 'closed', '2026-10-05T22:18:38.699923+00:00', 'cancelled', 'No longer needed; closed without completing.', 'done', NULL, NULL, true, false, false) ON CONFLICT DO NOTHING;
INSERT INTO public.status_group_statuses (id, group_id, name, color, "position", is_default, category, created_at, key, description, section, section_label, section_emoji, is_system, is_placeholder, is_archived) VALUES ('e208a237-1911-4859-bd7e-4b728a936f02', 'de81ee77-9db8-4114-a731-52972e26b38d', 'CLOSED', '#10b981', 28, false, 'closed', '2026-10-07T00:35:33.213701+00:00', 'closed', 'Completed and archived.', 'done', 'Closed', '✅', true, false, false) ON CONFLICT DO NOTHING;
INSERT INTO public.status_group_statuses (id, group_id, name, color, "position", is_default, category, created_at, key, description, section, section_label, section_emoji, is_system, is_placeholder, is_archived) VALUES ('51a7cadb-009d-4284-a58b-a0045133b16e', 'de81ee77-9db8-4114-a731-52972e26b38d', 'CANCELLED', '#6b7280', 29, false, 'closed', '2026-10-07T00:35:33.272377+00:00', 'cancelled', 'No longer needed; closed without completing.', 'done', 'Closed', '✅', true, false, false) ON CONFLICT DO NOTHING;
INSERT INTO public.status_group_statuses (id, group_id, name, color, "position", is_default, category, created_at, key, description, section, section_label, section_emoji, is_system, is_placeholder, is_archived) VALUES ('0863e305-ffff-49c5-8024-3d32055089e3', '7d433f4b-58d5-4525-895d-ab76d53a996f', 'Time tracked', '#0d9488', 0, false, 'active', '2026-10-05T22:18:38.699923+00:00', 'time_tracked', 'Timer is running / hours being logged against it.', 'in_motion', 'In progress', '🏃', true, false, false) ON CONFLICT DO NOTHING;
INSERT INTO public.status_group_statuses (id, group_id, name, color, "position", is_default, category, created_at, key, description, section, section_label, section_emoji, is_system, is_placeholder, is_archived) VALUES ('d9d71abe-3fca-4873-85a1-a610ce86e815', '7d433f4b-58d5-4525-895d-ab76d53a996f', 'Starting today', '#3b8ee6', 3, false, 'active', '2026-10-05T22:18:38.699923+00:00', 'active', 'Currently being worked on.', 'up_next', NULL, NULL, true, false, false) ON CONFLICT DO NOTHING;
INSERT INTO public.status_group_statuses (id, group_id, name, color, "position", is_default, category, created_at, key, description, section, section_label, section_emoji, is_system, is_placeholder, is_archived) VALUES ('5be117d9-0ee0-47be-8da5-c3497e00eccb', '7d433f4b-58d5-4525-895d-ab76d53a996f', 'Start Next', '#f93c1a', 4, false, 'todo', '2026-10-17T00:53:38.506116+00:00', 'start_next', 'Task that are high priority and needs to start soon', 'up_next', 'Up next', '🎯', true, false, false) ON CONFLICT DO NOTHING;
INSERT INTO public.status_group_statuses (id, group_id, name, color, "position", is_default, category, created_at, key, description, section, section_label, section_emoji, is_system, is_placeholder, is_archived) VALUES ('2f6da120-1239-4464-88ac-47a7153a8190', '7d433f4b-58d5-4525-895d-ab76d53a996f', 'Plan', '#8b6fd6', 9, false, 'todo', '2026-10-07T00:35:33.562307+00:00', 'planning', 'Being scoped and planned.', 'planning', NULL, NULL, true, false, false) ON CONFLICT DO NOTHING;
INSERT INTO public.status_group_statuses (id, group_id, name, color, "position", is_default, category, created_at, key, description, section, section_label, section_emoji, is_system, is_placeholder, is_archived) VALUES ('44dcdf2b-39fa-4129-b660-7f31a7989fdd', '7d433f4b-58d5-4525-895d-ab76d53a996f', 'Need discussion', '#a78bfa', 10, false, 'todo', '2026-10-16T19:01:29.757959+00:00', 'need_discussion', 'Needs a conversation before work can start.', 'planning', NULL, NULL, true, false, false) ON CONFLICT DO NOTHING;
INSERT INTO public.status_group_statuses (id, group_id, name, color, "position", is_default, category, created_at, key, description, section, section_label, section_emoji, is_system, is_placeholder, is_archived) VALUES ('952d9d74-7edf-4f26-b013-aac096194749', 'de81ee77-9db8-4114-a731-52972e26b38d', 'URGENT', '#ef4444', 2, false, 'active', '2026-10-07T00:35:31.291147+00:00', 'urgent', 'Needs immediate action.', 'priority_urgency', 'Priority & Urgency', '⚡', false, false, false) ON CONFLICT DO NOTHING;
INSERT INTO public.status_group_statuses (id, group_id, name, color, "position", is_default, category, created_at, key, description, section, section_label, section_emoji, is_system, is_placeholder, is_archived) VALUES ('ebb936b4-c30c-454a-9bf4-79783afb455c', 'de81ee77-9db8-4114-a731-52972e26b38d', 'PLANNING', '#a855f7', 10, false, 'todo', '2026-10-07T00:35:32.047146+00:00', 'planning', 'Architecture, RFC, spike, or scoping phase.', 'up_next', 'Up Next', '🎯', false, false, false) ON CONFLICT DO NOTHING;
INSERT INTO public.status_group_statuses (id, group_id, name, color, "position", is_default, category, created_at, key, description, section, section_label, section_emoji, is_system, is_placeholder, is_archived) VALUES ('e708244e-84b5-462a-a156-53503706c693', 'de81ee77-9db8-4114-a731-52972e26b38d', 'ON HOLD', '#78716c', 22, false, 'active', '2026-10-07T00:35:32.85904+00:00', 'on_hold', 'Intentionally paused for now.', 'blocked_paused', 'Blocked / Paused', '⏸️', false, false, false) ON CONFLICT DO NOTHING;
INSERT INTO public.status_group_statuses (id, group_id, name, color, "position", is_default, category, created_at, key, description, section, section_label, section_emoji, is_system, is_placeholder, is_archived) VALUES ('f37036d0-757b-4e60-9bed-88fdd748c884', '7d433f4b-58d5-4525-895d-ab76d53a996f', 'On hold', '#78716c', 11, false, 'active', '2026-10-05T22:18:38.699923+00:00', 'on_hold', 'Intentionally paused for now.', 'blocked_paused', NULL, NULL, true, false, false) ON CONFLICT DO NOTHING;
INSERT INTO public.status_group_statuses (id, group_id, name, color, "position", is_default, category, created_at, key, description, section, section_label, section_emoji, is_system, is_placeholder, is_archived) VALUES ('8d2689ff-4ab2-4997-aee8-9a9b1c8c85c3', '7d433f4b-58d5-4525-895d-ab76d53a996f', 'For review', '#8b5cf6', 17, false, 'active', '2026-10-16T19:01:29.757959+00:00', 'for_review', 'Waiting for review before closing.', 'done', NULL, NULL, true, false, false) ON CONFLICT DO NOTHING;
INSERT INTO public.status_group_statuses (id, group_id, name, color, "position", is_default, category, created_at, key, description, section, section_label, section_emoji, is_system, is_placeholder, is_archived) VALUES ('a80e65b9-15ce-4a07-9426-661a65e7ee88', '7d433f4b-58d5-4525-895d-ab76d53a996f', 'Waiting on dependency', '#6b7280', 12, false, 'active', '2026-10-05T22:18:38.699923+00:00', 'waiting_on_dependency', 'Blocked until something/someone else moves.', 'blocked_paused', NULL, NULL, true, false, false) ON CONFLICT DO NOTHING;
INSERT INTO public.status_group_statuses (id, group_id, name, color, "position", is_default, category, created_at, key, description, section, section_label, section_emoji, is_system, is_placeholder, is_archived) VALUES ('98c18c99-e6ae-4460-9e61-9398b9b9fb19', '6389d8a9-e5e8-4e10-bb1a-0d38e4341d92', 'NEW', '#9ca3af', 0, true, 'todo', '2026-10-08T13:19:05.477013+00:00', 'new', 'Just created; not triaged yet.', 'not_started', 'Not started', '📥', false, false, false) ON CONFLICT DO NOTHING;
INSERT INTO public.status_group_statuses (id, group_id, name, color, "position", is_default, category, created_at, key, description, section, section_label, section_emoji, is_system, is_placeholder, is_archived) VALUES ('10714b75-3933-4047-8d62-6261245b0a41', '6389d8a9-e5e8-4e10-bb1a-0d38e4341d92', 'WAITING ON – DEPENDENCY', '#6b7280', 1, false, 'active', '2026-10-08T13:19:05.477013+00:00', 'waiting_on_dependency', 'Waiting until another task / person moves.', 'blocked_paused', 'Blocked / Paused', '⏸️', false, true, false) ON CONFLICT DO NOTHING;
INSERT INTO public.status_group_statuses (id, group_id, name, color, "position", is_default, category, created_at, key, description, section, section_label, section_emoji, is_system, is_placeholder, is_archived) VALUES ('55fb4039-2ae3-48b2-9007-7f9fc804180d', '6389d8a9-e5e8-4e10-bb1a-0d38e4341d92', 'ON HOLD', '#78716c', 2, false, 'active', '2026-10-08T13:19:05.477013+00:00', 'on_hold', 'Intentionally paused for now.', 'blocked_paused', 'Blocked / Paused', '⏸️', false, true, false) ON CONFLICT DO NOTHING;
INSERT INTO public.status_group_statuses (id, group_id, name, color, "position", is_default, category, created_at, key, description, section, section_label, section_emoji, is_system, is_placeholder, is_archived) VALUES ('567100c5-3279-48f0-aff0-517980600809', '6389d8a9-e5e8-4e10-bb1a-0d38e4341d92', 'BLOCKED', '#dc2626', 3, false, 'active', '2026-10-08T13:19:05.477013+00:00', 'blocked', 'Can''t move forward.', 'blocked_paused', 'Blocked / Paused', '⏸️', false, true, false) ON CONFLICT DO NOTHING;
INSERT INTO public.status_group_statuses (id, group_id, name, color, "position", is_default, category, created_at, key, description, section, section_label, section_emoji, is_system, is_placeholder, is_archived) VALUES ('4ed75f6b-f130-450c-a496-4f42e0725457', '6389d8a9-e5e8-4e10-bb1a-0d38e4341d92', 'UNBLOCKED', '#84cc16', 4, false, 'active', '2026-10-08T13:19:05.477013+00:00', 'unblocked', 'Was waiting, now free to resume.', 'blocked_paused', 'Blocked / Paused', '⏸️', false, true, false) ON CONFLICT DO NOTHING;
INSERT INTO public.status_group_statuses (id, group_id, name, color, "position", is_default, category, created_at, key, description, section, section_label, section_emoji, is_system, is_placeholder, is_archived) VALUES ('ba35b089-188f-4e46-b297-5298e4bda8c0', '6389d8a9-e5e8-4e10-bb1a-0d38e4341d92', 'HELP', '#a16207', 5, false, 'active', '2026-10-08T13:19:05.477013+00:00', 'help', 'Stuck; needs input or assistance.', 'blocked_paused', 'Blocked / Paused', '⏸️', false, true, false) ON CONFLICT DO NOTHING;
INSERT INTO public.status_group_statuses (id, group_id, name, color, "position", is_default, category, created_at, key, description, section, section_label, section_emoji, is_system, is_placeholder, is_archived) VALUES ('74a797bb-de63-4dc5-9fde-e7dfe12217ec', '6389d8a9-e5e8-4e10-bb1a-0d38e4341d92', 'FOLLOW UP', '#4b5563', 6, false, 'active', '2026-10-08T13:19:05.477013+00:00', 'follow_ups', 'Awaiting a reply; check back.', 'blocked_paused', 'Blocked / Paused', '⏸️', false, true, false) ON CONFLICT DO NOTHING;
INSERT INTO public.status_group_statuses (id, group_id, name, color, "position", is_default, category, created_at, key, description, section, section_label, section_emoji, is_system, is_placeholder, is_archived) VALUES ('d60b63f2-2f95-440a-9c4f-7e037e882891', '6389d8a9-e5e8-4e10-bb1a-0d38e4341d92', 'CLOSED', '#10b981', 7, false, 'closed', '2026-10-08T13:19:05.477013+00:00', 'closed', 'Completed.', 'done', 'Closed', '✅', false, false, false) ON CONFLICT DO NOTHING;
INSERT INTO public.status_group_statuses (id, group_id, name, color, "position", is_default, category, created_at, key, description, section, section_label, section_emoji, is_system, is_placeholder, is_archived) VALUES ('adc75e09-ef37-483e-a029-1702dd2d558b', '6389d8a9-e5e8-4e10-bb1a-0d38e4341d92', 'CANCELLED', '#6b7280', 8, false, 'closed', '2026-10-08T13:19:05.477013+00:00', 'cancelled', 'No longer needed.', 'done', 'Closed', '✅', false, false, false) ON CONFLICT DO NOTHING;
INSERT INTO public.status_group_statuses (id, group_id, name, color, "position", is_default, category, created_at, key, description, section, section_label, section_emoji, is_system, is_placeholder, is_archived) VALUES ('7c986fc2-548a-4493-9fc8-e286f4000a3c', 'de81ee77-9db8-4114-a731-52972e26b38d', 'OVER DUE', '#dc2626', 3, false, 'active', '2026-10-07T00:35:31.356692+00:00', 'over_due', 'Deadline has already passed.', 'priority_urgency', 'Priority & Urgency', '⚡', false, false, false) ON CONFLICT DO NOTHING;
INSERT INTO public.status_group_statuses (id, group_id, name, color, "position", is_default, category, created_at, key, description, section, section_label, section_emoji, is_system, is_placeholder, is_archived) VALUES ('bf687ee7-582a-4aee-9d81-1a366ec70e55', 'de81ee77-9db8-4114-a731-52972e26b38d', 'READY TO CODE', '#22c55e', 9, false, 'todo', '2026-10-07T00:35:32.110345+00:00', 'ready_to_code', 'Groomed, estimated, and ready to start coding.', 'up_next', 'Up Next', '🎯', false, false, false) ON CONFLICT DO NOTHING;
INSERT INTO public.status_group_statuses (id, group_id, name, color, "position", is_default, category, created_at, key, description, section, section_label, section_emoji, is_system, is_placeholder, is_archived) VALUES ('6263876c-dc0c-4c72-986b-ff7e447770c9', 'de81ee77-9db8-4114-a731-52972e26b38d', 'UNBLOCKED', '#84cc16', 25, false, 'active', '2026-10-07T00:35:33.041953+00:00', 'unblocked', 'Was blocked, now free to resume.', 'blocked_paused', 'Blocked / Paused', '⏸️', true, false, false) ON CONFLICT DO NOTHING;
INSERT INTO public.status_group_statuses (id, group_id, name, color, "position", is_default, category, created_at, key, description, section, section_label, section_emoji, is_system, is_placeholder, is_archived) VALUES ('223d4565-56e6-438d-b86f-908d4455eb9a', '7d433f4b-58d5-4525-895d-ab76d53a996f', 'Follow ups', '#4b5563', 8, false, 'active', '2026-10-05T22:18:38.699923+00:00', 'follow_ups', 'Awaiting a reply; check back periodically.', 'scheduled_queued', NULL, NULL, true, false, false) ON CONFLICT DO NOTHING;
INSERT INTO public.status_group_statuses (id, group_id, name, color, "position", is_default, category, created_at, key, description, section, section_label, section_emoji, is_system, is_placeholder, is_archived) VALUES ('7f5c35ef-9b2d-47a4-b82a-5a25e80bed2d', 'de81ee77-9db8-4114-a731-52972e26b38d', 'FRONT BURNER', '#f59e0b', 13, false, 'active', '2026-10-07T00:35:32.172594+00:00', 'front_burner', 'Moving up the queue; active sprint priority.', 'scheduled_queued', 'Scheduled / Queued', '📅', false, false, false) ON CONFLICT DO NOTHING;
INSERT INTO public.status_group_statuses (id, group_id, name, color, "position", is_default, category, created_at, key, description, section, section_label, section_emoji, is_system, is_placeholder, is_archived) VALUES ('d8af66aa-19f7-4d71-a13f-c65d51c1fb52', 'de81ee77-9db8-4114-a731-52972e26b38d', 'OPEN', '#9ca3af', 26, true, 'todo', '2026-10-07T00:35:33.099492+00:00', 'open', 'Newly created task, not yet triaged or planned.', 'not_started', 'Not Started', '📥', false, false, false) ON CONFLICT DO NOTHING;
INSERT INTO public.status_group_statuses (id, group_id, name, color, "position", is_default, category, created_at, key, description, section, section_label, section_emoji, is_system, is_placeholder, is_archived) VALUES ('c28d0444-b4cb-4e2b-9618-a456ea9ec76b', '7d433f4b-58d5-4525-895d-ab76d53a996f', 'Help', '#a16207', 13, false, 'active', '2026-10-05T22:18:38.699923+00:00', 'help', 'Stuck; needs input or assistance from someone.', 'blocked_paused', NULL, NULL, true, false, false) ON CONFLICT DO NOTHING;
INSERT INTO public.status_group_statuses (id, group_id, name, color, "position", is_default, category, created_at, key, description, section, section_label, section_emoji, is_system, is_placeholder, is_archived) VALUES ('1eecb2e6-ef0b-4e50-b95e-c89169d7690c', 'de81ee77-9db8-4114-a731-52972e26b38d', 'SCHEDULED', '#60a5fa', 15, false, 'active', '2026-10-07T00:35:32.234674+00:00', 'scheduled', 'Has a specific date/time set.', 'scheduled_queued', 'Scheduled / Queued', '📅', false, false, false) ON CONFLICT DO NOTHING;
INSERT INTO public.status_group_statuses (id, group_id, name, color, "position", is_default, category, created_at, key, description, section, section_label, section_emoji, is_system, is_placeholder, is_archived) VALUES ('c0996f1a-dd7e-4b27-99e3-d03cc1dc3e5f', 'de81ee77-9db8-4114-a731-52972e26b38d', 'REMINDER', '#93c5fd', 17, false, 'active', '2026-10-07T00:35:32.540823+00:00', 'reminder', 'A nudge to do or check something later.', 'scheduled_queued', 'Scheduled / Queued', '📅', true, false, false) ON CONFLICT DO NOTHING;
INSERT INTO public.status_group_statuses (id, group_id, name, color, "position", is_default, category, created_at, key, description, section, section_label, section_emoji, is_system, is_placeholder, is_archived) VALUES ('e21543a9-344d-4e0f-bc9a-30fb6a9160b6', 'de81ee77-9db8-4114-a731-52972e26b38d', 'ROUTINES', '#a855f7', 18, false, 'active', '2026-10-07T00:35:32.610757+00:00', 'routines', 'Regular recurring task.', 'routines', 'Routines', '🔁', false, false, false) ON CONFLICT DO NOTHING;
INSERT INTO public.status_group_statuses (id, group_id, name, color, "position", is_default, category, created_at, key, description, section, section_label, section_emoji, is_system, is_placeholder, is_archived) VALUES ('83a411df-5bf5-4895-9aea-5fc00f0cb5da', 'de81ee77-9db8-4114-a731-52972e26b38d', 'WAITING ON – DEPENDENCY', '#6b7280', 20, false, 'active', '2026-10-07T00:35:32.737876+00:00', 'waiting_on_dependency', 'Blocked until something/someone else moves.', 'blocked_paused', 'Blocked / Paused', '⏸️', true, false, false) ON CONFLICT DO NOTHING;
INSERT INTO public.status_group_statuses (id, group_id, name, color, "position", is_default, category, created_at, key, description, section, section_label, section_emoji, is_system, is_placeholder, is_archived) VALUES ('c3b53e6b-8178-4e96-a27a-6c1e7ba752a6', 'de81ee77-9db8-4114-a731-52972e26b38d', 'EMPTY', '#d1d5db', 27, false, 'todo', '2026-10-07T00:35:33.156964+00:00', 'empty', 'Placeholder task with no details filled in yet.', 'not_started', 'Not Started', '📥', false, false, false) ON CONFLICT DO NOTHING;
INSERT INTO public.status_group_statuses (id, group_id, name, color, "position", is_default, category, created_at, key, description, section, section_label, section_emoji, is_system, is_placeholder, is_archived) VALUES ('9956d307-87c1-48ef-90b1-d766465e573a', '7d433f4b-58d5-4525-895d-ab76d53a996f', 'Blocked', '#ef4444', 14, false, 'active', '2026-10-07T00:35:33.681784+00:00', 'blocked', 'Halted by build failure, environment issue, or critical bug.', 'blocked_paused', NULL, NULL, true, false, false) ON CONFLICT DO NOTHING;
INSERT INTO public.status_group_statuses (id, group_id, name, color, "position", is_default, category, created_at, key, description, section, section_label, section_emoji, is_system, is_placeholder, is_archived) VALUES ('3671df2f-f84a-47ce-b891-393a332f0af6', 'de81ee77-9db8-4114-a731-52972e26b38d', 'BLOCKED', '#ef4444', 21, false, 'active', '2026-10-07T00:35:32.798692+00:00', 'blocked', 'Halted by build failure, environment issue, or critical bug.', 'blocked_paused', 'Blocked / Paused', '⏸️', false, false, false) ON CONFLICT DO NOTHING;
INSERT INTO public.status_group_statuses (id, group_id, name, color, "position", is_default, category, created_at, key, description, section, section_label, section_emoji, is_system, is_placeholder, is_archived) VALUES ('774db019-d237-48a1-9b11-75d6a1d45769', 'de81ee77-9db8-4114-a731-52972e26b38d', 'FOLLOW UPS', '#4b5563', 23, false, 'active', '2026-10-07T00:35:32.918415+00:00', 'follow_ups', 'Awaiting a reply; check back periodically.', 'blocked_paused', 'Blocked / Paused', '⏸️', false, false, false) ON CONFLICT DO NOTHING;
INSERT INTO public.status_group_statuses (id, group_id, name, color, "position", is_default, category, created_at, key, description, section, section_label, section_emoji, is_system, is_placeholder, is_archived) VALUES ('b22a2ccc-64c7-4f84-884c-a8edfaa80b49', 'de81ee77-9db8-4114-a731-52972e26b38d', 'Normal Priority', '#3ccbfb', 12, false, 'active', '2026-10-07T00:35:31.489429+00:00', 'priority', 'Important; above normal.', 'up_next', 'Up Next', '🎯', false, false, false) ON CONFLICT DO NOTHING;
INSERT INTO public.status_group_statuses (id, group_id, name, color, "position", is_default, category, created_at, key, description, section, section_label, section_emoji, is_system, is_placeholder, is_archived) VALUES ('c737fea9-04c0-4440-95fe-3574ea103cc9', 'de81ee77-9db8-4114-a731-52972e26b38d', 'HELP', '#a16207', 24, false, 'active', '2026-10-07T00:35:32.982746+00:00', 'help', 'Stuck; needs input or assistance from someone.', 'blocked_paused', 'Blocked / Paused', '⏸️', false, false, false) ON CONFLICT DO NOTHING;
INSERT INTO public.task_types (id, key, name, description, icon, color, "position", is_default, is_system, created_at, updated_at, is_enabled, group_name) VALUES ('4b8b4d73-5c47-4a5f-b18c-f3adcd6f439f', 'work_block', 'Time Block', 'Similar tasks grouped together to be completed in a time block.', 'clock', '#8b5cf6', 12, false, true, '2026-05-19T11:11:09.530713+00:00', '2026-10-08T08:16:35.472472+00:00', true, 'Task Types') ON CONFLICT DO NOTHING;
INSERT INTO public.task_types (id, key, name, description, icon, color, "position", is_default, is_system, created_at, updated_at, is_enabled, group_name) VALUES ('498321ed-e049-44e6-84a1-d3b043cc072e', 'task', 'Tasks', 'Requires more than 10 minutes to complete.', 'check-square', '#6b7280', 10, true, true, '2026-04-19T19:19:23.770764+00:00', '2026-10-05T15:01:01.26112+00:00', true, 'Task Types') ON CONFLICT DO NOTHING;
INSERT INTO public.task_types (id, key, name, description, icon, color, "position", is_default, is_system, created_at, updated_at, is_enabled, group_name) VALUES ('dcc67161-2c8c-41ef-bfaf-3701bf91520a', 'meeting', 'Meetings', 'Scheduled meetings and collaborative sessions.', 'users', '#f59e0b', 30, false, true, '2026-06-20T19:24:18.825504+00:00', '2026-10-05T11:59:31.756244+00:00', true, 'Meetings & Collaboration') ON CONFLICT DO NOTHING;
INSERT INTO public.task_types (id, key, name, description, icon, color, "position", is_default, is_system, created_at, updated_at, is_enabled, group_name) VALUES ('e0a7ffbf-ac67-4538-92ab-1d7afce81360', 'course', 'Courses', 'Courses that need to be completed', 'graduation-cap', '#0ea5e9', 42, false, true, '2026-06-20T19:24:18.825504+00:00', '2026-10-05T11:59:31.756244+00:00', true, 'Learning & Exploration') ON CONFLICT DO NOTHING;
INSERT INTO public.task_types (id, key, name, description, icon, color, "position", is_default, is_system, created_at, updated_at, is_enabled, group_name) VALUES ('d6e4c4ee-55a7-44c0-a916-0dfab2aea390', 'sop', 'SOP', 'A system / process step assigned to you', 'clipboard-list', '#10b981', 43, false, true, '2026-07-30T09:05:41.025971+00:00', '2026-10-05T11:59:31.756244+00:00', true, 'Learning & Exploration') ON CONFLICT DO NOTHING;
INSERT INTO public.task_types (id, key, name, description, icon, color, "position", is_default, is_system, created_at, updated_at, is_enabled, group_name) VALUES ('82f2b72c-abfd-4d5b-9736-cc4ef9764e34', 'knowledge', 'Knowledge Doc', 'A knowledge document page to review', 'file-check', '#0d9488', 44, false, true, '2026-09-28T08:17:43.198665+00:00', '2026-10-05T11:59:31.756244+00:00', true, 'Learning & Exploration') ON CONFLICT DO NOTHING;
INSERT INTO public.task_types (id, key, name, description, icon, color, "position", is_default, is_system, created_at, updated_at, is_enabled, group_name) VALUES ('ac180c0d-0820-43f1-93c9-e87833346543', 'design_task', 'Design Task', 'Visual design deliverables', 'palette', '#f6e41e', 61, false, true, '2026-04-19T19:36:44.304594+00:00', '2026-10-05T11:59:31.756244+00:00', true, 'Media Creation') ON CONFLICT DO NOTHING;
INSERT INTO public.task_types (id, key, name, description, icon, color, "position", is_default, is_system, created_at, updated_at, is_enabled, group_name) VALUES ('6070ee29-e885-46c5-aa2e-b1593b6e896d', 'video_edit_task', 'Video Edit Task', 'Video editing deliverables', 'video', '#ef4444', 62, false, true, '2026-04-21T16:15:44.098932+00:00', '2026-10-05T11:59:31.756244+00:00', true, 'Media Creation') ON CONFLICT DO NOTHING;
INSERT INTO public.task_types (id, key, name, description, icon, color, "position", is_default, is_system, created_at, updated_at, is_enabled, group_name) VALUES ('7f81fd40-4969-4c7e-b38e-60a8fd7861fd', 'post', 'Post', 'A resource update assigned to you', 'file-text', '#8b5cf6', 63, false, true, '2026-07-30T09:05:41.025971+00:00', '2026-10-05T11:59:31.756244+00:00', true, 'Media Creation') ON CONFLICT DO NOTHING;
INSERT INTO public.task_types (id, key, name, description, icon, color, "position", is_default, is_system, created_at, updated_at, is_enabled, group_name) VALUES ('fd56e070-ea57-4d48-98a8-c2b1aac578ff', 'commute', 'Commute', 'Short-distance travel for a purpose.', 'car', '#f97316', 20, false, true, '2026-10-05T11:59:31.756244+00:00', '2026-10-05T11:59:31.756244+00:00', true, 'Location-Based') ON CONFLICT DO NOTHING;
INSERT INTO public.task_types (id, key, name, description, icon, color, "position", is_default, is_system, created_at, updated_at, is_enabled, group_name) VALUES ('8c339399-c980-485a-bd67-7f6b614869a2', 'travel', 'Travel', 'Long-distance travel for work or personal reasons.', 'plane', '#0284c7', 21, false, true, '2026-10-05T11:59:31.756244+00:00', '2026-10-05T11:59:31.756244+00:00', true, 'Location-Based') ON CONFLICT DO NOTHING;
INSERT INTO public.task_types (id, key, name, description, icon, color, "position", is_default, is_system, created_at, updated_at, is_enabled, group_name) VALUES ('08584713-0325-4fbb-93ce-e4dc1e8efd36', 'out_of_office', 'Out of Office Tasks', 'Activities requiring you to go outside your usual workspace.', 'briefcase', '#d97706', 22, false, true, '2026-10-05T11:59:31.756244+00:00', '2026-10-05T11:59:31.756244+00:00', true, 'Location-Based') ON CONFLICT DO NOTHING;
INSERT INTO public.task_types (id, key, name, description, icon, color, "position", is_default, is_system, created_at, updated_at, is_enabled, group_name) VALUES ('8bc5070c-610c-4c3c-8a87-5b92c34703b8', 'call', 'Call', 'Phone or audio-only communication.', 'phone', '#10b981', 31, false, true, '2026-10-05T11:59:31.756244+00:00', '2026-10-05T11:59:31.756244+00:00', true, 'Meetings & Collaboration') ON CONFLICT DO NOTHING;
INSERT INTO public.task_types (id, key, name, description, icon, color, "position", is_default, is_system, created_at, updated_at, is_enabled, group_name) VALUES ('6467011d-6d11-4639-983c-5c515371aba8', 'e_meet', 'E-Meet', 'Online meeting with video or screen sharing.', 'video', '#2563eb', 32, false, true, '2026-10-05T11:59:31.756244+00:00', '2026-10-05T11:59:31.756244+00:00', true, 'Meetings & Collaboration') ON CONFLICT DO NOTHING;
INSERT INTO public.task_types (id, key, name, description, icon, color, "position", is_default, is_system, created_at, updated_at, is_enabled, group_name) VALUES ('0e2dbf13-c9a6-4802-a455-1b271c16d5df', 'in_person_meeting', 'In-Person Meeting', 'Face-to-face meetings.', 'users', '#7c3aed', 33, false, true, '2026-10-05T11:59:31.756244+00:00', '2026-10-05T11:59:31.756244+00:00', true, 'Meetings & Collaboration') ON CONFLICT DO NOTHING;
INSERT INTO public.task_types (id, key, name, description, icon, color, "position", is_default, is_system, created_at, updated_at, is_enabled, group_name) VALUES ('c09bca61-0208-4486-ba6b-d5f1ae86c49b', 'events', 'Events', 'Attending or organising events.', 'calendar', '#f43f5e', 34, false, true, '2026-10-05T11:59:31.756244+00:00', '2026-10-05T11:59:31.756244+00:00', true, 'Meetings & Collaboration') ON CONFLICT DO NOTHING;
INSERT INTO public.task_types (id, key, name, description, icon, color, "position", is_default, is_system, created_at, updated_at, is_enabled, group_name) VALUES ('700d7b7d-1270-4bb0-8da4-e2863f9e60b5', 'brainstorm_session', 'Brainstorm Sessions', 'Collaborative idea-generation meetings.', 'lightbulb', '#eab308', 35, false, true, '2026-10-05T11:59:31.756244+00:00', '2026-10-05T11:59:31.756244+00:00', true, 'Meetings & Collaboration') ON CONFLICT DO NOTHING;
INSERT INTO public.task_types (id, key, name, description, icon, color, "position", is_default, is_system, created_at, updated_at, is_enabled, group_name) VALUES ('217c77e9-1bf2-47fc-b685-6bc442da7549', 'learning', 'Learning', 'Activities focused on acquiring knowledge by reading, watching, or listening.', 'book-open', '#06b6d4', 40, false, true, '2026-10-05T11:59:31.756244+00:00', '2026-10-05T11:59:31.756244+00:00', true, 'Learning & Exploration') ON CONFLICT DO NOTHING;
INSERT INTO public.task_types (id, key, name, description, icon, color, "position", is_default, is_system, created_at, updated_at, is_enabled, group_name) VALUES ('85a24d38-8d99-4d5c-8197-e99a1bed5f11', 'research', 'Research', 'Tasks involving investigation, testing, and implementation.', 'search', '#8b5cf6', 41, false, true, '2026-10-05T11:59:31.756244+00:00', '2026-10-05T11:59:31.756244+00:00', true, 'Learning & Exploration') ON CONFLICT DO NOTHING;
INSERT INTO public.task_types (id, key, name, description, icon, color, "position", is_default, is_system, created_at, updated_at, is_enabled, group_name) VALUES ('c0a97c10-9882-4355-b994-1e10a2c15a44', 'follow_ups', 'Follow-Ups', 'Checking back with someone or following up on pending actions.', 'clock', '#f59e0b', 50, false, true, '2026-10-05T11:59:31.756244+00:00', '2026-10-05T11:59:31.756244+00:00', true, 'Follow-ups & Monitoring') ON CONFLICT DO NOTHING;
INSERT INTO public.task_types (id, key, name, description, icon, color, "position", is_default, is_system, created_at, updated_at, is_enabled, group_name) VALUES ('be423f1b-31a8-4b3f-a3af-53a4a1845899', 'recording', 'Recording', 'Creating audio or video recordings for various purposes.', 'mic', '#ef4444', 60, false, true, '2026-10-05T11:59:31.756244+00:00', '2026-10-05T11:59:31.756244+00:00', true, 'Media Creation') ON CONFLICT DO NOTHING;
INSERT INTO public.task_types (id, key, name, description, icon, color, "position", is_default, is_system, created_at, updated_at, is_enabled, group_name) VALUES ('29b0da07-8c4e-4d38-8180-ee1e7155a606', 'activities', 'Activities', 'Engaging, interactive tasks like physical activities or hobbies.', 'zap', '#10b981', 70, false, true, '2026-10-05T11:59:31.756244+00:00', '2026-10-05T11:59:31.756244+00:00', true, 'Action-Oriented Activities') ON CONFLICT DO NOTHING;
INSERT INTO public.task_types (id, key, name, description, icon, color, "position", is_default, is_system, created_at, updated_at, is_enabled, group_name) VALUES ('5114fb5e-b482-4ff3-995b-8860beda7c04', 'milestone', 'Milestone', 'Task Type is milestone', 'flag', '#6366f1', 80, false, true, '2026-10-05T11:59:31.756244+00:00', '2026-10-05T11:59:31.756244+00:00', true, 'Goals & Milestones') ON CONFLICT DO NOTHING;
INSERT INTO public.task_types (id, key, name, description, icon, color, "position", is_default, is_system, created_at, updated_at, is_enabled, group_name) VALUES ('df26af47-6981-4eb1-b793-aa78164b2ecd', 'goal', 'Goal', 'Task Type is Goal', 'trophy', '#f59e0b', 81, false, true, '2026-10-05T11:59:31.756244+00:00', '2026-10-05T11:59:31.756244+00:00', true, 'Goals & Milestones') ON CONFLICT DO NOTHING;
INSERT INTO public.task_types (id, key, name, description, icon, color, "position", is_default, is_system, created_at, updated_at, is_enabled, group_name) VALUES ('a39d45fc-c90f-4255-8e79-f14477655409', 'chores', 'Chores', 'For Household work related tasks, like cleaning, laundry etc', 'home', '#84cc16', 90, false, true, '2026-10-05T11:59:31.756244+00:00', '2026-10-05T11:59:31.756244+00:00', true, 'Personal') ON CONFLICT DO NOTHING;
INSERT INTO public.task_types (id, key, name, description, icon, color, "position", is_default, is_system, created_at, updated_at, is_enabled, group_name) VALUES ('623ad774-c0fd-45e9-b93a-56ecb7e89199', 'routine', 'Routines', 'Recurring tasks done at regular intervals (daily, weekly, etc.).', 'repeat', '#a855f7', 15, false, true, '2026-06-20T19:24:18.825504+00:00', '2026-10-05T15:01:01.26112+00:00', true, 'Task Types') ON CONFLICT DO NOTHING;
INSERT INTO public.task_types (id, key, name, description, icon, color, "position", is_default, is_system, created_at, updated_at, is_enabled, group_name) VALUES ('4707e9a5-9be3-4009-902d-97ad4a0f5021', 'todo', 'ToDo', 'Quick tasks that take only a couple of minutes to finish.', 'check-circle-2', '#3b82f6', 11, false, true, '2026-10-05T11:59:31.756244+00:00', '2026-10-05T15:01:01.26112+00:00', true, 'Task Types') ON CONFLICT DO NOTHING;
INSERT INTO public.task_types (id, key, name, description, icon, color, "position", is_default, is_system, created_at, updated_at, is_enabled, group_name) VALUES ('abd2e6e3-964c-4109-9de9-f86d830cd5bb', 'focus_task', 'Focus Tasks', 'Tasks requiring uninterrupted focus and deep work to complete.', 'target', '#6366f1', 13, false, true, '2026-10-05T11:59:31.756244+00:00', '2026-10-05T15:01:01.26112+00:00', true, 'Task Types') ON CONFLICT DO NOTHING;
INSERT INTO public.task_types (id, key, name, description, icon, color, "position", is_default, is_system, created_at, updated_at, is_enabled, group_name) VALUES ('28d3b94f-b2e7-4d09-b130-bf0a7e8f0776', 'multi_day_task', 'Multi-Day Tasks', 'Larger tasks broken down into daily efforts, spanning several days.', 'calendar-range', '#ec4899', 14, false, true, '2026-10-05T11:59:31.756244+00:00', '2026-10-05T15:01:01.26112+00:00', true, 'Task Types') ON CONFLICT DO NOTHING;
INSERT INTO public.task_types (id, key, name, description, icon, color, "position", is_default, is_system, created_at, updated_at, is_enabled, group_name) VALUES ('ef397520-c4e7-4987-8f17-5c6c9d5183e5', 'plan', 'Plan', 'Tasks involving preparation, strategy, or setup before execution.', 'compass', '#14b8a6', 16, false, true, '2026-10-05T11:59:31.756244+00:00', '2026-10-05T15:01:01.26112+00:00', true, 'Task Types') ON CONFLICT DO NOTHING;
INSERT INTO public.task_types (id, key, name, description, icon, color, "position", is_default, is_system, created_at, updated_at, is_enabled, group_name) VALUES ('2f5db98b-6dab-4038-8d0a-7bc195bee1ae', 'quick_wins', 'Quick Wins', 'Small but impactful tasks that can be done quickly to move things forward.', 'sparkles', '#eab308', 100, false, true, '2026-10-05T11:59:31.756244+00:00', '2026-10-05T11:59:31.756244+00:00', true, 'Planning & Review') ON CONFLICT DO NOTHING;
INSERT INTO public.task_types (id, key, name, description, icon, color, "position", is_default, is_system, created_at, updated_at, is_enabled, group_name) VALUES ('bb230b23-2da3-4669-aac1-4a8fd0a0ce7a', 'review', 'Review', 'Revisiting past work, reports, or plans to evaluate or update them.', 'clipboard-check', '#3b82f6', 101, false, true, '2026-10-05T11:59:31.756244+00:00', '2026-10-05T11:59:31.756244+00:00', true, 'Planning & Review') ON CONFLICT DO NOTHING;
INSERT INTO public.task_types (id, key, name, description, icon, color, "position", is_default, is_system, created_at, updated_at, is_enabled, group_name) VALUES ('18187852-0937-4fa9-ae48-9c4afb4578a3', 'on_hold', 'On Hold', 'Tasks that are on hold', 'pause-circle', '#9ca3af', 102, false, true, '2026-10-05T11:59:31.756244+00:00', '2026-10-05T11:59:31.756244+00:00', true, 'Planning & Review') ON CONFLICT DO NOTHING;
INSERT INTO public.task_types (id, key, name, description, icon, color, "position", is_default, is_system, created_at, updated_at, is_enabled, group_name) VALUES ('7675f109-1fe4-4654-b3b3-624083507e86', 'parked_task', 'Parked Tasks', 'Tasks have been moved aside for working on someday later', 'archive', '#64748b', 103, false, true, '2026-10-05T11:59:31.756244+00:00', '2026-10-05T11:59:31.756244+00:00', true, 'Planning & Review') ON CONFLICT DO NOTHING;
INSERT INTO public.task_types (id, key, name, description, icon, color, "position", is_default, is_system, created_at, updated_at, is_enabled, group_name) VALUES ('f49f6111-c1f0-4aa5-848c-e93353fe8dd1', 'coding', 'Coding', 'Software engineering, feature implementation, and bug fixing.', 'code', '#0ea5e9', 110, false, true, '2026-10-05T13:57:19.986778+00:00', '2026-10-05T13:57:19.986778+00:00', true, 'Software Development') ON CONFLICT DO NOTHING;
INSERT INTO public.task_types (id, key, name, description, icon, color, "position", is_default, is_system, created_at, updated_at, is_enabled, group_name) VALUES ('ff0f78a7-9e42-4eb6-a6f5-b5980e3909e7', 'testing', 'Testing', 'Writing and executing tests, QA verification, and bug validation.', 'test-tube', '#10b981', 111, false, true, '2026-10-05T13:57:20.081175+00:00', '2026-10-05T13:57:20.081175+00:00', true, 'Software Development') ON CONFLICT DO NOTHING;
INSERT INTO public.task_types (id, key, name, description, icon, color, "position", is_default, is_system, created_at, updated_at, is_enabled, group_name) VALUES ('db1d49a9-d2b8-423d-95f6-59f048d9be29', 'ui_designing', 'UI Designing', 'User interface design, wireframes, and prototyping.', 'layout', '#8b5cf6', 112, false, true, '2026-10-05T13:57:20.22663+00:00', '2026-10-05T13:57:20.22663+00:00', true, 'Software Development') ON CONFLICT DO NOTHING;
INSERT INTO public.task_types (id, key, name, description, icon, color, "position", is_default, is_system, created_at, updated_at, is_enabled, group_name) VALUES ('32e4e5f4-6b3e-4b99-b341-17ef93c40646', 'reminders', 'Reminders', NULL, 'check-square', '#3bf761', 113, false, true, '2026-10-05T21:11:31.534592+00:00', '2026-10-19T05:25:55.896058+00:00', true, 'Task Types') ON CONFLICT DO NOTHING;
INSERT INTO public.task_type_fields (id, task_type_id, key, label, field_type, options, is_required, help_text, placeholder, "position", created_at, updated_at, help_url, allow_other) VALUES ('0a822c1c-21e9-4ac0-94d9-eb6595824d4a', 'ac180c0d-0820-43f1-93c9-e87833346543', 'brief_type', 'Type', 'multi_select', '[{"label": "Social media post", "value": "social_post"}, {"label": "Carousel", "value": "carousel"}, {"label": "Story / Reel cover", "value": "story_cover"}, {"label": "Meta ad creative", "value": "meta_ad"}, {"label": "YouTube thumbnail", "value": "yt_thumb"}, {"label": "Flyer", "value": "flyer"}, {"label": "Poster", "value": "poster"}, {"label": "Brochure", "value": "brochure"}, {"label": "Banner", "value": "banner"}, {"label": "Pitch deck", "value": "deck"}]'::jsonb, false, NULL, NULL, 0, '2026-04-26T22:31:09.727568+00:00', '2026-04-27T06:10:14.051966+00:00', NULL, true) ON CONFLICT DO NOTHING;
INSERT INTO public.task_type_fields (id, task_type_id, key, label, field_type, options, is_required, help_text, placeholder, "position", created_at, updated_at, help_url, allow_other) VALUES ('c2e8b25a-3284-4209-a55a-146bd8083ef9', 'ac180c0d-0820-43f1-93c9-e87833346543', 'ratios', 'Ratios / Size', 'multi_select', '[{"label": "1:1 \u2014 1080\u00d71080 (Square)", "value": "1_1"}, {"label": "4:5 \u2014 1080\u00d71350 (Portrait)", "value": "4_5"}, {"label": "9:16 \u2014 1080\u00d71920 (Vertical)", "value": "9_16"}]'::jsonb, false, NULL, NULL, 1, '2026-04-26T22:31:09.727568+00:00', '2026-04-27T06:10:14.051966+00:00', '/help/social-sizes', false) ON CONFLICT DO NOTHING;
INSERT INTO public.task_type_fields (id, task_type_id, key, label, field_type, options, is_required, help_text, placeholder, "position", created_at, updated_at, help_url, allow_other) VALUES ('1473a81d-77d0-4c24-ab82-365daf686fdb', 'ac180c0d-0820-43f1-93c9-e87833346543', 'usage', 'Usage', 'text', '[]'::jsonb, false, NULL, NULL, 2, '2026-04-26T22:31:09.727568+00:00', '2026-04-27T06:10:14.051966+00:00', NULL, false) ON CONFLICT DO NOTHING;
INSERT INTO public.task_type_fields (id, task_type_id, key, label, field_type, options, is_required, help_text, placeholder, "position", created_at, updated_at, help_url, allow_other) VALUES ('293aa0c6-e49e-4e8b-9ac2-bbba5a4cf309', 'ac180c0d-0820-43f1-93c9-e87833346543', 'audience_text', 'Audience', 'text', '[]'::jsonb, false, NULL, NULL, 3, '2026-04-26T22:31:09.727568+00:00', '2026-04-27T06:10:14.051966+00:00', NULL, false) ON CONFLICT DO NOTHING;
INSERT INTO public.task_type_fields (id, task_type_id, key, label, field_type, options, is_required, help_text, placeholder, "position", created_at, updated_at, help_url, allow_other) VALUES ('21f69e43-3952-47e4-bf7a-73bd1fddcb7d', 'ac180c0d-0820-43f1-93c9-e87833346543', 'reference_links', 'Reference links', 'textarea', '[]'::jsonb, false, NULL, 'One link per line', 4, '2026-04-27T06:10:14.051966+00:00', '2026-04-27T06:10:14.051966+00:00', NULL, false) ON CONFLICT DO NOTHING;
INSERT INTO public.task_type_fields (id, task_type_id, key, label, field_type, options, is_required, help_text, placeholder, "position", created_at, updated_at, help_url, allow_other) VALUES ('b14cabf4-82fd-41d1-8399-b0258bc5e170', '6070ee29-e885-46c5-aa2e-b1593b6e896d', 'brief_type', 'Type of edit', 'multi_select', '[{"label": "Reel", "value": "reel"}, {"label": "YouTube long-form", "value": "yt_long"}, {"label": "YouTube Short", "value": "yt_short"}, {"label": "Podcast clip", "value": "podcast_clip"}, {"label": "Ad creative", "value": "ad"}, {"label": "Vlog", "value": "vlog"}, {"label": "Tutorial", "value": "tutorial"}, {"label": "Promo", "value": "promo"}, {"label": "Event recap", "value": "event_recap"}, {"label": "Interview", "value": "interview"}]'::jsonb, false, NULL, NULL, 0, '2026-05-08T21:19:22.862036+00:00', '2026-05-08T21:19:22.862036+00:00', NULL, true) ON CONFLICT DO NOTHING;
INSERT INTO public.task_type_fields (id, task_type_id, key, label, field_type, options, is_required, help_text, placeholder, "position", created_at, updated_at, help_url, allow_other) VALUES ('3e5a9a19-e668-4fe0-a43c-04c28024a846', '6070ee29-e885-46c5-aa2e-b1593b6e896d', 'aspect_ratio', 'Aspect ratio', 'multi_select', '[{"label": "16:9 \u2014 1920\u00d71080 (Landscape)", "value": "16_9"}, {"label": "9:16 \u2014 1080\u00d71920 (Vertical)", "value": "9_16"}, {"label": "1:1 \u2014 1080\u00d71080 (Square)", "value": "1_1"}, {"label": "4:5 \u2014 1080\u00d71350 (Portrait)", "value": "4_5"}]'::jsonb, false, NULL, NULL, 1, '2026-05-08T21:19:22.862036+00:00', '2026-05-08T21:19:22.862036+00:00', '/help/video-aspect-ratios', false) ON CONFLICT DO NOTHING;
INSERT INTO public.task_type_fields (id, task_type_id, key, label, field_type, options, is_required, help_text, placeholder, "position", created_at, updated_at, help_url, allow_other) VALUES ('8d901627-dc30-4e99-83f3-9462e9e2b16e', '6070ee29-e885-46c5-aa2e-b1593b6e896d', 'duration', 'Target duration', 'text', '[]'::jsonb, false, NULL, 'e.g. 30s, 60s, 5–7 min', 2, '2026-05-08T21:19:22.862036+00:00', '2026-05-08T21:19:22.862036+00:00', NULL, false) ON CONFLICT DO NOTHING;
INSERT INTO public.task_type_fields (id, task_type_id, key, label, field_type, options, is_required, help_text, placeholder, "position", created_at, updated_at, help_url, allow_other) VALUES ('28e0a2c7-1964-4c44-a169-ab0d37891132', '6070ee29-e885-46c5-aa2e-b1593b6e896d', 'platform', 'Platform', 'multi_select', '[{"label": "YouTube", "value": "youtube"}, {"label": "Instagram", "value": "instagram"}, {"label": "TikTok", "value": "tiktok"}, {"label": "Facebook", "value": "facebook"}, {"label": "LinkedIn", "value": "linkedin"}, {"label": "X / Twitter", "value": "x_twitter"}]'::jsonb, false, NULL, NULL, 3, '2026-05-08T21:19:22.862036+00:00', '2026-05-08T21:19:22.862036+00:00', NULL, false) ON CONFLICT DO NOTHING;
INSERT INTO public.task_type_groups (id, key, name, description, icon, color, "position", is_default, is_system, is_enabled, created_at, updated_at) VALUES ('f1440abe-17f4-4cde-bb45-592a0abc8696', 'default_task_types', 'Default Task Types', 'Default set of all task types available across all areas, spaces, folders, and lists.', 'check-square', '#3b82f6', 0, true, true, true, '2026-10-07T01:26:31.285189+00:00', '2026-10-07T01:26:31.285189+00:00') ON CONFLICT DO NOTHING;
INSERT INTO public.task_type_group_items (id, group_id, task_type_id, "position", created_at) VALUES ('c5b4b154-bfe0-42b6-97a0-8db118d96cd6', 'f1440abe-17f4-4cde-bb45-592a0abc8696', '498321ed-e049-44e6-84a1-d3b043cc072e', 10, '2026-10-07T01:26:31.285189+00:00') ON CONFLICT DO NOTHING;
INSERT INTO public.task_type_group_items (id, group_id, task_type_id, "position", created_at) VALUES ('ef497e8a-7185-4ee6-92ff-4ba4198d979a', 'f1440abe-17f4-4cde-bb45-592a0abc8696', '4b8b4d73-5c47-4a5f-b18c-f3adcd6f439f', 12, '2026-10-07T01:26:31.285189+00:00') ON CONFLICT DO NOTHING;
INSERT INTO public.task_type_group_items (id, group_id, task_type_id, "position", created_at) VALUES ('665508bf-883d-47e0-927c-485d4817a5eb', 'f1440abe-17f4-4cde-bb45-592a0abc8696', 'dcc67161-2c8c-41ef-bfaf-3701bf91520a', 30, '2026-10-07T01:26:31.285189+00:00') ON CONFLICT DO NOTHING;
INSERT INTO public.task_type_group_items (id, group_id, task_type_id, "position", created_at) VALUES ('a50ca516-df52-4ec4-ae4f-96bde2c32c98', 'f1440abe-17f4-4cde-bb45-592a0abc8696', 'e0a7ffbf-ac67-4538-92ab-1d7afce81360', 42, '2026-10-07T01:26:31.285189+00:00') ON CONFLICT DO NOTHING;
INSERT INTO public.task_type_group_items (id, group_id, task_type_id, "position", created_at) VALUES ('6261c399-dcf7-4c32-9427-41d12c2e89fa', 'f1440abe-17f4-4cde-bb45-592a0abc8696', 'd6e4c4ee-55a7-44c0-a916-0dfab2aea390', 43, '2026-10-07T01:26:31.285189+00:00') ON CONFLICT DO NOTHING;
INSERT INTO public.task_type_group_items (id, group_id, task_type_id, "position", created_at) VALUES ('8779962e-aadf-4295-92dc-6c0ed00584dc', 'f1440abe-17f4-4cde-bb45-592a0abc8696', '82f2b72c-abfd-4d5b-9736-cc4ef9764e34', 44, '2026-10-07T01:26:31.285189+00:00') ON CONFLICT DO NOTHING;
INSERT INTO public.task_type_group_items (id, group_id, task_type_id, "position", created_at) VALUES ('022c45af-a640-47d9-ab66-33520c4f1dd9', 'f1440abe-17f4-4cde-bb45-592a0abc8696', 'ac180c0d-0820-43f1-93c9-e87833346543', 61, '2026-10-07T01:26:31.285189+00:00') ON CONFLICT DO NOTHING;
INSERT INTO public.task_type_group_items (id, group_id, task_type_id, "position", created_at) VALUES ('6efb3b02-91b9-4989-acbd-8b8d50d9fbfc', 'f1440abe-17f4-4cde-bb45-592a0abc8696', '6070ee29-e885-46c5-aa2e-b1593b6e896d', 62, '2026-10-07T01:26:31.285189+00:00') ON CONFLICT DO NOTHING;
INSERT INTO public.task_type_group_items (id, group_id, task_type_id, "position", created_at) VALUES ('490f3ac1-94f8-4da5-b06f-7395fc33ace9', 'f1440abe-17f4-4cde-bb45-592a0abc8696', '7f81fd40-4969-4c7e-b38e-60a8fd7861fd', 63, '2026-10-07T01:26:31.285189+00:00') ON CONFLICT DO NOTHING;
INSERT INTO public.task_type_group_items (id, group_id, task_type_id, "position", created_at) VALUES ('36622a00-bd12-4d59-92b8-7014b9f4f4c8', 'f1440abe-17f4-4cde-bb45-592a0abc8696', 'fd56e070-ea57-4d48-98a8-c2b1aac578ff', 20, '2026-10-07T01:26:31.285189+00:00') ON CONFLICT DO NOTHING;
INSERT INTO public.task_type_group_items (id, group_id, task_type_id, "position", created_at) VALUES ('3372a5e9-0957-4231-84ea-ebc9ed3c4b52', 'f1440abe-17f4-4cde-bb45-592a0abc8696', '8c339399-c980-485a-bd67-7f6b614869a2', 21, '2026-10-07T01:26:31.285189+00:00') ON CONFLICT DO NOTHING;
INSERT INTO public.task_type_group_items (id, group_id, task_type_id, "position", created_at) VALUES ('6e3a5d5e-c97a-4a6d-b3db-2266bbf44836', 'f1440abe-17f4-4cde-bb45-592a0abc8696', '08584713-0325-4fbb-93ce-e4dc1e8efd36', 22, '2026-10-07T01:26:31.285189+00:00') ON CONFLICT DO NOTHING;
INSERT INTO public.task_type_group_items (id, group_id, task_type_id, "position", created_at) VALUES ('6ed65dd0-0ca2-44b7-9c14-463441833ecc', 'f1440abe-17f4-4cde-bb45-592a0abc8696', '8bc5070c-610c-4c3c-8a87-5b92c34703b8', 31, '2026-10-07T01:26:31.285189+00:00') ON CONFLICT DO NOTHING;
INSERT INTO public.task_type_group_items (id, group_id, task_type_id, "position", created_at) VALUES ('90ab34fd-8349-4b5b-ba65-43fc5bb6bf77', 'f1440abe-17f4-4cde-bb45-592a0abc8696', '6467011d-6d11-4639-983c-5c515371aba8', 32, '2026-10-07T01:26:31.285189+00:00') ON CONFLICT DO NOTHING;
INSERT INTO public.task_type_group_items (id, group_id, task_type_id, "position", created_at) VALUES ('d443e96b-57da-44d1-b2b5-1dc80ab88fe9', 'f1440abe-17f4-4cde-bb45-592a0abc8696', '0e2dbf13-c9a6-4802-a455-1b271c16d5df', 33, '2026-10-07T01:26:31.285189+00:00') ON CONFLICT DO NOTHING;
INSERT INTO public.task_type_group_items (id, group_id, task_type_id, "position", created_at) VALUES ('65c66032-bfd2-49a3-91d4-8a5081e216a3', 'f1440abe-17f4-4cde-bb45-592a0abc8696', 'c09bca61-0208-4486-ba6b-d5f1ae86c49b', 34, '2026-10-07T01:26:31.285189+00:00') ON CONFLICT DO NOTHING;
INSERT INTO public.task_type_group_items (id, group_id, task_type_id, "position", created_at) VALUES ('681bd38d-9c7b-4e3f-8ffb-6ca4bf074e56', 'f1440abe-17f4-4cde-bb45-592a0abc8696', '700d7b7d-1270-4bb0-8da4-e2863f9e60b5', 35, '2026-10-07T01:26:31.285189+00:00') ON CONFLICT DO NOTHING;
INSERT INTO public.task_type_group_items (id, group_id, task_type_id, "position", created_at) VALUES ('2bc67907-e0ce-4277-bab5-a41a1a1ed9fb', 'f1440abe-17f4-4cde-bb45-592a0abc8696', '217c77e9-1bf2-47fc-b685-6bc442da7549', 40, '2026-10-07T01:26:31.285189+00:00') ON CONFLICT DO NOTHING;
INSERT INTO public.task_type_group_items (id, group_id, task_type_id, "position", created_at) VALUES ('edde7eda-6e0c-4c09-aab5-49d17fa22bbd', 'f1440abe-17f4-4cde-bb45-592a0abc8696', '85a24d38-8d99-4d5c-8197-e99a1bed5f11', 41, '2026-10-07T01:26:31.285189+00:00') ON CONFLICT DO NOTHING;
INSERT INTO public.task_type_group_items (id, group_id, task_type_id, "position", created_at) VALUES ('a3662494-8716-4dda-b1e1-20ad2bbb09a9', 'f1440abe-17f4-4cde-bb45-592a0abc8696', 'c0a97c10-9882-4355-b994-1e10a2c15a44', 50, '2026-10-07T01:26:31.285189+00:00') ON CONFLICT DO NOTHING;
INSERT INTO public.task_type_group_items (id, group_id, task_type_id, "position", created_at) VALUES ('2e494cdc-1ef7-4d40-be4c-ec3890b45c83', 'f1440abe-17f4-4cde-bb45-592a0abc8696', 'be423f1b-31a8-4b3f-a3af-53a4a1845899', 60, '2026-10-07T01:26:31.285189+00:00') ON CONFLICT DO NOTHING;
INSERT INTO public.task_type_group_items (id, group_id, task_type_id, "position", created_at) VALUES ('b1ca53e9-3be2-476e-ab25-8352797b4d4e', 'f1440abe-17f4-4cde-bb45-592a0abc8696', '29b0da07-8c4e-4d38-8180-ee1e7155a606', 70, '2026-10-07T01:26:31.285189+00:00') ON CONFLICT DO NOTHING;
INSERT INTO public.task_type_group_items (id, group_id, task_type_id, "position", created_at) VALUES ('0461f19a-80f3-4985-bfac-bd43e19113a1', 'f1440abe-17f4-4cde-bb45-592a0abc8696', '5114fb5e-b482-4ff3-995b-8860beda7c04', 80, '2026-10-07T01:26:31.285189+00:00') ON CONFLICT DO NOTHING;
INSERT INTO public.task_type_group_items (id, group_id, task_type_id, "position", created_at) VALUES ('ef17a0fb-4bc1-472d-8cc8-b623c70169bf', 'f1440abe-17f4-4cde-bb45-592a0abc8696', 'df26af47-6981-4eb1-b793-aa78164b2ecd', 81, '2026-10-07T01:26:31.285189+00:00') ON CONFLICT DO NOTHING;
INSERT INTO public.task_type_group_items (id, group_id, task_type_id, "position", created_at) VALUES ('0467efa8-6756-49fd-873e-9f0e0dc537f8', 'f1440abe-17f4-4cde-bb45-592a0abc8696', 'a39d45fc-c90f-4255-8e79-f14477655409', 90, '2026-10-07T01:26:31.285189+00:00') ON CONFLICT DO NOTHING;
INSERT INTO public.task_type_group_items (id, group_id, task_type_id, "position", created_at) VALUES ('009ed43e-1ca4-469f-bed9-16ed043a4f78', 'f1440abe-17f4-4cde-bb45-592a0abc8696', '623ad774-c0fd-45e9-b93a-56ecb7e89199', 15, '2026-10-07T01:26:31.285189+00:00') ON CONFLICT DO NOTHING;
INSERT INTO public.task_type_group_items (id, group_id, task_type_id, "position", created_at) VALUES ('ee603bb7-d050-4dda-ac0d-4f710e105df5', 'f1440abe-17f4-4cde-bb45-592a0abc8696', '4707e9a5-9be3-4009-902d-97ad4a0f5021', 11, '2026-10-07T01:26:31.285189+00:00') ON CONFLICT DO NOTHING;
INSERT INTO public.task_type_group_items (id, group_id, task_type_id, "position", created_at) VALUES ('c4b0bd61-e98c-446e-b046-ffb6db0ee20d', 'f1440abe-17f4-4cde-bb45-592a0abc8696', 'abd2e6e3-964c-4109-9de9-f86d830cd5bb', 13, '2026-10-07T01:26:31.285189+00:00') ON CONFLICT DO NOTHING;
INSERT INTO public.task_type_group_items (id, group_id, task_type_id, "position", created_at) VALUES ('fe29eeb4-03bd-403b-a0e7-96f4de1575cd', 'f1440abe-17f4-4cde-bb45-592a0abc8696', '28d3b94f-b2e7-4d09-b130-bf0a7e8f0776', 14, '2026-10-07T01:26:31.285189+00:00') ON CONFLICT DO NOTHING;
INSERT INTO public.task_type_group_items (id, group_id, task_type_id, "position", created_at) VALUES ('24a08881-dfbc-4039-ad83-b1164a299c41', 'f1440abe-17f4-4cde-bb45-592a0abc8696', 'ef397520-c4e7-4987-8f17-5c6c9d5183e5', 16, '2026-10-07T01:26:31.285189+00:00') ON CONFLICT DO NOTHING;
INSERT INTO public.task_type_group_items (id, group_id, task_type_id, "position", created_at) VALUES ('9a62a15b-54a7-4eb7-bf4a-4d6ef23dc69a', 'f1440abe-17f4-4cde-bb45-592a0abc8696', '2f5db98b-6dab-4038-8d0a-7bc195bee1ae', 100, '2026-10-07T01:26:31.285189+00:00') ON CONFLICT DO NOTHING;
INSERT INTO public.task_type_group_items (id, group_id, task_type_id, "position", created_at) VALUES ('c09a24ab-cbb4-4c01-ab65-b6e8512e3529', 'f1440abe-17f4-4cde-bb45-592a0abc8696', 'bb230b23-2da3-4669-aac1-4a8fd0a0ce7a', 101, '2026-10-07T01:26:31.285189+00:00') ON CONFLICT DO NOTHING;
INSERT INTO public.task_type_group_items (id, group_id, task_type_id, "position", created_at) VALUES ('308714d8-acab-4631-80af-48aef1960b85', 'f1440abe-17f4-4cde-bb45-592a0abc8696', '18187852-0937-4fa9-ae48-9c4afb4578a3', 102, '2026-10-07T01:26:31.285189+00:00') ON CONFLICT DO NOTHING;
INSERT INTO public.task_type_group_items (id, group_id, task_type_id, "position", created_at) VALUES ('3312f99c-6e74-4e03-b3bd-bf7553ff8dc8', 'f1440abe-17f4-4cde-bb45-592a0abc8696', '7675f109-1fe4-4654-b3b3-624083507e86', 103, '2026-10-07T01:26:31.285189+00:00') ON CONFLICT DO NOTHING;
INSERT INTO public.task_type_group_items (id, group_id, task_type_id, "position", created_at) VALUES ('80e3c0ff-dbaa-4389-a889-36dc79478cb4', 'f1440abe-17f4-4cde-bb45-592a0abc8696', 'f49f6111-c1f0-4aa5-848c-e93353fe8dd1', 110, '2026-10-07T01:26:31.285189+00:00') ON CONFLICT DO NOTHING;
INSERT INTO public.task_type_group_items (id, group_id, task_type_id, "position", created_at) VALUES ('6cda8465-368e-45c8-a12c-c7cf0b62820b', 'f1440abe-17f4-4cde-bb45-592a0abc8696', 'ff0f78a7-9e42-4eb6-a6f5-b5980e3909e7', 111, '2026-10-07T01:26:31.285189+00:00') ON CONFLICT DO NOTHING;
INSERT INTO public.task_type_group_items (id, group_id, task_type_id, "position", created_at) VALUES ('61e47db5-bc16-4bf1-bab8-e7fd64cedb03', 'f1440abe-17f4-4cde-bb45-592a0abc8696', 'db1d49a9-d2b8-423d-95f6-59f048d9be29', 112, '2026-10-07T01:26:31.285189+00:00') ON CONFLICT DO NOTHING;
INSERT INTO public.task_type_group_items (id, group_id, task_type_id, "position", created_at) VALUES ('9a608864-b6c4-46e0-83d5-26f0128d5065', 'f1440abe-17f4-4cde-bb45-592a0abc8696', '32e4e5f4-6b3e-4b99-b341-17ef93c40646', 113, '2026-10-07T01:26:31.285189+00:00') ON CONFLICT DO NOTHING;
INSERT INTO public.mini_apps (id, slug, name, description, icon, is_enabled, created_at, updated_at) VALUES ('dde74884-a911-464b-a141-649820c318bb', 'daily-checkin-partners', 'Daily Check-In Partners', 'Track daily attendance for partners with configurable checklists per role', 'check-circle', true, '2026-03-28T07:49:43.858863+00:00', '2026-03-28T07:49:43.858863+00:00') ON CONFLICT DO NOTHING;
INSERT INTO public.mini_apps (id, slug, name, description, icon, is_enabled, created_at, updated_at) VALUES ('54d8a237-3371-4c19-ba88-425ca9334886', 'daily-checkin', 'Daily Check-In Teammates', 'Track daily attendance for teammates with configurable checklists per role', 'check-circle', true, '2026-03-21T10:20:29.166429+00:00', '2026-03-21T10:20:29.166429+00:00') ON CONFLICT DO NOTHING;
INSERT INTO public.mini_apps (id, slug, name, description, icon, is_enabled, created_at, updated_at) VALUES ('db69044d-a4b9-4905-a504-4ac499542ef3', 'time-management', 'Time Management', 'Team-wide time tracking dashboard for managers', 'clock', true, '2026-03-28T13:30:49.860211+00:00', '2026-03-28T13:30:49.860211+00:00') ON CONFLICT DO NOTHING;
INSERT INTO public.mini_apps (id, slug, name, description, icon, is_enabled, created_at, updated_at) VALUES ('82e751df-42d9-44de-830e-2d94537421ab', 'check-ins', 'Check-Ins', 'Daily check-ins for your account', 'check-circle', true, '2026-06-18T05:59:53.106128+00:00', '2026-06-18T05:59:53.106128+00:00') ON CONFLICT DO NOTHING;
INSERT INTO public.mini_apps (id, slug, name, description, icon, is_enabled, created_at, updated_at) VALUES ('3ac8ecff-52e7-4c9d-b660-3c644623bff6', 'squad-notes', 'SquadNotes', 'Notion-style notes & docs: nested pages, rich text, slash commands, embeds & sharing', 'file-text', true, '2026-06-19T09:57:32.347222+00:00', '2026-06-19T09:57:32.347222+00:00') ON CONFLICT DO NOTHING;
INSERT INTO public.mini_apps (id, slug, name, description, icon, is_enabled, created_at, updated_at) VALUES ('98955378-35b2-4136-8ecc-0b2bdb0ea440', 'meetings', 'Meetings', 'Schedule meetings & events: propose dates and time slots, vote on availability, and auto-generate meeting links.', 'calendar-days', true, '2026-06-26T18:04:15.147246+00:00', '2026-06-26T18:04:15.147246+00:00') ON CONFLICT DO NOTHING;
INSERT INTO public.mini_apps (id, slug, name, description, icon, is_enabled, created_at, updated_at) VALUES ('8438fa9f-2395-4c84-a0ca-6d6ef0c38fd5', 'partner-payments', 'Partner Payments', 'Assigned clients, monthly payouts and commission status for your engagements.', 'banknotes', true, '2026-08-22T02:15:05.898541+00:00', '2026-08-22T02:15:05.898541+00:00') ON CONFLICT DO NOTHING;
INSERT INTO public.working_days_config (id, working_days, updated_at) VALUES ('253fc50f-3e6d-43de-845f-f4e13476585d', '[1, 2, 3, 4, 5, 6]'::jsonb, '2026-03-21T06:56:16.901058+00:00') ON CONFLICT DO NOTHING;
ALTER TABLE public.status_groups ENABLE TRIGGER validate_status_group_inheritance;
ALTER TABLE public.status_group_statuses ENABLE TRIGGER validate_inherited_task_status;

INSERT INTO public.plans (name, price_inr, free_staff_seats, is_default) VALUES
  ('Free', 0, 3, true)
ON CONFLICT DO NOTHING;

