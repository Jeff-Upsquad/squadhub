-- Consolidate duplicate personal spaces and prevent recurrence.
--
-- GET /pm/personal ordered its "find existing personal space" query by a column
-- that does NOT exist on `spaces` (created_at), so the query errored and returned
-- nothing on every call — the endpoint then created a brand-new personal space
-- every time it ran (page load, quick-add, query refetch). The endpoint is fixed
-- to order by real columns; this migration cleans up the duplicates already
-- created and enforces one active personal space per (user, workspace).
--
-- Canonical = lowest (position, id), matching the fixed endpoint's lookup.

-- 1. Move tasks off duplicate spaces' lists onto the canonical space's list.
WITH ranked AS (
  SELECT id, created_by, workspace_id,
         row_number() OVER (PARTITION BY created_by, workspace_id ORDER BY position, id) AS rn
  FROM spaces
  WHERE kind = 'personal' AND deleted_at IS NULL
),
keeper AS (
  SELECT created_by, workspace_id, id AS keep_space_id FROM ranked WHERE rn = 1
),
dups AS (
  SELECT r.id AS dup_space_id, k.keep_space_id
  FROM ranked r
  JOIN keeper k ON k.created_by = r.created_by AND k.workspace_id = r.workspace_id
  WHERE r.rn > 1
),
keep_list AS (
  SELECT DISTINCT ON (space_id) space_id, id AS list_id
  FROM lists WHERE deleted_at IS NULL
  ORDER BY space_id, position, id
)
UPDATE tasks t
SET list_id = kl.list_id
FROM lists dl
JOIN dups d ON d.dup_space_id = dl.space_id
JOIN keep_list kl ON kl.space_id = d.keep_space_id
WHERE t.list_id = dl.id;

-- 2. Soft-delete the duplicate spaces' lists.
WITH ranked AS (
  SELECT id, row_number() OVER (PARTITION BY created_by, workspace_id ORDER BY position, id) AS rn
  FROM spaces
  WHERE kind = 'personal' AND deleted_at IS NULL
)
UPDATE lists SET deleted_at = NOW()
WHERE deleted_at IS NULL
  AND space_id IN (SELECT id FROM ranked WHERE rn > 1);

-- 3. Soft-delete the duplicate personal spaces themselves.
WITH ranked AS (
  SELECT id, row_number() OVER (PARTITION BY created_by, workspace_id ORDER BY position, id) AS rn
  FROM spaces
  WHERE kind = 'personal' AND deleted_at IS NULL
)
UPDATE spaces SET deleted_at = NOW()
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- 4. Enforce one active personal space per (user, workspace) going forward.
CREATE UNIQUE INDEX IF NOT EXISTS idx_spaces_one_personal_per_owner
  ON spaces (created_by, workspace_id)
  WHERE kind = 'personal' AND deleted_at IS NULL;
