-- ============================================================
-- 175: Support Tickets
--
-- A workspace-wide help desk that lives inside SquadHub as a special
-- "Support" channel. Any user (partner, client, internal) opens the
-- channel, files a categorised ticket, and each ticket becomes a
-- threaded conversation. Tickets are grouped Open / Closed. Support
-- agents (holders of the `support` mini app, plus admins) triage
-- tickets from an admin/mini-app module: claim them manually, have
-- them auto-assigned by category, converse in the thread, and close.
--
-- Data model reuses the existing chat plumbing: the ticket's opening
-- description is a top-level `messages` row in the Support channel and
-- the conversation is that message's thread (parent_message_id). The
-- `support_tickets` row carries the ticket metadata (category, status,
-- assignee, number). Per-ticket access is enforced in the /support
-- routes, so users never read the raw channel stream — only their own
-- tickets — while agents/admins see everything.
-- ============================================================

-- channel_kind marks the one special Support channel per workspace so the
-- sidebar renders it distinctly and the app swaps in the ticket UI instead of
-- the normal message stream. Everything else stays 'standard'.
ALTER TABLE channels
  ADD COLUMN IF NOT EXISTS channel_kind text NOT NULL DEFAULT 'standard';

-- Per-workspace, race-safe sequential ticket numbers (SUP-1, SUP-2, …).
CREATE TABLE IF NOT EXISTS support_ticket_counters (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  last_number  int NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS support_tickets (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id     uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  channel_id       uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  -- The opening message whose thread holds the conversation.
  root_message_id  uuid REFERENCES messages(id) ON DELETE SET NULL,
  ticket_number    int  NOT NULL,
  category         text NOT NULL,                       -- technical | accounts | financial | general
  subject          text NOT NULL,
  status           text NOT NULL DEFAULT 'open',        -- open | closed
  priority         text NOT NULL DEFAULT 'normal',      -- low | normal | high | urgent
  created_by       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_to      uuid REFERENCES users(id) ON DELETE SET NULL,
  assigned_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  assigned_at      timestamptz,
  closed_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  closed_at        timestamptz,
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, ticket_number)
);

CREATE INDEX IF NOT EXISTS idx_support_tickets_ws_status  ON support_tickets(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_support_tickets_creator    ON support_tickets(created_by);
CREATE INDEX IF NOT EXISTS idx_support_tickets_assignee   ON support_tickets(assigned_to);
CREATE INDEX IF NOT EXISTS idx_support_tickets_root_msg   ON support_tickets(root_message_id);

-- Auto-assign routing: one default agent per (workspace, category).
CREATE TABLE IF NOT EXISTS support_ticket_routing (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  category     text NOT NULL,
  assignee_id  uuid REFERENCES users(id) ON DELETE CASCADE,
  updated_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, category)
);

-- Assign the next per-workspace ticket number atomically on insert.
CREATE OR REPLACE FUNCTION assign_support_ticket_number()
RETURNS trigger AS $$
BEGIN
  INSERT INTO support_ticket_counters (workspace_id, last_number)
  VALUES (NEW.workspace_id, 1)
  ON CONFLICT (workspace_id)
    DO UPDATE SET last_number = support_ticket_counters.last_number + 1
  RETURNING last_number INTO NEW.ticket_number;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_support_ticket_number ON support_tickets;
CREATE TRIGGER trg_support_ticket_number
  BEFORE INSERT ON support_tickets
  FOR EACH ROW
  EXECUTE FUNCTION assign_support_ticket_number();

-- Allow the two support notification types (the notifications.type CHECK
-- constraint would otherwise silently reject reply/assign notifications).
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (
  type = ANY (ARRAY[
    'task_assigned','task_updated','task_completed','task_commented','task_due_soon',
    'mention','message_mention','dm_received','reaction_added',
    'lms_assigned','lms_updated','lms_shared','lms_review_requested','lms_review_decided','lms_comment',
    'meeting_invited','meeting_suggestion','meeting_suggestion_resolved','meeting_confirmed','meeting_cancelled',
    'support_ticket_reply','support_ticket_assigned'
  ]::text[])
);

-- The management module, exposed to non-admins as a shareable mini app. Every
-- /support triage endpoint is gated by requireMiniAppOrAdmin('support').
-- Visible to nobody until an admin grants access via Access Control.
INSERT INTO mini_apps (slug, name, description, icon, is_enabled)
VALUES (
  'support',
  'Support Tickets',
  'Triage the workspace help desk: view all tickets, claim or auto-assign by category, reply in the thread, and close.',
  'lifebuoy',
  true
)
ON CONFLICT DO NOTHING;
