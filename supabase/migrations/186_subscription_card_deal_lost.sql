-- Deal Lost — a sales outcome tag on subscription/assignment cards.
--
-- "Mark as deal lost" (card detail view) closes the card through the normal
-- cancel path when it is still live, then stamps deal_lost_at so the card
-- files under the admin pipeline's "Deal Lost" tab instead of "Cancelled".
-- Clearing the flag moves it back to Cancelled (a closed card never
-- resurrects); republish wipes the flag along with the other lifecycle
-- timestamps.
ALTER TABLE subscription_cards
  ADD COLUMN IF NOT EXISTS deal_lost_at TIMESTAMPTZ;

COMMENT ON COLUMN subscription_cards.deal_lost_at IS 'Sales outcome: set when an admin marks the deal lost. The card shows under Deal Lost instead of Cancelled. NULL = not marked.';

CREATE INDEX IF NOT EXISTS idx_subscription_cards_deal_lost
  ON subscription_cards(deal_lost_at)
  WHERE deal_lost_at IS NOT NULL;
