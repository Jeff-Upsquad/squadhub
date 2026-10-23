ALTER TABLE subscription_cards
  ADD COLUMN card_code TEXT UNIQUE,
  ADD COLUMN linked_folder_id UUID REFERENCES folders(id) ON DELETE SET NULL,
  ADD COLUMN linked_at TIMESTAMPTZ;

CREATE INDEX idx_subscription_cards_card_code ON subscription_cards(card_code);
