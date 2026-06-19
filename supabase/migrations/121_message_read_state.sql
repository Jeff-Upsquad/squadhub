-- 121_message_read_state.sql
-- Per-user read markers for the legacy chat (channels + DMs on the `messages`
-- table). The native partner app uses these to badge unread channels/DMs and
-- the Chat tab. One row per (user, conversation); `last_read_at` is a
-- high-water mark — a message counts as unread when its `created_at` is newer
-- than the user's `last_read_at` for that conversation.

CREATE TABLE IF NOT EXISTS message_reads (
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope_type   TEXT NOT NULL CHECK (scope_type IN ('channel', 'dm')),
  scope_id     UUID NOT NULL,
  last_read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, scope_type, scope_id)
);

CREATE INDEX IF NOT EXISTS idx_message_reads_user ON message_reads(user_id);

-- Unread counts per channel + DM for one user, in a single round-trip.
-- Only conversations the user can actually see are considered:
--   channels → resource_memberships (member) OR channels.created_by (creator)
--   DMs      → dm_participants
-- A message is unread when it is newer than the user's last_read_at for that
-- conversation, authored by someone else, and not soft-deleted. Conversations
-- with a zero count are omitted so the caller only gets rows that badge.
CREATE OR REPLACE FUNCTION chat_unread_summary(p_user_id UUID)
RETURNS TABLE (scope_type TEXT, scope_id UUID, unread_count BIGINT)
LANGUAGE sql
STABLE
AS $$
  WITH my_channels AS (
    SELECT rm.resource_id AS id
    FROM resource_memberships rm
    WHERE rm.user_id = p_user_id AND rm.resource_type = 'channel'
    UNION
    SELECT c.id
    FROM channels c
    WHERE c.created_by = p_user_id AND c.deleted_at IS NULL
  ),
  channel_unread AS (
    SELECT 'channel'::text AS scope_type, mc.id AS scope_id, COUNT(m.id) AS unread_count
    FROM my_channels mc
    LEFT JOIN message_reads r
      ON r.user_id = p_user_id AND r.scope_type = 'channel' AND r.scope_id = mc.id
    LEFT JOIN messages m
      ON m.channel_id = mc.id
      AND m.sender_id <> p_user_id
      AND m.is_deleted = false
      AND m.created_at > COALESCE(r.last_read_at, 'epoch'::timestamptz)
    GROUP BY mc.id
  ),
  my_dms AS (
    SELECT dp.conversation_id AS id
    FROM dm_participants dp
    WHERE dp.user_id = p_user_id
  ),
  dm_unread AS (
    SELECT 'dm'::text AS scope_type, md.id AS scope_id, COUNT(m.id) AS unread_count
    FROM my_dms md
    LEFT JOIN message_reads r
      ON r.user_id = p_user_id AND r.scope_type = 'dm' AND r.scope_id = md.id
    LEFT JOIN messages m
      ON m.dm_conversation_id = md.id
      AND m.sender_id <> p_user_id
      AND m.is_deleted = false
      AND m.created_at > COALESCE(r.last_read_at, 'epoch'::timestamptz)
    GROUP BY md.id
  )
  SELECT scope_type, scope_id, unread_count FROM channel_unread WHERE unread_count > 0
  UNION ALL
  SELECT scope_type, scope_id, unread_count FROM dm_unread WHERE unread_count > 0;
$$;
