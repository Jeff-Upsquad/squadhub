-- 105_subscription_card_recipient_rounds.sql
-- Archive previous rounds of responders when a card is reopened. archived_at is
-- stamped on the current recipients at reopen time; the admin recipients view +
-- counts and the assign/finalize selection queries filter to archived_at IS NULL
-- (the current round). Rows are kept for history (status preserved).
ALTER TABLE subscription_card_recipients
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE subscription_card_external_recipients
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_scr_card_current
  ON subscription_card_recipients(card_id) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_scer_card_current
  ON subscription_card_external_recipients(card_id) WHERE archived_at IS NULL;
