-- ============================================================
-- Notifications
-- Backs the inbox tab in the partner mobile app and (eventually)
-- the web InboxView. Server creates rows via triggers on:
--   task_assignees INSERT   -> task_assigned
--   tasks          UPDATE   -> task_updated (on status change)
--   task_comments  INSERT   -> task_commented
-- Actor exclusion uses current_setting('app.actor_id') which the
-- server may SET LOCAL at the start of a mutation request. When
-- unset, all assignees (including the actor) receive a notification
-- which is conservative but never loses signal.
-- ============================================================

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL
    CHECK (type IN ('task_assigned', 'task_updated', 'task_commented', 'task_due_soon', 'mention')),
  reference_id UUID NOT NULL,
  reference_type TEXT NOT NULL DEFAULT 'task',
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  body TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON notifications(user_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_reference
  ON notifications(reference_id, reference_type);

-- ------------------------------------------------------------
-- Helper: read current actor (nullable) from session config
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION current_actor_id() RETURNS UUID AS $$
BEGIN
  RETURN NULLIF(current_setting('app.actor_id', true), '')::UUID;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE;

-- ------------------------------------------------------------
-- Trigger: task_assigned
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION notify_task_assigned() RETURNS TRIGGER AS $$
DECLARE
  task_title TEXT;
  actor UUID;
  actor_name TEXT;
BEGIN
  actor := current_actor_id();
  IF actor IS NOT NULL AND actor = NEW.user_id THEN
    RETURN NEW;
  END IF;

  SELECT title INTO task_title FROM tasks WHERE id = NEW.task_id;
  IF actor IS NOT NULL THEN
    SELECT display_name INTO actor_name FROM users WHERE id = actor;
  END IF;

  INSERT INTO notifications (user_id, type, reference_id, reference_type, actor_id, title, metadata)
  VALUES (
    NEW.user_id,
    'task_assigned',
    NEW.task_id,
    'task',
    actor,
    COALESCE(actor_name || ' assigned you to ', 'You were assigned to ') || COALESCE(task_title, 'a task'),
    jsonb_build_object('task_id', NEW.task_id)
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_notify_task_assigned ON task_assignees;
CREATE TRIGGER trg_notify_task_assigned
  AFTER INSERT ON task_assignees
  FOR EACH ROW EXECUTE FUNCTION notify_task_assigned();

-- ------------------------------------------------------------
-- Trigger: task_updated (status change only, to keep volume sane)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION notify_task_status_changed() RETURNS TRIGGER AS $$
DECLARE
  actor UUID;
  actor_name TEXT;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  actor := current_actor_id();
  IF actor IS NOT NULL THEN
    SELECT display_name INTO actor_name FROM users WHERE id = actor;
  END IF;

  INSERT INTO notifications (user_id, type, reference_id, reference_type, actor_id, title, body, metadata)
  SELECT
    ta.user_id,
    'task_updated',
    NEW.id,
    'task',
    actor,
    COALESCE(actor_name || ' moved ', 'Status changed on ') || NEW.title,
    'Status: ' || COALESCE(OLD.status, '(none)') || ' → ' || COALESCE(NEW.status, '(none)'),
    jsonb_build_object('task_id', NEW.id, 'old_status', OLD.status, 'new_status', NEW.status)
  FROM task_assignees ta
  WHERE ta.task_id = NEW.id
    AND (actor IS NULL OR ta.user_id != actor);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_notify_task_status_changed ON tasks;
CREATE TRIGGER trg_notify_task_status_changed
  AFTER UPDATE OF status ON tasks
  FOR EACH ROW EXECUTE FUNCTION notify_task_status_changed();

-- ------------------------------------------------------------
-- Trigger: task_commented
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION notify_task_commented() RETURNS TRIGGER AS $$
DECLARE
  task_title TEXT;
  actor_name TEXT;
BEGIN
  SELECT title INTO task_title FROM tasks WHERE id = NEW.task_id;
  SELECT display_name INTO actor_name FROM users WHERE id = NEW.user_id;

  INSERT INTO notifications (user_id, type, reference_id, reference_type, actor_id, title, body, metadata)
  SELECT
    ta.user_id,
    'task_commented',
    NEW.task_id,
    'task',
    NEW.user_id,
    COALESCE(actor_name, 'Someone') || ' commented on ' || COALESCE(task_title, 'a task'),
    LEFT(NEW.content, 140),
    jsonb_build_object('task_id', NEW.task_id, 'comment_id', NEW.id)
  FROM task_assignees ta
  WHERE ta.task_id = NEW.task_id
    AND ta.user_id != NEW.user_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_notify_task_commented ON task_comments;
CREATE TRIGGER trg_notify_task_commented
  AFTER INSERT ON task_comments
  FOR EACH ROW EXECUTE FUNCTION notify_task_commented();
