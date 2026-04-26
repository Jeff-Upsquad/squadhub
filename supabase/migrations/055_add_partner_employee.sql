-- 055: Add 'partner_employee' to user_type enums.
--   - users.user_type CHECK constraint
--   - invitations.user_type CHECK constraint
--
-- partner_employee has full parity with partner; no parent-link FK.

BEGIN;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_user_type_check;
ALTER TABLE users ADD CONSTRAINT users_user_type_check
  CHECK (user_type IN ('internal', 'client', 'client_staff', 'partner', 'partner_employee'));

ALTER TABLE invitations DROP CONSTRAINT IF EXISTS invitations_user_type_check;
ALTER TABLE invitations ADD CONSTRAINT invitations_user_type_check
  CHECK (user_type IN ('internal', 'client', 'client_staff', 'partner', 'partner_employee'));

COMMIT;
