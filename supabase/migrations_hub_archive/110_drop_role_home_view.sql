-- ============================================================
-- 110: Drop roles.home_view (per-role home view system removed)
--   - Home is now chosen purely by user_type in the web app:
--       client / client_staff -> ClientDashboard
--       everyone else (internal + partners) -> the single shared Home
--   - The roles.home_view column + its CHECK constraint (added in 023,
--     widened in 046) are obsolete. No code reads or writes it anymore.
-- Reverses migrations 023 / 046. Idempotent — safe to re-run.
-- ============================================================

BEGIN;

ALTER TABLE roles DROP CONSTRAINT IF EXISTS roles_home_view_check;
ALTER TABLE roles DROP COLUMN IF EXISTS home_view;

NOTIFY pgrst, 'reload schema';
COMMIT;
