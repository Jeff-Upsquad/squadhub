-- New "Top Priority" value: ranked above Urgent (star icon in the UI).
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_priority_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_priority_check
  CHECK (priority IN ('emergency', 'top', 'urgent', 'high', 'normal', 'low', 'none'));

ALTER TABLE goals DROP CONSTRAINT IF EXISTS goals_priority_check;
ALTER TABLE goals ADD CONSTRAINT goals_priority_check
  CHECK (priority IN ('emergency', 'top', 'urgent', 'high', 'normal', 'low', 'none'));
