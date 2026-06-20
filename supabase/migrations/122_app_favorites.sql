-- App favorites: per-user pinned mini-apps shown in the home sidebar's Apps section.
-- Apps are identified by slug (not a UUID), so they get their own table rather than
-- the workspace-scoped `favorites` table used for channels/lists/folders/spaces.
-- Pins are global per user (not workspace-scoped), preserving the prior client-only
-- (localStorage) behavior — now server-backed so they sync across browsers/devices.
CREATE TABLE IF NOT EXISTS app_favorites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  app_slug TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, app_slug)
);

CREATE INDEX IF NOT EXISTS idx_app_favorites_user ON app_favorites(user_id);

-- All access is validated server-side with the service role; RLS is enabled with no
-- policies so direct anon/authenticated client access is denied by default.
ALTER TABLE app_favorites ENABLE ROW LEVEL SECURITY;
