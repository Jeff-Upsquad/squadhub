-- CRM entity chats: link channels to CRM deals / contacts / leads, store a
-- human label for the SquadHub sidebar, and track per-user close state so a
-- closed chat reappears when a new message arrives after the close.

-- 1. Widen linked_resource_type to include CRM entities.
ALTER TABLE channels DROP CONSTRAINT IF EXISTS channels_linked_resource_type_check;
ALTER TABLE channels
  ADD CONSTRAINT channels_linked_resource_type_check
  CHECK (
    linked_resource_type IS NULL
    OR linked_resource_type IN (
      'space', 'folder', 'list',
      'crm_deal', 'crm_contact', 'crm_lead'
    )
  );

-- 2. Label / subtitle shown in the CRM Chats sidebar (avoids a CRM round-trip).
ALTER TABLE channels
  ADD COLUMN IF NOT EXISTS linked_label TEXT,
  ADD COLUMN IF NOT EXISTS linked_subtitle TEXT;

-- 3. Per-user "close chat" for CRM-linked channels. A chat is "open" for a user
-- when there is no closed_at, or when the channel has a message newer than closed_at.
CREATE TABLE IF NOT EXISTS crm_chat_user_state (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  closed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, channel_id)
);

CREATE INDEX IF NOT EXISTS idx_crm_chat_user_state_channel
  ON crm_chat_user_state (channel_id);

-- RLS on: no policies → only service role (same pattern as other app tables).
ALTER TABLE crm_chat_user_state ENABLE ROW LEVEL SECURITY;
