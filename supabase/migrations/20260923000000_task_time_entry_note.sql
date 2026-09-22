-- ============================================================
-- Task time entries: optional per-entry note
-- ============================================================
-- The redesigned "Log time" popover on the task detail panel lets a user say
-- what a logged block of time was spent on ("client revisions", "call with
-- ops"). One nullable column on the existing per-session table (migration 040)
-- is all that needs; every existing entry stays valid with note = NULL.

ALTER TABLE task_time_entries
  ADD COLUMN IF NOT EXISTS note TEXT;
