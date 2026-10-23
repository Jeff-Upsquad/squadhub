-- Add time estimate and time tracked columns to tasks
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS time_estimate INTEGER DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS time_tracked INTEGER NOT NULL DEFAULT 0;

-- time_estimate: stored in minutes (e.g. 90 = 1h 30m), NULL means not set
-- time_tracked: stored in seconds for precision, 0 means no time tracked
