-- ============================================================
-- 141: Surface work-block run time alongside normal task time.
-- ============================================================
-- A work block is a task whose Start→Stop "run" was previously tracked only
-- in work_block_runs and shown only in the Work Block detail panel. We now
-- also log each run as a task_time_entry on the work-block task, so block time
-- flows into the same aggregates as a normal per-task timer (the rail Time
-- Sheet, the task "Logged" field via tasks.time_tracked, the daily timesheet
-- total + design Reports via daily_time_summaries).
--
-- Two schema tweaks support that:
--   1) a new 'work_block' source value on task_time_entries, and
--   2) a back-link to the originating run, so the Time Sheet can nest the
--      tasks worked on / completed during the run as sub-items.
-- ============================================================

-- 1) Allow the new source. (migration 042 set this to IN ('timer','manual').)
ALTER TABLE task_time_entries DROP CONSTRAINT IF EXISTS task_time_entries_source_check;
ALTER TABLE task_time_entries ADD CONSTRAINT task_time_entries_source_check
  CHECK (source IN ('timer', 'manual', 'work_block'));

-- 2) Link a work-block entry back to its run (NULL for normal entries).
ALTER TABLE task_time_entries
  ADD COLUMN IF NOT EXISTS work_block_run_id UUID
    REFERENCES work_block_runs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_task_time_entries_wb_run
  ON task_time_entries(work_block_run_id);
