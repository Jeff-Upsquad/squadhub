-- ============================================================
-- 011: Time Tracking (timer sessions + daily summaries)
-- ============================================================

-- Timer sessions (individual start/stop records)
CREATE TABLE timer_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  timer_type TEXT NOT NULL CHECK (timer_type IN ('work', 'break', 'no_work')),
  start_time TIMESTAMPTZ NOT NULL DEFAULT now(),
  end_time TIMESTAMPTZ,
  duration_seconds INTEGER,
  is_auto_stopped BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_timer_sessions_user_date ON timer_sessions(user_id, date);
CREATE INDEX idx_timer_sessions_active ON timer_sessions(user_id) WHERE end_time IS NULL;

-- Daily aggregated summaries
CREATE TABLE daily_time_summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  total_work_seconds INTEGER NOT NULL DEFAULT 0,
  total_break_seconds INTEGER NOT NULL DEFAULT 0,
  total_no_work_seconds INTEGER NOT NULL DEFAULT 0,
  session_count INTEGER NOT NULL DEFAULT 0,
  first_start TIMESTAMPTZ,
  last_stop TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, date)
);

CREATE INDEX idx_daily_time_summaries_user_date ON daily_time_summaries(user_id, date);
CREATE INDEX idx_daily_time_summaries_date ON daily_time_summaries(date);

-- Enable RLS
ALTER TABLE timer_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_time_summaries ENABLE ROW LEVEL SECURITY;

-- RLS policies (service role bypasses, these are for anon/authenticated)
CREATE POLICY "Users can view own timer sessions"
  ON timer_sessions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own timer sessions"
  ON timer_sessions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own timer sessions"
  ON timer_sessions FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can view own daily summaries"
  ON daily_time_summaries FOR SELECT
  USING (auth.uid() = user_id);

-- Register time-management mini app
INSERT INTO mini_apps (slug, name, description, icon, is_enabled)
VALUES ('time-management', 'Time Management', 'Team-wide time tracking dashboard for managers', 'clock', true);
