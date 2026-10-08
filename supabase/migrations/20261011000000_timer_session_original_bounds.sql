-- Preserve the true original bounds of a timer session so reduce-only edits
-- can allow re-expanding back up to the original range (but never beyond it).
-- NULL means "never trimmed": bounds equal the current start/end/duration.
ALTER TABLE timer_sessions
  ADD COLUMN IF NOT EXISTS original_start_time TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS original_end_time TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS original_duration_seconds INTEGER;
