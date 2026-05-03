-- ============================================================
-- Subscription plans: add daily/weekly hours and pricing margin
-- ============================================================
-- Hours: per (subscription, tier, plan) — admin-editable in the
-- Subscriptions module, read-only at the card level.
-- Margin: per (plan, country) on the pricing row. Partner price
-- becomes derived (customer_proposed - margin), so the existing
-- subscription_plan_partner_pricing table is deprecated but kept
-- around until we can drop it in a later migration.

ALTER TABLE subscription_plans
  ADD COLUMN IF NOT EXISTS daily_hours NUMERIC(4,2),
  ADD COLUMN IF NOT EXISTS weekly_hours NUMERIC(4,2);

ALTER TABLE subscription_plan_pricing
  ADD COLUMN IF NOT EXISTS margin_value INTEGER NOT NULL DEFAULT 0
    CHECK (margin_value >= 0);

ALTER TABLE subscription_plan_pricing
  ADD COLUMN IF NOT EXISTS margin_type TEXT NOT NULL DEFAULT 'fixed'
    CHECK (margin_type IN ('fixed', 'percent'));

-- Seed default hours per plan name (only when null, so a re-run never
-- overwrites an admin choice).
UPDATE subscription_plans SET daily_hours = 1,   weekly_hours = 5  WHERE plan = 'Starter'  AND daily_hours IS NULL;
UPDATE subscription_plans SET daily_hours = 2.5, weekly_hours = 10 WHERE plan = 'Basic'    AND daily_hours IS NULL;
UPDATE subscription_plans SET daily_hours = 4.5, weekly_hours = 20 WHERE plan = 'Plus'     AND daily_hours IS NULL;
UPDATE subscription_plans SET daily_hours = 6.5, weekly_hours = 30 WHERE plan = 'Pro'      AND daily_hours IS NULL;
UPDATE subscription_plans SET daily_hours = 8,   weekly_hours = 40 WHERE plan = 'Personal' AND daily_hours IS NULL;

-- Seed margins from existing partner_pricing rows so admin doesn't
-- lose pricing intent. Only fills rows where margin is still 0.
UPDATE subscription_plan_pricing p
SET margin_value = GREATEST(p.price - pp.price, 0)
FROM subscription_plan_partner_pricing pp
WHERE pp.plan_id = p.plan_id
  AND pp.country_id = p.country_id
  AND p.margin_value = 0;
