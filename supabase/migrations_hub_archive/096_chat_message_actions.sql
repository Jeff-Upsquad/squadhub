-- Workspace chat message actions: edit (10-min window, enforced in API),
-- delete (soft, is_deleted already exists), and scheduled sends.

-- ---- Edited marker for workspace chat messages ----
ALTER TABLE messages ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;

-- ---- Scheduled messages (text-only v1) ----
CREATE TABLE IF NOT EXISTS chat_scheduled_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_id UUID REFERENCES channels(id) ON DELETE CASCADE,
  dm_conversation_id UUID REFERENCES dm_conversations(id) ON DELETE CASCADE,
  parent_message_id UUID REFERENCES messages(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'canceled')),
  sent_message_id UUID REFERENCES messages(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (channel_id IS NOT NULL OR dm_conversation_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_chat_sched_due
  ON chat_scheduled_messages (scheduled_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_chat_sched_user
  ON chat_scheduled_messages (user_id, status);

-- Server uses the service role (bypasses RLS); enabling RLS with no policies
-- locks the table to everyone else, keeping the security advisors quiet.
ALTER TABLE chat_scheduled_messages ENABLE ROW LEVEL SECURITY;
