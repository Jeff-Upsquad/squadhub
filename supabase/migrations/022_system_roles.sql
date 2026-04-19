-- 022: System roles (Member / User / Guest) as per-user-type defaults
--   - Adds roles.system_key for stable lookup independent of display name
--   - Adopts 'Member' as system_key='member' (default for internal users)
--   - Seeds 'User' (system_key='user', default for client + partner)
--   - Seeds 'Guest' (system_key='guest', default for client_staff)
--   - All three are is_system=true (undeletable, unrenamable — enforced by app)
-- Idempotent — safe to re-run.

BEGIN;

ALTER TABLE roles ADD COLUMN IF NOT EXISTS system_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS roles_system_key_unique
  ON roles(system_key) WHERE system_key IS NOT NULL;

-- Adopt existing 'Member' role
UPDATE roles
  SET is_system = TRUE, system_key = 'member'
  WHERE name = 'Member' AND (system_key IS NULL OR system_key = 'member');

-- Seed 'User' role (client + partner default)
INSERT INTO roles (name, color, permissions, is_default, is_system, system_key)
VALUES (
  'User',
  '#0ea5e9',
  '{"can_manage_channels":false,"can_delete_messages":false,"can_manage_members":false,"can_manage_tasks":false,"can_manage_roles":false,"can_view_admin_panel":false,"can_manage_workspace":false}'::jsonb,
  FALSE, TRUE, 'user'
)
ON CONFLICT (name) DO UPDATE SET is_system = TRUE, system_key = 'user';

-- Seed 'Guest' role (client_staff default)
INSERT INTO roles (name, color, permissions, is_default, is_system, system_key)
VALUES (
  'Guest',
  '#94a3b8',
  '{"can_manage_channels":false,"can_delete_messages":false,"can_manage_members":false,"can_manage_tasks":false,"can_manage_roles":false,"can_view_admin_panel":false,"can_manage_workspace":false}'::jsonb,
  FALSE, TRUE, 'guest'
)
ON CONFLICT (name) DO UPDATE SET is_system = TRUE, system_key = 'guest';

NOTIFY pgrst, 'reload schema';
COMMIT;
