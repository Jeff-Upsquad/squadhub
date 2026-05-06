-- Off Day Requests: users submit half-day / full-day / long-term leave for admin approval

CREATE TABLE IF NOT EXISTS off_day_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_type TEXT NOT NULL CHECK (request_type IN ('half_day', 'full_day', 'long_term')),
  date DATE,
  start_date DATE,
  end_date DATE,
  reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chk_date_fields CHECK (
    (request_type IN ('half_day', 'full_day') AND date IS NOT NULL)
    OR
    (request_type = 'long_term' AND start_date IS NOT NULL AND end_date IS NOT NULL AND end_date >= start_date)
  )
);

CREATE INDEX idx_off_day_requests_user ON off_day_requests(user_id);
CREATE INDEX idx_off_day_requests_status ON off_day_requests(status);
CREATE INDEX idx_off_day_requests_date ON off_day_requests(date);
