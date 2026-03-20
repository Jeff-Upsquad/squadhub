-- ============================================================
-- Migration 005: Resource Access Control
-- - resource_memberships table for per-resource access levels
-- - is_private flag on spaces, folders, lists
-- - channels default to private
-- - auto-grant creator Manager membership via trigger
-- - backfill existing data
-- ============================================================

-- 1. Create resource_memberships table
CREATE TABLE resource_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_type TEXT NOT NULL CHECK (resource_type IN ('channel', 'space', 'folder', 'list')),
  resource_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  access_level TEXT NOT NULL DEFAULT 'viewer'
    CHECK (access_level IN ('viewer', 'commenter', 'member', 'manager')),
  invited_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(resource_type, resource_id, user_id)
);

CREATE INDEX idx_rm_resource ON resource_memberships(resource_type, resource_id);
CREATE INDEX idx_rm_user ON resource_memberships(user_id);
CREATE INDEX idx_rm_user_type ON resource_memberships(user_id, resource_type);

-- 2. Add is_private to PM resources (channels already has it)
ALTER TABLE spaces ADD COLUMN IF NOT EXISTS is_private BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE folders ADD COLUMN IF NOT EXISTS is_private BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE lists ADD COLUMN IF NOT EXISTS is_private BOOLEAN NOT NULL DEFAULT true;

-- 3. Change channels default to private
ALTER TABLE channels ALTER COLUMN is_private SET DEFAULT true;

-- 4. Trigger: auto-add creator as Manager on resource creation
CREATE OR REPLACE FUNCTION auto_add_creator_as_manager()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO resource_memberships (resource_type, resource_id, user_id, access_level, invited_by)
  VALUES (TG_ARGV[0], NEW.id, NEW.created_by, 'manager', NEW.created_by)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_channel_auto_member AFTER INSERT ON channels
  FOR EACH ROW EXECUTE FUNCTION auto_add_creator_as_manager('channel');
CREATE TRIGGER trg_space_auto_member AFTER INSERT ON spaces
  FOR EACH ROW EXECUTE FUNCTION auto_add_creator_as_manager('space');
CREATE TRIGGER trg_folder_auto_member AFTER INSERT ON folders
  FOR EACH ROW EXECUTE FUNCTION auto_add_creator_as_manager('folder');
CREATE TRIGGER trg_list_auto_member AFTER INSERT ON lists
  FOR EACH ROW EXECUTE FUNCTION auto_add_creator_as_manager('list');

-- 5. Mark all existing resources as private
UPDATE channels SET is_private = true WHERE is_private = false;

-- 6. Backfill: add all workspace_members as 'member' on existing resources
INSERT INTO resource_memberships (resource_type, resource_id, user_id, access_level)
SELECT 'channel', c.id, wm.user_id, 'member'
FROM channels c CROSS JOIN workspace_members wm
ON CONFLICT DO NOTHING;

INSERT INTO resource_memberships (resource_type, resource_id, user_id, access_level)
SELECT 'space', s.id, wm.user_id, 'member'
FROM spaces s CROSS JOIN workspace_members wm
ON CONFLICT DO NOTHING;

INSERT INTO resource_memberships (resource_type, resource_id, user_id, access_level)
SELECT 'folder', f.id, wm.user_id, 'member'
FROM folders f CROSS JOIN workspace_members wm
ON CONFLICT DO NOTHING;

INSERT INTO resource_memberships (resource_type, resource_id, user_id, access_level)
SELECT 'list', l.id, wm.user_id, 'member'
FROM lists l CROSS JOIN workspace_members wm
ON CONFLICT DO NOTHING;

-- 7. Update roles permissions schema to include all permission keys
-- Update the default Member role with all permission keys
UPDATE roles SET permissions = jsonb_build_object(
  'can_create_channels', true,
  'can_create_lists', true,
  'can_create_folders', true,
  'can_create_spaces', true,
  'can_archive_lists', false,
  'can_archive_spaces', false,
  'can_archive_folders', false,
  'can_delete_messages', false,
  'can_edit_messages', true,
  'can_send_dms', true,
  'can_manage_channels', false,
  'can_manage_members', false,
  'can_manage_tasks', true,
  'can_manage_roles', false,
  'can_view_admin_panel', false,
  'can_manage_workspace', false
) WHERE name = 'Member';

-- Update the Moderator role
UPDATE roles SET permissions = jsonb_build_object(
  'can_create_channels', true,
  'can_create_lists', true,
  'can_create_folders', true,
  'can_create_spaces', true,
  'can_archive_lists', true,
  'can_archive_spaces', true,
  'can_archive_folders', true,
  'can_delete_messages', true,
  'can_edit_messages', true,
  'can_send_dms', true,
  'can_manage_channels', true,
  'can_manage_members', false,
  'can_manage_tasks', true,
  'can_manage_roles', false,
  'can_view_admin_panel', false,
  'can_manage_workspace', false
) WHERE name = 'Moderator';

-- 8. Create a Guest role with all permissions false
INSERT INTO roles (name, color, permissions, is_default) VALUES
  ('Guest', '#94a3b8', '{
    "can_create_channels": false,
    "can_create_lists": false,
    "can_create_folders": false,
    "can_create_spaces": false,
    "can_archive_lists": false,
    "can_archive_spaces": false,
    "can_archive_folders": false,
    "can_delete_messages": false,
    "can_edit_messages": false,
    "can_send_dms": false,
    "can_manage_channels": false,
    "can_manage_members": false,
    "can_manage_tasks": false,
    "can_manage_roles": false,
    "can_view_admin_panel": false,
    "can_manage_workspace": false
  }', false)
ON CONFLICT (name) DO NOTHING;
