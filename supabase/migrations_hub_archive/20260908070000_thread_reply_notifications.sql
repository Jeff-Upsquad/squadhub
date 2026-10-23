-- Notify the thread starter when somebody replies in a channel without
-- @mentioning them. DMs already create a dm_received notification for every
-- reply, so limiting this trigger to channels avoids duplicate DM alerts.
-- Mentioned starters are excluded here because notify_message_mention already
-- creates the stronger, mention-specific notification for the same reply.

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (
  type = ANY (ARRAY[
    'announcement',
    'task_assigned','task_updated','task_completed','task_commented','task_due_soon',
    'mention','message_mention','thread_reply','dm_received','reaction_added',
    'lms_assigned','lms_updated','lms_shared','lms_review_requested','lms_review_decided','lms_comment',
    'meeting_invited','meeting_suggestion','meeting_suggestion_resolved','meeting_confirmed','meeting_cancelled',
    'support_ticket_reply','support_ticket_assigned',
    'sop_flag','sop_strike'
  ]::text[])
);

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

  -- Do not notify a user about their own reply or create a duplicate when the
  -- reply explicitly mentions the thread starter.
  IF root_author_id IS NULL
     OR root_author_id = NEW.sender_id
     OR root_author_id = ANY(COALESCE(NEW.mentions, '{}'::uuid[])) THEN
    RETURN NEW;
  END IF;

  SELECT display_name INTO sender_name FROM users WHERE id = NEW.sender_id;
  IF NEW.channel_id IS NOT NULL THEN
    SELECT name INTO channel_name FROM channels WHERE id = NEW.channel_id;
  END IF;

  INSERT INTO notifications (
    user_id, type, reference_id, reference_type, actor_id, title, body, metadata
  ) VALUES (
    root_author_id,
    'thread_reply',
    NEW.id,
    'message',
    NEW.sender_id,
    COALESCE(sender_name, 'Someone') || ' replied to your thread'
      || CASE WHEN channel_name IS NOT NULL THEN ' in #' || channel_name ELSE '' END,
    LEFT(COALESCE(NEW.content, ''), 140),
    jsonb_build_object(
      'message_id', NEW.id,
      'channel_id', NEW.channel_id,
      'dm_conversation_id', NEW.dm_conversation_id,
      'parent_message_id', NEW.parent_message_id
    )
  );

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_notify_thread_reply ON messages;
CREATE TRIGGER trg_notify_thread_reply
  AFTER INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION public.notify_thread_reply();

NOTIFY pgrst, 'reload schema';
