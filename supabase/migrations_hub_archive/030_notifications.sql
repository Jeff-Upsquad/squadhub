-- ============================================================
-- Notifications
-- Backs the inbox tab in the partner mobile app.
--
-- Source of truth for assignees is the `tasks.assignee_ids` UUID[]
-- column (NOT a task_assignees join table — that was defined in an
-- early migration but never landed on prod).
--
-- Server creates rows via triggers on:
--   tasks           INSERT            -> task_assigned (every current assignee)
--   tasks           UPDATE (assignees) -> task_assigned (newly added only)
--   tasks           UPDATE (status)    -> task_updated
--   task_comments   INSERT            -> task_commented
--
-- Actor exclusion uses current_setting('app.actor_id') which the
-- server may SET LOCAL at the start of a mutation request. When
-- unset, all assignees (including the actor) receive a notification —
-- conservative but never loses signal.
-- ============================================================

-- Clear any pre-existing attempts (guarded against missing tables)
DROP TRIGGER IF EXISTS trg_notify_task_assigned ON tasks;
DROP TRIGGER IF EXISTS trg_notify_task_status_changed ON tasks;
DROP TRIGGER IF EXISTS trg_notify_task_commented ON task_comments;
DROP FUNCTION IF EXISTS notify_task_assigned();
DROP FUNCTION IF EXISTS notify_task_status_changed();
DROP FUNCTION IF EXISTS notify_task_commented();
DROP FUNCTION IF EXISTS current_actor_id();
DROP TABLE IF EXISTS notifications CASCADE;

CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL
    CHECK (type IN ('task_assigned', 'task_updated', 'task_commented', 'task_due_soon', 'mention', 'message_mention', 'dm_received', 'reaction_added')),
  reference_id UUID NOT NULL,
  reference_type TEXT NOT NULL DEFAULT 'task',
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  body TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notifications_user_unread
  ON notifications(user_id, is_read, created_at DESC);
CREATE INDEX idx_notifications_reference
  ON notifications(reference_id, reference_type);

-- ------------------------------------------------------------
-- Helper: read current actor (nullable) from session config
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION current_actor_id() RETURNS UUID AS $fn$
BEGIN
  RETURN NULLIF(current_setting('app.actor_id', true), '')::UUID;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$fn$ LANGUAGE plpgsql STABLE;

-- ------------------------------------------------------------
-- Trigger: task_assigned
-- Fires on tasks INSERT (all initial assignees) and
-- tasks UPDATE OF assignee_ids (only newly-added users).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION notify_task_assigned() RETURNS TRIGGER AS $fn$
DECLARE
  actor UUID;
  actor_name TEXT;
  new_assignees UUID[];
  assignee UUID;
BEGIN
  actor := current_actor_id();
  IF actor IS NOT NULL THEN
    SELECT display_name INTO actor_name FROM users WHERE id = actor;
  END IF;

  IF TG_OP = 'INSERT' THEN
    new_assignees := COALESCE(NEW.assignee_ids, ARRAY[]::UUID[]);
  ELSE
    SELECT COALESCE(ARRAY_AGG(a), ARRAY[]::UUID[]) INTO new_assignees
    FROM (
      SELECT unnest(COALESCE(NEW.assignee_ids, ARRAY[]::UUID[]))
      EXCEPT
      SELECT unnest(COALESCE(OLD.assignee_ids, ARRAY[]::UUID[]))
    ) s(a);
  END IF;

  FOREACH assignee IN ARRAY new_assignees LOOP
    IF actor IS NOT NULL AND actor = assignee THEN
      CONTINUE;
    END IF;
    INSERT INTO notifications (user_id, type, reference_id, reference_type, actor_id, title, metadata)
    VALUES (
      assignee,
      'task_assigned',
      NEW.id,
      'task',
      actor,
      COALESCE(actor_name || ' assigned you to ', 'You were assigned to ') || COALESCE(NEW.title, 'a task'),
      jsonb_build_object('task_id', NEW.id)
    );
  END LOOP;

  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

CREATE TRIGGER trg_notify_task_assigned
  AFTER INSERT OR UPDATE OF assignee_ids ON tasks
  FOR EACH ROW EXECUTE FUNCTION notify_task_assigned();

-- ------------------------------------------------------------
-- Trigger: task_updated (status change only, to keep volume sane)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION notify_task_status_changed() RETURNS TRIGGER AS $fn$
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
    assignee,
    'task_updated',
    NEW.id,
    'task',
    actor,
    COALESCE(actor_name || ' moved ', 'Status changed on ') || NEW.title,
    'Status: ' || COALESCE(OLD.status, '(none)') || ' -> ' || COALESCE(NEW.status, '(none)'),
    jsonb_build_object('task_id', NEW.id, 'old_status', OLD.status, 'new_status', NEW.status)
  FROM unnest(COALESCE(NEW.assignee_ids, ARRAY[]::UUID[])) AS assignee
  WHERE actor IS NULL OR assignee != actor;

  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

CREATE TRIGGER trg_notify_task_status_changed
  AFTER UPDATE OF status ON tasks
  FOR EACH ROW EXECUTE FUNCTION notify_task_status_changed();

-- ------------------------------------------------------------
-- Trigger: task_commented
-- Notifies every assignee of the parent task except the commenter.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION notify_task_commented() RETURNS TRIGGER AS $fn$
DECLARE
  task_title TEXT;
  assignee_list UUID[];
  actor_name TEXT;
BEGIN
  SELECT title, assignee_ids INTO task_title, assignee_list
  FROM tasks WHERE id = NEW.task_id;
  SELECT display_name INTO actor_name FROM users WHERE id = NEW.user_id;

  INSERT INTO notifications (user_id, type, reference_id, reference_type, actor_id, title, body, metadata)
  SELECT
    assignee,
    'task_commented',
    NEW.task_id,
    'task',
    NEW.user_id,
    COALESCE(actor_name, 'Someone') || ' commented on ' || COALESCE(task_title, 'a task'),
    LEFT(NEW.content, 140),
    jsonb_build_object('task_id', NEW.task_id, 'comment_id', NEW.id)
  FROM unnest(COALESCE(assignee_list, ARRAY[]::UUID[])) AS assignee
  WHERE assignee != NEW.user_id;

  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

CREATE TRIGGER trg_notify_task_commented
  AFTER INSERT ON task_comments
  FOR EACH ROW EXECUTE FUNCTION notify_task_commented();
