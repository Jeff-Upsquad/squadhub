-- 104_subscription_assignment_terms.sql
-- Per-talent subscription assignment terms. One row per assignment, so
-- reassigning a card creates a new row -> full history. assigned_date /
-- unassigned_date are captured automatically by the finalize / unassign flow;
-- work_start_date / work_end_date default to those but are admin-editable
-- (managed in the Subscription Assignments admin module).

CREATE TABLE IF NOT EXISTS subscription_assignment_terms (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id           UUID NOT NULL REFERENCES subscription_cards(id) ON DELETE CASCADE,
  recipient_type    TEXT NOT NULL CHECK (recipient_type IN ('talent', 'partner')),
  recipient_id      TEXT NOT NULL,
  recipient_name    TEXT,
  business_name     TEXT,
  subscription_name TEXT,
  assigned_date     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  unassigned_date   TIMESTAMPTZ,
  work_start_date   DATE,
  work_end_date     DATE,
  status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sat_card      ON subscription_assignment_terms(card_id);
CREATE INDEX IF NOT EXISTS idx_sat_status    ON subscription_assignment_terms(status, assigned_date DESC);
CREATE INDEX IF NOT EXISTS idx_sat_recipient ON subscription_assignment_terms(recipient_type, recipient_id);

-- Touched only by the server (service role) — enable RLS with no policies.
ALTER TABLE subscription_assignment_terms ENABLE ROW LEVEL SECURITY;
