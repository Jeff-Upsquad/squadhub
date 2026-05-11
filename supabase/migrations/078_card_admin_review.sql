-- 078: Admin review tracking for assigned cards
--
-- When a card is finalised (selected_recipient_id set by admin / business / webhook)
-- the admin should see a "NEW" badge until they review it. This column tracks
-- the review state and a BEFORE-UPDATE trigger resets it any time the final
-- recipient changes, regardless of which code path made the change.

ALTER TABLE subscription_cards
  ADD COLUMN IF NOT EXISTS admin_reviewed_at TIMESTAMPTZ NULL;

CREATE OR REPLACE FUNCTION subscription_cards_reset_review_on_selection()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.selected_recipient_id IS DISTINCT FROM OLD.selected_recipient_id
     AND NEW.selected_recipient_id IS NOT NULL THEN
    NEW.admin_reviewed_at := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_subscription_cards_reset_review ON subscription_cards;
CREATE TRIGGER trg_subscription_cards_reset_review
  BEFORE UPDATE ON subscription_cards
  FOR EACH ROW EXECUTE FUNCTION subscription_cards_reset_review_on_selection();

CREATE INDEX IF NOT EXISTS idx_subscription_cards_unreviewed
  ON subscription_cards(admin_reviewed_at)
  WHERE selected_recipient_id IS NOT NULL AND admin_reviewed_at IS NULL;
