-- ============================================================
-- Recalled cards
--   Recall used to be blocked when partners had accepted.
--   Now admins can recall with acceptances; the card stays
--   visible (with a "Recalled" tag) to anyone who already
--   accepted/rejected, while pending recipients are dropped.
-- ============================================================

ALTER TABLE subscription_cards
  ADD COLUMN IF NOT EXISTS recalled_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_subscription_cards_recalled
  ON subscription_cards(recalled_at)
  WHERE recalled_at IS NOT NULL;
