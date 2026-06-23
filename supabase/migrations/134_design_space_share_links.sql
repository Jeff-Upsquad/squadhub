-- ============================================================
-- 134: Public, persistent shareable links for a Design Space
--   A manager generates an unguessable tokenized link for a design-space
--   folder. A client opens it (unauthenticated) to view the Dashboard /
--   Reports / Completed tabs and optionally submit a new request.
--   Unlike the card pre-fill links (108), this link is PERSISTENT — it has
--   no expiry and no single-use; it can be enabled, disabled, or deleted.
--   Idempotent — safe to re-run.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS design_space_share_links (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),  -- = the token
  folder_id  UUID NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  enabled    BOOLEAN NOT NULL DEFAULT true,               -- disable without deleting
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- At most ONE link per design space. Regenerating deletes the old row and
-- inserts a fresh one (new token; the previously shared URL stops working).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_design_space_share_link_folder
  ON design_space_share_links(folder_id);

-- Server accesses this table exclusively via the service role (supabaseAdmin),
-- matching subscription_card_share_links (108) and client_onboarding_links (036).
ALTER TABLE design_space_share_links ENABLE ROW LEVEL SECURITY;

-- Race-free find-or-create of a design space's queued (Briefs) backing list.
-- The public request form auto-creates this list if a client submits before
-- one exists; a per-folder advisory lock serializes concurrent submissions so
-- they can't create duplicate backing lists (lists has no unique name index).
CREATE OR REPLACE FUNCTION ensure_design_queued_list(p_folder uuid, p_created_by uuid)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_id uuid;
  v_space uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('design_queued_list:' || p_folder::text));

  SELECT id INTO v_id
    FROM lists
   WHERE folder_id = p_folder
     AND deleted_at IS NULL
     AND lower(name) IN ('briefs', 'queued', 'queue')
   ORDER BY position, created_at
   LIMIT 1;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  SELECT space_id INTO v_space FROM folders WHERE id = p_folder AND deleted_at IS NULL;
  IF v_space IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO lists (space_id, folder_id, name, created_by)
  VALUES (v_space, p_folder, 'Briefs', p_created_by)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

NOTIFY pgrst, 'reload schema';
COMMIT;
