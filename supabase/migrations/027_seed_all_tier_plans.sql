-- ============================================================
-- Replicate every plan (Starter/Basic/Plus/Pro/Personal) at every
-- tier (Junior/Pro/Elite) so each subscription has 15 plan rows.
-- Relax UNIQUE(subscription_id, plan) -> UNIQUE(subscription_id, plan, tier).
-- Assumes migration 026 has been applied.
-- ============================================================

-- Drop the 2-column unique constraint by whatever name it has.
-- (Created inline in 025 as UNIQUE(subscription_id, plan); PostgreSQL auto-names it.)
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'subscription_plans'
      AND con.contype = 'u'
      AND array_length(con.conkey, 1) = 2
  LOOP
    EXECUTE 'ALTER TABLE subscription_plans DROP CONSTRAINT ' || quote_ident(r.conname);
  END LOOP;
END $$;

-- Seed any missing (subscription, plan, tier) combos.
-- Uses NOT EXISTS rather than ON CONFLICT because we've just dropped the old
-- unique constraint and haven't yet added the new one.
INSERT INTO subscription_plans (subscription_id, plan, tier, is_active, sort_order)
SELECT s.id, p.plan, t.tier, true, p.sort_order
FROM subscriptions s
CROSS JOIN (
  VALUES
    ('Starter', 1),
    ('Basic', 2),
    ('Plus', 3),
    ('Pro', 4),
    ('Personal', 5)
) AS p(plan, sort_order)
CROSS JOIN (
  VALUES ('Junior'), ('Pro'), ('Elite')
) AS t(tier)
WHERE NOT EXISTS (
  SELECT 1 FROM subscription_plans sp
  WHERE sp.subscription_id = s.id
    AND sp.plan = p.plan
    AND sp.tier = t.tier
);

-- Add the 3-column unique constraint (idempotent).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'subscription_plans_sub_plan_tier_key'
      AND conrelid = 'subscription_plans'::regclass
  ) THEN
    ALTER TABLE subscription_plans
      ADD CONSTRAINT subscription_plans_sub_plan_tier_key
      UNIQUE (subscription_id, plan, tier);
  END IF;
END $$;
