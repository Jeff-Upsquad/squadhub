-- ============================================================
-- Top Talents tier rename — Phase 3 (drop legacy 'Elite')
--
-- Re-creates every tier-value CHECK constraint WITHOUT 'Elite', now
-- that Phase 2 has backfilled all data and the application no longer
-- writes or accepts 'Elite'. Apply LAST — only after the Phase-3
-- application code (which stops producing 'Elite') is live in prod.
--
-- Applied to production via the Supabase MCP (deploy.sh does not run
-- migrations). Idempotent: DROP IF EXISTS + ADD under stable names.
-- ============================================================

ALTER TABLE subscription_plans DROP CONSTRAINT IF EXISTS subscription_plans_tier_check;
ALTER TABLE subscription_plans
  ADD CONSTRAINT subscription_plans_tier_check
  CHECK (tier IN ('Junior', 'Pro', 'Top Talents'));

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_tier_check;
ALTER TABLE users
  ADD CONSTRAINT users_tier_check
  CHECK (tier IS NULL OR tier IN ('Junior', 'Pro', 'Top Talents', 'Custom'));

ALTER TABLE subscription_cards DROP CONSTRAINT IF EXISTS subscription_cards_target_tiers_valid;
ALTER TABLE subscription_cards
  ADD CONSTRAINT subscription_cards_target_tiers_valid
  CHECK (target_tiers <@ ARRAY['Junior','Pro','Top Talents','Custom']::text[]);

ALTER TABLE client_submission_brands DROP CONSTRAINT IF EXISTS client_submission_brands_target_tiers_check;
ALTER TABLE client_submission_brands
  ADD CONSTRAINT client_submission_brands_target_tiers_check
  CHECK (target_tiers <@ ARRAY['Junior','Pro','Top Talents','Custom']::text[]);
