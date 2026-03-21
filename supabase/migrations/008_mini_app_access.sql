-- ============================================================
-- 008: Mini App Access Management
-- Registry of mini apps with role-based and user-based access
-- ============================================================

-- Mini app registry
CREATE TABLE mini_apps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  icon TEXT DEFAULT 'puzzle',
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Role-based access: which roles can see which mini apps
CREATE TABLE mini_app_role_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mini_app_id UUID NOT NULL REFERENCES mini_apps(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(mini_app_id, role_id)
);

-- User-based access: direct user grants (overrides / supplements role access)
CREATE TABLE mini_app_user_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mini_app_id UUID NOT NULL REFERENCES mini_apps(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(mini_app_id, user_id)
);

-- Indexes for fast lookups
CREATE INDEX idx_mini_app_role_access_app ON mini_app_role_access(mini_app_id);
CREATE INDEX idx_mini_app_role_access_role ON mini_app_role_access(role_id);
CREATE INDEX idx_mini_app_user_access_app ON mini_app_user_access(mini_app_id);
CREATE INDEX idx_mini_app_user_access_user ON mini_app_user_access(user_id);

-- Seed: Daily Check-In as first mini app
INSERT INTO mini_apps (slug, name, description, icon, is_enabled)
VALUES ('daily-checkin', 'Daily Check-In', 'Track daily attendance with configurable checklists per role', 'check-circle', true);
