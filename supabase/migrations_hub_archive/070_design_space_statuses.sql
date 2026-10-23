-- Replace default statuses with design-specific statuses
-- for spaces that contain design-space folders.

DO $$
DECLARE
  _space_id UUID;
BEGIN
  FOR _space_id IN
    SELECT DISTINCT s.id
    FROM spaces s
    JOIN folders f ON f.space_id = s.id
    JOIN client_space_templates cst ON cst.id = f.client_space_template_id
    WHERE cst.slug = 'design-space'
  LOOP
    -- Remove default statuses
    DELETE FROM space_statuses WHERE space_id = _space_id;

    -- Insert design-specific statuses
    INSERT INTO space_statuses (space_id, name, color, position, is_default, category) VALUES
      (_space_id, 'New Request',      '#6b7280', 0,  TRUE,  'todo'),
      (_space_id, 'Checking',         '#f59e0b', 1,  FALSE, 'todo'),
      (_space_id, 'Line-up',          '#8b5cf6', 2,  FALSE, 'active'),
      (_space_id, 'Assigned',         '#3b82f6', 3,  FALSE, 'active'),
      (_space_id, 'Work in Progress', '#0ea5e9', 4,  FALSE, 'active'),
      (_space_id, 'Changes',          '#f97316', 5,  FALSE, 'done'),
      (_space_id, 'For Review',       '#a855f7', 6,  FALSE, 'done'),
      (_space_id, 'Closed',           '#22c55e', 7,  FALSE, 'closed');
  END LOOP;
END $$;

-- Auto-apply design statuses when a folder gets linked to the design-space template
CREATE OR REPLACE FUNCTION seed_design_statuses()
RETURNS TRIGGER AS $$
DECLARE
  _tpl_slug TEXT;
BEGIN
  IF NEW.client_space_template_id IS NULL OR NEW.space_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT slug INTO _tpl_slug
  FROM client_space_templates
  WHERE id = NEW.client_space_template_id;

  IF _tpl_slug = 'design-space' THEN
    DELETE FROM space_statuses WHERE space_id = NEW.space_id;

    INSERT INTO space_statuses (space_id, name, color, position, is_default, category) VALUES
      (NEW.space_id, 'New Request',      '#6b7280', 0,  TRUE,  'todo'),
      (NEW.space_id, 'Checking',         '#f59e0b', 1,  FALSE, 'todo'),
      (NEW.space_id, 'Line-up',          '#8b5cf6', 2,  FALSE, 'active'),
      (NEW.space_id, 'Assigned',         '#3b82f6', 3,  FALSE, 'active'),
      (NEW.space_id, 'Work in Progress', '#0ea5e9', 4,  FALSE, 'active'),
      (NEW.space_id, 'Changes',          '#f97316', 5,  FALSE, 'done'),
      (NEW.space_id, 'For Review',       '#a855f7', 6,  FALSE, 'done'),
      (NEW.space_id, 'Closed',           '#22c55e', 7,  FALSE, 'closed');
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_seed_design_statuses ON folders;
CREATE TRIGGER trg_seed_design_statuses
  AFTER INSERT OR UPDATE OF client_space_template_id ON folders
  FOR EACH ROW
  EXECUTE FUNCTION seed_design_statuses();
