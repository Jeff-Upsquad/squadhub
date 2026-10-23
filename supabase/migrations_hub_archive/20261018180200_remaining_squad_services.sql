-- Subscription and assignment catalogs for the remaining squads.
BEGIN;
ALTER TABLE client_submission_brands DROP CONSTRAINT IF EXISTS client_submission_brands_service_type_check;
ALTER TABLE client_submission_brands ADD CONSTRAINT client_submission_brands_service_type_check CHECK(service_type IN ('designer','video_editor','designer_video_editor','accountant','ads_specialist','creative_director','copy_content_writer','social_media_manager','videographer','photographer','videographer_photographer','ai_video_image_creator','seo_specialist','digital_marketing_team','influencer_marketing','offline_marketing','web_development','app_building','automation','software_solutions','cfo_ca','gst_experts','tds_experts','labour_law','incorporation','contract_drafting','ip_protection','compliance','business_formation','end_to_end_hiring','team_building','hr_process'));
-- Subscription catalog.
INSERT INTO subscriptions (slug, name, description, is_active, sort_order)
SELECT
  'seo_specialist',
  'SEO Specialist',
  'Explain your SEO audit process, search markets and organic growth results.',
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
WHERE s.slug = 'seo_specialist'
ON CONFLICT (subscription_id, plan, tier) DO NOTHING;

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
  ON ads_sub.id = ads_plan.subscription_id AND ads_sub.slug = 'seo_specialist'
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
  ('Technical SEO', 1),
  ('On-page SEO', 2),
  ('Local SEO', 3),
  ('E-commerce SEO', 4),
  ('Content SEO', 5),
  ('SEO audits', 6)
) AS d(name, sort_order)
WHERE s.slug = 'seo_specialist'
ON CONFLICT (subscription_id, name) DO NOTHING;

-- Direct link to the SquadHire SEO Specialist category. The UUID is stable
-- and is seeded by Profiles migration 20261014130100.
INSERT INTO subscription_squadhire_profiles (subscription_id, squadhire_category_id)
SELECT s.id, 'ca148002-5800-4800-8800-000000000001'::uuid
FROM subscriptions s
WHERE s.slug = 'seo_specialist'
ON CONFLICT (subscription_id, squadhire_category_id) DO NOTHING;

-- Assignment catalog entry. Copy existing Designer margins as a safe initial
-- baseline while keeping all values admin-editable.
INSERT INTO assignment_services (slug, name, description, is_active, sort_order)
SELECT
  'seo_specialist',
  'SEO Specialist',
  'One-off seo specialist projects',
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
WHERE ads.slug = 'seo_specialist'
ON CONFLICT (service_id, tier, country_id) DO NOTHING;



-- Subscription catalog.
INSERT INTO subscriptions (slug, name, description, is_active, sort_order)
SELECT
  'digital_marketing_team',
  'Digital Marketing Team',
  'Describe channel expertise, team responsibilities and campaign outcomes.',
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
WHERE s.slug = 'digital_marketing_team'
ON CONFLICT (subscription_id, plan, tier) DO NOTHING;

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
  ON ads_sub.id = ads_plan.subscription_id AND ads_sub.slug = 'digital_marketing_team'
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
  ('Marketing strategy', 1),
  ('Campaign management', 2),
  ('Email marketing', 3),
  ('Conversion optimization', 4),
  ('Analytics', 5),
  ('Growth marketing', 6)
) AS d(name, sort_order)
WHERE s.slug = 'digital_marketing_team'
ON CONFLICT (subscription_id, name) DO NOTHING;

-- Direct link to the SquadHire Digital Marketing Team category. The UUID is stable
-- and is seeded by Profiles migration 20261014130100.
INSERT INTO subscription_squadhire_profiles (subscription_id, squadhire_category_id)
SELECT s.id, 'ca148002-5800-4800-8800-000000000002'::uuid
FROM subscriptions s
WHERE s.slug = 'digital_marketing_team'
ON CONFLICT (subscription_id, squadhire_category_id) DO NOTHING;

-- Assignment catalog entry. Copy existing Designer margins as a safe initial
-- baseline while keeping all values admin-editable.
INSERT INTO assignment_services (slug, name, description, is_active, sort_order)
SELECT
  'digital_marketing_team',
  'Digital Marketing Team',
  'One-off digital marketing team projects',
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
WHERE ads.slug = 'digital_marketing_team'
ON CONFLICT (service_id, tier, country_id) DO NOTHING;



