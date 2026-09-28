-- ============================================================
-- 20260928160000: Consolidate fragmented task time entries
-- ============================================================
-- The 2-minute auto-save checkpointing added in PR #79 sliced running timers
-- into fragmented 120s/150s task_time_entries rows.
-- This migration merges contiguous rows for the same (task_id, user_id)
-- where the gap between consecutive rows is <= 5 seconds, extending the first
-- row's stopped_at and duration, and removing the intermediate fragments.
-- The task total (tasks.time_tracked) and daily_time_summaries totals remain
-- exactly identical.
-- ============================================================

DO $$
DECLARE
  r RECORD;
  prev_id UUID;
  prev_task UUID;
  prev_user UUID;
  prev_source TEXT;
  prev_stop TIMESTAMPTZ;
  prev_dur INT;
  to_delete UUID[] := '{}';
BEGIN
  FOR r IN
    SELECT id, task_id, user_id, source, started_at, stopped_at, duration_seconds
    FROM task_time_entries
    WHERE duration_seconds > 0
    ORDER BY task_id, user_id, source, started_at ASC
  LOOP
    IF prev_id IS NOT NULL
       AND prev_task = r.task_id
       AND prev_user = r.user_id
       AND prev_source = r.source
       AND r.started_at <= prev_stop + INTERVAL '5 seconds'
    THEN
      -- Contiguous / overlapping row: merge into prev_id
      IF r.stopped_at > prev_stop THEN
        IF r.started_at >= prev_stop - INTERVAL '1 second' THEN
          prev_dur := prev_dur + r.duration_seconds;
        ELSE
          prev_dur := prev_dur + GREATEST(0, ROUND(EXTRACT(EPOCH FROM (r.stopped_at - prev_stop)))::INT);
        END IF;
        prev_stop := r.stopped_at;

        UPDATE task_time_entries
        SET stopped_at = prev_stop, duration_seconds = prev_dur
        WHERE id = prev_id;
      END IF;

      to_delete := array_append(to_delete, r.id);
    ELSE
      prev_id := r.id;
      prev_task := r.task_id;
      prev_user := r.user_id;
      prev_source := r.source;
      prev_stop := r.stopped_at;
      prev_dur := r.duration_seconds;
    END IF;
  END LOOP;

  IF array_length(to_delete, 1) > 0 THEN
    DELETE FROM task_time_entries WHERE id = ANY(to_delete);
  END IF;
END $$;
