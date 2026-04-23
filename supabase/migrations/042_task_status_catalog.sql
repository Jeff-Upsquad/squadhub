-- Migration 042: Task status catalog for task_type='task'
--
-- Introduces a hard-coded 28-status catalog (defined in shared/src/index.ts)
-- used by the 'task' task type. tasks.status stays TEXT but now holds a
-- catalog key (e.g. 'open', 'front_burner', 'over_due', 'closed') for this
-- task type. Other task types keep using per-space space_statuses.
--
-- This migration does three things:
--   1. Drops the legacy tasks_status_check constraint that limited status to
--      the 4 legacy category values. The new catalog has 28 keys and
--      validation now lives in the application layer (TASK_STATUS_CATALOG
--      in shared/src/index.ts). The constraint was added directly in the
--      Supabase dashboard (no migration file defined it), so we drop by name.
--   2. Remaps existing tasks.status for task_type='task' rows:
--        'todo'   -> 'open'
--        'active' -> 'in_progress'
--        'done'   -> 'closed'
--        'closed' -> 'closed'
--   3. Updates notify_task_completed() so the terminal catalog key 'closed'
--      is recognised as a completion event even when no matching
--      space_statuses row exists (catalog tasks have no per-space row).

-- ------------------------------------------------------------
-- 1. Drop legacy CHECK constraint on tasks.status
-- ------------------------------------------------------------

ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_status_check;

-- ------------------------------------------------------------
-- 2. Data remap for task_type='task'
-- ------------------------------------------------------------

UPDATE tasks
SET status = CASE status
  WHEN 'todo'   THEN 'open'
  WHEN 'active' THEN 'in_progress'
  WHEN 'done'   THEN 'closed'
  WHEN 'closed' THEN 'closed'
  ELSE status
END
WHERE task_type_id IN (SELECT id FROM task_types WHERE key = 'task');

-- ------------------------------------------------------------
-- 3. Rewrite notify_task_completed() to recognise catalog keys.
--
-- For tasks of type 'task' the status is a catalog key, so we check for the
-- terminal key 'closed' directly. For other types we still resolve via
-- space_statuses.name (pre-existing behaviour, unchanged).
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION notify_task_completed() RETURNS TRIGGER AS $fn$
DECLARE
  actor UUID;
  actor_name TEXT;
  task_space UUID;
  old_cat TEXT;
  new_cat TEXT;
  recipients UUID[];
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  SELECT space_id INTO task_space FROM lists WHERE id = NEW.list_id;
  IF task_space IS NULL THEN
    RETURN NEW;
  END IF;

  -- Resolve new_cat: catalog key 'closed' is terminal; otherwise fall back
  -- to space_statuses lookup for legacy task types.
  IF NEW.status = 'closed' THEN
    new_cat := 'closed';
  ELSE
    SELECT category INTO new_cat FROM space_statuses
      WHERE space_id = task_space AND name = NEW.status
      LIMIT 1;
  END IF;

  IF OLD.status = 'closed' THEN
    old_cat := 'closed';
  ELSE
    SELECT category INTO old_cat FROM space_statuses
      WHERE space_id = task_space AND name = OLD.status
      LIMIT 1;
  END IF;

  IF new_cat IS NULL OR new_cat NOT IN ('done', 'closed') THEN
    RETURN NEW;
  END IF;
  IF old_cat IS NOT NULL AND old_cat IN ('done', 'closed') THEN
    RETURN NEW;
  END IF;

  actor := COALESCE(NEW.last_modified_by, current_actor_id());
  IF actor IS NOT NULL THEN
    SELECT display_name INTO actor_name FROM users WHERE id = actor;
  END IF;

  SELECT ARRAY_AGG(DISTINCT u) INTO recipients FROM (
    SELECT unnest(COALESCE(NEW.assignee_ids, ARRAY[]::UUID[])) AS u
    UNION
    SELECT NEW.created_by AS u
  ) s
  WHERE u IS NOT NULL AND (actor IS NULL OR u != actor);

  IF recipients IS NULL OR array_length(recipients, 1) IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO notifications (user_id, type, reference_id, reference_type, actor_id, title, body, metadata)
  SELECT
    r,
    'task_completed',
    NEW.id,
    'task',
    actor,
    COALESCE(actor_name || ' completed ', 'Completed: ') || COALESCE(NEW.title, 'a task'),
    NULL,
    jsonb_build_object('task_id', NEW.id, 'old_status', OLD.status, 'new_status', NEW.status)
  FROM unnest(recipients) AS r;

  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;
