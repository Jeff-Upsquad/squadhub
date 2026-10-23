-- ============================================================
-- 113: List whiteboards — FigJam-style canvas view for lists
-- One row per list. `data` is an app-owned JSONB blob holding the
-- React Flow nodes/edges/viewport; the shape is owned by the
-- whiteboard view (see WhiteboardData in @squadhub/shared) and the
-- server stores it opaquely. Accessed server-side with the service
-- role + checkResourceAccess (same as lists/tasks), so RLS owner
-- policies here are defense-in-depth only.
-- ============================================================

CREATE TABLE IF NOT EXISTS list_whiteboards (
  list_id    UUID PRIMARY KEY REFERENCES lists(id) ON DELETE CASCADE,
  data       JSONB NOT NULL DEFAULT '{"nodes":[],"edges":[]}'::jsonb,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- updated_at trigger (function from migration 024)
DROP TRIGGER IF EXISTS trg_list_whiteboards_updated_at ON list_whiteboards;
CREATE TRIGGER trg_list_whiteboards_updated_at
  BEFORE UPDATE ON list_whiteboards
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE list_whiteboards ENABLE ROW LEVEL SECURITY;

-- Allow lists to default to the new whiteboard view. 002 defined default_view
-- with a list/board-only CHECK, but the live DB has drifted (the column is
-- absent on some environments), so widen the constraint only where the column
-- actually exists — greenfield DBs built from migrations get it; drifted DBs
-- skip it harmlessly. The whiteboard view itself does not depend on this column
-- (the active view is chosen via the session viewMode store).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'lists' AND column_name = 'default_view'
  ) THEN
    ALTER TABLE lists DROP CONSTRAINT IF EXISTS lists_default_view_check;
    ALTER TABLE lists ADD  CONSTRAINT lists_default_view_check
      CHECK (default_view IN ('list', 'board', 'whiteboard'));
  END IF;
END $$;
