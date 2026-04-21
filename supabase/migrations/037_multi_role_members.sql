-- ============================================================
-- 037: Multi-role workspace members (primary + many secondaries)
--   - workspace_members.role_id remains the PRIMARY role (unchanged)
--   - New workspace_member_secondary_roles holds 0..N extra roles per member
--   - Permissions and mini-app access will be unioned across primary + secondaries
--   - "secondary != primary" is enforced in application code, not SQL
-- Idempotent — safe to re-run.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS workspace_member_secondary_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_member_id UUID NOT NULL REFERENCES workspace_members(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_member_id, role_id)
);

CREATE INDEX IF NOT EXISTS idx_wm_sec_roles_member ON workspace_member_secondary_roles(workspace_member_id);
CREATE INDEX IF NOT EXISTS idx_wm_sec_roles_role ON workspace_member_secondary_roles(role_id);

NOTIFY pgrst, 'reload schema';
COMMIT;
