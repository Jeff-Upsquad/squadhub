-- 070: Add 'assigned' state to subscription cards
--
-- Multi-select flow: admin selects multiple accepted recipients, then
-- finalises with "Assign". Card transitions published → assigned.

-- Widen the state CHECK to include 'assigned'.
ALTER TABLE subscription_cards
  DROP CONSTRAINT IF EXISTS subscription_cards_state_check;

ALTER TABLE subscription_cards
  ADD CONSTRAINT subscription_cards_state_check
    CHECK (state IN ('draft', 'published', 'assigned', 'closed'));

ALTER TABLE subscription_cards
  ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ;
