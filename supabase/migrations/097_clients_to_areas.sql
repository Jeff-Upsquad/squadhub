-- ============================================================
-- 097: Clients → Areas
-- The sidebar "Clients" section merges into "Areas" (spaces).
-- Each client becomes its own private space:
--   • spaces.client_id links the area to its client
--   • the client's folders (and their lists) move into that space
--   • the source space's task statuses are cloned into the new
--     space so board columns stay identical (tasks store status as
--     text keys, so no per-task remap is needed)
--   • client_user_access grants become space resource_memberships
--     (Squad Manager → manager, everything else → member)
-- clients, client_user_access, folders.client_id and per-client
-- task counters are kept — billing, cash book, squad pools and the
-- client portal still read them. The old "Client Spaces" host space
-- is kept too (it still holds non-client folders).
-- Idempotent — safe to re-run.
-- ============================================================

-- 1. Link spaces to clients
ALTER TABLE spaces ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES clients(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_spaces_client_unique
  ON spaces(client_id) WHERE client_id IS NOT NULL AND deleted_at IS NULL;

-- 2. Create one space per client: every active client, plus any
--    client that still owns folders or access grants.
DO $$
DECLARE
  c RECORD;
  v_workspace UUID;
  v_creator UUID;
  v_pos INTEGER;
BEGIN
  FOR c IN
    SELECT cl.id, cl.business_name
    FROM clients cl
    WHERE cl.status = 'active'
       OR EXISTS (SELECT 1 FROM folders f WHERE f.client_id = cl.id)
       OR EXISTS (SELECT 1 FROM client_user_access a WHERE a.client_id = cl.id)
    ORDER BY cl.created_at
  LOOP
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM spaces s WHERE s.client_id = c.id AND s.deleted_at IS NULL
    );

    v_workspace := NULL;
    v_creator := NULL;

    -- Workspace: where the client's folders already live → else the
    -- "Client Spaces" host space's workspace → else the oldest workspace.
    SELECT s.workspace_id INTO v_workspace
    FROM folders f
    JOIN spaces s ON s.id = f.space_id
    WHERE f.client_id = c.id
    LIMIT 1;

    IF v_workspace IS NULL THEN
      SELECT s.workspace_id INTO v_workspace
      FROM spaces s
      WHERE s.name = 'Client Spaces' AND s.deleted_at IS NULL
      LIMIT 1;
    END IF;

    IF v_workspace IS NULL THEN
      SELECT w.id INTO v_workspace FROM workspaces w ORDER BY w.created_at LIMIT 1;
    END IF;

    CONTINUE WHEN v_workspace IS NULL;

    -- Creator: earliest access grantor → else a workspace admin.
    SELECT a.created_by INTO v_creator
    FROM client_user_access a
    WHERE a.client_id = c.id
    ORDER BY a.created_at
    LIMIT 1;

    IF v_creator IS NULL THEN
      SELECT wm.user_id INTO v_creator
      FROM workspace_members wm
      WHERE wm.workspace_id = v_workspace AND wm.role IN ('admin', 'super_admin')
      LIMIT 1;
    END IF;

    SELECT COALESCE(MAX(s.position), -1) + 1 INTO v_pos
    FROM spaces s
    WHERE s.workspace_id = v_workspace AND s.deleted_at IS NULL;

    -- Insert triggers auto-create default statuses + creator membership.
    INSERT INTO spaces (workspace_id, name, color, icon, description, is_private, created_by, position, client_id)
    VALUES (
      v_workspace,
      btrim(c.business_name),
      '#7c3aed',
      'users',
      'Client area for ' || btrim(c.business_name),
      TRUE,
      v_creator,
      v_pos,
      c.id
    );
  END LOOP;
END $$;

-- 3. Clone task statuses from each source space into the client spaces
--    about to receive folders (replacing the trigger-seeded defaults), so
--    board columns stay identical after the move. Tasks store status as
--    text keys, so no per-task remap is needed.
--    Runs BEFORE the folder move; no-op once folders have moved.
DO $$
DECLARE
  pair RECORD;
BEGIN
  FOR pair IN
    SELECT DISTINCT s.id AS client_space_id, f.space_id AS source_space_id
    FROM folders f
    JOIN spaces s ON s.client_id = f.client_id AND s.deleted_at IS NULL
    WHERE f.client_id IS NOT NULL AND f.space_id <> s.id
  LOOP
    DELETE FROM space_statuses WHERE space_id = pair.client_space_id;

    INSERT INTO space_statuses (space_id, name, color, position, is_default, category)
    SELECT pair.client_space_id, ss.name, ss.color, ss.position, ss.is_default, ss.category
    FROM space_statuses ss
    WHERE ss.space_id = pair.source_space_id;
  END LOOP;
END $$;

-- 4. Move client folders (and their lists) into the client's space.
--    Soft-deleted folders move too, so Trash restores land in the
--    right area.
UPDATE folders f
SET space_id = s.id
FROM spaces s
WHERE s.client_id = f.client_id
  AND s.deleted_at IS NULL
  AND f.client_id IS NOT NULL
  AND f.space_id <> s.id;

UPDATE lists l
SET space_id = f.space_id
FROM folders f
WHERE f.id = l.folder_id
  AND f.client_id IS NOT NULL
  AND l.space_id <> f.space_id;

-- 5. Translate client access grants into space memberships.
--    (The creator already has a manager row from the insert trigger.)
INSERT INTO resource_memberships (resource_type, resource_id, user_id, access_level, invited_by)
SELECT
  'space',
  s.id,
  a.user_id,
  CASE WHEN r.name = 'Squad Manager' THEN 'manager' ELSE 'member' END,
  a.created_by
FROM client_user_access a
JOIN spaces s ON s.client_id = a.client_id AND s.deleted_at IS NULL
JOIN users u ON u.id = a.user_id
LEFT JOIN roles r ON r.id = a.role_id
ON CONFLICT (resource_type, resource_id, user_id) DO NOTHING;
