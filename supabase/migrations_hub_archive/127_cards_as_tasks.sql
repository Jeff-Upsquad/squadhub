-- 127_cards_as_tasks.sql
-- Mirror the Home "disappearing cards" (Courses, Meetings) into real tasks and
-- give Routines their own type. Courses live in lms_assignments and Meetings in
-- the meetings table; this lets a per-user mirror task be created in the user's
-- personal space so they show up like any other task. The link back to the
-- source row + owning user is stored on the task so the mirror stays idempotent.

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS source_kind    TEXT,   -- 'course' | 'meeting' (NULL = ordinary task)
  ADD COLUMN IF NOT EXISTS source_id      UUID,   -- the lms_assignment / meeting id
  ADD COLUMN IF NOT EXISTS source_user_id UUID;   -- the user this mirror belongs to

-- One mirror task per (kind, source row, owning user). A meeting fans out to one
-- task per participant, so source_id alone isn't unique — the owner completes it.
-- Partial so it never constrains the 99% of tasks that aren't mirrors.
CREATE UNIQUE INDEX IF NOT EXISTS uq_tasks_source
  ON tasks (source_kind, source_id, source_user_id)
  WHERE source_kind IS NOT NULL;

-- Lets the reconciler scan/cleanup mirror rows by kind cheaply.
CREATE INDEX IF NOT EXISTS idx_tasks_source_kind
  ON tasks (source_kind)
  WHERE source_kind IS NOT NULL;

-- System task types for the mirrored categories. is_system so admins can't
-- delete/rename them; icons are lucide keys, colors drive the row/detail chips.
INSERT INTO task_types (key, name, description, icon, color, is_system, is_default, is_enabled, position)
VALUES
  ('course',  'Course',  'A learning assignment due to you',         'graduation-cap', '#0ea5e9', TRUE, FALSE, TRUE, 3),
  ('meeting', 'Meeting', 'A scheduled meeting you''re part of',       'users',          '#f59e0b', TRUE, FALSE, TRUE, 4),
  ('routine', 'Routine', 'A recurring task spawned from a routine',   'repeat',         '#a855f7', TRUE, FALSE, TRUE, 5)
ON CONFLICT (key) DO NOTHING;
