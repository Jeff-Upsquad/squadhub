-- Partner-app high-attention notifications need a response that is separate
-- from the initial accept/reject on an opportunity. A shortlist asks whether
-- the talent is still ready; a final selection asks them to confirm the work.
CREATE TABLE IF NOT EXISTS partner_opportunity_notification_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id TEXT NOT NULL,
  card_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('shortlist', 'selection')),
  action TEXT NOT NULL CHECK (action IN ('confirm', 'decline')),
  responded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, recipient_id, kind)
);

CREATE INDEX IF NOT EXISTS idx_partner_opportunity_notification_responses_user
  ON partner_opportunity_notification_responses(user_id, responded_at DESC);

ALTER TABLE partner_opportunity_notification_responses ENABLE ROW LEVEL SECURITY;

-- Reads/writes go through the authenticated server and its service role. Keep
-- the table closed to direct browser access, like the canonical opportunity
-- proxy itself.
