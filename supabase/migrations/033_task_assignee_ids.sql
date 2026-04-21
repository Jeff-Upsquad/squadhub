-- ============================================================
-- Task assignee_ids column (idempotent)
-- Source of truth for task assignees is the `tasks.assignee_ids`
-- UUID[] column (see migration 030 for context). This migration
-- guarantees the column and its lookup index exist on every
-- environment — a no-op where they already do.
-- ============================================================

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS assignee_ids UUID[] NOT NULL DEFAULT '{}'::UUID[];

CREATE INDEX IF NOT EXISTS idx_tasks_assignee_ids
  ON tasks USING GIN (assignee_ids);