-- Subscription catalog.
INSERT INTO subscriptions (slug, name, description, is_active, sort_order)
SELECT
  'influencer_marketing',
  'Influencer Marketing Expert',
  'Describe creator selection, campaign coordination and measurable results.',
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
WHERE s.slug = 'influencer_marketing'
ON CONFLICT (subscription_id, plan, tier) DO NOTHING;

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
  ON ads_sub.id = ads_plan.subscription_id AND ads_sub.slug = 'influencer_marketing'
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
  ('Creator sourcing', 1),
  ('Campaign strategy', 2),
  ('Creator partnerships', 3),
  ('UGC campaigns', 4),
  ('Campaign reporting', 5)
) AS d(name, sort_order)
WHERE s.slug = 'influencer_marketing'
ON CONFLICT (subscription_id, name) DO NOTHING;

-- Direct link to the SquadHire Influencer Marketing Expert category. The UUID is stable
-- and is seeded by Profiles migration 20261014130100.
INSERT INTO subscription_squadhire_profiles (subscription_id, squadhire_category_id)
SELECT s.id, 'ca148002-5800-4800-8800-000000000003'::uuid
FROM subscriptions s
WHERE s.slug = 'influencer_marketing'
ON CONFLICT (subscription_id, squadhire_category_id) DO NOTHING;

-- Assignment catalog entry. Copy existing Designer margins as a safe initial
-- baseline while keeping all values admin-editable.
INSERT INTO assignment_services (slug, name, description, is_active, sort_order)
SELECT
  'influencer_marketing',
  'Influencer Marketing Expert',
  'One-off influencer marketing expert projects',
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
WHERE ads.slug = 'influencer_marketing'
ON CONFLICT (service_id, tier, country_id) DO NOTHING;



-- Subscription catalog.
INSERT INTO subscriptions (slug, name, description, is_active, sort_order)
SELECT
  'offline_marketing',
  'Offline Marketing Specialist',
  'Describe on-ground campaigns, locations served and execution capacity.',
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
WHERE s.slug = 'offline_marketing'
ON CONFLICT (subscription_id, plan, tier) DO NOTHING;

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
  ON ads_sub.id = ads_plan.subscription_id AND ads_sub.slug = 'offline_marketing'
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
  ('Brand activations', 1),
  ('Events', 2),
  ('Retail marketing', 3),
  ('Outdoor advertising', 4),
  ('Local promotions', 5)
) AS d(name, sort_order)
WHERE s.slug = 'offline_marketing'
ON CONFLICT (subscription_id, name) DO NOTHING;

-- Direct link to the SquadHire Offline Marketing Specialist category. The UUID is stable
-- and is seeded by Profiles migration 20261014130100.
INSERT INTO subscription_squadhire_profiles (subscription_id, squadhire_category_id)
SELECT s.id, 'ca148002-5800-4800-8800-000000000004'::uuid
FROM subscriptions s
WHERE s.slug = 'offline_marketing'
ON CONFLICT (subscription_id, squadhire_category_id) DO NOTHING;

-- Assignment catalog entry. Copy existing Designer margins as a safe initial
-- baseline while keeping all values admin-editable.
INSERT INTO assignment_services (slug, name, description, is_active, sort_order)
SELECT
  'offline_marketing',
  'Offline Marketing Specialist',
  'One-off offline marketing specialist projects',
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
WHERE ads.slug = 'offline_marketing'
ON CONFLICT (service_id, tier, country_id) DO NOTHING;



-- Subscription catalog.
INSERT INTO subscriptions (slug, name, description, is_active, sort_order)
SELECT
  'web_development',
  'Web Developer',
  'Describe your stack, delivery process, testing and deployed projects.',
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
WHERE s.slug = 'web_development'
ON CONFLICT (subscription_id, plan, tier) DO NOTHING;

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
  ON ads_sub.id = ads_plan.subscription_id AND ads_sub.slug = 'web_development'
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
  ('Business websites', 1),
  ('E-commerce', 2),
  ('Web applications', 3),
  ('CMS development', 4),
  ('Website maintenance', 5)
) AS d(name, sort_order)
WHERE s.slug = 'web_development'
ON CONFLICT (subscription_id, name) DO NOTHING;

