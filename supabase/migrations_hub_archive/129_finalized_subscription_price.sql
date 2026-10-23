-- ============================================================
-- Finalized subscription price + plan-margin fallback
-- ============================================================
-- Pricing model:
--   Plan price       — catalog minimum (subscription_plan_pricing.price)
--   Proposed price   — what the client asked for in the brief (proposed_price)
--   Subscription price — the FINALIZED monthly price the client pays (new)
-- Margin:
--   Plan margin      — catalog default (subscription_plan_pricing.margin_value)
--   Adjusted margin  — per-card override; markup now means this
--   Final margin     = adjusted (markup) if set, else the plan margin
-- Partner price = finalized price - final margin, or partner_price_override.
-- ============================================================

-- Finalized monthly client price (INR). NULL = not finalized yet; callers
-- fall back to proposed_price.
ALTER TABLE subscription_cards
  ADD COLUMN IF NOT EXISTS subscription_price INTEGER
    CHECK (subscription_price IS NULL OR subscription_price > 0);

COMMENT ON COLUMN subscription_cards.subscription_price IS
  'Finalized monthly price the client pays (INR). NULL = not finalized; falls back to proposed_price.';

-- markup becomes the "adjusted margin": NULL = inherit the plan catalog
-- margin; a value = explicit per-card override. Existing rows keep their
-- current 0 (zero margin) so no already-published card is silently re-priced.
ALTER TABLE subscription_cards
  ALTER COLUMN markup DROP NOT NULL,
  ALTER COLUMN markup DROP DEFAULT;

COMMENT ON COLUMN subscription_cards.markup IS
  'Adjusted margin (INR/month). NULL = use the plan catalog margin; a value overrides it. Partner price = finalized price - final margin.';
