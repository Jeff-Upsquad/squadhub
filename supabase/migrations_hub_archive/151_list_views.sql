-- ============================================================
-- 151: Named list views (ClickUp-style)
-- A list can now hold MULTIPLE named views instead of the fixed
-- List/Board/Whiteboard trio. Each list/board view carries its own
-- saved config (filter + group-by + sort); each whiteboard view is
-- its own canvas. Views are shared on the list, with an optional
-- per-view "private" flag (creator-only).
--
-- Whiteboard storage moves from one-blob-per-list (list_whiteboards,
-- keyed by list_id) to one-blob-per-view (whiteboards, keyed by
-- view_id). The legacy list_whiteboards / list_whiteboard_versions
-- tables are left intact as a backup and dropped in a later migration
-- once verified in prod.
--
-- Accessed server-side with the service role + checkResourceAccess on
-- the parent list (same model as lists/tasks/list_whiteboards), so the
-- RLS owner policies here are defense-in-depth only.
-- ============================================================

-- ------------------------------------------------------------
-- list_views
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS list_views (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id    UUID NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  view_type  TEXT NOT NULL CHECK (view_type IN ('list', 'board', 'whiteboard')),
  name       TEXT NOT NULL,
  position   INTEGER NOT NULL DEFAULT 0,
  is_default BOOLEAN NOT NULL DEFAULT false,
  is_private BOOLEAN NOT NULL DEFAULT false,
  owner_id   UUID REFERENCES users(id) ON DELETE CASCADE,  -- creator; enforced for private views
  config     JSONB NOT NULL DEFAULT '{}'::jsonb,            -- {filters, groupBy, sortBy}; unused for whiteboard
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_list_views_list_pos ON list_views(list_id, position);

DROP TRIGGER IF EXISTS trg_list_views_updated_at ON list_views;
CREATE TRIGGER trg_list_views_updated_at
  BEFORE UPDATE ON list_views
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE list_views ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- whiteboards — one canvas per whiteboard view (was list_whiteboards)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS whiteboards (
  view_id    UUID PRIMARY KEY REFERENCES list_views(id) ON DELETE CASCADE,
  data       JSONB NOT NULL DEFAULT '{"nodes":[],"edges":[]}'::jsonb,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_whiteboards_updated_at ON whiteboards;
CREATE TRIGGER trg_whiteboards_updated_at
  BEFORE UPDATE ON whiteboards
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE whiteboards ENABLE ROW LEVEL SECURITY;

-- Version history — mirrors list_whiteboard_versions (migr 114) but keyed by view_id.
CREATE TABLE IF NOT EXISTS whiteboard_versions (
  id          BIGSERIAL PRIMARY KEY,
  view_id     UUID NOT NULL REFERENCES list_views(id) ON DELETE CASCADE,
  data        JSONB NOT NULL,
  node_count  INT,
  edge_count  INT,
  updated_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  saved_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wv_view_saved
  ON whiteboard_versions (view_id, saved_at DESC);

ALTER TABLE whiteboard_versions ENABLE ROW LEVEL SECURITY;

-- Snapshot the prior canvas on every meaningful change, then prune to 40 per view.
CREATE OR REPLACE FUNCTION snapshot_whiteboard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  old_nodes int := CASE WHEN jsonb_typeof(OLD.data->'nodes') = 'array'
                        THEN jsonb_array_length(OLD.data->'nodes') ELSE 0 END;
  old_edges int := CASE WHEN jsonb_typeof(OLD.data->'edges') = 'array'
                        THEN jsonb_array_length(OLD.data->'edges') ELSE 0 END;
BEGIN
  IF old_nodes > 0 AND OLD.data IS DISTINCT FROM NEW.data THEN
    INSERT INTO whiteboard_versions (view_id, data, node_count, edge_count, updated_by)
    VALUES (OLD.view_id, OLD.data, old_nodes, old_edges, OLD.updated_by);

    DELETE FROM whiteboard_versions v
    WHERE v.view_id = OLD.view_id
      AND v.id NOT IN (
        SELECT id FROM whiteboard_versions
        WHERE view_id = OLD.view_id
        ORDER BY saved_at DESC, id DESC
        LIMIT 40
      );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_snapshot_whiteboard ON whiteboards;
CREATE TRIGGER trg_snapshot_whiteboard
  BEFORE UPDATE ON whiteboards
  FOR EACH ROW EXECUTE FUNCTION snapshot_whiteboard();

-- ------------------------------------------------------------
-- Backfill — re-runnable. Seed default views for every existing list
-- and migrate existing whiteboard blobs into a whiteboard view.
-- ------------------------------------------------------------

-- 1. Every list without any views gets a List view (default) and a Board view.
INSERT INTO list_views (list_id, view_type, name, position, is_default)
SELECT l.id, 'list', 'List', 0, true
FROM lists l
WHERE NOT EXISTS (SELECT 1 FROM list_views v WHERE v.list_id = l.id);

INSERT INTO list_views (list_id, view_type, name, position, is_default)
SELECT l.id, 'board', 'Board', 1, false
FROM lists l
WHERE NOT EXISTS (
  SELECT 1 FROM list_views v WHERE v.list_id = l.id AND v.view_type = 'board'
);

-- 2. Every list that already has a non-empty whiteboard canvas gets a Whiteboard
--    view, and its blob is copied over. (Idempotent: skip lists already migrated.)
WITH new_wb_views AS (
  INSERT INTO list_views (list_id, view_type, name, position, is_default, updated_at)
  SELECT lw.list_id, 'whiteboard', 'Whiteboard', 2, false, lw.updated_at
  FROM list_whiteboards lw
  WHERE jsonb_typeof(lw.data->'nodes') = 'array'
    AND jsonb_array_length(lw.data->'nodes') > 0
    AND NOT EXISTS (
      SELECT 1 FROM list_views v
      WHERE v.list_id = lw.list_id AND v.view_type = 'whiteboard'
    )
  RETURNING id AS view_id, list_id
)
INSERT INTO whiteboards (view_id, data, updated_by, updated_at)
SELECT nv.view_id, lw.data, lw.updated_by, lw.updated_at
FROM new_wb_views nv
JOIN list_whiteboards lw ON lw.list_id = nv.list_id;

-- 3. Honour lists.default_view when the column exists (drifted DBs skip this).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'lists' AND column_name = 'default_view'
  ) THEN
    -- Move the default flag to the board view where the list prefers 'board'.
    UPDATE list_views v
    SET is_default = (v.view_type = 'board')
    FROM lists l
    WHERE l.id = v.list_id
      AND l.default_view = 'board'
      AND v.view_type IN ('list', 'board');

    -- Move the default flag to the whiteboard view where the list prefers
    -- 'whiteboard' AND a whiteboard view exists (empty-canvas lists keep List).
    UPDATE list_views v
    SET is_default = (v.view_type = 'whiteboard')
    FROM lists l
    WHERE l.id = v.list_id
      AND l.default_view = 'whiteboard'
      AND v.view_type IN ('list', 'whiteboard')
      AND EXISTS (
        SELECT 1 FROM list_views w
        WHERE w.list_id = l.id AND w.view_type = 'whiteboard'
      );
  END IF;
END $$;
