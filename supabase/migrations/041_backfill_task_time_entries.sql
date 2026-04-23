-- ============================================================
-- 041: Backfill task_time_entries from existing tasks.time_tracked totals.
-- ============================================================
-- The aggregate tasks.time_tracked column has no per-user, per-session
-- history. For each task with time_tracked > 0, attribute the whole total
-- to every user who plausibly logged it: the union of assignees and the
-- creator, deduped. One row per (task, user) pair.
--
-- Caveats:
--   - This inflates team-wide totals: a 5h total on a 3-assignee task
--     becomes 5h in THREE people's Time Sheets.
--   - started_at and stopped_at are both set to task.created_at (we don't
--     know when the time was actually logged). Duration is correct.
--   - Subsequent code path (ActiveTimer / TaskDetailPanel) stops bumping
--     tasks.time_tracked through the old PUT path — from the release of
--     migration 040 onward, every new session is a proper entry row, so
--     running this script multiple times would double-count. Guard with a
--     NOT EXISTS clause so re-running is a no-op.

INSERT INTO task_time_entries (task_id, user_id, workspace_id, started_at, stopped_at, duration_seconds, created_at)
SELECT
  t.id,
  u.user_id,
  s.workspace_id,
  t.created_at,
  t.created_at,
  t.time_tracked,
  now()
FROM tasks t
JOIN lists l ON l.id = t.list_id
JOIN spaces s ON s.id = l.space_id
CROSS JOIN LATERAL (
  SELECT DISTINCT user_id FROM (
    SELECT unnest(COALESCE(t.assignee_ids, ARRAY[]::UUID[])) AS user_id
    UNION
    SELECT t.created_by
  ) x WHERE x.user_id IS NOT NULL
) u
WHERE t.time_tracked > 0
  AND NOT EXISTS (
    SELECT 1 FROM task_time_entries e WHERE e.task_id = t.id
  );
