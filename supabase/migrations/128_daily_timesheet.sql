-- Daily Timesheet
-- End-of-day report submitted inside the Daily Check-In module: users review the
-- tasks they completed, report progress against per-user/per-client targets, and
-- see their tracked office hours. Missed days can be backfilled later as "late".
--
-- Two tables:
--   timesheet_targets — admin-set, per-user/per-client day/week/month targets.
--   timesheets        — one submission per user per date (IST), with a JSONB
--                       progress snapshot so historical sheets are immune to
--                       later target changes.
-- Gating reuses the existing 'check-ins' mini app (admin endpoints) and the same
-- user-type scope as the check-in routes (user endpoints). Server uses
-- supabaseAdmin, so no RLS policies are required here.

-- ============================================================
-- timesheet_targets — per-user, per-client targets
-- ============================================================
CREATE TABLE IF NOT EXISTS timesheet_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('hours', 'item')),
  label TEXT NOT NULL DEFAULT '',
  per_day NUMERIC NOT NULL DEFAULT 0,
  per_week NUMERIC NOT NULL DEFAULT 0,
  per_month NUMERIC NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, client_id, kind)
);

CREATE INDEX IF NOT EXISTS idx_timesheet_targets_user ON timesheet_targets(user_id);
CREATE INDEX IF NOT EXISTS idx_timesheet_targets_client ON timesheet_targets(client_id);

-- ============================================================
-- timesheets — one daily submission per user
-- ============================================================
CREATE TABLE IF NOT EXISTS timesheets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date DATE NOT NULL,                         -- the day the sheet is FOR (IST)
  submitted_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'no_submission'
    CHECK (status IN ('on_time', 'late', 'no_submission')),
  summary TEXT NOT NULL DEFAULT '',
  tracked_work_seconds INTEGER NOT NULL DEFAULT 0,
  office_hours_total_seconds INTEGER NOT NULL DEFAULT 0,
  completed_task_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Snapshot array of progress lines:
  --   { client_id, client_name, kind, label,
  --     target_day, target_week, target_month,
  --     achieved_day, achieved_week, achieved_month, auto_day }
  progress JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, date)
);

CREATE INDEX IF NOT EXISTS idx_timesheets_user_date ON timesheets(user_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_timesheets_date ON timesheets(date);
CREATE INDEX IF NOT EXISTS idx_timesheets_status ON timesheets(status);
