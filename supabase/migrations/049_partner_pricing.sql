-- Migration: 049_partner_pricing
-- Description: Add a parallel "partner price" dimension to the subscription
-- pricing model. The existing `subscription_plan_pricing` column represents
-- what the CUSTOMER pays us; this migration adds the matching PARTNER price
-- (what we pay the partner), defaulted per plan × country and optionally
-- overridden per subscription card. Gross profit = customer − partner.
--
-- Shape mirrors subscription_plan_pricing exactly so server/admin code
-- patterns copy 1:1. The per-card override is a nullable scalar — null means
-- "use the plan default for the card's country".

-- ------------------------------------------------------------
-- subscription_plan_partner_pricing: default partner rate per plan × country
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS subscription_plan_partner_pricing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES subscription_plans(id) ON DELETE CASCADE,
  country_id UUID NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
  price INTEGER NOT NULL CHECK (price >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (plan_id, country_id)
);

CREATE INDEX IF NOT EXISTS idx_sp_partner_pricing_plan
  ON subscription_plan_partner_pricing (plan_id);
CREATE INDEX IF NOT EXISTS idx_sp_partner_pricing_country
  ON subscription_plan_partner_pricing (country_id);

DROP TRIGGER IF EXISTS trg_sp_partner_pricing_updated_at ON subscription_plan_partner_pricing;
CREATE TRIGGER trg_sp_partner_pricing_updated_at
  BEFORE UPDATE ON subscription_plan_partner_pricing
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ------------------------------------------------------------
-- subscription_cards.partner_price_override: per-card override of the default
-- ------------------------------------------------------------
ALTER TABLE subscription_cards
  ADD COLUMN IF NOT EXISTS partner_price_override INTEGER
    CHECK (partner_price_override IS NULL OR partner_price_override >= 0);

COMMENT ON COLUMN subscription_cards.partner_price_override IS
  'Per-card override for the partner price. NULL = use subscription_plan_partner_pricing for the card''s target country.';
