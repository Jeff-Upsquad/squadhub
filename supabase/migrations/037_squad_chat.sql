-- ============================================================
-- Squad Chat v1
-- WhatsApp-style messaging backing two Android apps:
--   - Squad Chat (clients)  -> client + client_staff users
--   - Squad Chat Team       -> partner + internal + admin users
--
-- All tables are prefixed `chat_` and fully isolated from the
-- existing messages/channels/dms workspace-messaging tables.
--
-- Writes go through the Express server (service role). RLS is
-- enabled with no policies — direct anon access is blocked.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- chat_groups
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chat_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  description TEXT,
  avatar_url TEXT,
  app_scope TEXT NOT NULL CHECK (app_scope IN ('clients', 'team')),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_groups_scope_active
  ON chat_groups(app_scope) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_chat_groups_created_by
  ON chat_groups(created_by);

-- ------------------------------------------------------------
-- chat_group_members
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chat_group_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES chat_groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_group_admin BOOLEAN NOT NULL DEFAULT FALSE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_read_at TIMESTAMPTZ,
  muted_until TIMESTAMPTZ,
  UNIQUE (group_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_group_members_user
  ON chat_group_members(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_group_members_group
  ON chat_group_members(group_id);

-- ------------------------------------------------------------
-- chat_dm_conversations
-- Canonical ordering: user1_id < user2_id so (a,b) == (b,a).
-- Trigger enforces partner <-> internal/admin pairing.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chat_dm_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user1_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user2_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_message_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (user1_id < user2_id),
  UNIQUE (user1_id, user2_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_dm_conv_user1
  ON chat_dm_conversations(user1_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_dm_conv_user2
  ON chat_dm_conversations(user2_id, last_message_at DESC);

CREATE OR REPLACE FUNCTION chat_dm_validate_pair() RETURNS TRIGGER AS $fn$
DECLARE
  u1_type TEXT;
  u1_admin BOOLEAN;
  u2_type TEXT;
  u2_admin BOOLEAN;
  side1 TEXT;
  side2 TEXT;
BEGIN
  SELECT user_type, is_admin INTO u1_type, u1_admin FROM users WHERE id = NEW.user1_id;
  SELECT user_type, is_admin INTO u2_type, u2_admin FROM users WHERE id = NEW.user2_id;

  IF u1_type IS NULL OR u2_type IS NULL THEN
    RAISE EXCEPTION 'chat_dm_conversations: user not found';
  END IF;

  -- Side assignment: partner -> 'partner'; internal/client_*/admin -> 'team'
  side1 := CASE
    WHEN u1_type = 'partner' THEN 'partner'
    WHEN u1_type = 'internal' OR u1_admin THEN 'team'
    ELSE 'excluded'
  END;
  side2 := CASE
    WHEN u2_type = 'partner' THEN 'partner'
    WHEN u2_type = 'internal' OR u2_admin THEN 'team'
    ELSE 'excluded'
  END;

  IF side1 = 'excluded' OR side2 = 'excluded' THEN
    RAISE EXCEPTION 'chat_dm_conversations: DMs are only for partner <-> internal/admin';
  END IF;
  IF side1 = side2 THEN
    RAISE EXCEPTION 'chat_dm_conversations: DM pair must be one partner and one internal/admin';
  END IF;

  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_chat_dm_validate_pair ON chat_dm_conversations;
CREATE TRIGGER trg_chat_dm_validate_pair
  BEFORE INSERT ON chat_dm_conversations
  FOR EACH ROW EXECUTE FUNCTION chat_dm_validate_pair();

-- ------------------------------------------------------------
-- chat_messages
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID REFERENCES chat_groups(id) ON DELETE CASCADE,
  dm_conversation_id UUID REFERENCES chat_dm_conversations(id) ON DELETE CASCADE,
  sender_id UUID REFERENCES users(id) ON DELETE SET NULL,
  client_temp_id TEXT,
  content TEXT,
  type TEXT NOT NULL
    CHECK (type IN ('text', 'voice', 'image', 'video', 'document', 'system')),
  file_url TEXT,
  file_name TEXT,
  file_size BIGINT,
  file_mime TEXT,
  duration_ms INTEGER,
  width INTEGER,
  height INTEGER,
  parent_message_id UUID REFERENCES chat_messages(id) ON DELETE SET NULL,
  mentions UUID[] NOT NULL DEFAULT '{}',
  edited_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((group_id IS NOT NULL) <> (dm_conversation_id IS NOT NULL)),
  CHECK (content IS NOT NULL OR file_url IS NOT NULL OR type = 'system')
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_group_created
  ON chat_messages(group_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_chat_messages_dm_created
  ON chat_messages(dm_conversation_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_chat_messages_sender
  ON chat_messages(sender_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_messages_parent
  ON chat_messages(parent_message_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_mentions
  ON chat_messages USING GIN (mentions);
CREATE INDEX IF NOT EXISTS idx_chat_messages_temp
  ON chat_messages(sender_id, client_temp_id) WHERE client_temp_id IS NOT NULL;

-- Bump parent conversation timestamp on message insert.
CREATE OR REPLACE FUNCTION chat_messages_bump_conv() RETURNS TRIGGER AS $fn$
BEGIN
  IF NEW.group_id IS NOT NULL THEN
    UPDATE chat_groups SET updated_at = NOW() WHERE id = NEW.group_id;
  ELSIF NEW.dm_conversation_id IS NOT NULL THEN
    UPDATE chat_dm_conversations SET last_message_at = NEW.created_at
    WHERE id = NEW.dm_conversation_id;
  END IF;
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_chat_messages_bump_conv ON chat_messages;
CREATE TRIGGER trg_chat_messages_bump_conv
  AFTER INSERT ON chat_messages
  FOR EACH ROW EXECUTE FUNCTION chat_messages_bump_conv();

-- ------------------------------------------------------------
-- chat_message_receipts
-- One row per (message, recipient). Drives tick marks:
--   none ticked yet -> single
--   every row delivered_at IS NOT NULL -> double grey
--   every row read_at IS NOT NULL      -> double blue
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chat_message_receipts (
  message_id UUID NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delivered_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  PRIMARY KEY (message_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_receipts_user_unread
  ON chat_message_receipts(user_id) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_chat_receipts_user_undelivered
  ON chat_message_receipts(user_id) WHERE delivered_at IS NULL;

-- ------------------------------------------------------------
-- chat_push_tokens
-- Expo push tokens, one row per device/user/variant.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chat_push_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL,
  app_variant TEXT NOT NULL CHECK (app_variant IN ('clients', 'team')),
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, token)
);

CREATE INDEX IF NOT EXISTS idx_chat_push_tokens_user_variant
  ON chat_push_tokens(user_id, app_variant);

-- ------------------------------------------------------------
-- chat_app_config
-- Per-variant min-version and download URL. Admin edits live.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chat_app_config (
  variant TEXT PRIMARY KEY CHECK (variant IN ('clients', 'team')),
  min_version TEXT NOT NULL DEFAULT '1.0.0',
  download_url TEXT,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO chat_app_config (variant, min_version, download_url)
VALUES
  ('clients', '1.0.0', NULL),
  ('team',    '1.0.0', NULL)
ON CONFLICT (variant) DO NOTHING;

-- ------------------------------------------------------------
-- RLS: lock down anon access. Server writes via service role
-- which bypasses RLS, matching the pattern in earlier migrations.
-- ------------------------------------------------------------
ALTER TABLE chat_groups             ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_group_members      ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_dm_conversations   ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages           ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_message_receipts   ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_push_tokens        ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_app_config         ENABLE ROW LEVEL SECURITY;

COMMIT;

NOTIFY pgrst, 'reload schema';
