-- ============================================================
-- Migration 179: Share content by user type
--
-- Extends lms_item_shares (from 165) so a share can target EVERY user of a
-- given user_type ('internal', 'client', 'client_staff', 'partner',
-- 'partner_employee'), not just specific users or roles. This is the
-- "share by user type" option in the Content Library Share modal.
--
-- principal_id stays UUID: the API validates the payload key against the five
-- allowed user types and stores a deterministic UUID derived from the key
-- (md5('user_type:' || key)::uuid), so the UNIQUE(item_id, principal_type,
-- principal_id) constraint and column type keep working unchanged.
-- ============================================================

ALTER TABLE lms_item_shares
  DROP CONSTRAINT IF EXISTS lms_item_shares_principal_type_check;
ALTER TABLE lms_item_shares
  ADD CONSTRAINT lms_item_shares_principal_type_check
  CHECK (principal_type IN ('user', 'role', 'user_type'));

-- Lookups resolve a requesting user's own type, so a partial index on
-- (principal_type) with the type value is all that's needed on top of the
-- existing idx_lms_shares_principal (principal_type, principal_id).
CREATE INDEX IF NOT EXISTS idx_lms_shares_user_type
  ON lms_item_shares(principal_type)
  WHERE principal_type = 'user_type';
