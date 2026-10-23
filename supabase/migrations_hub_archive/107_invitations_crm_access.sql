-- ============================================================
-- 107: CRM access on invitations
--   - Adds an optional crm_access JSONB blob to invitations so an
--     admin inviting a NEW user can also grant CRM access that is
--     applied on signup/accept (see server/src/routes/auth.ts).
--   - Shape: { app, workspace_id, role, modules?: { <moduleKey>: <level> } }
--     e.g. { "app": "squadcrm", "workspace_id": "…", "role": "member",
--            "modules": { "settings": "view", "leads": "full" } }
--   - The crm_* tables it feeds are owned by the SquadCRM migrations
--     (025_crm_access_management.sql) in the shared Supabase project.
-- Additive only. Idempotent — safe to re-run.
-- ============================================================

BEGIN;

ALTER TABLE invitations
  ADD COLUMN IF NOT EXISTS crm_access JSONB;

COMMIT;
