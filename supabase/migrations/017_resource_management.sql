-- ============================================================
-- 017: Resource Management (status + lock)
-- Adds active/inactive status and lock capability to spaces, folders, lists
-- ============================================================

-- Spaces
ALTER TABLE spaces
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  ADD COLUMN IF NOT EXISTS is_locked BOOLEAN NOT NULL DEFAULT false;

-- Folders
ALTER TABLE folders
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  ADD COLUMN IF NOT EXISTS is_locked BOOLEAN NOT NULL DEFAULT false;

-- Lists
ALTER TABLE lists
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  ADD COLUMN IF NOT EXISTS is_locked BOOLEAN NOT NULL DEFAULT false;

-- Indexes for filtered queries
CREATE INDEX IF NOT EXISTS idx_spaces_status ON spaces(status);
CREATE INDEX IF NOT EXISTS idx_folders_status ON folders(status);
CREATE INDEX IF NOT EXISTS idx_lists_status ON lists(status);
