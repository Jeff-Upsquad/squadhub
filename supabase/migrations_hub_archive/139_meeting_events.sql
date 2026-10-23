-- ============================================================
-- 139: Meeting / Event scheduler
--
-- A vote-driven meeting scheduler surfaced BOTH as a gated mini app
-- ('meetings') and as an interactive poll card inside chat. A creator
-- proposes one or more dates — each optionally carrying multiple time
-- slots — and guests vote Yes/No/Maybe per slot or Suggest an alternate.
-- Once agreed, the host confirms a single slot.
--
-- Kept deliberately separate from the legacy minimal `meetings` table
-- (112), which powers the simple Home "Meetings" card. This is a new,
-- richer table family. Like the rest of the feature tables, server
-- routes use supabaseAdmin behind requireAuth — no app-level RLS
-- (consistent with 112_meetings.sql / 097_task_recurrence.sql).
-- ============================================================

-- ------------------------------------------------------------
-- Root record
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS meeting_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title        text NOT NULL,
  kind         text NOT NULL DEFAULT 'virtual'
                 CHECK (kind IN ('virtual', 'in_person', 'event')),
  agenda       text,
  -- NULL duration => a "dates only" meeting (no time slots, no overlay times).
  duration_min int,
  -- Meeting-local timezone; slot_date + start_min are interpreted in it.
  timezone     text NOT NULL DEFAULT 'Asia/Kolkata',
  status       text NOT NULL DEFAULT 'open'
                 CHECK (status IN ('open', 'confirmed', 'cancelled')),
  -- Auto-generated video link (virtual only). link_url renders even if the
  -- provider later becomes unconfigured — we never re-resolve it at read time.
  link_provider text CHECK (link_provider IN ('jitsi', 'google_meet', 'zoom')),
  link_url      text,
  link_meta     jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Where the meeting was created from (context for @all + posting the card).
  origin_channel_id         uuid,
  origin_dm_conversation_id uuid,
  -- Set when the host locks a slot. FK added after the slots table exists.
  confirmed_slot_id uuid,
  created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_meeting_events_created_by ON meeting_events (created_by);
CREATE INDEX IF NOT EXISTS idx_meeting_events_status ON meeting_events (status);
CREATE INDEX IF NOT EXISTS idx_meeting_events_origin_channel
  ON meeting_events (origin_channel_id) WHERE origin_channel_id IS NOT NULL;

-- ------------------------------------------------------------
-- Proposed dates and (optional) time slots. One table serves both
-- "dates only" (start_min NULL) and "dates with times" (one row per slot).
-- Suggestions live here too (is_suggestion = true) and, once accepted,
-- become ordinary votable slots.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS meeting_event_slots (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_event_id uuid NOT NULL REFERENCES meeting_events(id) ON DELETE CASCADE,
  slot_date        date NOT NULL,
  start_min        int,  -- minute-of-day 0..1439; NULL => dates-only
  end_min          int,
  is_suggestion    boolean NOT NULL DEFAULT false,
  suggested_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  suggestion_status text CHECK (suggestion_status IN ('pending', 'accepted', 'rejected')),
  sort_order       int NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_meeting_slots_event ON meeting_event_slots (meeting_event_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_meeting_slots_suggestion
  ON meeting_event_slots (meeting_event_id) WHERE is_suggestion;

-- Now wire the confirmed-slot FK (deferred to avoid the circular create).
ALTER TABLE meeting_events
  ADD CONSTRAINT meeting_events_confirmed_slot_fk
  FOREIGN KEY (confirmed_slot_id) REFERENCES meeting_event_slots(id) ON DELETE SET NULL;

-- ------------------------------------------------------------
-- Guests (invitees). `responded` flips true on a guest's first vote and
-- powers the per-guest availability dot + the right-side summary message.
-- The creator is also inserted here with role 'host'.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS meeting_event_guests (
  meeting_event_id uuid NOT NULL REFERENCES meeting_events(id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role             text NOT NULL DEFAULT 'guest' CHECK (role IN ('host', 'guest')),
  responded        boolean NOT NULL DEFAULT false,
  invited_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (meeting_event_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_meeting_guests_user ON meeting_event_guests (user_id);

-- ------------------------------------------------------------
-- Yes / No / Maybe votes — one row per (slot, user); re-voting upserts.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS meeting_slot_votes (
  slot_id    uuid NOT NULL REFERENCES meeting_event_slots(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vote       text NOT NULL CHECK (vote IN ('yes', 'no', 'maybe')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (slot_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_meeting_votes_slot ON meeting_slot_votes (slot_id);

-- ------------------------------------------------------------
-- Confirm / reject responses to a suggested slot. Kept distinct from
-- preference votes; drives the suggestion's suggestion_status.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS meeting_suggestion_responses (
  slot_id    uuid NOT NULL REFERENCES meeting_event_slots(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  response   text NOT NULL CHECK (response IN ('confirm', 'reject')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (slot_id, user_id)
);

-- ------------------------------------------------------------
-- Attachments (uploaded via the existing R2 presign flow).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS meeting_event_attachments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_event_id uuid NOT NULL REFERENCES meeting_events(id) ON DELETE CASCADE,
  file_url         text NOT NULL,
  file_name        text,
  file_size        bigint,
  file_mime        text,
  uploaded_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  uploaded_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_meeting_attachments_event ON meeting_event_attachments (meeting_event_id);

-- ------------------------------------------------------------
-- Chat link: a meeting card is a normal message carrying a reverse
-- reference. MessageBubble renders the card when this is set. This avoids
-- touching the messages.type CHECK constraint / MessageType union.
-- ------------------------------------------------------------
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS meeting_event_id uuid REFERENCES meeting_events(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_messages_meeting_event
  ON messages (meeting_event_id) WHERE meeting_event_id IS NOT NULL;

-- ------------------------------------------------------------
-- Notification types. Re-add the CHECK with the existing values plus the
-- new meeting_* types (the live constraint already carries values beyond
-- migration 030 — task_completed / lms_*; preserve them all).
-- ------------------------------------------------------------
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'task_assigned', 'task_updated', 'task_completed', 'task_commented',
    'task_due_soon', 'mention', 'message_mention', 'dm_received',
    'reaction_added', 'lms_assigned', 'lms_updated',
    'meeting_invited', 'meeting_suggestion', 'meeting_suggestion_resolved',
    'meeting_confirmed', 'meeting_cancelled'
  ));

-- ------------------------------------------------------------
-- Mini app registration. Visible to nobody until an admin grants access
-- via Access Control (mirrors 124_candidates_mini_app.sql).
-- ------------------------------------------------------------
INSERT INTO mini_apps (slug, name, description, icon, is_enabled)
VALUES (
  'meetings',
  'Meetings',
  'Schedule meetings & events: propose dates and time slots, vote on availability, and auto-generate meeting links.',
  'calendar-days',
  true
)
ON CONFLICT DO NOTHING;
