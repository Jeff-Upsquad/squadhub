-- ============================================================
-- 125: Candidate category access
-- Optional per-category (Creative / Accountant / Sales) restriction
-- layered ON TOP of the `candidates` mini-app grant. Grant a category
-- to a role (everyone with it inherits) or to an individual user.
--
-- Semantics (enforced in the server): a user with NO rows here is
-- UNRESTRICTED (sees all categories) — so this is backward-compatible.
-- Once a user has any matching row (direct or via a role), they are
-- limited to exactly those categories. Internal admins always see all.
-- ============================================================

CREATE TABLE IF NOT EXISTS candidate_category_access (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category    TEXT NOT NULL CHECK (category IN ('creative', 'accountant', 'sales')),
  role_id     UUID REFERENCES roles(id) ON DELETE CASCADE,
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- exactly one subject: a role grant XOR a user grant
  CONSTRAINT cca_one_subject CHECK ((role_id IS NOT NULL)::int + (user_id IS NOT NULL)::int = 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_cca_role ON candidate_category_access (category, role_id) WHERE role_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_cca_user ON candidate_category_access (category, user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cca_user ON candidate_category_access (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cca_role ON candidate_category_access (role_id) WHERE role_id IS NOT NULL;

ALTER TABLE candidate_category_access ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access on candidate_category_access" ON candidate_category_access;
CREATE POLICY "Service role full access on candidate_category_access"
  ON candidate_category_access FOR ALL TO service_role USING (true) WITH CHECK (true);
