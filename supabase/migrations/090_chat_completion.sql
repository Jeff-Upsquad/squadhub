-- ============================================================
-- Migration 090: Slack-like Chat Completion
-- Adds the missing columns/indexes for full chat parity:
--   - File attachment metadata (file_name, file_size, file_mime, duration_ms)
--   - Link unfurl preview JSON on messages
--   - Denormalized reply_count for thread bar perf
--   - Indexes for reactions, parent_message_id, and message_threads
--
-- Idempotent (uses IF NOT EXISTS) — safe to apply on environments
-- where these columns/tables already exist.
-- ============================================================

-- ---- Workspace messages: file attachment metadata ----
ALTER TABLE messages ADD COLUMN IF NOT EXISTS file_name TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS file_size BIGINT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS file_mime TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS duration_ms INTEGER;

-- ---- Threading: parent_message_id may pre-exist on some envs but not all ----
ALTER TABLE messages ADD COLUMN IF NOT EXISTS parent_message_id UUID REFERENCES messages(id) ON DELETE CASCADE;

-- ---- Link unfurl preview (OG metadata captured at send time) ----
-- Shape: { title, description, image, site_name, url } | null
ALTER TABLE messages ADD COLUMN IF NOT EXISTS unfurl JSONB;

-- ---- Denormalized reply_count for cheap thread-bar rendering ----
ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_count INTEGER NOT NULL DEFAULT 0;

-- ---- Indexes ----
CREATE INDEX IF NOT EXISTS idx_messages_parent ON messages(parent_message_id) WHERE parent_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_messages_channel_created ON messages(channel_id, created_at DESC) WHERE channel_id IS NOT NULL AND is_deleted = FALSE;
CREATE INDEX IF NOT EXISTS idx_messages_dm_created ON messages(dm_conversation_id, created_at DESC) WHERE dm_conversation_id IS NOT NULL AND is_deleted = FALSE;
CREATE INDEX IF NOT EXISTS idx_reactions_message ON reactions(message_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_reactions_unique ON reactions(message_id, user_id, emoji);

-- ---- Trigger to maintain reply_count on parent message ----
CREATE OR REPLACE FUNCTION bump_reply_count() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.parent_message_id IS NOT NULL THEN
    UPDATE messages SET reply_count = reply_count + 1 WHERE id = NEW.parent_message_id;
  ELSIF TG_OP = 'DELETE' AND OLD.parent_message_id IS NOT NULL THEN
    UPDATE messages SET reply_count = GREATEST(reply_count - 1, 0) WHERE id = OLD.parent_message_id;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Soft-delete (is_deleted true) => decrement; un-delete => increment
    IF NEW.parent_message_id IS NOT NULL THEN
      IF OLD.is_deleted = FALSE AND NEW.is_deleted = TRUE THEN
        UPDATE messages SET reply_count = GREATEST(reply_count - 1, 0) WHERE id = NEW.parent_message_id;
      ELSIF OLD.is_deleted = TRUE AND NEW.is_deleted = FALSE THEN
        UPDATE messages SET reply_count = reply_count + 1 WHERE id = NEW.parent_message_id;
      END IF;
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_messages_reply_count ON messages;
CREATE TRIGGER trg_messages_reply_count
AFTER INSERT OR DELETE OR UPDATE OF is_deleted ON messages
FOR EACH ROW EXECUTE FUNCTION bump_reply_count();

-- ---- Backfill reply_count for existing rows ----
UPDATE messages parent
SET reply_count = (
  SELECT COUNT(*) FROM messages child
  WHERE child.parent_message_id = parent.id AND child.is_deleted = FALSE
)
WHERE parent.reply_count = 0
  AND EXISTS (SELECT 1 FROM messages c WHERE c.parent_message_id = parent.id);

-- ---- Reload PostgREST schema cache so the new columns are immediately visible ----
NOTIFY pgrst, 'reload schema';
