-- ============================================================
-- 036: Sales onboarding links + primary/secondary sales person attribution
--   - New "Sales" system role (users with this role are the sales pool)
--   - client_onboarding_links: 7-day single-use tokens for attributed onboarding
--   - Adds primary/secondary sales person columns to client_submissions + clients
--   - Registers the `sales-leads` mini app and grants it to the Sales role
-- Idempotent — safe to re-run.
-- ============================================================

BEGIN;

-- 1. Sales role (mirrors 022_system_roles.sql pattern, but is_system=false so it's deletable/renamable)
INSERT INTO roles (name, color, permissions, is_default, is_system, system_key)
VALUES (
  'Sales',
  '#f97316',
  '{"can_manage_channels":false,"can_delete_messages":false,"can_manage_members":false,"can_manage_tasks":false,"can_manage_roles":false,"can_view_admin_panel":false,"can_manage_workspace":false}'::jsonb,
  FALSE, FALSE, 'sales'
)
ON CONFLICT (name) DO UPDATE SET system_key = 'sales';

-- 2. Tokenized onboarding links
CREATE TABLE IF NOT EXISTS client_onboarding_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  primary_sales_person_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  secondary_sales_person_id UUID REFERENCES users(id) ON DELETE SET NULL,
  submission_id UUID REFERENCES client_submissions(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_onboarding_links_created_by ON client_onboarding_links(created_by);
CREATE INDEX IF NOT EXISTS idx_onboarding_links_primary_sp ON client_onboarding_links(primary_sales_person_id);
CREATE INDEX IF NOT EXISTS idx_onboarding_links_secondary_sp ON client_onboarding_links(secondary_sales_person_id);
CREATE INDEX IF NOT EXISTS idx_onboarding_links_expires_at ON client_onboarding_links(expires_at);

-- 3. Attribution columns on client_submissions
ALTER TABLE client_submissions
  ADD COLUMN IF NOT EXISTS primary_sales_person_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS secondary_sales_person_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS onboarding_link_id UUID REFERENCES client_onboarding_links(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_submissions_primary_sp ON client_submissions(primary_sales_person_id);
CREATE INDEX IF NOT EXISTS idx_submissions_secondary_sp ON client_submissions(secondary_sales_person_id);

-- 4. Attribution columns on clients (carried over at approval time)
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS primary_sales_person_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS secondary_sales_person_id UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_clients_primary_sp ON clients(primary_sales_person_id);
CREATE INDEX IF NOT EXISTS idx_clients_secondary_sp ON clients(secondary_sales_person_id);

-- 5. Sales Leads mini app + grant to Sales role
INSERT INTO mini_apps (slug, name, description, icon, is_enabled)
VALUES ('sales-leads', 'Sales Leads', 'Generate onboarding links and track your leads', 'user-plus', true)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO mini_app_role_access (mini_app_id, role_id)
SELECT ma.id, r.id
FROM mini_apps ma
CROSS JOIN roles r
WHERE ma.slug = 'sales-leads'
  AND r.system_key = 'sales'
ON CONFLICT (mini_app_id, role_id) DO NOTHING;

NOTIFY pgrst, 'reload schema';
COMMIT;
