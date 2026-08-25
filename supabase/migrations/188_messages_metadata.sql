-- ============================================================
-- messages.metadata — generic JSONB sidecar for system-tagged rows
-- ============================================================
-- The CRM mirrors entity activities (comments, task events, stage
-- moves) into team chats as real `messages` rows. They carry a
-- marker here ({ "crm_activity": { "kind": "...", "action": "..." } })
-- so the chat renderer can style them as activity lines instead of
-- chat bubbles (see Squad CRM server/src/services/team-chat-mirror.ts).

ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS metadata JSONB;