-- Direct link to the SquadHire Web Developer category. The UUID is stable
-- and is seeded by Profiles migration 20261014130100.
INSERT INTO subscription_squadhire_profiles (subscription_id, squadhire_category_id)
SELECT s.id, 'ca148002-5800-4800-8800-000000000005'::uuid
FROM subscriptions s
WHERE s.slug = 'web_development'
ON CONFLICT (subscription_id, squadhire_category_id) DO NOTHING;

-- Assignment catalog entry. Copy existing Designer margins as a safe initial
-- baseline while keeping all values admin-editable.
INSERT INTO assignment_services (slug, name, description, is_active, sort_order)
SELECT
  'web_development',
  'Web Developer',
  'One-off web developer projects',
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
WHERE ads.slug = 'web_development'
ON CONFLICT (service_id, tier, country_id) DO NOTHING;



-- Subscription catalog.
INSERT INTO subscriptions (slug, name, description, is_active, sort_order)
SELECT
  'app_building',
  'App Developer',
  'Describe platforms, architecture, app releases and maintenance experience.',
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
WHERE s.slug = 'app_building'
ON CONFLICT (subscription_id, plan, tier) DO NOTHING;

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
  ON ads_sub.id = ads_plan.subscription_id AND ads_sub.slug = 'app_building'
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
  ('Android apps', 1),
  ('iOS apps', 2),
  ('Cross-platform apps', 3),
  ('App maintenance', 4),
  ('App integrations', 5)
) AS d(name, sort_order)
WHERE s.slug = 'app_building'
ON CONFLICT (subscription_id, name) DO NOTHING;

-- Direct link to the SquadHire App Developer category. The UUID is stable
-- and is seeded by Profiles migration 20261014130100.
INSERT INTO subscription_squadhire_profiles (subscription_id, squadhire_category_id)
SELECT s.id, 'ca148002-5800-4800-8800-000000000006'::uuid
FROM subscriptions s
WHERE s.slug = 'app_building'
ON CONFLICT (subscription_id, squadhire_category_id) DO NOTHING;

-- Assignment catalog entry. Copy existing Designer margins as a safe initial
-- baseline while keeping all values admin-editable.
INSERT INTO assignment_services (slug, name, description, is_active, sort_order)
SELECT
  'app_building',
  'App Developer',
  'One-off app developer projects',
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
WHERE ads.slug = 'app_building'
ON CONFLICT (service_id, tier, country_id) DO NOTHING;



-- Subscription catalog.
INSERT INTO subscriptions (slug, name, description, is_active, sort_order)
SELECT
  'automation',
  'Automation Specialist',
  'Describe workflows automated, systems connected and reliability controls.',
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
WHERE s.slug = 'automation'
ON CONFLICT (subscription_id, plan, tier) DO NOTHING;

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
  ON ads_sub.id = ads_plan.subscription_id AND ads_sub.slug = 'automation'
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
  ('Workflow automation', 1),
  ('CRM automation', 2),
  ('Data synchronization', 3),
  ('Reporting automation', 4),
  ('AI workflows', 5)
) AS d(name, sort_order)
WHERE s.slug = 'automation'
ON CONFLICT (subscription_id, name) DO NOTHING;

-- Direct link to the SquadHire Automation Specialist category. The UUID is stable
-- and is seeded by Profiles migration 20261014130100.
INSERT INTO subscription_squadhire_profiles (subscription_id, squadhire_category_id)
SELECT s.id, 'ca148002-5800-4800-8800-000000000007'::uuid
FROM subscriptions s
WHERE s.slug = 'automation'
ON CONFLICT (subscription_id, squadhire_category_id) DO NOTHING;

-- Assignment catalog entry. Copy existing Designer margins as a safe initial
-- baseline while keeping all values admin-editable.
INSERT INTO assignment_services (slug, name, description, is_active, sort_order)
SELECT
  'automation',
  'Automation Specialist',
  'One-off automation specialist projects',
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
WHERE ads.slug = 'automation'
ON CONFLICT (service_id, tier, country_id) DO NOTHING;



