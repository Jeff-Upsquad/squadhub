-- Support for hierarchical folders: parent_folder_id lets client folders
-- contain template-based spaces, and folder_type distinguishes them visually.
ALTER TABLE folders ADD COLUMN IF NOT EXISTS folder_type TEXT NOT NULL DEFAULT 'folder' CHECK (folder_type IN ('folder', 'client'));
ALTER TABLE folders ADD COLUMN IF NOT EXISTS parent_folder_id UUID REFERENCES folders(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_folders_parent ON folders(parent_folder_id) WHERE parent_folder_id IS NOT NULL;
