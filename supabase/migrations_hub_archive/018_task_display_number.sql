-- ============================================================
-- 018: Human-friendly sequential task IDs
-- Adds tasks.display_number backed by a sequence starting at 1000.
-- Idempotent — safe to re-run.
-- ============================================================

CREATE SEQUENCE IF NOT EXISTS tasks_display_number_seq
  START 1000
  MINVALUE 1000
  INCREMENT 1
  NO CYCLE;

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS display_number INTEGER;

-- Backfill any rows that don't have a number yet. Each call to nextval()
-- returns a new unique value so this assigns distinct numbers.
UPDATE tasks
SET display_number = nextval('tasks_display_number_seq')
WHERE display_number IS NULL;

-- Default for new inserts
ALTER TABLE tasks ALTER COLUMN display_number SET DEFAULT nextval('tasks_display_number_seq');

-- Enforce uniqueness
CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_display_number ON tasks(display_number);
