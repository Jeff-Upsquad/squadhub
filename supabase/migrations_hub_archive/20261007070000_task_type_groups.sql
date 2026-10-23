-- ============================================================
-- Task Type Groups: reusable task-type sets manageable from admin.
--
-- Model mirrors status_groups architecture:
--   task_type_groups             = a named group (e.g. "Default Task Types", "Software Development")
--   task_type_group_items        = task types included inside the group
--   task_type_group_assignments  = where the group is applied
--     entity_type: space (= Area) | folder (= Space in UI) |
--                  list | template (= client_space_templates row)
--
-- Nearest assigned wins: list > folder > space > template > default group.
--
-- Server-only tables: all access goes through the API with
-- service_role. Idempotent — safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS task_type_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  icon TEXT NOT NULL DEFAULT 'check-square',
  color TEXT NOT NULL DEFAULT '#6b7280',
  position INTEGER NOT NULL DEFAULT 0,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS task_type_group_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES task_type_groups(id) ON DELETE CASCADE,
  task_type_id UUID NOT NULL REFERENCES task_types(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(group_id, task_type_id)
);

CREATE TABLE IF NOT EXISTS task_type_group_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES task_type_groups(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('space', 'folder', 'list', 'template')),
  entity_id UUID NOT NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_ttgi_group ON task_type_group_items(group_id);
CREATE INDEX IF NOT EXISTS idx_ttgi_type ON task_type_group_items(task_type_id);
CREATE INDEX IF NOT EXISTS idx_ttga_group ON task_type_group_assignments(group_id);
CREATE INDEX IF NOT EXISTS idx_ttga_entity ON task_type_group_assignments(entity_type, entity_id);

-- updated_at trigger for task_type_groups
CREATE OR REPLACE FUNCTION update_task_type_groups_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_task_type_groups_updated_at ON task_type_groups;
CREATE TRIGGER trg_task_type_groups_updated_at
  BEFORE UPDATE ON task_type_groups
  FOR EACH ROW
  EXECUTE FUNCTION update_task_type_groups_updated_at();

-- ------------------------------------------------------------
-- Seed: The current task types will be saved as the default task types.
-- ------------------------------------------------------------

INSERT INTO task_type_groups (key, name, description, icon, color, position, is_default, is_system, is_enabled)
VALUES
  ('default_task_types', 'Default Task Types', 'Default set of all task types available across all areas, spaces, folders, and lists.', 'check-square', '#3b82f6', 0, TRUE, TRUE, TRUE)
ON CONFLICT (key) DO UPDATE SET
  is_default = TRUE;

-- Insert all existing task types into the default group
INSERT INTO task_type_group_items (group_id, task_type_id, position)
SELECT g.id, t.id, t.position
FROM task_types t
CROSS JOIN task_type_groups g
WHERE g.key = 'default_task_types'
ON CONFLICT (group_id, task_type_id) DO NOTHING;

-- ------------------------------------------------------------
-- Data API grants: server-only tables.
-- ------------------------------------------------------------
REVOKE ALL PRIVILEGES ON TABLE public.task_type_groups FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.task_type_group_items FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.task_type_group_assignments FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.task_type_groups TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.task_type_group_items TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.task_type_group_assignments TO service_role;
