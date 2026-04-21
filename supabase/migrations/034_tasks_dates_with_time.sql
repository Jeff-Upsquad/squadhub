-- ============================================================
-- Promote tasks.work_date and tasks.start_date from DATE to
-- TIMESTAMPTZ so the product can carry a time-of-day on each of
-- the three task dates (work, start, due). `due_date` was already
-- TIMESTAMPTZ from migration 002. Existing DATE values are kept
-- as midnight in the session timezone.
--
-- Idempotent: no-op once both columns are already TIMESTAMPTZ.
-- ============================================================

DO $$
BEGIN
  IF (
    SELECT data_type FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'tasks'
      AND column_name = 'work_date'
  ) = 'date' THEN
    ALTER TABLE tasks
      ALTER COLUMN work_date TYPE TIMESTAMPTZ USING work_date::timestamptz;
  END IF;

  IF (
    SELECT data_type FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'tasks'
      AND column_name = 'start_date'
  ) = 'date' THEN
    ALTER TABLE tasks
      ALTER COLUMN start_date TYPE TIMESTAMPTZ USING start_date::timestamptz;
  END IF;
END$$;
