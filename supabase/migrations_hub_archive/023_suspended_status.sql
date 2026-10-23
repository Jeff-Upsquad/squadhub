-- 023: Add 'suspended' to users.status.
-- Suspended is a softer-than-banned state: app-level block at login
-- and on authed requests, but no Supabase Auth ban_duration applied.
-- Idempotent.

BEGIN;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_status_check;
ALTER TABLE users ADD CONSTRAINT users_status_check
  CHECK (status IN ('active', 'pending', 'rejected', 'banned', 'suspended'));

NOTIFY pgrst, 'reload schema';
COMMIT;
