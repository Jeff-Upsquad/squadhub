-- Treat a task as a conversation among its participants, mirroring how
-- 20260909114750_notify_all_thread_participants.sql treats a channel thread.
--
-- A user follows a task automatically once they create it, are assigned to
-- it, or comment on it. Task events notify every current participant except:
--   * the actor (never notify users about their own actions — the actor is
--     taken from tasks.last_modified_by / task_comments.user_id, per the
--     pooled-connection caveat documented in 039),
--   * users explicitly @mentioned in a comment (the 'mention' notification
--     is the stronger signal, so a task_commented row would be a duplicate),
--   * newly added assignees on an update (trg_notify_task_assigned already
--     creates the stronger 'task_assigned' notification for them),
--   * everyone, when the update is a completion transition
--     (notify_task_completed creates the sharper 'task_completed').
--
-- Three triggers change:
--   1. notify_task_commented(): recipients grow from "remaining assignees"
--      to "creator + assignees + everyone who already commented".
--   2. notify_task_completed(): recipients grow from "assignees + creator"
--      to also include prior commenters.
--   3. notify_task_updated(): NEW — the type existed in the CHECK constraint
--      and the frontend labels, but nothing created it. Any meaningful task
--      edit (title, description, status, priority, due date, assignees) now
--      notifies all participants.

-- ------------------------------------------------------------
-- Shared status-category resolver. Catalog tasks use the terminal key
-- 'closed' directly; other task types resolve through space_statuses
-- (mirrors the inline logic 042 put inside notify_task_completed).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.task_status_category(p_list_id UUID, p_status TEXT)
RETURNS TEXT
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT CASE
    WHEN p_status = 'closed' THEN 'closed'::text
    ELSE (
      SELECT ss.category
      FROM public.lists l
      JOIN public.space_statuses ss ON ss.space_id = l.space_id
      WHERE l.id = p_list_id AND ss.name = p_status
      LIMIT 1
    )
  END
$fn$;

-- ------------------------------------------------------------
-- task_commented: mentioned users (excluding the commenter) keep getting
-- 'mention'; every other participant — creator, assignees, and anyone who
-- already commented — now gets 'task_commented'.
-- ------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_notify_task_commented ON task_comments;

CREATE OR REPLACE FUNCTION public.notify_task_commented()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  task_title TEXT;
  task_creator UUID;
  assignee_list UUID[];
  actor_name TEXT;
  mention_set UUID[];
BEGIN
  SELECT title, created_by, assignee_ids
    INTO task_title, task_creator, assignee_list
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
    participant.user_id,
    'task_commented',
    NEW.task_id,
    'task',
    NEW.user_id,
    COALESCE(actor_name, 'Someone') || ' commented on ' || COALESCE(task_title, 'a task'),
    LEFT(NEW.content, 140),
    jsonb_build_object('task_id', NEW.task_id, 'comment_id', NEW.id)
  FROM (
    -- UNION makes each participant unique even if they wear several hats
    -- (creator who is also an assignee and has commented before).
    SELECT task_creator AS user_id
    UNION
    SELECT unnest(COALESCE(assignee_list, ARRAY[]::UUID[])) AS user_id
    UNION
    -- The new row is already inserted when this AFTER trigger runs, so
    -- excluding the commenter's own rows yields exactly the prior
    -- commenters.
    SELECT user_id FROM task_comments
     WHERE task_id = NEW.task_id AND user_id <> NEW.user_id
  ) AS participant
  WHERE participant.user_id IS NOT NULL
    AND participant.user_id <> NEW.user_id
    AND NOT (participant.user_id = ANY(mention_set));

  RETURN NEW;
END;
$fn$;

CREATE TRIGGER trg_notify_task_commented
  AFTER INSERT ON task_comments
  FOR EACH ROW EXECUTE FUNCTION public.notify_task_commented();

-- ------------------------------------------------------------
-- task_completed: same completion detection as 042 (status crossing into a
-- 'done'/'closed' category), but recipients now include prior commenters
-- alongside assignees and the creator.
-- ------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_notify_task_completed ON tasks;

