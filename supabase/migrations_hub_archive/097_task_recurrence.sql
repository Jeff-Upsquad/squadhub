-- ============================================================
-- 097: Routines / recurring tasks
--
-- A task with a non-null `recurrence` rule is a ROUTINE TEMPLATE.
-- Templates are hidden from normal task views; a nightly spawner
-- (server/src/cron/routine-cron.ts) creates a fresh task copy on
-- each date the rule fires. Spawned copies link back via
-- `recurring_parent_id` and carry their occurrence date in
-- `recurrence_instance_date`.
--
-- Recurrence JSONB shape (same dialect as work_blocks.recurrence):
--   { "kind": "daily" | "weekdays" | "weekly" | "monthly",
--     "weekdays": [0..6],        -- kind='weekly', 0=Sun
--     "day_of_month": 1..28,     -- kind='monthly'
--     "starts_on": "YYYY-MM-DD", -- inclusive, optional
--     "ends_on": "YYYY-MM-DD" }  -- inclusive, optional/null = forever
-- ============================================================

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS recurrence JSONB;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS recurrence_paused BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS recurring_parent_id UUID REFERENCES tasks(id) ON DELETE SET NULL;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS recurrence_instance_date DATE;

-- The nightly spawner scans templates only; tiny partial index keeps
-- that scan off the main table.
CREATE INDEX IF NOT EXISTS idx_tasks_routine_templates
  ON tasks (id) WHERE recurrence IS NOT NULL;

-- One spawned copy per (template, date) — makes the spawner idempotent
-- (boot catch-up + midnight run + manual "Run now" can all race safely).
CREATE UNIQUE INDEX IF NOT EXISTS uq_tasks_routine_instance
  ON tasks (recurring_parent_id, recurrence_instance_date)
  WHERE recurring_parent_id IS NOT NULL AND recurrence_instance_date IS NOT NULL;