-- Subscription catalog.
INSERT INTO subscriptions (slug, name, description, is_active, sort_order)
SELECT
  'software_solutions',
  'Software Developer',
  'Describe software architecture, integrations and production support experience.',
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
WHERE s.slug = 'software_solutions'
ON CONFLICT (subscription_id, plan, tier) DO NOTHING;

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
  ON ads_sub.id = ads_plan.subscription_id AND ads_sub.slug = 'software_solutions'
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
  ('Custom software', 1),
  ('Internal tools', 2),
  ('SaaS products', 3),
  ('System integrations', 4),
  ('Software maintenance', 5)
) AS d(name, sort_order)
WHERE s.slug = 'software_solutions'
ON CONFLICT (subscription_id, name) DO NOTHING;

-- Direct link to the SquadHire Software Developer category. The UUID is stable
-- and is seeded by Profiles migration 20261014130100.
INSERT INTO subscription_squadhire_profiles (subscription_id, squadhire_category_id)
SELECT s.id, 'ca148002-5800-4800-8800-000000000008'::uuid
FROM subscriptions s
WHERE s.slug = 'software_solutions'
ON CONFLICT (subscription_id, squadhire_category_id) DO NOTHING;

-- Assignment catalog entry. Copy existing Designer margins as a safe initial
-- baseline while keeping all values admin-editable.
INSERT INTO assignment_services (slug, name, description, is_active, sort_order)
SELECT
  'software_solutions',
  'Software Developer',
  'One-off software developer projects',
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
WHERE ads.slug = 'software_solutions'
ON CONFLICT (service_id, tier, country_id) DO NOTHING;



-- Subscription catalog.
INSERT INTO subscriptions (slug, name, description, is_active, sort_order)
SELECT
  'cfo_ca',
  'CFO / Chartered Accountant',
  'Describe qualifications, professional registrations where applicable, finance responsibilities and outcomes.',
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
WHERE s.slug = 'cfo_ca'
ON CONFLICT (subscription_id, plan, tier) DO NOTHING;

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
  ON ads_sub.id = ads_plan.subscription_id AND ads_sub.slug = 'cfo_ca'
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
  ('Financial planning', 1),
  ('Management reporting', 2),
  ('Cash flow', 3),
  ('Budgeting', 4),
  ('Audit support', 5),
  ('Financial advisory', 6)
) AS d(name, sort_order)
WHERE s.slug = 'cfo_ca'
ON CONFLICT (subscription_id, name) DO NOTHING;

-- Direct link to the SquadHire CFO / Chartered Accountant category. The UUID is stable
-- and is seeded by Profiles migration 20261014130100.
INSERT INTO subscription_squadhire_profiles (subscription_id, squadhire_category_id)
SELECT s.id, 'ca148002-5800-4800-8800-000000000009'::uuid
FROM subscriptions s
WHERE s.slug = 'cfo_ca'
ON CONFLICT (subscription_id, squadhire_category_id) DO NOTHING;

-- Assignment catalog entry. Copy existing Designer margins as a safe initial
-- baseline while keeping all values admin-editable.
INSERT INTO assignment_services (slug, name, description, is_active, sort_order)
SELECT
  'cfo_ca',
  'CFO / Chartered Accountant',
  'One-off cfo / chartered accountant projects',
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
WHERE ads.slug = 'cfo_ca'
ON CONFLICT (service_id, tier, country_id) DO NOTHING;



-- Subscription catalog.
INSERT INTO subscriptions (slug, name, description, is_active, sort_order)
SELECT
  'gst_experts',
  'GST Expert',
  'Describe qualifications, GST work experience, reconciliations and filing process.',
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
WHERE s.slug = 'gst_experts'
ON CONFLICT (subscription_id, plan, tier) DO NOTHING;

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
  ON ads_sub.id = ads_plan.subscription_id AND ads_sub.slug = 'gst_experts'
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
  ('GST returns', 1),
  ('GST reconciliation', 2),
  ('GST registration', 3),
  ('GST advisory', 4),
  ('Notice support', 5)
) AS d(name, sort_order)
WHERE s.slug = 'gst_experts'
ON CONFLICT (subscription_id, name) DO NOTHING;

-- Direct link to the SquadHire GST Expert category. The UUID is stable
-- and is seeded by Profiles migration 20261014130100.
INSERT INTO subscription_squadhire_profiles (subscription_id, squadhire_category_id)
SELECT s.id, 'ca148002-5800-4800-8800-000000000010'::uuid
FROM subscriptions s
WHERE s.slug = 'gst_experts'
ON CONFLICT (subscription_id, squadhire_category_id) DO NOTHING;

