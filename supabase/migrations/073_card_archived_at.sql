-- ============================================================
-- Archived cards
--   archived_at is a soft-hide flag orthogonal to state. Any card
--   (draft, published, assigned, closed) can be archived; it
--   disappears from the default Published Cards list and from
--   talent feeds, and surfaces only in the dedicated Archive tab.
--   From there sales can either Republish (state='published',
--   distribution='manual', clean recipients) or Delete permanently
--   (DELETE → recipients + secondaries cascade).
-- ============================================================

ALTER TABLE subscription_cards
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_subscription_cards_archived
  ON subscription_cards(archived_at)
  WHERE archived_at IS NOT NULL;
