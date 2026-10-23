-- Partner payment workflow status — THE single source of truth.
--
-- The payout AMOUNTS are computed live from subscription_assignment_terms +
-- subscription_cards and never stored. What *is* stored is the workflow status
-- of each (month, recipient) payout: not processed → processing → paid, or on
-- hold with an internal reason.
--
-- This used to live only in the SquadBooks project's own database, so the
-- SquadHub admin module had no status at all and the partner mini app showed a
-- hardcoded "pending" for every month — including months already paid. The
-- table now lives here, in the same database as the terms it describes, and
-- SquadBooks reads/writes it over the integration API.
--
-- hold_reason is INTERNAL: it is written by staff and must never be returned to
-- a partner-facing surface (see routes/partner-payments-miniapp.ts, which maps
-- on_hold down to "pending" and never selects this column).
CREATE TABLE IF NOT EXISTS partner_payment_statuses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  month TEXT NOT NULL CHECK (month ~ '^[0-9]{4}-[0-9]{2}$'),
  recipient_type TEXT NOT NULL CHECK (recipient_type IN ('talent', 'partner')),
  -- Not an FK: talent recipients are SquadHire (Profiles) users, who have no
  -- row in this database's users table.
  recipient_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'not_processed'
    CHECK (status IN ('not_processed', 'processing', 'paid', 'on_hold')),
  hold_reason TEXT,
  -- Which app last wrote the row, for audit when the two disagree.
  updated_source TEXT NOT NULL DEFAULT 'hub' CHECK (updated_source IN ('hub', 'squadbooks')),
  -- SquadHub user when written from the admin module; NULL when written from
  -- SquadBooks (whose user ids live in a different database).
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (month, recipient_type, recipient_id)
);

CREATE INDEX IF NOT EXISTS idx_partner_payment_statuses_month
  ON partner_payment_statuses (month);

-- Server-only table: reached through the Express API with the service role, never
-- from anon/authenticated (see 20260922235959_explicit_data_api_grants).
ALTER TABLE partner_payment_statuses ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE partner_payment_statuses TO service_role;

-- Carry over the rows SquadBooks had already recorded in its own project
-- (vixqnjrsihawsjlatfew.partner_payment_statuses) so no held payment silently
-- reverts to "not processed" at cutover. Its org_id/created_by are SquadBooks
-- identifiers with no meaning here, so they are dropped.
INSERT INTO partner_payment_statuses
  (month, recipient_type, recipient_id, status, hold_reason, updated_source, created_at, updated_at)
VALUES
  ('2026-04', 'talent', '483f78a6-2cab-4d1c-9bbb-645983677f0e', 'on_hold', 'Policy violations',
   'squadbooks', '2026-09-10 04:36:44.096023+00', '2026-09-10 04:36:44.096023+00'),
  ('2026-05', 'talent', '483f78a6-2cab-4d1c-9bbb-645983677f0e', 'on_hold', 'Policy violations',
   'squadbooks', '2026-09-10 04:37:42.263052+00', '2026-09-10 04:37:42.263052+00')
ON CONFLICT (month, recipient_type, recipient_id) DO NOTHING;