-- Assignment catalog entry. Copy existing Designer margins as a safe initial
-- baseline while keeping all values admin-editable.
INSERT INTO assignment_services (slug, name, description, is_active, sort_order)
SELECT
  'gst_experts',
  'GST Expert',
  'One-off gst expert projects',
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
WHERE ads.slug = 'gst_experts'
ON CONFLICT (service_id, tier, country_id) DO NOTHING;



-- Subscription catalog.
INSERT INTO subscriptions (slug, name, description, is_active, sort_order)
SELECT
  'tds_experts',
  'TDS Expert',
  'Describe TDS work, reconciliation process and qualifications.',
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
WHERE s.slug = 'tds_experts'
ON CONFLICT (subscription_id, plan, tier) DO NOTHING;

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
  ON ads_sub.id = ads_plan.subscription_id AND ads_sub.slug = 'tds_experts'
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
  ('TDS calculations', 1),
  ('TDS returns', 2),
  ('Challan reconciliation', 3),
  ('Certificates', 4),
  ('Correction returns', 5)
) AS d(name, sort_order)
WHERE s.slug = 'tds_experts'
ON CONFLICT (subscription_id, name) DO NOTHING;

-- Direct link to the SquadHire TDS Expert category. The UUID is stable
-- and is seeded by Profiles migration 20261014130100.
INSERT INTO subscription_squadhire_profiles (subscription_id, squadhire_category_id)
SELECT s.id, 'ca148002-5800-4800-8800-000000000011'::uuid
FROM subscriptions s
WHERE s.slug = 'tds_experts'
ON CONFLICT (subscription_id, squadhire_category_id) DO NOTHING;

-- Assignment catalog entry. Copy existing Designer margins as a safe initial
-- baseline while keeping all values admin-editable.
INSERT INTO assignment_services (slug, name, description, is_active, sort_order)
SELECT
  'tds_experts',
  'TDS Expert',
  'One-off tds expert projects',
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
WHERE ads.slug = 'tds_experts'
ON CONFLICT (service_id, tier, country_id) DO NOTHING;



-- Subscription catalog.
INSERT INTO subscriptions (slug, name, description, is_active, sort_order)
SELECT
  'labour_law',
  'Labour Law Expert',
  'Describe qualifications, jurisdictions served and employment compliance experience.',
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
WHERE s.slug = 'labour_law'
ON CONFLICT (subscription_id, plan, tier) DO NOTHING;

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
  ON ads_sub.id = ads_plan.subscription_id AND ads_sub.slug = 'labour_law'
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
  ('Payroll compliance', 1),
  ('Employment compliance', 2),
  ('Statutory records', 3),
  ('HR compliance audits', 4),
  ('Registration support', 5)
) AS d(name, sort_order)
WHERE s.slug = 'labour_law'
ON CONFLICT (subscription_id, name) DO NOTHING;

-- Direct link to the SquadHire Labour Law Expert category. The UUID is stable
-- and is seeded by Profiles migration 20261014130100.
INSERT INTO subscription_squadhire_profiles (subscription_id, squadhire_category_id)
SELECT s.id, 'ca148002-5800-4800-8800-000000000012'::uuid
FROM subscriptions s
WHERE s.slug = 'labour_law'
ON CONFLICT (subscription_id, squadhire_category_id) DO NOTHING;

-- Assignment catalog entry. Copy existing Designer margins as a safe initial
-- baseline while keeping all values admin-editable.
INSERT INTO assignment_services (slug, name, description, is_active, sort_order)
SELECT
  'labour_law',
  'Labour Law Expert',
  'One-off labour law expert projects',
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
WHERE ads.slug = 'labour_law'
ON CONFLICT (service_id, tier, country_id) DO NOTHING;



-- Subscription catalog.
INSERT INTO subscriptions (slug, name, description, is_active, sort_order)
SELECT
  'incorporation',
  'Incorporation & Licensing Specialist',
  'Describe qualifications, entity types, jurisdictions and registration experience.',
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
WHERE s.slug = 'incorporation'
ON CONFLICT (subscription_id, plan, tier) DO NOTHING;

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
  ON ads_sub.id = ads_plan.subscription_id AND ads_sub.slug = 'incorporation'
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
  ('Company registration', 1),
  ('Business licenses', 2),
  ('Entity changes', 3),
  ('Registration documentation', 4),
  ('Annual compliance', 5)
) AS d(name, sort_order)
WHERE s.slug = 'incorporation'
ON CONFLICT (subscription_id, name) DO NOTHING;

