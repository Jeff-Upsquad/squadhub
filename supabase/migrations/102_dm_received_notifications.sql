-- Notify the recipient(s) of every direct message.
--
-- Channel messages stay mention-only (notify_message_mention); this fills the
-- gap for DMs, which previously created no notification at all (the 'dm_received'
-- type existed but nothing inserted it). The Socket.IO poll bridge then fans
-- each row to the web feed and to the native partner app via FCM.
--
-- reference_type = 'message' + metadata.dm_conversation_id so the app deep-links
-- the tap straight to the conversation (squadhub-partner://dm/<id>).
CREATE OR REPLACE FUNCTION notify_dm_received() RETURNS TRIGGER AS $fn$
DECLARE
  sender_name TEXT;
BEGIN
  -- DMs only. Channel messages are handled by notify_message_mention.
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
    jsonb_build_object('message_id', NEW.id, 'dm_conversation_id', NEW.dm_conversation_id)
  FROM dm_participants dp
  WHERE dp.conversation_id = NEW.dm_conversation_id
    AND dp.user_id <> NEW.sender_id
    -- Don't double-notify someone already getting a message_mention for this row.
    AND NOT (NEW.mentions IS NOT NULL AND dp.user_id = ANY (NEW.mentions));

  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_notify_dm_received ON messages;
CREATE TRIGGER trg_notify_dm_received
  AFTER INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION notify_dm_received();
