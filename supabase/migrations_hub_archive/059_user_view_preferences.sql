-- ============================================================
-- 059: User View Preferences
-- ============================================================
-- Stores per-user task-view preferences (filters, group-by,
-- sort, etc.) as a single JSONB blob so they persist across
-- browsers and devices.

CREATE TABLE IF NOT EXISTS user_view_preferences (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  preferences JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_view_prefs_user ON user_view_preferences(user_id);

-- Reuse the shared updated_at trigger defined in migration 024.
DROP TRIGGER IF EXISTS trg_user_view_prefs_updated_at ON user_view_preferences;
CREATE TRIGGER trg_user_view_prefs_updated_at
  BEFORE UPDATE ON user_view_preferences
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE user_view_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own view prefs" ON user_view_preferences;
CREATE POLICY "Users can manage own view prefs"
  ON user_view_preferences FOR ALL
  USING (auth.uid() = user_id);
