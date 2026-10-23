-- ============================================================
-- Ads Specialist: subscription + assignment catalogs and SquadHire mapping
-- ============================================================

-- Accept Ads Specialist briefs from the business portal.
DO $$
DECLARE c text;
BEGIN
  SELECT conname INTO c
  FROM pg_constraint
  WHERE conrelid = 'client_submission_brands'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%service_type%';
  IF c IS NOT NULL THEN
    EXECUTE format('ALTER TABLE client_submission_brands DROP CONSTRAINT %I', c);
  END IF;
END $$;

ALTER TABLE client_submission_brands
  ADD CONSTRAINT client_submission_brands_service_type_check
  CHECK (service_type IN (
    'designer', 'video_editor', 'designer_video_editor', 'accountant', 'ads_specialist'
  ));

ALTER TABLE subscription_cards
  ADD COLUMN IF NOT EXISTS budget_currency TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'subscription_cards'::regclass
      AND conname = 'subscription_cards_budget_currency_check'
  ) THEN
    ALTER TABLE subscription_cards
      ADD CONSTRAINT subscription_cards_budget_currency_check
      CHECK (budget_currency IS NULL OR budget_currency IN (
        'INR', 'USD', 'EUR', 'GBP', 'AED', 'AUD', 'CAD', 'SGD'
      ));
  END IF;
END $$;

-- Subscription catalog.
INSERT INTO subscriptions (slug, name, description, is_active, sort_order)
SELECT
  'ads_specialist',
  'Ads Specialist',
  'Performance marketing and paid acquisition across search, social, commerce, video, and emerging ad channels.',
  TRUE,
  (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM subscriptions)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  is_active = TRUE;

-- Five plans at the daily, weekly, and monthly caps used in the brief form.
INSERT INTO subscription_plans (
  subscription_id, plan, tier, is_active, sort_order,
  daily_hours, weekly_hours, monthly_hours
)
SELECT
  s.id, p.plan, t.tier, TRUE, p.sort_order,
  p.daily_hours, p.weekly_hours, p.monthly_hours
FROM subscriptions s
CROSS JOIN (VALUES
  ('Starter',  1, 1.0,  5.0,  20.0),
  ('Basic',    2, 2.0, 10.0,  40.0),
  ('Plus',     3, 4.0, 20.0,  80.0),
  ('Pro',      4, 6.0, 30.0, 120.0),
  ('Personal', 5, 8.0, 40.0, 160.0)
) AS p(plan, sort_order, daily_hours, weekly_hours, monthly_hours)
CROSS JOIN (VALUES ('Junior'), ('Pro'), ('Top Talents')) AS t(tier)
WHERE s.slug = 'ads_specialist'
ON CONFLICT (subscription_id, plan, tier) DO UPDATE SET
  is_active = TRUE,
  sort_order = EXCLUDED.sort_order,
  daily_hours = EXCLUDED.daily_hours,
  weekly_hours = EXCLUDED.weekly_hours,
  monthly_hours = EXCLUDED.monthly_hours;

-- Start with Designer pricing/margins for the corresponding plan and level;
-- the catalog remains fully editable by admins after deployment.
INSERT INTO subscription_plan_pricing (plan_id, country_id, price, margin_value, margin_type)
SELECT
  ads_plan.id,
  base_price.country_id,
  base_price.price,
  base_price.margin_value,
  base_price.margin_type
FROM subscription_plans ads_plan
JOIN subscriptions ads_sub
  ON ads_sub.id = ads_plan.subscription_id AND ads_sub.slug = 'ads_specialist'
JOIN subscriptions base_sub ON base_sub.slug = 'designer'
JOIN subscription_plans base_plan
  ON base_plan.subscription_id = base_sub.id
 AND base_plan.plan = ads_plan.plan
 AND base_plan.tier = ads_plan.tier
JOIN subscription_plan_pricing base_price ON base_price.plan_id = base_plan.id
ON CONFLICT (plan_id, country_id) DO NOTHING;

INSERT INTO subscription_deliverable_types (subscription_id, name, is_active, sort_order)
SELECT s.id, d.name, TRUE, d.sort_order
FROM subscriptions s
CROSS JOIN (VALUES
  ('Campaign management', 1),
  ('Media planning & budget pacing', 2),
  ('Creative testing', 3),
  ('Conversion tracking & attribution', 4),
  ('Performance reporting & insights', 5),
  ('Landing-page optimisation', 6)
) AS d(name, sort_order)
WHERE s.slug = 'ads_specialist'
ON CONFLICT (subscription_id, name) DO UPDATE SET
  is_active = TRUE, sort_order = EXCLUDED.sort_order;

-- Direct link to the SquadHire Ads Specialist category. The UUID is stable
-- and is seeded by Profiles migration 00138.
INSERT INTO subscription_squadhire_profiles (subscription_id, squadhire_category_id)
SELECT s.id, '6c46f5a5-8e38-4ed9-96f8-472fb2f0b0b1'::uuid
FROM subscriptions s
WHERE s.slug = 'ads_specialist'
ON CONFLICT (subscription_id, squadhire_category_id) DO NOTHING;

-- Assignment catalog entry. Copy existing Designer margins as a safe initial
-- baseline while keeping all values admin-editable.
INSERT INTO assignment_services (slug, name, description, is_active, sort_order)
SELECT
  'ads_specialist',
  'Ads Specialist',
  'One-off paid advertising and performance marketing projects',
  TRUE,
  (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM assignment_services)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  is_active = TRUE;

INSERT INTO assignment_service_margins (
  service_id, tier, country_id, margin_value, margin_type
)
SELECT
  ads.id, base_margin.tier, base_margin.country_id,
  base_margin.margin_value, base_margin.margin_type
FROM assignment_services ads
JOIN assignment_services designer ON designer.slug = 'designer'
JOIN assignment_service_margins base_margin ON base_margin.service_id = designer.id
WHERE ads.slug = 'ads_specialist'
ON CONFLICT (service_id, tier, country_id) DO NOTHING;

NOTIFY pgrst, 'reload schema';
