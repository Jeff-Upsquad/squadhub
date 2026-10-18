-- Allow setting a default task type for lists, folders, and spaces (areas).
ALTER TABLE lists   ADD COLUMN IF NOT EXISTS default_task_type_id UUID REFERENCES task_types(id) ON DELETE SET NULL;
ALTER TABLE folders ADD COLUMN IF NOT EXISTS default_task_type_id UUID REFERENCES task_types(id) ON DELETE SET NULL;
ALTER TABLE spaces  ADD COLUMN IF NOT EXISTS default_task_type_id UUID REFERENCES task_types(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_lists_default_task_type ON lists(default_task_type_id);
CREATE INDEX IF NOT EXISTS idx_folders_default_task_type ON folders(default_task_type_id);
CREATE INDEX IF NOT EXISTS idx_spaces_default_task_type ON spaces(default_task_type_id);
