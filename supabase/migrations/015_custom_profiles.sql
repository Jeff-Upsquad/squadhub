-- ============================================================
-- 015: Custom Profiles for Folders & Lists
-- Template-based folder/list creation with access control
-- ============================================================

-- Custom profile definitions (templates)
CREATE TABLE custom_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  icon TEXT DEFAULT 'folder',
  category TEXT NOT NULL DEFAULT 'general',
  target_type TEXT NOT NULL CHECK (target_type IN ('folder', 'list')),
  template JSONB NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Role-based access: which roles can see which profiles
CREATE TABLE custom_profile_role_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES custom_profiles(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(profile_id, role_id)
);

-- User-based access: direct user grants
CREATE TABLE custom_profile_user_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES custom_profiles(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(profile_id, user_id)
);

-- Track which profile was used to create a folder/list
ALTER TABLE folders
  ADD COLUMN profile_id UUID REFERENCES custom_profiles(id) ON DELETE SET NULL,
  ADD COLUMN profile_version INTEGER;

ALTER TABLE lists
  ADD COLUMN profile_id UUID REFERENCES custom_profiles(id) ON DELETE SET NULL,
  ADD COLUMN profile_version INTEGER;

-- Indexes
CREATE INDEX idx_custom_profile_role_access_profile ON custom_profile_role_access(profile_id);
CREATE INDEX idx_custom_profile_role_access_role ON custom_profile_role_access(role_id);
CREATE INDEX idx_custom_profile_user_access_profile ON custom_profile_user_access(profile_id);
CREATE INDEX idx_custom_profile_user_access_user ON custom_profile_user_access(user_id);
CREATE INDEX idx_folders_profile ON folders(profile_id) WHERE profile_id IS NOT NULL;
CREATE INDEX idx_lists_profile ON lists(profile_id) WHERE profile_id IS NOT NULL;

-- Seed example profiles
INSERT INTO custom_profiles (slug, name, description, icon, category, target_type, template) VALUES
(
  'design-workflow',
  'Design Workflow',
  'Manage design projects with review stages',
  'palette',
  'design',
  'folder',
  '{"lists": [{"name": "Briefs", "position": 0, "default_view": "list"}, {"name": "In Progress", "position": 1, "default_view": "board"}, {"name": "Reviews", "position": 2, "default_view": "board"}]}'
),
(
  'video-production',
  'Video Production',
  'End-to-end video production pipeline',
  'video',
  'video',
  'folder',
  '{"lists": [{"name": "Pre-Production", "position": 0, "default_view": "list"}, {"name": "Filming", "position": 1, "default_view": "board"}, {"name": "Editing", "position": 2, "default_view": "board"}, {"name": "Review & Publish", "position": 3, "default_view": "list"}]}'
),
(
  'sprint-board',
  'Sprint Board',
  'Agile sprint tracking list',
  'zap',
  'development',
  'list',
  '{"default_view": "board"}'
);
