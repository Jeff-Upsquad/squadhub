-- ============================================================
-- Top Talents tier rename — Phase 2 (data backfill)
--
-- Rewrites every stored legacy 'Elite' tier value to the new canonical
-- 'Top Talents'. Phase 1 (migration 089) already widened the CHECK
-- constraints to accept both, so this backfill cannot violate them.
--
-- Applied to production via the Supabase MCP as part of the rename
-- rollout (deploy.sh does not run migrations). Re-runnable: every
-- statement is guarded so a second run is a no-op.
--
-- Covers all tier-bearing locations discovered by a full audit:
--   subscription_plans.tier              (scalar)
--   users.tier                           (scalar; none in prod)
--   subscription_cards.target_tiers      (text[])
--   subscription_cards.plan_snapshot     (jsonb: plan.tier)
--   client_submission_brands.target_tiers(text[]; none in prod)
-- ============================================================

UPDATE subscription_plans SET tier = 'Top Talents' WHERE tier = 'Elite';

UPDATE users SET tier = 'Top Talents' WHERE tier = 'Elite';

UPDATE subscription_cards
   SET target_tiers = array_replace(target_tiers, 'Elite', 'Top Talents')
 WHERE 'Elite' = ANY(target_tiers);

UPDATE subscription_cards
   SET plan_snapshot = jsonb_set(plan_snapshot, '{plan,tier}', '"Top Talents"'::jsonb)
 WHERE plan_snapshot->'plan'->>'tier' = 'Elite';

UPDATE client_submission_brands
   SET target_tiers = array_replace(target_tiers, 'Elite', 'Top Talents')
 WHERE 'Elite' = ANY(target_tiers);

-- array_replace can introduce a duplicate when a card already listed both
-- 'Elite' and 'Top Talents'. De-duplicate target_tiers, preserving order.
UPDATE subscription_cards
   SET target_tiers = (
     SELECT array_agg(t ORDER BY ord)
       FROM (SELECT t, min(ord) AS ord
               FROM unnest(target_tiers) WITH ORDINALITY u(t, ord)
              GROUP BY t) s)
 WHERE (SELECT count(*) FROM unnest(target_tiers))
     <> (SELECT count(DISTINCT x) FROM unnest(target_tiers) x);
