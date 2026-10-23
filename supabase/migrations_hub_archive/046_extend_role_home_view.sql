-- 046: Extend roles.home_view with role-specific variants
--   - Adds 'designer', 'video_editor', 'accountant' to the allowed set
--   - Each new value gets its own Home component; roles can opt into any
-- Idempotent — safe to re-run.

BEGIN;

ALTER TABLE roles DROP CONSTRAINT IF EXISTS roles_home_view_check;
ALTER TABLE roles ADD CONSTRAINT roles_home_view_check
  CHECK (home_view IN ('member','user','guest','designer','video_editor','accountant'));

NOTIFY pgrst, 'reload schema';
COMMIT;
