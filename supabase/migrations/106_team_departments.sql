-- ============================================================
-- 106: Team departments (internal-team org structure)
--   - departments: admin-managed groupings (Sales, HR, Recruiting, …)
--   - department_members: many-to-many users <-> departments
--   - Seeds Sales / HR / Recruiting (idempotent)
-- Additive only — no changes to existing tables.
-- Idempotent — safe to re-run.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  color TEXT NOT NULL DEFAULT '#6b7280',
  position INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Case-insensitive unique name so "Sales" and "sales" can't coexist.
CREATE UNIQUE INDEX IF NOT EXISTS idx_departments_name_lower ON departments (lower(name));

CREATE TABLE IF NOT EXISTS department_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (department_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_department_members_department ON department_members(department_id);
CREATE INDEX IF NOT EXISTS idx_department_members_user ON department_members(user_id);

-- Seed starter departments. ON CONFLICT targets the lower(name) unique index.
INSERT INTO departments (name, description, color, position) VALUES
  ('Sales', 'Sales team', '#22c55e', 0),
  ('HR', 'Human resources', '#a855f7', 1),
  ('Recruiting', 'Talent acquisition & recruiting', '#3b82f6', 2)
ON CONFLICT (lower(name)) DO NOTHING;

NOTIFY pgrst, 'reload schema';
COMMIT;
