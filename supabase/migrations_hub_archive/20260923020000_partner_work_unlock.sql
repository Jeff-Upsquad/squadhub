-- Pre-work Partner app access.
--
-- SquadHire talents can now sign in to the SquadHub Partner app with their
-- SquadHire email + password before they have any work, so they can use
-- Discover to pick up opportunities. Until they are assigned their first card
-- the Work side of the app stays locked.
--
-- NULL means locked. Every account that already exists is stamped as unlocked,
-- so nobody who is currently working can be locked out by this deploy. Only
-- partner/partner_employee accounts are ever treated as locked; every other
-- user type ignores this column.
ALTER TABLE users ADD COLUMN IF NOT EXISTS work_unlocked_at TIMESTAMPTZ;

UPDATE users
   SET work_unlocked_at = COALESCE(created_at, now())
 WHERE work_unlocked_at IS NULL;

COMMENT ON COLUMN users.work_unlocked_at IS
  'When this account gained the SquadHub Work surface. NULL = work locked: a SquadHire talent who signed in before their first assignment and may only use Discover. Stamped at first card assignment (server/src/utils/workAccess.ts).';
