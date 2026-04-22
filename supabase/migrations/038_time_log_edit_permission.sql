-- ============================================================
-- 038: Per-role time-log edit permission
--   - Adds two keys to roles.permissions JSONB (no DDL):
--       can_edit_time_logs     (boolean, default false)
--       time_edit_window_hours (integer, default 0 = unlimited)
--   - Semantics: when the toggle is on, the user's PRIMARY role
--     controls whether they can edit/delete their own timer_sessions.
--     When the window is > 0, edits are only allowed within N hours
--     after the session's end_time.
--   - Idempotent.
-- ============================================================

BEGIN;

UPDATE roles
SET permissions = coalesce(permissions, '{}'::jsonb)
  || jsonb_build_object(
       'can_edit_time_logs', false,
       'time_edit_window_hours', 0
     )
WHERE permissions IS NULL
   OR NOT (permissions ? 'can_edit_time_logs');

NOTIFY pgrst, 'reload schema';
COMMIT;