CREATE OR REPLACE FUNCTION public.notify_task_completed()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  actor UUID;
  actor_name TEXT;
  old_cat TEXT;
  new_cat TEXT;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  new_cat := public.task_status_category(NEW.list_id, NEW.status);
  old_cat := public.task_status_category(NEW.list_id, OLD.status);

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

  INSERT INTO notifications (user_id, type, reference_id, reference_type, actor_id, title, body, metadata)
  SELECT
    participant.user_id,
    'task_completed',
    NEW.id,
    'task',
    actor,
    COALESCE(actor_name || ' completed ', 'Completed: ') || COALESCE(NEW.title, 'a task'),
    NULL,
    jsonb_build_object('task_id', NEW.id, 'old_status', OLD.status, 'new_status', NEW.status)
  FROM (
    SELECT NEW.created_by AS user_id
    UNION
    SELECT unnest(COALESCE(NEW.assignee_ids, ARRAY[]::UUID[])) AS user_id
    UNION
    SELECT user_id FROM task_comments WHERE task_id = NEW.id
  ) AS participant
  WHERE participant.user_id IS NOT NULL
    AND (actor IS NULL OR participant.user_id <> actor);

  RETURN NEW;
END;
$fn$;

CREATE TRIGGER trg_notify_task_completed
  AFTER UPDATE OF status ON tasks
  FOR EACH ROW EXECUTE FUNCTION public.notify_task_completed();

-- ------------------------------------------------------------
-- task_updated: NEW. Fires on any UPDATE but returns early unless one of the
-- participant-facing fields actually changed, so reorder/timer/position
-- writes stay silent. Suppressed entirely on a completion transition, where
-- notify_task_completed owns the notification.
-- ------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_notify_task_updated ON tasks;

CREATE OR REPLACE FUNCTION public.notify_task_updated()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  actor UUID;
  actor_name TEXT;
  changed TEXT[] := ARRAY[]::TEXT[];
  newly_assigned UUID[];
  old_cat TEXT;
  new_cat TEXT;
BEGIN
  IF NEW.title IS DISTINCT FROM OLD.title THEN
    changed := array_append(changed, 'title');
  END IF;
  IF NEW.description IS DISTINCT FROM OLD.description THEN
    changed := array_append(changed, 'description');
  END IF;
  IF NEW.priority IS DISTINCT FROM OLD.priority THEN
    changed := array_append(changed, 'priority');
  END IF;
  IF NEW.due_date IS DISTINCT FROM OLD.due_date THEN
    changed := array_append(changed, 'due date');
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    new_cat := public.task_status_category(NEW.list_id, NEW.status);
    old_cat := public.task_status_category(NEW.list_id, OLD.status);
    IF new_cat IN ('done', 'closed')
       AND (old_cat IS NULL OR old_cat NOT IN ('done', 'closed')) THEN
      RETURN NEW;
    END IF;
    changed := array_append(changed, 'status');
  END IF;
  IF NEW.assignee_ids IS DISTINCT FROM OLD.assignee_ids THEN
    changed := array_append(changed, 'assignees');
  END IF;

  IF array_length(changed, 1) IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(ARRAY_AGG(DISTINCT a), ARRAY[]::UUID[]) INTO newly_assigned
  FROM (
    SELECT unnest(COALESCE(NEW.assignee_ids, ARRAY[]::UUID[])) AS a
    EXCEPT
    SELECT unnest(COALESCE(OLD.assignee_ids, ARRAY[]::UUID[])) AS a
  ) s;

  actor := COALESCE(NEW.last_modified_by, current_actor_id());
  IF actor IS NOT NULL THEN
    SELECT display_name INTO actor_name FROM users WHERE id = actor;
  END IF;

  INSERT INTO notifications (user_id, type, reference_id, reference_type, actor_id, title, body, metadata)
  SELECT
    participant.user_id,
    'task_updated',
    NEW.id,
    'task',
    actor,
    COALESCE(actor_name || ' updated ', 'Updated: ') || COALESCE(NEW.title, 'a task'),
    LEFT('Changed ' || array_to_string(changed, ', '), 140),
    jsonb_build_object('task_id', NEW.id, 'changed', changed)
  FROM (
    SELECT NEW.created_by AS user_id
    UNION
    SELECT unnest(COALESCE(NEW.assignee_ids, ARRAY[]::UUID[])) AS user_id
    UNION
    SELECT user_id FROM task_comments WHERE task_id = NEW.id
  ) AS participant
  WHERE participant.user_id IS NOT NULL
    AND (actor IS NULL OR participant.user_id <> actor)
    AND NOT (participant.user_id = ANY(newly_assigned));

  RETURN NEW;
END;
$fn$;

CREATE TRIGGER trg_notify_task_updated
  AFTER UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION public.notify_task_updated();

NOTIFY pgrst, 'reload schema';
