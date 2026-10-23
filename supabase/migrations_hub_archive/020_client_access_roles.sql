-- ============================================================
-- 020: Client access via roles (replaces access_level)
-- - Adds roles.is_system to mark seeded, undeletable roles
-- - Seeds 'Squad Manager' and 'Client User' system roles
-- - Switches client_user_access.access_level -> role_id
-- Idempotent — safe to re-run.
-- ============================================================

-- 1. Role durability flag
ALTER TABLE roles ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT FALSE;

-- 2. Seed Squad Manager role (upsert by name)
INSERT INTO roles (name, color, permissions, is_default, is_system)
VALUES (
  'Squad Manager',
  '#9333ea',
  '{"can_manage_channels":false,"can_delete_messages":false,"can_manage_members":false,"can_manage_tasks":false,"can_manage_roles":false,"can_view_admin_panel":false,"can_manage_workspace":false}'::jsonb,
  FALSE,
  TRUE
)
ON CONFLICT (name) DO UPDATE SET is_system = TRUE;

-- 3. Seed Client User role (default bucket for existing 'member' rows)
INSERT INTO roles (name, color, permissions, is_default, is_system)
VALUES (
  'Client User',
  '#6b7280',
  '{"can_manage_channels":false,"can_delete_messages":false,"can_manage_members":false,"can_manage_tasks":false,"can_manage_roles":false,"can_view_admin_panel":false,"can_manage_workspace":false}'::jsonb,
  FALSE,
  TRUE
)
ON CONFLICT (name) DO UPDATE SET is_system = TRUE;

-- 4. Add role_id column to client_user_access
ALTER TABLE client_user_access
  ADD COLUMN IF NOT EXISTS role_id UUID REFERENCES roles(id) ON DELETE SET NULL;

-- 5. Backfill role_id from the legacy access_level values, if the column still exists
DO $$
DECLARE
  v_squad_manager UUID;
  v_client_user UUID;
  v_has_access_level BOOLEAN;
BEGIN
  SELECT id INTO v_squad_manager FROM roles WHERE name = 'Squad Manager' LIMIT 1;
  SELECT id INTO v_client_user FROM roles WHERE name = 'Client User' LIMIT 1;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'client_user_access' AND column_name = 'access_level'
  ) INTO v_has_access_level;

  IF v_has_access_level THEN
    EXECUTE 'UPDATE client_user_access SET role_id = $1 WHERE role_id IS NULL AND access_level = ''admin'''
      USING v_squad_manager;
    EXECUTE 'UPDATE client_user_access SET role_id = $1 WHERE role_id IS NULL AND access_level = ''member'''
      USING v_client_user;
  ELSE
    -- If access_level was already dropped, fill any NULL role_id rows with Client User
    UPDATE client_user_access SET role_id = v_client_user WHERE role_id IS NULL;
  END IF;
END $$;

-- 6. Drop the legacy column (no-op if already gone)
ALTER TABLE client_user_access DROP COLUMN IF EXISTS access_level;

-- 7. Tell PostgREST to refresh its schema cache
NOTIFY pgrst, 'reload schema';
