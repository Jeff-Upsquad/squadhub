-- ============================================================
-- Secondary Published Cards
--   Allow creating secondary cards linked to a primary card.
--   Secondary cards inherit content from the parent but can have
--   their own partner_price_override, distribution, and recipients.
-- ============================================================

-- Secondary cards have submission_subscription_id = NULL (inherited from parent).
ALTER TABLE subscription_cards
  ALTER COLUMN submission_subscription_id DROP NOT NULL;

-- Link secondary → primary card.
ALTER TABLE subscription_cards
  ADD COLUMN IF NOT EXISTS parent_card_id UUID
    REFERENCES subscription_cards(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_subscription_cards_parent
  ON subscription_cards(parent_card_id)
  WHERE parent_card_id IS NOT NULL;
