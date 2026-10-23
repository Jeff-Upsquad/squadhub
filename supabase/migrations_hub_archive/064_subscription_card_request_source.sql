-- ============================================================
-- Subscription Cards: request-sourced and custom card support
-- Adds source tracking, proposed_price + markup pricing,
-- explicit publish targets, and customer info fields.
-- ============================================================

-- Source discriminator: where did this card originate?
ALTER TABLE subscription_cards
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'submission';

-- upsquad subscription_request ID (integer, not UUID)
ALTER TABLE subscription_cards
  ADD COLUMN IF NOT EXISTS subscription_request_id INTEGER;

-- Customer's proposed monthly price (INR)
ALTER TABLE subscription_cards
  ADD COLUMN IF NOT EXISTS proposed_price INTEGER;

-- Admin markup (INR/month, absolute)
ALTER TABLE subscription_cards
  ADD COLUMN IF NOT EXISTS markup INTEGER NOT NULL DEFAULT 0;

-- Explicit publish targeting (who sees the card)
ALTER TABLE subscription_cards
  ADD COLUMN IF NOT EXISTS publish_targets TEXT[] NOT NULL DEFAULT '{partner,talent}';

-- Customer info (for cards without a client_submission)
ALTER TABLE subscription_cards
  ADD COLUMN IF NOT EXISTS customer_name TEXT;

ALTER TABLE subscription_cards
  ADD COLUMN IF NOT EXISTS customer_email TEXT;

ALTER TABLE subscription_cards
  ADD COLUMN IF NOT EXISTS customer_company TEXT;

ALTER TABLE subscription_cards
  ADD COLUMN IF NOT EXISTS customer_phone TEXT;

-- Service metadata from request
ALTER TABLE subscription_cards
  ADD COLUMN IF NOT EXISTS service_type TEXT;

ALTER TABLE subscription_cards
  ADD COLUMN IF NOT EXISTS plan_name TEXT;

-- Constraints
ALTER TABLE subscription_cards
  ADD CONSTRAINT chk_source CHECK (source IN ('submission', 'request', 'custom'));

ALTER TABLE subscription_cards
  ADD CONSTRAINT chk_proposed_price CHECK (proposed_price IS NULL OR proposed_price > 0);

ALTER TABLE subscription_cards
  ADD CONSTRAINT chk_markup CHECK (markup >= 0);

-- Index for looking up cards by upsquad request ID
CREATE INDEX IF NOT EXISTS idx_subscription_cards_request_id
  ON subscription_cards(subscription_request_id)
  WHERE subscription_request_id IS NOT NULL;
