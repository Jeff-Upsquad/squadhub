-- ============================================================
-- Inbox notifications: task_completed, comment mentions, chat mentions
--
-- Builds on 030_notifications.sql:
--   - Adds 'task_completed' notification type. Replaces the noisy
--     "any status change" trigger with a sharper one that only fires
--     when a task crosses into a status whose space_statuses.category
--     is 'done' or 'closed'.
--   - Adds a `mentions UUID[]` column to task_comments.
--   - Replaces notify_task_commented() so that mentioned users get a
--     'mention' notification (higher signal) and the remaining
--     assignees get the existing 'task_commented'.
--   - Adds a chat_messages INSERT trigger that creates 'message_mention'
--     rows for each user in chat_messages.mentions (excluding the sender).
--
-- Actor exclusion:
--   Supabase-JS can't hold a session var across .rpc() + .insert() calls
--   (each hits a different pooled connection), so the original
--   `current_actor_id()` session-var scheme from 030 can't be populated
--   reliably from the Node server. Instead, we track the actor on the
--   row itself:
--     - tasks.created_by          (already present)  -> actor for INSERT
--     - tasks.last_modified_by    (added below)      -> actor for UPDATE
--     - task_comments.user_id     (already present)  -> commenter
--     - chat_messages.sender_id   (already present)  -> sender
--   Triggers fall back to current_actor_id() when the row column is null,
--   which preserves the old behavior for any code path that still
--   SET LOCALs the session var.
-- ============================================================

-- ------------------------------------------------------------
-- Type CHECK: add 'task_completed'. Keep 'task_updated' so any
-- pre-existing rows written before this migration remain valid.
-- ------------------------------------------------------------
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'task_assigned', 'task_updated', 'task_completed', 'task_commented', 'task_due_soon',
    'mention', 'message_mention', 'dm_received', 'reaction_added',
    'lms_assigned', 'lms_updated'
  ));

-- ------------------------------------------------------------
-- tasks.last_modified_by — server sets this on every PUT so the
-- UPDATE triggers can exclude the actor.
-- ------------------------------------------------------------
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS last_modified_by UUID REFERENCES users(id) ON DELETE SET NULL;

-- ------------------------------------------------------------
-- Replace notify_task_assigned() so UPDATE path uses
-- NEW.last_modified_by as the actor.
-- ------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_notify_task_assigned ON tasks;
DROP FUNCTION IF EXISTS notify_task_assigned();

CREATE OR REPLACE FUNCTION notify_task_assigned() RETURNS TRIGGER AS $fn$
DECLARE
  actor UUID;
  actor_name TEXT;
  new_assignees UUID[];
  assignee UUID;
BEGIN
  IF TG_OP = 'INSERT' THEN
    actor := COALESCE(NEW.created_by, current_actor_id());
    new_assignees := COALESCE(NEW.assignee_ids, ARRAY[]::UUID[]);
  ELSE
    actor := COALESCE(NEW.last_modified_by, current_actor_id());
    SELECT COALESCE(ARRAY_AGG(a), ARRAY[]::UUID[]) INTO new_assignees
    FROM (
      SELECT unnest(COALESCE(NEW.assignee_ids, ARRAY[]::UUID[]))
      EXCEPT
      SELECT unnest(COALESCE(OLD.assignee_ids, ARRAY[]::UUID[]))
    ) s(a);
  END IF;

  IF actor IS NOT NULL THEN
    SELECT display_name INTO actor_name FROM users WHERE id = actor;
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
-- task_completed: fires only when status crosses INTO a 'done' or
-- 'closed' category. Notifies all assignees + creator, except actor.
-- ------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_notify_task_status_changed ON tasks;
DROP FUNCTION IF EXISTS notify_task_status_changed();
DROP TRIGGER IF EXISTS trg_notify_task_completed ON tasks;
DROP FUNCTION IF EXISTS notify_task_completed();

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

  SELECT category INTO new_cat FROM space_statuses
    WHERE space_id = task_space AND name = NEW.status
    LIMIT 1;
  SELECT category INTO old_cat FROM space_statuses
    WHERE space_id = task_space AND name = OLD.status
    LIMIT 1;

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

CREATE TRIGGER trg_notify_task_completed
  AFTER UPDATE OF status ON tasks
  FOR EACH ROW EXECUTE FUNCTION notify_task_completed();

-- ------------------------------------------------------------
-- task_comments: add mentions column.
-- ------------------------------------------------------------
ALTER TABLE task_comments
  ADD COLUMN IF NOT EXISTS mentions UUID[] NOT NULL DEFAULT '{}'::uuid[];

-- ------------------------------------------------------------
-- task_commented: rewritten. Mentioned users (excluding commenter)
-- get a 'mention' notification. Remaining assignees (not the
-- commenter, not already mentioned) get 'task_commented'.
-- ------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_notify_task_commented ON task_comments;
DROP FUNCTION IF EXISTS notify_task_commented();

CREATE OR REPLACE FUNCTION notify_task_commented() RETURNS TRIGGER AS $fn$
DECLARE
  task_title TEXT;
  assignee_list UUID[];
  actor_name TEXT;
  mention_set UUID[];
