-- ============================================================
-- Task Types + Custom Fields + Checklists
-- Adds missing work_date/start_date columns on tasks
-- ============================================================

-- Ensure the shared updated_at trigger function exists (idempotent)
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Global task types (admin-managed, not scoped to workspace/space)
CREATE TABLE IF NOT EXISTS task_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  icon TEXT NOT NULL DEFAULT 'check-square',
  color TEXT NOT NULL DEFAULT '#6b7280',
  position INTEGER NOT NULL DEFAULT 0,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enforce exactly one default type
CREATE UNIQUE INDEX IF NOT EXISTS idx_task_types_default
  ON task_types(is_default) WHERE is_default = TRUE;

-- Per-type custom field definitions
CREATE TABLE IF NOT EXISTS task_type_fields (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_type_id UUID NOT NULL REFERENCES task_types(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  field_type TEXT NOT NULL
    CHECK (field_type IN ('text', 'textarea', 'select', 'multi_select', 'number', 'date', 'url', 'checkbox')),
  options JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_required BOOLEAN NOT NULL DEFAULT FALSE,
  help_text TEXT,
  placeholder TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (task_type_id, key)
);

CREATE INDEX IF NOT EXISTS idx_task_type_fields_type ON task_type_fields(task_type_id);

-- Tasks: add task_type_id FK + missing date columns
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS task_type_id UUID REFERENCES task_types(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS work_date  DATE,
  ADD COLUMN IF NOT EXISTS start_date DATE;

CREATE INDEX IF NOT EXISTS idx_tasks_task_type ON tasks(task_type_id);

-- Checklists (multiple per task)
CREATE TABLE IF NOT EXISTS task_checklists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'Checklist',
  position INTEGER NOT NULL DEFAULT 0,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_checklists_task ON task_checklists(task_id);

CREATE TABLE IF NOT EXISTS task_checklist_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  checklist_id UUID NOT NULL REFERENCES task_checklists(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  is_done BOOLEAN NOT NULL DEFAULT FALSE,
  position INTEGER NOT NULL DEFAULT 0,
  assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
  due_date DATE,
  completed_at TIMESTAMPTZ,
  completed_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_checklist_items_checklist ON task_checklist_items(checklist_id);

-- updated_at triggers (drop-then-create so the migration is safely re-runnable)
DROP TRIGGER IF EXISTS trg_task_types_updated_at ON task_types;
CREATE TRIGGER trg_task_types_updated_at
  BEFORE UPDATE ON task_types
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_task_type_fields_updated_at ON task_type_fields;
CREATE TRIGGER trg_task_type_fields_updated_at
  BEFORE UPDATE ON task_type_fields
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_task_checklists_updated_at ON task_checklists;
CREATE TRIGGER trg_task_checklists_updated_at
  BEFORE UPDATE ON task_checklists
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_checklist_items_updated_at ON task_checklist_items;
CREATE TRIGGER trg_checklist_items_updated_at
  BEFORE UPDATE ON task_checklist_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Seed the default "Task" type (system-protected)
INSERT INTO task_types (key, name, icon, color, is_default, is_system, position)
VALUES ('task', 'Task', 'check-square', '#6b7280', TRUE, TRUE, 0)
ON CONFLICT (key) DO NOTHING;

-- Backfill existing tasks with the default type
UPDATE tasks
SET task_type_id = (SELECT id FROM task_types WHERE key = 'task')
WHERE task_type_id IS NULL;
