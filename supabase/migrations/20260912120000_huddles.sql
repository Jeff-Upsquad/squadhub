-- Huddles: Slack-style in-app audio/video calls attached to a channel or DM,
-- backed by LiveKit. One active (ended_at IS NULL) huddle per conversation.
-- A huddle is also shareable by `code` (/huddle/<code>) so people without an
-- account can join as guests when allow_guests is set.

CREATE TABLE IF NOT EXISTS huddles (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code               text NOT NULL UNIQUE,
  room_name          text NOT NULL UNIQUE,
  channel_id         uuid REFERENCES channels(id) ON DELETE SET NULL,
  dm_conversation_id uuid REFERENCES dm_conversations(id) ON DELETE SET NULL,
  topic              text,
  started_by         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  started_at         timestamptz NOT NULL DEFAULT now(),
  ended_at           timestamptz,
  allow_guests       boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (channel_id IS NOT NULL OR dm_conversation_id IS NOT NULL)
);

-- At most one live huddle per conversation.
CREATE UNIQUE INDEX IF NOT EXISTS huddles_active_channel_uniq
  ON huddles (channel_id) WHERE ended_at IS NULL AND channel_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS huddles_active_dm_uniq
  ON huddles (dm_conversation_id) WHERE ended_at IS NULL AND dm_conversation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_huddles_active ON huddles (started_at) WHERE ended_at IS NULL;

-- Who is / was in the call. `identity` is the LiveKit participant identity
-- ("user:<uuid>" for members, "guest:<random>" for link joiners).
CREATE TABLE IF NOT EXISTS huddle_participants (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  huddle_id    uuid NOT NULL REFERENCES huddles(id) ON DELETE CASCADE,
  identity     text NOT NULL,
  user_id      uuid REFERENCES users(id) ON DELETE SET NULL,
  display_name text NOT NULL,
  avatar_url   text,
  joined_at    timestamptz NOT NULL DEFAULT now(),
  left_at      timestamptz,
  UNIQUE (huddle_id, identity)
);
CREATE INDEX IF NOT EXISTS idx_huddle_participants_huddle ON huddle_participants (huddle_id);

-- Chat link: the "X started a huddle" card is a normal message carrying a
-- reverse reference (same pattern as messages.meeting_event_id, migration 139).
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS huddle_id uuid REFERENCES huddles(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_messages_huddle
  ON messages (huddle_id) WHERE huddle_id IS NOT NULL;

ALTER TABLE huddles ENABLE ROW LEVEL SECURITY;
ALTER TABLE huddle_participants ENABLE ROW LEVEL SECURITY;
