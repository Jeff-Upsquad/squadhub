-- Thread-reply deep links for the native partner app.
--
-- Chat notifications carry the conversation id (channel_id / dm_conversation_id)
-- but never the thread root, so tapping a notification for a *thread reply* only
-- deep-linked to the parent conversation, not the thread. Add the reply's
-- parent_message_id (the thread root) to the notification metadata. The partner
-- push forwarder (server/src/push/partnerPush.ts) relays it, and the Android app
-- routes a tap with a parent_message_id straight to the thread screen
-- (GET /messages/:id/thread resolves the root from any member id).
--
-- Both functions live on the `messages` table; parent_message_id is NULL for
-- top-level messages, so this is a no-op for non-thread notifications.

CREATE OR REPLACE FUNCTION public.notify_dm_received()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  sender_name TEXT;
BEGIN
  IF NEW.dm_conversation_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT display_name INTO sender_name FROM users WHERE id = NEW.sender_id;

  INSERT INTO notifications (user_id, type, reference_id, reference_type, actor_id, title, body, metadata)
  SELECT
    dp.user_id,
    'dm_received',
    NEW.id,
    'message',
    NEW.sender_id,
    COALESCE(sender_name, 'Someone') || ' sent you a message',
    LEFT(COALESCE(NEW.content, ''), 140),
    jsonb_build_object(
      'message_id', NEW.id,
      'dm_conversation_id', NEW.dm_conversation_id,
      'parent_message_id', NEW.parent_message_id
    )
  FROM dm_participants dp
  WHERE dp.conversation_id = NEW.dm_conversation_id
    AND dp.user_id <> NEW.sender_id
    AND NOT (NEW.mentions IS NOT NULL AND dp.user_id = ANY (NEW.mentions));

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_message_mention()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
      'dm_conversation_id', NEW.dm_conversation_id,
      'parent_message_id', NEW.parent_message_id
    )
  FROM unnest(NEW.mentions) AS m
  WHERE m IS NOT NULL AND m != NEW.sender_id;

  RETURN NEW;
END;
$function$;

NOTIFY pgrst, 'reload schema';
