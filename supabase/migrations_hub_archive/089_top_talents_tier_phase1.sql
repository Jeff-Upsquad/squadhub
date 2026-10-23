-- ============================================================
-- Top Talents tier rename — Phase 1 (read-tolerant widening)
--
-- Widens every tier-value CHECK constraint to ACCEPT the new
-- value 'Top Talents' alongside the legacy 'Elite'. No data is
-- rewritten in this migration — that happens in the Phase 2
-- backfill once the application has shipped Phase 1 code.
--
-- Affected constraints:
--   1. subscription_plans.tier              (Junior/Pro/Elite)
--   2. users.tier (partner tier)            (Junior/Pro/Elite/Custom)
--   3. subscription_cards.target_tiers      (array; J/P/E/Custom)
--   4. client_submission_brands.target_tiers (array; J/P/E/Custom)
--
-- Note: migration 009 originally added a `subscriptions.level` CHECK,
-- but migration 025 (subscriptions restructure) dropped and re-created
-- the subscriptions table without that column. So there is no
-- subscriptions.level constraint to widen in prod.
--
-- Re-runnable: each step finds the existing CHECK constraint by
-- definition pattern (so we don't rely on auto-generated names)
-- and re-creates it with the wider allow-list under a stable
-- explicit name.
-- ============================================================

-- 1) subscription_plans.tier — adds 'Top Talents'
DO $$
DECLARE
  cname TEXT;
BEGIN
  FOR cname IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'subscription_plans'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%tier%'
      AND pg_get_constraintdef(oid) LIKE '%Elite%'
  LOOP
    EXECUTE 'ALTER TABLE subscription_plans DROP CONSTRAINT ' || quote_ident(cname);
  END LOOP;
END $$;

ALTER TABLE subscription_plans
  ADD CONSTRAINT subscription_plans_tier_check
  CHECK (tier IN ('Junior', 'Pro', 'Elite', 'Top Talents'));


-- 3) users.tier (partner tier) — adds 'Top Talents'
DO $$
DECLARE
  cname TEXT;
BEGIN
  FOR cname IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'users'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%tier%'
      AND pg_get_constraintdef(oid) LIKE '%Elite%'
      AND pg_get_constraintdef(oid) LIKE '%Custom%'
  LOOP
    EXECUTE 'ALTER TABLE users DROP CONSTRAINT ' || quote_ident(cname);
  END LOOP;
END $$;

ALTER TABLE users
  ADD CONSTRAINT users_tier_check
  CHECK (tier IS NULL OR tier IN ('Junior', 'Pro', 'Elite', 'Top Talents', 'Custom'));


-- 4) subscription_cards.target_tiers (array) — adds 'Top Talents'
-- Existing constraint name is explicit: subscription_cards_target_tiers_valid
DO $$
DECLARE
  cname TEXT;
BEGIN
  FOR cname IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'subscription_cards'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%target_tiers%'
      AND pg_get_constraintdef(oid) LIKE '%Elite%'
  LOOP
    EXECUTE 'ALTER TABLE subscription_cards DROP CONSTRAINT ' || quote_ident(cname);
  END LOOP;
END $$;

ALTER TABLE subscription_cards
  ADD CONSTRAINT subscription_cards_target_tiers_valid
  CHECK (target_tiers <@ ARRAY['Junior','Pro','Elite','Top Talents','Custom']::text[]);


-- 5) client_submission_brands.target_tiers (array) — adds 'Top Talents'
DO $$
DECLARE
  cname TEXT;
BEGIN
  FOR cname IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'client_submission_brands'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%target_tiers%'
      AND pg_get_constraintdef(oid) LIKE '%Elite%'
  LOOP
    EXECUTE 'ALTER TABLE client_submission_brands DROP CONSTRAINT ' || quote_ident(cname);
  END LOOP;
END $$;

ALTER TABLE client_submission_brands
  ADD CONSTRAINT client_submission_brands_target_tiers_check
  CHECK (target_tiers <@ ARRAY['Junior','Pro','Elite','Top Talents','Custom']::text[]);
