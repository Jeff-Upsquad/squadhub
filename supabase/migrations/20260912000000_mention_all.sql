-- @all channel mentions.
--
-- A message sent with mention_all = true notifies every member of the
-- channel (like Slack's @channel/@all): each member except the sender gets a
-- 'message_mention' inbox notification, so existing inbox/push rendering
-- works unchanged. The @all rows carry a distinct title ("mentioned @all")
-- so recipients can tell a broadcast from a personal mention.
--
-- Threads started from an @all message treat the whole channel as followers:
-- notify_thread_reply additionally follows the root message's explicit
-- mentions and, when the root has mention_all, every channel member. Later
-- replies therefore notify all of them (minus the replier and anyone
-- explicitly @mentioned in that reply, who get the stronger mention alert).
--
-- Channel membership mirrors the mention-picker scope (routes/users.ts):
-- resource_memberships rows for the channel plus the channel creator.
-- DMs ignore mention_all (a DM already notifies its recipients).

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS mention_all BOOLEAN NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.notify_message_mention()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  sender_name TEXT;
  channel_name TEXT;
  is_dm BOOLEAN;
  has_mentions BOOLEAN;
  is_all BOOLEAN;
BEGIN
  has_mentions := NEW.mentions IS NOT NULL AND array_length(NEW.mentions, 1) IS NOT NULL;
  is_all := COALESCE(NEW.mention_all, false) AND NEW.channel_id IS NOT NULL;
  IF NOT has_mentions AND NOT is_all THEN
    RETURN NEW;
  END IF;

  SELECT display_name INTO sender_name FROM users WHERE id = NEW.sender_id;

  is_dm := NEW.dm_conversation_id IS NOT NULL;
  IF NEW.channel_id IS NOT NULL THEN
    SELECT name INTO channel_name FROM channels WHERE id = NEW.channel_id;
  END IF;

  -- Explicit @mentions (unchanged behaviour).
  IF has_mentions THEN
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
        'dm_conversation_id', NEW.dm_conversation_id,
        'parent_message_id', NEW.parent_message_id
      )
    FROM unnest(NEW.mentions) AS m
    WHERE m IS NOT NULL AND m != NEW.sender_id;
  END IF;

  -- @all broadcast: every channel member (+ creator) except the sender and
  -- anyone already notified above via an explicit mention.
  IF is_all THEN
    INSERT INTO notifications (user_id, type, reference_id, reference_type, actor_id, title, body, metadata)
    SELECT DISTINCT
      member_id,
      'message_mention',
      NEW.id,
      'message',
      NEW.sender_id,
      COALESCE(sender_name, 'Someone') || ' mentioned @all'
        || CASE WHEN channel_name IS NOT NULL THEN ' in #' || channel_name ELSE '' END,
      LEFT(COALESCE(NEW.content, ''), 140),
      jsonb_build_object(
        'message_id', NEW.id,
        'channel_id', NEW.channel_id,
        'dm_conversation_id', NEW.dm_conversation_id,
        'parent_message_id', NEW.parent_message_id,
        'mention_all', true
      )
    FROM (
      SELECT user_id AS member_id
        FROM resource_memberships
       WHERE resource_type = 'channel'
         AND resource_id = NEW.channel_id
      UNION
      SELECT created_by AS member_id
        FROM channels
       WHERE id = NEW.channel_id
         AND created_by IS NOT NULL
    ) AS members
    WHERE member_id IS NOT NULL
      AND member_id != NEW.sender_id
      AND NOT (has_mentions AND member_id = ANY (NEW.mentions));
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_notify_message_mention ON messages;
CREATE TRIGGER trg_notify_message_mention
  AFTER INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION public.notify_message_mention();

CREATE OR REPLACE FUNCTION public.notify_thread_reply()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  root_author_id UUID;
  root_mentions UUID[];
  root_all BOOLEAN;
  root_channel_id UUID;
  sender_name TEXT;
  channel_name TEXT;
BEGIN
  IF NEW.parent_message_id IS NULL OR NEW.channel_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT sender_id, COALESCE(mentions, '{}'::uuid[]), COALESCE(mention_all, false), channel_id
    INTO root_author_id, root_mentions, root_all, root_channel_id
    FROM messages
   WHERE id = NEW.parent_message_id;

  -- A missing parent should be impossible because of the foreign key, but
  -- returning safely keeps this notification trigger from blocking a send if
  -- an older environment has inconsistent data.
  IF root_author_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT display_name INTO sender_name FROM users WHERE id = NEW.sender_id;
  SELECT name INTO channel_name FROM channels WHERE id = NEW.channel_id;

  INSERT INTO notifications (
    user_id, type, reference_id, reference_type, actor_id, title, body, metadata
  )
  SELECT
    participant.user_id,
    'thread_reply',
    NEW.id,
    'message',
    NEW.sender_id,
    COALESCE(sender_name, 'Someone')
      || CASE
           WHEN participant.user_id = root_author_id THEN ' replied to your thread'
           ELSE ' replied in a thread you joined'
         END
      || CASE WHEN channel_name IS NOT NULL THEN ' in #' || channel_name ELSE '' END,
    LEFT(COALESCE(NEW.content, ''), 140),
    jsonb_build_object(
      'message_id', NEW.id,
      'channel_id', NEW.channel_id,
      'dm_conversation_id', NEW.dm_conversation_id,
      'parent_message_id', NEW.parent_message_id,
      'thread_role', CASE
        WHEN participant.user_id = root_author_id THEN 'starter'
        ELSE 'participant'
      END
    )
  FROM (
    -- UNION makes each follower unique even if they have replied many times.
    SELECT sender_id AS user_id
      FROM messages
     WHERE id = NEW.parent_message_id
    UNION
    SELECT sender_id AS user_id
      FROM messages
     WHERE parent_message_id = NEW.parent_message_id
    UNION
    -- People @mentioned in the thread starter follow the thread too.
    SELECT unnest(root_mentions) AS user_id
     WHERE array_length(root_mentions, 1) IS NOT NULL
    UNION
    -- @all starter: the whole channel follows the thread.
    SELECT user_id AS user_id
      FROM resource_memberships
     WHERE root_all
       AND resource_type = 'channel'
       AND resource_id = root_channel_id
    UNION
    SELECT created_by AS user_id
      FROM channels
     WHERE root_all
       AND id = root_channel_id
       AND created_by IS NOT NULL
  ) AS participant
  WHERE participant.user_id IS NOT NULL
    AND participant.user_id <> NEW.sender_id
    AND NOT (
      participant.user_id = ANY(COALESCE(NEW.mentions, '{}'::uuid[]))
    );

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_notify_thread_reply ON messages;
CREATE TRIGGER trg_notify_thread_reply
  AFTER INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION public.notify_thread_reply();

NOTIFY pgrst, 'reload schema';
