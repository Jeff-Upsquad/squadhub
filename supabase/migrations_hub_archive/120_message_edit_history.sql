-- 120_message_edit_history.sql
-- Recoverable message edits.
--
-- Both chat surfaces overwrite `content` in place when a message is edited:
--   * mobile Squad Chat  -> chat_messages  (routes/chat/messages.ts)
--   * web workspace chat -> messages       (routes/messages.ts)
-- Once overwritten the prior text was unrecoverable. These BEFORE UPDATE
-- triggers snapshot the OLD content into a history table on every content
-- change, so an admin can view and restore prior versions. Triggers (rather
-- than app code) guarantee EVERY edit path is captured and can't be bypassed.
--
-- Deletes are already soft (deleted_at / is_deleted) so they stay recoverable
-- on their own; only edits needed this.

-- ---------------------------------------------------------------------------
-- Mobile Squad Chat (chat_messages)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chat_message_edits (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  message_id       UUID NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  previous_content TEXT NOT NULL,
  -- author of the previous version (the message sender); NULL if the user row
  -- is later removed.
  editor_id        UUID REFERENCES users(id) ON DELETE SET NULL,
  -- when the previous_content was replaced by a newer edit.
  replaced_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_message_edits_message
  ON chat_message_edits(message_id, replaced_at DESC);

-- Content holds message text; access only via service-role admin endpoints.
ALTER TABLE chat_message_edits ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION capture_chat_message_edit() RETURNS TRIGGER AS $fn$
BEGIN
  IF NEW.content IS DISTINCT FROM OLD.content AND OLD.content IS NOT NULL THEN
    INSERT INTO chat_message_edits (message_id, previous_content, editor_id)
    VALUES (OLD.id, OLD.content, OLD.sender_id);
  END IF;
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_capture_chat_message_edit ON chat_messages;
CREATE TRIGGER trg_capture_chat_message_edit
  BEFORE UPDATE ON chat_messages
  FOR EACH ROW EXECUTE FUNCTION capture_chat_message_edit();

-- ---------------------------------------------------------------------------
-- Web workspace chat (messages)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS message_edits (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  message_id       UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  previous_content TEXT NOT NULL,
  editor_id        UUID REFERENCES users(id) ON DELETE SET NULL,
  replaced_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_message_edits_message
  ON message_edits(message_id, replaced_at DESC);

ALTER TABLE message_edits ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION capture_message_edit() RETURNS TRIGGER AS $fn$
BEGIN
  IF NEW.content IS DISTINCT FROM OLD.content AND OLD.content IS NOT NULL THEN
    INSERT INTO message_edits (message_id, previous_content, editor_id)
    VALUES (OLD.id, OLD.content, OLD.sender_id);
  END IF;
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_capture_message_edit ON messages;
CREATE TRIGGER trg_capture_message_edit
  BEFORE UPDATE ON messages
  FOR EACH ROW EXECUTE FUNCTION capture_message_edit();
