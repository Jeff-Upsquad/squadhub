-- 023: Role home view
--   - Adds roles.home_view column (values: 'member' | 'user' | 'guest')
--   - Default = 'user' (every custom/legacy role gets this)
--   - Seeds the three system roles to their matching home view
-- Idempotent — safe to re-run.

BEGIN;

ALTER TABLE roles ADD COLUMN IF NOT EXISTS home_view TEXT NOT NULL DEFAULT 'user';

ALTER TABLE roles DROP CONSTRAINT IF EXISTS roles_home_view_check;
ALTER TABLE roles ADD CONSTRAINT roles_home_view_check
  CHECK (home_view IN ('member','user','guest'));

UPDATE roles SET home_view = 'member' WHERE system_key = 'member';
UPDATE roles SET home_view = 'user'   WHERE system_key = 'user';
UPDATE roles SET home_view = 'guest'  WHERE system_key = 'guest';

NOTIFY pgrst, 'reload schema';
COMMIT;
