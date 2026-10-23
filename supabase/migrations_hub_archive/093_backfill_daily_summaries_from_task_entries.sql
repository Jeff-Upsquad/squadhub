-- ============================================================
-- 093: Backfill daily_time_summaries from task_time_entries.
-- ============================================================
-- Existing task_time_entries (from the per-task timer and manual edits)
-- never updated daily_time_summaries, so the space dashboard showed 0h
-- for historical time. This backfill computes IST-date buckets from
-- every task_time_entry and upserts them into daily_time_summaries.
--
-- Only runs once (tracked by migration runner). If a row already exists
-- from the check-in timer, the task time is *added* to the existing
-- totals so both sources are reflected.

INSERT INTO daily_time_summaries (user_id, workspace_id, context, date, total_work_seconds, total_break_seconds, total_no_work_seconds, session_count, first_start, last_stop, updated_at)
SELECT
  e.user_id,
  e.workspace_id,
  'default' AS context,
  (e.started_at AT TIME ZONE 'UTC' + INTERVAL '5.5 hours')::DATE AS date,
  SUM(e.duration_seconds) AS total_work_seconds,
  0 AS total_break_seconds,
  0 AS total_no_work_seconds,
  COUNT(*) AS session_count,
  MIN(e.started_at) AS first_start,
  MAX(e.started_at) AS last_stop,
  now() AS updated_at
FROM task_time_entries e
WHERE e.duration_seconds > 0
GROUP BY e.user_id, e.workspace_id, (e.started_at AT TIME ZONE 'UTC' + INTERVAL '5.5 hours')::DATE
ON CONFLICT ON CONSTRAINT daily_time_summaries_user_workspace_context_date_key
DO UPDATE SET
  total_work_seconds = daily_time_summaries.total_work_seconds + EXCLUDED.total_work_seconds,
  session_count     = daily_time_summaries.session_count + EXCLUDED.session_count,
  first_start       = LEAST(COALESCE(daily_time_summaries.first_start, EXCLUDED.first_start), EXCLUDED.first_start),
  last_stop         = GREATEST(COALESCE(daily_time_summaries.last_stop, EXCLUDED.last_stop), EXCLUDED.last_stop),
  updated_at        = now();
