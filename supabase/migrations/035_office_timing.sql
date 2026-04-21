-- ============================================================
-- 035: Per-user Office Timing
-- ============================================================
-- Per-user office timing configuration. Drives the check-in on-time
-- cutoff and the time-tracking progress bar denominator. Intended
-- for users with user_type in ('internal', 'partner'); scope is
-- enforced at the application layer in the admin route.

CREATE TABLE IF NOT EXISTS user_office_timing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  from_time TEXT NOT NULL,
  to_time TEXT NOT NULL,
  working_days JSONB NOT NULL DEFAULT '[1, 2, 3, 4, 5, 6]',
  max_break_minutes INTEGER NOT NULL DEFAULT 60,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id),
  CONSTRAINT user_office_timing_from_format CHECK (from_time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  CONSTRAINT user_office_timing_to_format CHECK (to_time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  CONSTRAINT user_office_timing_range CHECK (from_time < to_time),
  CONSTRAINT user_office_timing_label_len CHECK (char_length(label) BETWEEN 1 AND 80),
  CONSTRAINT user_office_timing_break_bounds CHECK (max_break_minutes BETWEEN 0 AND 720)
);

CREATE INDEX IF NOT EXISTS idx_user_office_timing_user ON user_office_timing(user_id);

-- Reuse the shared updated_at trigger defined in migration 024.
DROP TRIGGER IF EXISTS trg_user_office_timing_updated_at ON user_office_timing;
CREATE TRIGGER trg_user_office_timing_updated_at
  BEFORE UPDATE ON user_office_timing
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE user_office_timing ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own office timing" ON user_office_timing;
CREATE POLICY "Users can view own office timing"
  ON user_office_timing FOR SELECT
  USING (auth.uid() = user_id);
