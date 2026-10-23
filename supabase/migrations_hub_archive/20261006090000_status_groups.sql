-- ============================================================
-- Status Groups: reusable workflow-status sets manageable from admin.
--
-- Model mirrors task_types admin UX:
--   status_groups                = a named group (e.g. "Design Workflow")
--   status_group_statuses        = the statuses inside the group
--   status_group_assignments     = where the group is applied
--     entity_type: space (= Area) | folder (= Space in UI) |
--                  list | template (= client_space_templates row,
--                  i.e. "Designer Space" / "Video Editor Space" etc.)
--
-- Applying a group to a SPACE also clones its statuses into
-- space_statuses so existing boards (which read space_statuses)
-- update immediately. Folder/list/template assignments are stored
-- and resolved via the effective-group lookup
-- (GET /pm/status-groups/effective); the web board adopts that
-- lookup in a follow-up.
--
-- Server-only tables: all access goes through the API with
-- service_role. Idempotent — safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS status_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  icon TEXT NOT NULL DEFAULT 'flag',
  color TEXT NOT NULL DEFAULT '#6b7280',
  position INTEGER NOT NULL DEFAULT 0,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS status_group_statuses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES status_groups(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#6b7280',
  position INTEGER NOT NULL DEFAULT 0,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  category TEXT NOT NULL DEFAULT 'todo' CHECK (category IN ('todo', 'active', 'done', 'closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(group_id, name)
);

CREATE TABLE IF NOT EXISTS status_group_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES status_groups(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('space', 'folder', 'list', 'template')),
  entity_id UUID NOT NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_sgs_group ON status_group_statuses(group_id);
CREATE INDEX IF NOT EXISTS idx_sga_group ON status_group_assignments(group_id);
CREATE INDEX IF NOT EXISTS idx_sga_entity ON status_group_assignments(entity_type, entity_id);

-- updated_at trigger for status_groups
CREATE OR REPLACE FUNCTION update_status_groups_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_status_groups_updated_at ON status_groups;
CREATE TRIGGER trg_status_groups_updated_at
  BEFORE UPDATE ON status_groups
  FOR EACH ROW
  EXECUTE FUNCTION update_status_groups_updated_at();

-- ------------------------------------------------------------
-- Seed: mirror the two status sets the codebase already uses.
-- General Workflow  = seed_default_statuses() (002)
-- Design Workflow   = seed_design_statuses() (070/071)
-- ------------------------------------------------------------

INSERT INTO status_groups (key, name, description, icon, color, position, is_default, is_system, is_enabled)
VALUES
  ('general_workflow', 'General Workflow', 'Default To Do / In Progress / Done flow for areas, folders and lists.', 'flag', '#6b7280', 0, TRUE, TRUE, TRUE),
  ('design_workflow', 'Design Workflow', 'Request → lineup → assigned → work in progress → changes → review → closed. Used by designer and video editor spaces.', 'palette', '#8b5cf6', 1, FALSE, TRUE, TRUE)
ON CONFLICT (key) DO NOTHING;

-- General statuses
INSERT INTO status_group_statuses (group_id, name, color, position, is_default, category)
SELECT g.id, v.name, v.color, v.position, v.is_default, v.category
FROM (VALUES
  ('To Do', '#6b7280', 0, TRUE, 'todo'),
  ('In Progress', '#3b82f6', 1, FALSE, 'active'),
  ('Done', '#22c55e', 2, FALSE, 'done')
) AS v(name, color, position, is_default, category)
JOIN status_groups g ON g.key = 'general_workflow'
ON CONFLICT (group_id, name) DO NOTHING;

-- Design statuses (mirrors 070 seed_design_statuses)
INSERT INTO status_group_statuses (group_id, name, color, position, is_default, category)
SELECT g.id, v.name, v.color, v.position, v.is_default, v.category
FROM (VALUES
  ('New Request', '#6b7280', 0, TRUE, 'todo'),
  ('Checking', '#9ca3af', 1, FALSE, 'todo'),
  ('Line-up', '#38bdf8', 2, FALSE, 'active'),
  ('Assigned', '#3b82f6', 3, FALSE, 'active'),
  ('Work in Progress', '#f59e0b', 4, FALSE, 'active'),
  ('Changes', '#f97316', 5, FALSE, 'done'),
  ('For Review', '#8b5cf6', 6, FALSE, 'done'),
  ('Closed', '#22c55e', 7, FALSE, 'closed')
) AS v(name, color, position, is_default, category)
JOIN status_groups g ON g.key = 'design_workflow'
ON CONFLICT (group_id, name) DO NOTHING;

-- ------------------------------------------------------------
-- Data API grants: server-only tables.
-- ------------------------------------------------------------
REVOKE ALL PRIVILEGES ON TABLE public.status_groups FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.status_group_statuses FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.status_group_assignments FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.status_groups TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.status_group_statuses TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.status_group_assignments TO service_role;
