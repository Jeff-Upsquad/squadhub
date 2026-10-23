-- ============================================================
-- Agencies delivery option — allow 'Agencies' alongside talent tiers
--
-- 'Agencies' is a delivery option, not a talent tier. It is forwarded
-- verbatim from the brief form (Profiles + /leads/landing) so it appears
-- on the requirement card alongside Junior/Pro/Top Talents/Custom.
-- Only the two target_tiers array CHECKs need widening — the talent
-- profile tier constraints (users.tier, subscription_plans.tier) stay
-- as-is because no talent has tier = 'Agencies'.
-- ============================================================

ALTER TABLE subscription_cards DROP CONSTRAINT IF EXISTS subscription_cards_target_tiers_valid;
ALTER TABLE subscription_cards
  ADD CONSTRAINT subscription_cards_target_tiers_valid
  CHECK (target_tiers <@ ARRAY['Junior','Pro','Top Talents','Custom','Agencies']::text[]);

ALTER TABLE client_submission_brands DROP CONSTRAINT IF EXISTS client_submission_brands_target_tiers_check;
ALTER TABLE client_submission_brands
  ADD CONSTRAINT client_submission_brands_target_tiers_check
  CHECK (target_tiers <@ ARRAY['Junior','Pro','Top Talents','Custom','Agencies']::text[]);
