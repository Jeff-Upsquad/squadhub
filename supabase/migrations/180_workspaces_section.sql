-- ============================================================
-- 180: Workspaces sidebar section
-- Reuses spaces.kind to split the sidebar into a new top-level
-- "Workspaces" section above "Areas". The legacy "Client Spaces"
-- host area is re-tagged kind='workspace' and its client folders
-- are surfaced as direct workspace roots (no "Client Spaces" row).
-- Additive and reversible: set kind back to 'normal' to restore.
-- ============================================================

-- Widen spaces.kind to allow 'workspace'.
DO $$
DECLARE
  v_constraint text;
BEGIN
  SELECT conname INTO v_constraint
  FROM pg_constraint
  WHERE conrelid = 'spaces'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%kind%';
  IF v_constraint IS NOT NULL THEN
    EXECUTE format('ALTER TABLE spaces DROP CONSTRAINT %I', v_constraint);
  END IF;
END $$;

ALTER TABLE spaces
  ADD CONSTRAINT spaces_kind_check
  CHECK (kind IN ('normal', 'personal', 'workspace'));

-- Re-tag the legacy "Client Spaces" host area as a workspace.
UPDATE spaces
SET kind = 'workspace'
WHERE name = 'Client Spaces'
  AND kind = 'normal'
  AND client_id IS NULL
  AND deleted_at IS NULL;
