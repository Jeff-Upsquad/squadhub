-- Extend tasks.priority to include 'emergency' for rare, critical incidents.
-- Existing rows (urgent/high/normal/low/none) are unaffected.
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_priority_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_priority_check
  CHECK (priority IN ('emergency', 'urgent', 'high', 'normal', 'low', 'none'));
