-- ============================================================
-- 112: Meetings
--
-- A lightweight meeting record powering the Home "Meetings" secondary
-- card. The card surfaces the current user's meetings (where they are the
-- creator OR listed in attendee_ids) that are still 'scheduled' and whose
-- scheduled_at is today or overdue in the caller's timezone. A meeting
-- drops off once it is marked 'done' or 'cancelled'.
--
-- This is intentionally minimal — no invites, recurrence, or calendar UI.
-- Server routes (server/src/routes/meetings.ts) use supabaseAdmin behind
-- requireAuth, matching the rest of the API; no app-level RLS (consistent
-- with 097_task_recurrence.sql and the other feature tables).
-- ============================================================

CREATE TABLE IF NOT EXISTS meetings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  scheduled_at timestamptz NOT NULL,
  duration_min int NOT NULL DEFAULT 30,
  location text,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'done', 'cancelled')),
  attendee_ids uuid[] NOT NULL DEFAULT '{}',
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_meetings_scheduled_at ON meetings (scheduled_at);
CREATE INDEX IF NOT EXISTS idx_meetings_created_by ON meetings (created_by);
CREATE INDEX IF NOT EXISTS idx_meetings_attendees ON meetings USING GIN (attendee_ids);
