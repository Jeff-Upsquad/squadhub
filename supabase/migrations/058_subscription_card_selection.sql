-- 058: Subscription Card Selection
--
-- After multiple partners/talents accept a subscription card, an admin
-- selects one. Selection is recorded on the recipient row and the card
-- auto-closes.

-- Partners: selection fields on subscription_card_recipients
ALTER TABLE subscription_card_recipients
  ADD COLUMN IF NOT EXISTS selected_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS selected_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS passed_over_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_scr_selected
  ON subscription_card_recipients(card_id)
  WHERE selected_at IS NOT NULL;

-- Talents (SquadHire-sourced): selection fields on subscription_card_external_recipients
ALTER TABLE subscription_card_external_recipients
  ADD COLUMN IF NOT EXISTS selected_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS selected_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS passed_over_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_scer_selected
  ON subscription_card_external_recipients(card_id)
  WHERE selected_at IS NOT NULL;

-- Card-level denormalized pointer for quick lookups without scanning
-- both recipient tables. Nullable = no selection yet.
ALTER TABLE subscription_cards
  ADD COLUMN IF NOT EXISTS selected_recipient_type TEXT
    CHECK (selected_recipient_type IN ('partner', 'talent')),
  ADD COLUMN IF NOT EXISTS selected_recipient_id TEXT;
