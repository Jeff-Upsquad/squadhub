-- ============================================================
-- 108: "No access" as a CRM module level
--   - Widens crm_module_access.level to allow 'none' alongside the
--     existing 'view' / 'full' / 'admin'. A 'none' override means the
--     user has CRM app access but is explicitly DENIED that module.
--   - Lets the admin CRM-access UI lock a new user out of every module
--     by default (see server/src/routes/admin-crm-access.ts grant flow).
--   - crm_module_access is OWNED by the SquadCRM migrations
--     (025_crm_access_management.sql); this only widens its CHECK so the
--     shared admin surface can write 'none'. SquadCRM's crm-server must
--     treat level = 'none' as DENY when enforcing.
-- Additive only. Idempotent — safe to re-run.
-- ============================================================

BEGIN;

ALTER TABLE crm_module_access
  DROP CONSTRAINT IF EXISTS crm_module_access_level_check;

ALTER TABLE crm_module_access
  ADD CONSTRAINT crm_module_access_level_check
  CHECK (level = ANY (ARRAY['full'::text, 'view'::text, 'admin'::text, 'none'::text]));

COMMIT;
