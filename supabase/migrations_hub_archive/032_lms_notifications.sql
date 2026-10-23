-- ============================================================
-- LMS notifications integration
--
-- Extends the notifications.type enum (defined in 030) to
-- carry 'lms_assigned' and 'lms_updated'. Adds triggers:
--   lms_assignments    INSERT         -> lms_assigned (assignee)
--   lms_items          UPDATE status  -> lms_updated  (re-publish pings existing assignees)
-- Uses the same current_actor_id() helper for actor exclusion.
-- ============================================================

-- Drop and recreate the notifications type check with the new values.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'task_assigned', 'task_updated', 'task_commented', 'task_due_soon',
    'mention', 'message_mention', 'dm_received', 'reaction_added',
    'lms_assigned', 'lms_updated'
  ));

-- ------------------------------------------------------------
-- Trigger: lms_assigned
-- Fires when a new lms_assignments row is inserted.
-- ------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_notify_lms_assigned ON lms_assignments;
DROP FUNCTION IF EXISTS notify_lms_assigned();

CREATE OR REPLACE FUNCTION notify_lms_assigned() RETURNS TRIGGER AS $fn$
DECLARE
  actor UUID;
  actor_name TEXT;
  item_title TEXT;
  item_kind TEXT;
BEGIN
  actor := current_actor_id();
  IF actor IS NOT NULL AND actor = NEW.user_id THEN
    RETURN NEW;  -- don't notify the admin about their own assignment
  END IF;

  IF actor IS NOT NULL THEN
    SELECT display_name INTO actor_name FROM users WHERE id = actor;
  END IF;

  SELECT title, kind INTO item_title, item_kind
  FROM lms_items WHERE id = NEW.item_id;

  INSERT INTO notifications (user_id, type, reference_id, reference_type, actor_id, title, body, metadata)
  VALUES (
    NEW.user_id,
    'lms_assigned',
    NEW.item_id,
    'lms_item',
    actor,
    COALESCE(actor_name || ' assigned you ', 'You were assigned ')
      || COALESCE(item_kind, 'content') || ': '
      || COALESCE(item_title, 'Untitled'),
    NULL,
    jsonb_build_object('item_id', NEW.item_id, 'assignment_id', NEW.id, 'kind', item_kind)
  );

  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

CREATE TRIGGER trg_notify_lms_assigned
  AFTER INSERT ON lms_assignments
  FOR EACH ROW EXECUTE FUNCTION notify_lms_assigned();

-- ------------------------------------------------------------
-- Trigger: lms_updated
-- Fires when an item is re-published (status transitions to
-- 'published' while published_at was already set, OR title changes
-- on a published item). We notify every existing assignee.
-- ------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_notify_lms_updated ON lms_items;
DROP FUNCTION IF EXISTS notify_lms_updated();

CREATE OR REPLACE FUNCTION notify_lms_updated() RETURNS TRIGGER AS $fn$
DECLARE
  actor UUID;
  actor_name TEXT;
  is_republish BOOLEAN;
BEGIN
  -- Only interested in events on already-published items
  IF NEW.status <> 'published' THEN
    RETURN NEW;
  END IF;

  -- Re-publish (status was already 'published') OR first publish after
  -- a prior publish cycle (published_at already set).
  is_republish := (OLD.status = 'published')
    OR (OLD.published_at IS NOT NULL AND NEW.status = 'published');

  IF NOT is_republish THEN
    RETURN NEW;  -- first-time publish: lms_assigned trigger handles it
  END IF;

  -- Avoid spamming for metadata-only tweaks on already-published items.
  -- We only notify when title changes OR status itself was just flipped.
  IF OLD.title IS NOT DISTINCT FROM NEW.title
     AND OLD.status IS NOT DISTINCT FROM NEW.status
     AND OLD.published_at IS NOT DISTINCT FROM NEW.published_at THEN
    RETURN NEW;
  END IF;

  actor := current_actor_id();
  IF actor IS NOT NULL THEN
    SELECT display_name INTO actor_name FROM users WHERE id = actor;
  END IF;

  INSERT INTO notifications (user_id, type, reference_id, reference_type, actor_id, title, body, metadata)
  SELECT
    a.user_id,
    'lms_updated',
    NEW.id,
    'lms_item',
    actor,
    COALESCE(actor_name || ' updated ', 'Content updated: ') || NEW.title,
    NULL,
    jsonb_build_object('item_id', NEW.id, 'assignment_id', a.id)
  FROM lms_assignments a
  WHERE a.item_id = NEW.id
    AND (actor IS NULL OR a.user_id != actor);

  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

CREATE TRIGGER trg_notify_lms_updated
  AFTER UPDATE ON lms_items
  FOR EACH ROW EXECUTE FUNCTION notify_lms_updated();

NOTIFY pgrst, 'reload schema';