BEGIN
  SELECT title, assignee_ids INTO task_title, assignee_list
    FROM tasks WHERE id = NEW.task_id;
  SELECT display_name INTO actor_name FROM users WHERE id = NEW.user_id;

  mention_set := COALESCE(NEW.mentions, ARRAY[]::UUID[]);

  INSERT INTO notifications (user_id, type, reference_id, reference_type, actor_id, title, body, metadata)
  SELECT DISTINCT
    m,
    'mention',
    NEW.task_id,
    'task',
    NEW.user_id,
    COALESCE(actor_name, 'Someone') || ' mentioned you on ' || COALESCE(task_title, 'a task'),
    LEFT(NEW.content, 140),
    jsonb_build_object('task_id', NEW.task_id, 'comment_id', NEW.id)
  FROM unnest(mention_set) AS m
  WHERE m IS NOT NULL AND m != NEW.user_id;

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
  WHERE assignee != NEW.user_id
    AND NOT (assignee = ANY(mention_set));

  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

CREATE TRIGGER trg_notify_task_commented
  AFTER INSERT ON task_comments
  FOR EACH ROW EXECUTE FUNCTION notify_task_commented();

-- ------------------------------------------------------------
-- Old channel/DM messages table: add mentions column + trigger so
-- the web chat composer (posts to /messages, not /chat/messages)
-- can drive inbox mentions too.
-- ------------------------------------------------------------
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS mentions UUID[] NOT NULL DEFAULT '{}'::uuid[];

DROP TRIGGER IF EXISTS trg_notify_message_mention ON messages;
DROP FUNCTION IF EXISTS notify_message_mention();

CREATE OR REPLACE FUNCTION notify_message_mention() RETURNS TRIGGER AS $fn$
DECLARE
  sender_name TEXT;
  channel_name TEXT;
  is_dm BOOLEAN;
BEGIN
  IF NEW.mentions IS NULL OR array_length(NEW.mentions, 1) IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT display_name INTO sender_name FROM users WHERE id = NEW.sender_id;

  is_dm := NEW.dm_conversation_id IS NOT NULL;
  IF NEW.channel_id IS NOT NULL THEN
    SELECT name INTO channel_name FROM channels WHERE id = NEW.channel_id;
  END IF;

  INSERT INTO notifications (user_id, type, reference_id, reference_type, actor_id, title, body, metadata)
  SELECT DISTINCT
    m,
    'message_mention',
    NEW.id,
    'message',
    NEW.sender_id,
    COALESCE(sender_name, 'Someone') || ' mentioned you'
      || CASE
           WHEN is_dm THEN ' in a DM'
           WHEN channel_name IS NOT NULL THEN ' in #' || channel_name
           ELSE ''
         END,
    LEFT(COALESCE(NEW.content, ''), 140),
    jsonb_build_object(
      'message_id', NEW.id,
      'channel_id', NEW.channel_id,
      'dm_conversation_id', NEW.dm_conversation_id
    )
  FROM unnest(NEW.mentions) AS m
  WHERE m IS NOT NULL AND m != NEW.sender_id;

  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

CREATE TRIGGER trg_notify_message_mention
  AFTER INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION notify_message_mention();

-- ------------------------------------------------------------
-- chat_messages (squad_chat): emit 'message_mention' for each user
-- in chat_messages.mentions (excluding the sender).
-- ------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_notify_chat_mention ON chat_messages;
DROP FUNCTION IF EXISTS notify_chat_mention();

CREATE OR REPLACE FUNCTION notify_chat_mention() RETURNS TRIGGER AS $fn$
DECLARE
  sender_name TEXT;
  group_name TEXT;
  is_dm BOOLEAN;
BEGIN
  IF NEW.mentions IS NULL OR array_length(NEW.mentions, 1) IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT display_name INTO sender_name FROM users WHERE id = NEW.sender_id;

  is_dm := NEW.dm_conversation_id IS NOT NULL;
  IF NEW.group_id IS NOT NULL THEN
    SELECT name INTO group_name FROM chat_groups WHERE id = NEW.group_id;
  END IF;

  INSERT INTO notifications (user_id, type, reference_id, reference_type, actor_id, title, body, metadata)
  SELECT DISTINCT
    m,
    'message_mention',
    NEW.id,
    'chat_message',
    NEW.sender_id,
    COALESCE(sender_name, 'Someone') || ' mentioned you'
      || CASE
           WHEN is_dm THEN ' in a DM'
           WHEN group_name IS NOT NULL THEN ' in #' || group_name
           ELSE ''
         END,
    LEFT(COALESCE(NEW.content, ''), 140),
    jsonb_build_object(
      'message_id', NEW.id,
      'group_id', NEW.group_id,
      'dm_conversation_id', NEW.dm_conversation_id
    )
  FROM unnest(NEW.mentions) AS m
  WHERE m IS NOT NULL AND m != NEW.sender_id;

  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

CREATE TRIGGER trg_notify_chat_mention
  AFTER INSERT ON chat_messages
  FOR EACH ROW EXECUTE FUNCTION notify_chat_mention();

NOTIFY pgrst, 'reload schema';
