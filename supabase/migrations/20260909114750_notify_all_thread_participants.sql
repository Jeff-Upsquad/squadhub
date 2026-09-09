-- Treat a channel thread as a conversation, not as a notification owned only
-- by its root author.
--
-- A user follows a thread automatically once they start it or reply to it.
-- Every later reply notifies all existing followers except:
--   * the sender (never notify users about their own message), and
--   * users explicitly @mentioned in this reply (notify_message_mention creates
--     the stronger mention notification for them, so a thread alert would be a
--     duplicate).
--
-- DMs remain excluded: notify_dm_received already alerts every DM recipient.

CREATE OR REPLACE FUNCTION public.notify_thread_reply()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  root_author_id UUID;
  sender_name TEXT;
  channel_name TEXT;
BEGIN
  IF NEW.parent_message_id IS NULL OR NEW.channel_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT sender_id
    INTO root_author_id
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
  ) AS participant
  WHERE participant.user_id <> NEW.sender_id
    AND NOT (
      participant.user_id = ANY(COALESCE(NEW.mentions, '{}'::uuid[]))
    );

  RETURN NEW;
END;
$function$;

-- The trigger already exists in production, but recreate it defensively so
-- this migration also repairs an environment where the function exists but the
-- trigger was dropped.
DROP TRIGGER IF EXISTS trg_notify_thread_reply ON messages;
CREATE TRIGGER trg_notify_thread_reply
  AFTER INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION public.notify_thread_reply();

NOTIFY pgrst, 'reload schema';
