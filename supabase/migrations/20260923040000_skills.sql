-- ============================================================
-- Skills: capability grants managed from the admin "Skills" module
-- ============================================================
-- A skill is a named capability defined in code (shared SKILL_CATALOG), each
-- with an ordered set of levels. Admins grant a skill at one level to a
-- specific user, a role, or a whole user type; a user's effective level is the
-- highest across every grant that matches them (platform admins always hold
-- the top level).
--
-- First skill: `edit_logged_time` — 'reduce' (lower or remove logged time
-- only) or 'full' (change logged time up or down). It replaces the role flag
-- can_edit_time_logs as the gate on task time entries; that flag keeps gating
-- the office timer's own sessions.

CREATE TABLE IF NOT EXISTS skill_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_key TEXT NOT NULL,
  principal_type TEXT NOT NULL CHECK (principal_type IN ('user', 'role', 'user_type')),
  -- users.id / roles.id as text, or the user-type key ('internal', 'partner', …)
  principal_id TEXT NOT NULL,
  level TEXT NOT NULL,
  granted_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (skill_key, principal_type, principal_id)
);

CREATE INDEX IF NOT EXISTS idx_skill_grants_principal
  ON skill_grants (principal_type, principal_id);

-- Server-only table (service role). RLS on with no policies keeps it closed to
-- anon/authenticated; grant only what the API needs (see
-- 20260922235959_explicit_data_api_grants).
ALTER TABLE skill_grants ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE skill_grants TO service_role;

-- Carry today's behaviour over: every role that could subtract/remove task
-- time via can_edit_time_logs keeps that ability as a full edit_logged_time
-- grant, now visible (and changeable) in the Skills module.
INSERT INTO skill_grants (skill_key, principal_type, principal_id, level)
SELECT 'edit_logged_time', 'role', r.id::text, 'full'
FROM roles r
WHERE (r.permissions ->> 'can_edit_time_logs') = 'true'
ON CONFLICT (skill_key, principal_type, principal_id) DO NOTHING;

-- Editing a logged entry in place (PATCH /pm/tasks/:id/time-entries/:entryId)
-- leaves a trace on the row, so the task's history shows it was changed and by
-- whom rather than silently rewriting the record.
ALTER TABLE task_time_entries
  ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS edited_by UUID REFERENCES users(id) ON DELETE SET NULL;
