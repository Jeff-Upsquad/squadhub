-- ============================================================
-- 017: Client Spaces
-- New concept: clients can own folders built from space templates.
-- Introduces its own template table + access grants (separate from custom_profiles).
-- Idempotent — safe to re-run.
-- ============================================================

-- Client space templates (analogous to custom_profiles, but scoped to client-owned folders)
CREATE TABLE IF NOT EXISTS client_space_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  icon TEXT NOT NULL DEFAULT 'folder',
  category TEXT NOT NULL DEFAULT 'general',
  -- JSON shape: { "lists": [{"name": "Briefs", "position": 0, "default_view": "list"}, ...] }
  template JSONB NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Role-based access: which roles can instantiate a template as a folder under a client
CREATE TABLE IF NOT EXISTS client_space_template_role_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL REFERENCES client_space_templates(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(template_id, role_id)
);

-- User-based access (direct grants)
CREATE TABLE IF NOT EXISTS client_space_template_user_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL REFERENCES client_space_templates(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(template_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_cst_role_access_template ON client_space_template_role_access(template_id);
CREATE INDEX IF NOT EXISTS idx_cst_role_access_role ON client_space_template_role_access(role_id);
CREATE INDEX IF NOT EXISTS idx_cst_user_access_template ON client_space_template_user_access(template_id);
CREATE INDEX IF NOT EXISTS idx_cst_user_access_user ON client_space_template_user_access(user_id);

-- Client access grants: which users can see a client in the main app's "Client" section.
-- Distinct from partner_client_assignments (which is the partner→client billing link).
CREATE TABLE IF NOT EXISTS client_user_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Whether this user can add spaces under the client (admin) vs view only (member).
  access_level TEXT NOT NULL DEFAULT 'member' CHECK (access_level IN ('member', 'admin')),
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(client_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_client_user_access_user ON client_user_access(user_id);
CREATE INDEX IF NOT EXISTS idx_client_user_access_client ON client_user_access(client_id);

-- Tag folders with the client they belong to (nullable; existing folders are unowned)
ALTER TABLE folders ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES clients(id) ON DELETE SET NULL;
ALTER TABLE folders ADD COLUMN IF NOT EXISTS client_space_template_id UUID REFERENCES client_space_templates(id) ON DELETE SET NULL;
ALTER TABLE folders ADD COLUMN IF NOT EXISTS client_space_template_version INTEGER;

CREATE INDEX IF NOT EXISTS idx_folders_client ON folders(client_id) WHERE client_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_folders_cst ON folders(client_space_template_id) WHERE client_space_template_id IS NOT NULL;

-- Seed the "Design Space" template (the former "Design Workflow")
INSERT INTO client_space_templates (slug, name, description, icon, category, template) VALUES
(
  'design-space',
  'Design Space',
  'Manage design requests with brief, in-progress, and review lanes',
  'palette',
  'design',
  '{"lists": [{"name": "Briefs", "position": 0, "default_view": "list"}, {"name": "In Progress", "position": 1, "default_view": "board"}, {"name": "Reviews", "position": 2, "default_view": "board"}]}'
)
ON CONFLICT (slug) DO NOTHING;

-- updated_at trigger for client_space_templates
CREATE OR REPLACE FUNCTION update_client_space_templates_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_client_space_templates_updated_at ON client_space_templates;
CREATE TRIGGER trg_client_space_templates_updated_at
  BEFORE UPDATE ON client_space_templates
  FOR EACH ROW
  EXECUTE FUNCTION update_client_space_templates_updated_at();