-- Direct link to the SquadHire Incorporation & Licensing Specialist category. The UUID is stable
-- and is seeded by Profiles migration 20261014130100.
INSERT INTO subscription_squadhire_profiles (subscription_id, squadhire_category_id)
SELECT s.id, 'ca148002-5800-4800-8800-000000000013'::uuid
FROM subscriptions s
WHERE s.slug = 'incorporation'
ON CONFLICT (subscription_id, squadhire_category_id) DO NOTHING;

-- Assignment catalog entry. Copy existing Designer margins as a safe initial
-- baseline while keeping all values admin-editable.
INSERT INTO assignment_services (slug, name, description, is_active, sort_order)
SELECT
  'incorporation',
  'Incorporation & Licensing Specialist',
  'One-off incorporation & licensing specialist projects',
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
WHERE ads.slug = 'incorporation'
ON CONFLICT (service_id, tier, country_id) DO NOTHING;



-- Subscription catalog.
INSERT INTO subscriptions (slug, name, description, is_active, sort_order)
SELECT
  'contract_drafting',
  'Contract Drafting Specialist',
  'Describe legal qualifications, registrations, jurisdictions and contract experience.',
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
WHERE s.slug = 'contract_drafting'
ON CONFLICT (subscription_id, plan, tier) DO NOTHING;

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
  ON ads_sub.id = ads_plan.subscription_id AND ads_sub.slug = 'contract_drafting'
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
  ('Commercial contracts', 1),
  ('Employment agreements', 2),
  ('NDAs', 3),
  ('Vendor agreements', 4),
  ('Contract review', 5)
) AS d(name, sort_order)
WHERE s.slug = 'contract_drafting'
ON CONFLICT (subscription_id, name) DO NOTHING;

-- Direct link to the SquadHire Contract Drafting Specialist category. The UUID is stable
-- and is seeded by Profiles migration 20261014130100.
INSERT INTO subscription_squadhire_profiles (subscription_id, squadhire_category_id)
SELECT s.id, 'ca148002-5800-4800-8800-000000000014'::uuid
FROM subscriptions s
WHERE s.slug = 'contract_drafting'
ON CONFLICT (subscription_id, squadhire_category_id) DO NOTHING;

-- Assignment catalog entry. Copy existing Designer margins as a safe initial
-- baseline while keeping all values admin-editable.
INSERT INTO assignment_services (slug, name, description, is_active, sort_order)
SELECT
  'contract_drafting',
  'Contract Drafting Specialist',
  'One-off contract drafting specialist projects',
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
WHERE ads.slug = 'contract_drafting'
ON CONFLICT (service_id, tier, country_id) DO NOTHING;



-- Subscription catalog.
INSERT INTO subscriptions (slug, name, description, is_active, sort_order)
SELECT
  'ip_protection',
  'IP Protection Specialist',
  'Describe legal qualifications, jurisdictions, IP types and experience.',
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
WHERE s.slug = 'ip_protection'
ON CONFLICT (subscription_id, plan, tier) DO NOTHING;

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
  ON ads_sub.id = ads_plan.subscription_id AND ads_sub.slug = 'ip_protection'
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
  ('Trademarks', 1),
  ('Copyrights', 2),
  ('IP documentation', 3),
  ('IP portfolio review', 4),
  ('Licensing support', 5)
) AS d(name, sort_order)
WHERE s.slug = 'ip_protection'
ON CONFLICT (subscription_id, name) DO NOTHING;

-- Direct link to the SquadHire IP Protection Specialist category. The UUID is stable
-- and is seeded by Profiles migration 20261014130100.
INSERT INTO subscription_squadhire_profiles (subscription_id, squadhire_category_id)
SELECT s.id, 'ca148002-5800-4800-8800-000000000015'::uuid
FROM subscriptions s
WHERE s.slug = 'ip_protection'
ON CONFLICT (subscription_id, squadhire_category_id) DO NOTHING;

