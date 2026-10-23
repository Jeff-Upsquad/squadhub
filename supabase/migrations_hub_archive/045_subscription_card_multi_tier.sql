-- ============================================================
-- Subscription Card: multi-tier targeting
-- target_tier (single) → target_tiers (array). Empty = any tier.
-- Safe to re-run; idempotent on schema, non-destructive on data since
-- nothing has created a published card yet.
-- ============================================================

ALTER TABLE subscription_cards
  ADD COLUMN IF NOT EXISTS target_tiers TEXT[] NOT NULL DEFAULT '{}';

-- Carry any existing single-value target_tier into the array, then drop.
UPDATE subscription_cards
  SET target_tiers = ARRAY[target_tier]
  WHERE target_tier IS NOT NULL AND cardinality(target_tiers) = 0;

ALTER TABLE subscription_cards
  DROP COLUMN IF EXISTS target_tier;

ALTER TABLE subscription_cards
  ADD CONSTRAINT subscription_cards_target_tiers_valid
  CHECK (target_tiers <@ ARRAY['Junior','Pro','Elite','Custom']::text[]);
