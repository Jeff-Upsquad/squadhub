-- Creator subscription and assignment catalogs; apply with the companion Profiles category.
ALTER TABLE client_submission_brands DROP CONSTRAINT IF EXISTS client_submission_brands_service_type_check;
ALTER TABLE client_submission_brands ADD CONSTRAINT client_submission_brands_service_type_check CHECK(service_type IN ('designer','video_editor','designer_video_editor','accountant','ads_specialist','creative_director','copy_content_writer','social_media_manager','videographer','photographer','videographer_photographer','ai_video_image_creator','seo_specialist','digital_marketing_team','influencer_marketing','offline_marketing','web_development','app_building','automation','software_solutions','cfo_ca','gst_experts','tds_experts','labour_law','incorporation','contract_drafting','ip_protection','compliance','business_formation','end_to_end_hiring','team_building','hr_process','social_media_creator'));
-- Subscription catalog.
INSERT INTO subscriptions (slug, name, description, is_active, sort_order)
SELECT
  'social_media_creator',
  'Social Media Creator',
  'Individual and channel creators publishing content across social platforms.',
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
WHERE s.slug = 'social_media_creator'
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
  ON ads_sub.id = ads_plan.subscription_id AND ads_sub.slug = 'social_media_creator'
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
  ('Short-form video', 1),
  ('Long-form video', 2),
  ('Stories', 3),
  ('Sponsored posts', 4),
  ('UGC production', 5),
  ('Live streams', 6)
) AS d(name, sort_order)
WHERE s.slug = 'social_media_creator'
ON CONFLICT (subscription_id, name) DO NOTHING;

-- Direct link to the SquadHire Social Media Creator category. The UUID is stable
-- and is seeded by the companion Profiles social_media_creators migration.
INSERT INTO subscription_squadhire_profiles (subscription_id, squadhire_category_id)
SELECT s.id, 'ca148003-5800-4800-8800-000000000001'::uuid
FROM subscriptions s
WHERE s.slug = 'social_media_creator'
ON CONFLICT (subscription_id, squadhire_category_id) DO NOTHING;

-- Assignment catalog entry. Copy existing Designer margins as a safe initial
-- baseline while keeping all values admin-editable.
INSERT INTO assignment_services (slug, name, description, is_active, sort_order)
SELECT
  'social_media_creator',
  'Social Media Creator',
  'One-off social media creator projects',
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
WHERE ads.slug = 'social_media_creator'
ON CONFLICT (service_id, tier, country_id) DO NOTHING;




