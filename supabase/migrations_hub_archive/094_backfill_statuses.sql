-- ============================================================
-- 094: Backfill design/video statuses for existing spaces
-- Spaces that already had folders before the seed_design_statuses()
-- trigger was deployed never got the 8 custom statuses replaced.
-- This finds all spaces with design/video template folders and
-- backfills them.
-- Idempotent — safe to re-run.
-- ============================================================

DO $$
DECLARE
  tpl_ids uuid[];
  sid uuid;
BEGIN
  -- Collect template IDs for design-space and video-editing-space
  SELECT array_agg(id) INTO tpl_ids
  FROM client_space_templates
  WHERE slug IN ('design-space', 'video-editing-space');

  -- Loop over every space that has at least one folder with one of those templates
  FOR sid IN
    SELECT DISTINCT f.space_id
    FROM folders f
    WHERE f.client_space_template_id = ANY(tpl_ids)
      AND f.deleted_at IS NULL
  LOOP
    -- Remove existing default statuses for this space
    DELETE FROM space_statuses WHERE space_id = sid;

    -- Insert the 8 design/video statuses
    INSERT INTO space_statuses (space_id, name, color, position, is_default, category) VALUES
      (sid, 'New Request',      '#6b7280', 0,  TRUE,  'todo'),
      (sid, 'Checking',         '#f59e0b', 1,  FALSE, 'todo'),
      (sid, 'Line-up',          '#8b5cf6', 2,  FALSE, 'active'),
      (sid, 'Assigned',         '#3b82f6', 3,  FALSE, 'active'),
      (sid, 'Work in Progress', '#0ea5e9', 4,  FALSE, 'active'),
      (sid, 'Changes',          '#f97316', 5,  FALSE, 'done'),
      (sid, 'For Review',       '#a855f7', 6,  FALSE, 'done'),
      (sid, 'Closed',           '#22c55e', 7,  FALSE, 'closed');
  END LOOP;
END $$;
