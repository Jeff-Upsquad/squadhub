-- ============================================================
-- Platform role hierarchy
--   Admin > Managers > Member (the default Internal role)
--
-- Existing platform admins keep users.is_admin=true for backward-compatible
-- access to every existing admin gate. Their former primary role is preserved
-- as a secondary role before Admin becomes their new primary, so role-based
-- mini-app grants and effective permissions are not lost.
-- ============================================================

BEGIN;

-- Protected top-level Admin role. Platform authorization continues to use the
-- durable users.is_admin flag as well, so this migration cannot strand an
-- existing admin if a caller still uses the legacy gate.
INSERT INTO roles (name, color, permissions, is_default, is_system, system_key)
VALUES (
  'Admin',
  '#d97706',
  '{
    "can_create_channels":true,
    "can_create_lists":true,
    "can_create_folders":true,
    "can_create_spaces":true,
    "can_archive_lists":true,
    "can_archive_spaces":true,
    "can_archive_folders":true,
    "can_delete_messages":true,
    "can_edit_messages":true,
    "can_send_dms":true,
    "can_manage_channels":true,
    "can_manage_members":true,
    "can_manage_tasks":true,
    "can_manage_roles":true,
    "can_view_admin_panel":true,
    "can_manage_workspace":true,
    "can_edit_time_logs":true,
    "time_edit_window_hours":0,
    "can_edit_elapsed_time":true
  }'::jsonb,
  FALSE, TRUE, 'admin'
)
ON CONFLICT (name) DO UPDATE SET
  is_system = TRUE,
  system_key = 'admin',
  permissions = EXCLUDED.permissions;

-- Operational management role. It can run day-to-day work, but cannot enter
-- the platform admin panel, alter roles, or change workspace-wide settings.
INSERT INTO roles (name, color, permissions, is_default, is_system, system_key)
VALUES (
  'Managers',
  '#7c3aed',
  '{
    "can_create_channels":true,
    "can_create_lists":true,
    "can_create_folders":true,
    "can_create_spaces":true,
    "can_archive_lists":true,
    "can_archive_spaces":true,
    "can_archive_folders":true,
    "can_delete_messages":true,
    "can_edit_messages":true,
    "can_send_dms":true,
    "can_manage_channels":true,
    "can_manage_members":true,
    "can_manage_tasks":true,
    "can_manage_roles":false,
    "can_view_admin_panel":false,
    "can_manage_workspace":false,
    "can_edit_time_logs":true,
    "time_edit_window_hours":0,
    "can_edit_elapsed_time":true
  }'::jsonb,
  FALSE, TRUE, 'manager'
)
ON CONFLICT (name) DO UPDATE SET
  is_system = TRUE,
  system_key = 'manager',
  permissions = EXCLUDED.permissions;

-- Exact restoration point for an admin demotion. This also lets promotion be
-- idempotent without replacing the role the user held before becoming Admin.
CREATE TABLE IF NOT EXISTS platform_admin_role_backups (
  workspace_member_id UUID PRIMARY KEY REFERENCES workspace_members(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  previous_workspace_role TEXT NOT NULL,
  previous_role_id UUID REFERENCES roles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_platform_admin_role_backups_user
  ON platform_admin_role_backups(user_id);
ALTER TABLE platform_admin_role_backups ENABLE ROW LEVEL SECURITY;

-- Snapshot existing admins before changing their workspace role.
INSERT INTO platform_admin_role_backups (
  workspace_member_id,
  user_id,
  previous_workspace_role,
  previous_role_id
)
SELECT wm.id, wm.user_id, wm.role, wm.role_id
FROM workspace_members wm
JOIN users u ON u.id = wm.user_id
WHERE u.is_admin = TRUE
ON CONFLICT (workspace_member_id) DO NOTHING;

-- Preserve the former primary in the effective role union. This is the key
-- compatibility step for role-scoped mini apps and custom permissions.
INSERT INTO workspace_member_secondary_roles (workspace_member_id, role_id)
SELECT wm.id, wm.role_id
FROM workspace_members wm
JOIN users u ON u.id = wm.user_id
JOIN roles admin_role ON admin_role.system_key = 'admin'
WHERE u.is_admin = TRUE
  AND wm.role_id IS NOT NULL
  AND wm.role_id <> admin_role.id
ON CONFLICT (workspace_member_id, role_id) DO NOTHING;

-- Admin is now the visible top role. users.is_admin deliberately remains true.
UPDATE workspace_members wm
SET role = 'admin', role_id = admin_role.id
FROM users u, roles admin_role
WHERE wm.user_id = u.id
  AND u.is_admin = TRUE
  AND admin_role.system_key = 'admin';

-- A few legacy platform admins may predate workspace membership. Attach them
-- to the oldest workspace so the new Admin role is visible and effective,
-- while keeping the legacy flag that already grants their platform access.
INSERT INTO workspace_members (workspace_id, user_id, role, role_id)
SELECT ws.id, u.id, 'admin', admin_role.id
FROM users u
CROSS JOIN LATERAL (
  SELECT id FROM workspaces ORDER BY created_at ASC LIMIT 1
) ws
CROSS JOIN roles admin_role
WHERE u.is_admin = TRUE
  AND admin_role.system_key = 'admin'
  AND NOT EXISTS (
    SELECT 1 FROM workspace_members existing WHERE existing.user_id = u.id
  )
ON CONFLICT (workspace_id, user_id) DO NOTHING;

NOTIFY pgrst, 'reload schema';
COMMIT;
