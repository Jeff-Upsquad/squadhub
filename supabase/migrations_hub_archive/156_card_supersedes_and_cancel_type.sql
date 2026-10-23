-- Upgrade/downgrade = soft-cancel the old card + create a NEW card that supersedes it.
-- supersedes_card_id chains the new card back to the one it replaced, so Reports +
-- assignment-history can walk the chain for a continuous timeline / full previous-
-- assignee list across the plan change. cancel_type tags WHY a card was closed.
ALTER TABLE subscription_cards
  ADD COLUMN IF NOT EXISTS supersedes_card_id UUID REFERENCES subscription_cards(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cancel_type TEXT;

COMMENT ON COLUMN subscription_cards.supersedes_card_id IS 'Upgrade/downgrade: the older card this one replaces. Reports + assignment-history walk the chain.';
COMMENT ON COLUMN subscription_cards.cancel_type IS 'Why the card closed: NULL/hard = normal cancel; soft = replaced by an upgrade/downgrade card.';

CREATE INDEX IF NOT EXISTS idx_subscription_cards_supersedes
  ON subscription_cards(supersedes_card_id) WHERE supersedes_card_id IS NOT NULL;