-- Assignment catalog entry. Copy existing Designer margins as a safe initial
-- baseline while keeping all values admin-editable.
INSERT INTO assignment_services (slug, name, description, is_active, sort_order)
SELECT
  'ip_protection',
  'IP Protection Specialist',
  'One-off ip protection specialist projects',
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
WHERE ads.slug = 'ip_protection'
ON CONFLICT (service_id, tier, country_id) DO NOTHING;



-- Subscription catalog.
INSERT INTO subscriptions (slug, name, description, is_active, sort_order)
SELECT
  'compliance',
  'Compliance Specialist',
  'Describe qualifications, industries, jurisdictions and compliance review experience.',
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
WHERE s.slug = 'compliance'
ON CONFLICT (subscription_id, plan, tier) DO NOTHING;

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
  ON ads_sub.id = ads_plan.subscription_id AND ads_sub.slug = 'compliance'
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
  ('Regulatory review', 1),
  ('Compliance audits', 2),
  ('Policy documentation', 3),
  ('Compliance calendars', 4),
  ('Governance support', 5)
) AS d(name, sort_order)
WHERE s.slug = 'compliance'
ON CONFLICT (subscription_id, name) DO NOTHING;

-- Direct link to the SquadHire Compliance Specialist category. The UUID is stable
-- and is seeded by Profiles migration 20261014130100.
INSERT INTO subscription_squadhire_profiles (subscription_id, squadhire_category_id)
SELECT s.id, 'ca148002-5800-4800-8800-000000000016'::uuid
FROM subscriptions s
WHERE s.slug = 'compliance'
ON CONFLICT (subscription_id, squadhire_category_id) DO NOTHING;

-- Assignment catalog entry. Copy existing Designer margins as a safe initial
-- baseline while keeping all values admin-editable.
INSERT INTO assignment_services (slug, name, description, is_active, sort_order)
SELECT
  'compliance',
  'Compliance Specialist',
  'One-off compliance specialist projects',
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
WHERE ads.slug = 'compliance'
ON CONFLICT (service_id, tier, country_id) DO NOTHING;



-- Subscription catalog.
INSERT INTO subscriptions (slug, name, description, is_active, sort_order)
SELECT
  'business_formation',
  'Business Formation Specialist',
  'Describe qualifications, entity structures and jurisdictions supported.',
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
WHERE s.slug = 'business_formation'
ON CONFLICT (subscription_id, plan, tier) DO NOTHING;

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
  ON ads_sub.id = ads_plan.subscription_id AND ads_sub.slug = 'business_formation'
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
  ('Entity structuring', 1),
  ('Formation documentation', 2),
  ('Founder agreements', 3),
  ('Registration coordination', 4),
  ('Governance setup', 5)
) AS d(name, sort_order)
WHERE s.slug = 'business_formation'
ON CONFLICT (subscription_id, name) DO NOTHING;

-- Direct link to the SquadHire Business Formation Specialist category. The UUID is stable
-- and is seeded by Profiles migration 20261014130100.
INSERT INTO subscription_squadhire_profiles (subscription_id, squadhire_category_id)
SELECT s.id, 'ca148002-5800-4800-8800-000000000017'::uuid
FROM subscriptions s
WHERE s.slug = 'business_formation'
ON CONFLICT (subscription_id, squadhire_category_id) DO NOTHING;

-- Assignment catalog entry. Copy existing Designer margins as a safe initial
-- baseline while keeping all values admin-editable.
INSERT INTO assignment_services (slug, name, description, is_active, sort_order)
SELECT
  'business_formation',
  'Business Formation Specialist',
  'One-off business formation specialist projects',
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
WHERE ads.slug = 'business_formation'
ON CONFLICT (service_id, tier, country_id) DO NOTHING;



-- Subscription catalog.
INSERT INTO subscriptions (slug, name, description, is_active, sort_order)
SELECT
  'end_to_end_hiring',
  'Recruitment Specialist',
  'Describe roles hired, sourcing methods, hiring volume and placement results.',
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
WHERE s.slug = 'end_to_end_hiring'
ON CONFLICT (subscription_id, plan, tier) DO NOTHING;

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
  ON ads_sub.id = ads_plan.subscription_id AND ads_sub.slug = 'end_to_end_hiring'
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
  ('Candidate sourcing', 1),
  ('Screening', 2),
  ('Interview coordination', 3),
  ('Offer coordination', 4),
  ('Recruitment reporting', 5)
) AS d(name, sort_order)
WHERE s.slug = 'end_to_end_hiring'
ON CONFLICT (subscription_id, name) DO NOTHING;

