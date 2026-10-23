-- ============================================================
-- Daily Check-In System
-- ============================================================

-- Check-in configuration per role (checklist items)
CREATE TABLE IF NOT EXISTS checkin_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  items JSONB NOT NULL DEFAULT '[]',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(role_id)
);

-- Individual check-in records
CREATE TABLE IF NOT EXISTS checkins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  submitted_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'no_checkin' CHECK (status IN ('on_time', 'late', 'no_checkin')),
  completed_items JSONB NOT NULL DEFAULT '[]',
  role_id UUID REFERENCES roles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, date)
);

-- Holidays
CREATE TABLE IF NOT EXISTS holidays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  date DATE,
  is_recurring BOOLEAN NOT NULL DEFAULT false,
  recurring_month INTEGER CHECK (recurring_month >= 1 AND recurring_month <= 12),
  recurring_day INTEGER CHECK (recurring_day >= 1 AND recurring_day <= 31),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- User check-in settings (deadline time per user)
CREATE TABLE IF NOT EXISTS user_checkin_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  deadline_time TEXT NOT NULL DEFAULT '10:00',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

-- Working days configuration (global)
CREATE TABLE IF NOT EXISTS working_days_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  working_days JSONB NOT NULL DEFAULT '[1, 2, 3, 4, 5, 6]',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed default working days config (Mon-Sat, Sunday off)
INSERT INTO working_days_config (working_days)
VALUES ('[1, 2, 3, 4, 5, 6]')
ON CONFLICT DO NOTHING;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_checkins_user_date ON checkins(user_id, date);
CREATE INDEX IF NOT EXISTS idx_checkins_date ON checkins(date);
CREATE INDEX IF NOT EXISTS idx_checkins_status ON checkins(status);
CREATE INDEX IF NOT EXISTS idx_holidays_date ON holidays(date);
CREATE INDEX IF NOT EXISTS idx_holidays_recurring ON holidays(is_recurring);
