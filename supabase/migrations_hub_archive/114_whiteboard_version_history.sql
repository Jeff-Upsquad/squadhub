-- ============================================================
-- 114: Whiteboard version history — safety net against wipes
-- Every UPDATE to list_whiteboards snapshots the PREVIOUS `data`
-- (when it had content) into list_whiteboard_versions before the
-- new value lands. An accidental clear (select-all + delete, a bug,
-- a bad autosave) is therefore always recoverable: the last
-- non-empty board is retained as the most recent snapshot.
-- Pruned to the last 40 versions per list so it stays bounded.
-- Service-role only (RLS on, no policies) — same model as the
-- list_whiteboards table itself.
-- ============================================================

CREATE TABLE IF NOT EXISTS list_whiteboard_versions (
  id          BIGSERIAL PRIMARY KEY,
  list_id     UUID NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  data        JSONB NOT NULL,
  node_count  INT,
  edge_count  INT,
  updated_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  saved_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lwv_list_saved
  ON list_whiteboard_versions (list_id, saved_at DESC);

ALTER TABLE list_whiteboard_versions ENABLE ROW LEVEL SECURITY;

-- Snapshot the prior board on every meaningful change, then prune.
CREATE OR REPLACE FUNCTION snapshot_list_whiteboard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  old_nodes int := CASE WHEN jsonb_typeof(OLD.data->'nodes') = 'array'
                        THEN jsonb_array_length(OLD.data->'nodes') ELSE 0 END;
  old_edges int := CASE WHEN jsonb_typeof(OLD.data->'edges') = 'array'
                        THEN jsonb_array_length(OLD.data->'edges') ELSE 0 END;
BEGIN
  -- Only keep history for boards that actually had content and changed.
  -- (An empty board overwriting an empty board carries nothing to lose,
  -- so a wipe never gets diluted out of the keep-40 window by empty saves.)
  IF old_nodes > 0 AND OLD.data IS DISTINCT FROM NEW.data THEN
    INSERT INTO list_whiteboard_versions (list_id, data, node_count, edge_count, updated_by)
    VALUES (OLD.list_id, OLD.data, old_nodes, old_edges, OLD.updated_by);

    DELETE FROM list_whiteboard_versions v
    WHERE v.list_id = OLD.list_id
      AND v.id NOT IN (
        SELECT id FROM list_whiteboard_versions
        WHERE list_id = OLD.list_id
        ORDER BY saved_at DESC, id DESC
        LIMIT 40
      );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_snapshot_list_whiteboard ON list_whiteboards;
CREATE TRIGGER trg_snapshot_list_whiteboard
  BEFORE UPDATE ON list_whiteboards
  FOR EACH ROW EXECUTE FUNCTION snapshot_list_whiteboard();
