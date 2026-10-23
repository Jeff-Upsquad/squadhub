-- Phone number on SquadHub users.
--
-- Two reasons this exists:
--   1. Business users provisioned from SquadHire at first login carry their
--      SquadHire contact phone across, so the account isn't email-only.
--   2. The self-serve "forgot password" flow is phone-keyed (a temp password is
--      delivered over WhatsApp via Squad CRM), so we need to resolve a phone
--      number back to exactly one user.
--
-- Numbers are entered inconsistently (+91 98765 43210, 09876543210,
-- 9876543210…), so matching is done on the trailing 10 digits. `phone_last10`
-- is a stored generated column rather than a LIKE '%suffix' scan: the
-- expression is immutable, so it can carry a real index and the lookup stays an
-- exact match as the users table grows.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS phone TEXT;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS phone_last10 TEXT
  GENERATED ALWAYS AS (
    NULLIF(RIGHT(REGEXP_REPLACE(COALESCE(phone, ''), '\D', '', 'g'), 10), '')
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_users_phone_last10
  ON users (phone_last10)
  WHERE phone_last10 IS NOT NULL;

COMMENT ON COLUMN users.phone IS
  'Contact phone as entered. Seeded from SquadHire for business users provisioned at first login.';
COMMENT ON COLUMN users.phone_last10 IS
  'Trailing 10 digits of phone, generated. Match on this — stored formats vary by country code and separators.';
