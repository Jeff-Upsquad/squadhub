-- 021: Restructure users table
--   - Replace users.role with users.is_admin (boolean)
--   - Expand users.status: approved->active, add 'banned'
--   - Add 'client_staff' to users.user_type and invitations.user_type
--
-- Ships atomically with the matching app-code change.

BEGIN;

-- is_admin boolean
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE users SET is_admin = TRUE WHERE role = 'admin';

-- Expand status enum. Order matters: rename approved->active first,
-- then overwrite banned rows so they land on 'banned' regardless of
-- their previous status value.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_status_check;
UPDATE users SET status = 'active' WHERE status = 'approved';
UPDATE users SET status = 'banned' WHERE role = 'banned';
ALTER TABLE users ALTER COLUMN status SET DEFAULT 'active';
ALTER TABLE users ADD CONSTRAINT users_status_check
  CHECK (status IN ('active', 'pending', 'rejected', 'banned'));

-- Drop legacy role column.
ALTER TABLE users DROP COLUMN IF EXISTS role;
CREATE INDEX IF NOT EXISTS idx_users_is_admin ON users(is_admin) WHERE is_admin = TRUE;

-- Add 'client_staff' to user_type enums.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_user_type_check;
ALTER TABLE users ADD CONSTRAINT users_user_type_check
  CHECK (user_type IN ('internal', 'client', 'client_staff', 'partner'));

ALTER TABLE invitations DROP CONSTRAINT IF EXISTS invitations_user_type_check;
ALTER TABLE invitations ADD CONSTRAINT invitations_user_type_check
  CHECK (user_type IN ('internal', 'client', 'client_staff', 'partner'));

COMMIT;
