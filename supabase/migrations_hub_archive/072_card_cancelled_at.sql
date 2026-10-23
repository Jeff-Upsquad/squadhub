-- ============================================================
-- Cancelled cards
--   Distinct from recall: cancel is always terminal (no draft
--   return path). Acceptees keep seeing the card with a red
--   "Cancelled" tag; pending recipients are dropped just like
--   recall. recalled_at and cancelled_at can theoretically
--   coexist on a single closed card, but the cancel endpoint
--   only accepts state='published' so that path doesn't
--   normally happen.
-- ============================================================

ALTER TABLE subscription_cards
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_subscription_cards_cancelled
  ON subscription_cards(cancelled_at)
  WHERE cancelled_at IS NOT NULL;
