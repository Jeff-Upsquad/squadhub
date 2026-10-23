-- 135_labels.sql — Task "Labels" system
--
-- NOTE ON NAMING: the physical store for a label is the `task_tags` /
-- `task_tag_assignments` tables. They are DEFINED in migration 002 but were
-- never applied to the live Squad Hub DB (repo/prod drift), so this migration
-- (re)creates them idempotently — `CREATE TABLE IF NOT EXISTS` is a no-op where
-- 002 already ran, and creates them where it didn't. The product calls these
-- "Labels"; we keep the legacy physical names and add `group_id`.
--
-- Model:
--   label_groups            — named groups; the per-workspace default is "General"
--   task_tags.group_id      — every label belongs to exactly one group
--   label_group_role/user_access  — gate VISIBILITY of a (non-default) group
--   label_create_role/user_access — grant the CREATE-label permission to roles/users
--   label_requests          — users request labels admins haven't created yet
--
-- Visibility rule (enforced in the API layer): the default "General" group is
-- visible to everyone; every other group is visible only to admins and the
-- roles/users explicitly assigned to it. Labels are visible iff their group is.

BEGIN;

-- 1. Label groups -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS label_groups (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  is_default   BOOLEAN NOT NULL DEFAULT false,
  position     INTEGER NOT NULL DEFAULT 0,
  created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, name)
);

CREATE INDEX IF NOT EXISTS idx_label_groups_workspace ON label_groups(workspace_id);
-- At most one default ("General") group per workspace.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_label_group_default
  ON label_groups(workspace_id) WHERE is_default;

-- Auto-seed a "General" default group whenever a workspace is created
-- (mirrors seed_default_statuses() for spaces). Existing workspaces are
-- backfilled below.
CREATE OR REPLACE FUNCTION seed_default_label_group()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO label_groups (workspace_id, name, is_default, position)
  VALUES (NEW.id, 'General', true, 0)
  ON CONFLICT (workspace_id, name) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_seed_default_label_group ON workspaces;
CREATE TRIGGER trg_seed_default_label_group
  AFTER INSERT ON workspaces
  FOR EACH ROW EXECUTE FUNCTION seed_default_label_group();

-- 2. Label store (task_tags) + assignments — created here because migration
--    002's definitions were never applied to the live DB. IF NOT EXISTS makes
--    this a no-op on databases where 002 did run.
CREATE TABLE IF NOT EXISTS task_tags (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  color        TEXT NOT NULL DEFAULT '#6b7280'
);
CREATE INDEX IF NOT EXISTS idx_task_tags_workspace ON task_tags(workspace_id);

CREATE TABLE IF NOT EXISTS task_tag_assignments (
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  tag_id  UUID NOT NULL REFERENCES task_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, tag_id)
);

-- Seed General for existing workspaces + backfill task_tags.group_id
INSERT INTO label_groups (workspace_id, name, is_default, position)
  SELECT id, 'General', true, 0 FROM workspaces
  ON CONFLICT (workspace_id, name) DO NOTHING;

ALTER TABLE task_tags
  ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES label_groups(id) ON DELETE RESTRICT;

UPDATE task_tags t
  SET group_id = g.id
  FROM label_groups g
  WHERE g.workspace_id = t.workspace_id
    AND g.is_default
    AND t.group_id IS NULL;

ALTER TABLE task_tags ALTER COLUMN group_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_task_tags_group ON task_tags(group_id);
-- Case-insensitive uniqueness per workspace so inline create / request-approval
-- can be made idempotent and never produce duplicate labels.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_task_tag_name
  ON task_tags(workspace_id, lower(name));

-- 3. Group visibility gating (mirror mini_app_*_access) ---------------------
CREATE TABLE IF NOT EXISTS label_group_role_access (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id   UUID NOT NULL REFERENCES label_groups(id) ON DELETE CASCADE,
  role_id    UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (group_id, role_id)
);
CREATE INDEX IF NOT EXISTS idx_label_group_role_access_group ON label_group_role_access(group_id);
CREATE INDEX IF NOT EXISTS idx_label_group_role_access_role ON label_group_role_access(role_id);

CREATE TABLE IF NOT EXISTS label_group_user_access (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id   UUID NOT NULL REFERENCES label_groups(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (group_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_label_group_user_access_group ON label_group_user_access(group_id);
CREATE INDEX IF NOT EXISTS idx_label_group_user_access_user ON label_group_user_access(user_id);

-- 4. Create-label permission grants (workspace-scoped) ----------------------
CREATE TABLE IF NOT EXISTS label_create_role_access (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  role_id      UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, role_id)
);

CREATE TABLE IF NOT EXISTS label_create_user_access (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, user_id)
);

-- 5. Label requests ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS label_requests (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id       UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  requested_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  name               TEXT NOT NULL,
  suggested_group_id UUID REFERENCES label_groups(id) ON DELETE SET NULL,
  note               TEXT,
  status             TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'approved', 'rejected')),
  resolved_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  resolved_label_id  UUID REFERENCES task_tags(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_label_requests_status ON label_requests(workspace_id, status);

-- Writes go through the service-role API; RLS enabled with no user-facing
-- policies, matching the rest of the PM schema.
ALTER TABLE task_tags                ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_tag_assignments     ENABLE ROW LEVEL SECURITY;
ALTER TABLE label_groups            ENABLE ROW LEVEL SECURITY;
ALTER TABLE label_group_role_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE label_group_user_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE label_create_role_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE label_create_user_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE label_requests          ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
COMMIT;
