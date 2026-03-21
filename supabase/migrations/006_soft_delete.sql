-- Add soft-delete support to spaces, folders, and lists
ALTER TABLE spaces ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE folders ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE lists ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

-- Index for efficient trash queries
CREATE INDEX IF NOT EXISTS idx_spaces_deleted ON spaces(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_folders_deleted ON folders(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lists_deleted ON lists(deleted_at) WHERE deleted_at IS NOT NULL;