-- Direct link to the SquadHire Recruitment Specialist category. The UUID is stable
-- and is seeded by Profiles migration 20261014130100.
INSERT INTO subscription_squadhire_profiles (subscription_id, squadhire_category_id)
SELECT s.id, 'ca148002-5800-4800-8800-000000000018'::uuid
FROM subscriptions s
WHERE s.slug = 'end_to_end_hiring'
ON CONFLICT (subscription_id, squadhire_category_id) DO NOTHING;

-- Assignment catalog entry. Copy existing Designer margins as a safe initial
-- baseline while keeping all values admin-editable.
INSERT INTO assignment_services (slug, name, description, is_active, sort_order)
SELECT
  'end_to_end_hiring',
  'Recruitment Specialist',
  'One-off recruitment specialist projects',
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
WHERE ads.slug = 'end_to_end_hiring'
ON CONFLICT (service_id, tier, country_id) DO NOTHING;



-- Subscription catalog.
INSERT INTO subscriptions (slug, name, description, is_active, sort_order)
SELECT
  'team_building',
  'Team Building Specialist',
  'Describe teams supported, facilitation approach and organizational outcomes.',
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
WHERE s.slug = 'team_building'
ON CONFLICT (subscription_id, plan, tier) DO NOTHING;

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
  ON ads_sub.id = ads_plan.subscription_id AND ads_sub.slug = 'team_building'
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
  ('Workforce planning', 1),
  ('Team design', 2),
  ('Competency mapping', 3),
  ('Team development', 4),
  ('Manager enablement', 5)
) AS d(name, sort_order)
WHERE s.slug = 'team_building'
ON CONFLICT (subscription_id, name) DO NOTHING;

-- Direct link to the SquadHire Team Building Specialist category. The UUID is stable
-- and is seeded by Profiles migration 20261014130100.
INSERT INTO subscription_squadhire_profiles (subscription_id, squadhire_category_id)
SELECT s.id, 'ca148002-5800-4800-8800-000000000019'::uuid
FROM subscriptions s
WHERE s.slug = 'team_building'
ON CONFLICT (subscription_id, squadhire_category_id) DO NOTHING;

-- Assignment catalog entry. Copy existing Designer margins as a safe initial
-- baseline while keeping all values admin-editable.
INSERT INTO assignment_services (slug, name, description, is_active, sort_order)
SELECT
  'team_building',
  'Team Building Specialist',
  'One-off team building specialist projects',
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
WHERE ads.slug = 'team_building'
ON CONFLICT (service_id, tier, country_id) DO NOTHING;



-- Subscription catalog.
INSERT INTO subscriptions (slug, name, description, is_active, sort_order)
SELECT
  'hr_process',
  'HR Process Specialist',
  'Describe HR operations, workforce sizes, systems and process improvements.',
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
WHERE s.slug = 'hr_process'
ON CONFLICT (subscription_id, plan, tier) DO NOTHING;

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
  ON ads_sub.id = ads_plan.subscription_id AND ads_sub.slug = 'hr_process'
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
  ('Employee onboarding', 1),
  ('HR policies', 2),
  ('HR operations', 3),
  ('Performance processes', 4),
  ('Employee records', 5)
) AS d(name, sort_order)
WHERE s.slug = 'hr_process'
ON CONFLICT (subscription_id, name) DO NOTHING;

-- Direct link to the SquadHire HR Process Specialist category. The UUID is stable
-- and is seeded by Profiles migration 20261014130100.
INSERT INTO subscription_squadhire_profiles (subscription_id, squadhire_category_id)
SELECT s.id, 'ca148002-5800-4800-8800-000000000020'::uuid
FROM subscriptions s
WHERE s.slug = 'hr_process'
ON CONFLICT (subscription_id, squadhire_category_id) DO NOTHING;

-- Assignment catalog entry. Copy existing Designer margins as a safe initial
-- baseline while keeping all values admin-editable.
INSERT INTO assignment_services (slug, name, description, is_active, sort_order)
SELECT
  'hr_process',
  'HR Process Specialist',
  'One-off hr process specialist projects',
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
WHERE ads.slug = 'hr_process'
ON CONFLICT (service_id, tier, country_id) DO NOTHING;




COMMIT;
NOTIFY pgrst, 'reload schema';
