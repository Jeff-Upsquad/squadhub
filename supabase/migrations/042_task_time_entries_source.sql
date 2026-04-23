-- ============================================================
-- 042: Add `source` column + allow negative durations on task_time_entries
-- ============================================================
-- Manual edits of a task's logged time (via the "Logged" field in the task
-- detail panel) now create an entry too, so the Time Sheet reflects them.
-- A reduction (e.g. user over-logged and fixes it) is represented as an
-- entry with a NEGATIVE duration_seconds, so the sum of entries stays in
-- sync with the tasks.time_tracked aggregate.

ALTER TABLE task_time_entries
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'timer'
    CHECK (source IN ('timer', 'manual'));

ALTER TABLE task_time_entries DROP CONSTRAINT IF EXISTS task_time_entries_duration_seconds_check;
ALTER TABLE task_time_entries ADD CONSTRAINT task_time_entries_duration_seconds_check
  CHECK (duration_seconds <> 0);
