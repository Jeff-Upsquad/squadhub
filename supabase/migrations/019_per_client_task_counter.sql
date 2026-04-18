-- ============================================================
-- 019: Per-client task display numbering
-- Replaces the global sequence (018) with a per-client counter.
-- Each client starts at REQ-1 and increments independently.
-- Idempotent — safe to re-run.
-- ============================================================

-- Per-client counter table
CREATE TABLE IF NOT EXISTS client_task_counters (
  client_id UUID PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
  next_number INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Atomic increment: upserts the counter and returns the new value.
-- First call for a client returns 1; subsequent calls return 2, 3, ...
CREATE OR REPLACE FUNCTION increment_client_task_counter(p_client_id UUID)
RETURNS INTEGER AS $$
DECLARE
  v_number INTEGER;
BEGIN
  INSERT INTO client_task_counters (client_id, next_number)
  VALUES (p_client_id, 1)
  ON CONFLICT (client_id) DO UPDATE
    SET next_number = client_task_counters.next_number + 1,
        updated_at = now()
  RETURNING next_number INTO v_number;
  RETURN v_number;
END;
$$ LANGUAGE plpgsql;

-- Retire the global display_number approach
DROP INDEX IF EXISTS idx_tasks_display_number;
ALTER TABLE tasks ALTER COLUMN display_number DROP DEFAULT;

-- Renumber every task per-client (REQ-1, REQ-2, … per client). Tasks that
-- aren't under a client-tagged folder get their display_number cleared.
UPDATE tasks SET display_number = NULL;

DO $$
DECLARE
  c RECORD;
  t RECORD;
  n INTEGER;
BEGIN
  FOR c IN
    SELECT DISTINCT f.client_id
    FROM folders f
    WHERE f.client_id IS NOT NULL
      AND f.deleted_at IS NULL
  LOOP
    n := 0;
    FOR t IN
      SELECT tasks.id
      FROM tasks
      JOIN lists ON lists.id = tasks.list_id
      JOIN folders ON folders.id = lists.folder_id
      WHERE folders.client_id = c.client_id
      ORDER BY tasks.position, tasks.id
    LOOP
      n := n + 1;
      UPDATE tasks SET display_number = n WHERE id = t.id;
    END LOOP;
    INSERT INTO client_task_counters (client_id, next_number)
    VALUES (c.client_id, n)
    ON CONFLICT (client_id) DO UPDATE SET next_number = EXCLUDED.next_number;
  END LOOP;
END $$;
