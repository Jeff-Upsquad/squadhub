-- Content Squad catalog, subscription plans, assignments and talent links.
BEGIN;
ALTER TABLE client_submission_brands DROP CONSTRAINT IF EXISTS client_submission_brands_service_type_check;
ALTER TABLE client_submission_brands ADD CONSTRAINT client_submission_brands_service_type_check CHECK(service_type IN ('designer', 'video_editor', 'designer_video_editor', 'accountant', 'ads_specialist', 'creative_director', 'copy_content_writer', 'social_media_manager', 'videographer_photographer', 'ai_video_image_creator'));

-- Subscription catalog.
INSERT INTO subscriptions (slug, name, description, is_active, sort_order)
SELECT
  'creative_director',
  'Creative Director',
  'Creative strategy, brand direction, campaign concepts and production leadership.',
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
WHERE s.slug = 'creative_director'
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
  ON ads_sub.id = ads_plan.subscription_id AND ads_sub.slug = 'creative_director'
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
  ('Brand strategy', 1),
  ('Campaign concepts', 2),
  ('Art direction', 3),
  ('Content strategy', 4),
  ('Video direction', 5),
  ('Creative production', 6),
  ('Brand guidelines', 7),
  ('Creative audits', 8)
) AS d(name, sort_order)
WHERE s.slug = 'creative_director'
ON CONFLICT (subscription_id, name) DO NOTHING;

-- Direct link to the SquadHire Creative Director category. The UUID is stable
-- and is seeded by Profiles migration 20261014130100.
INSERT INTO subscription_squadhire_profiles (subscription_id, squadhire_category_id)
SELECT s.id, 'ca148001-5800-4800-8800-000000000001'::uuid
FROM subscriptions s
WHERE s.slug = 'creative_director'
ON CONFLICT (subscription_id, squadhire_category_id) DO NOTHING;

-- Assignment catalog entry. Copy existing Designer margins as a safe initial
-- baseline while keeping all values admin-editable.
INSERT INTO assignment_services (slug, name, description, is_active, sort_order)
SELECT
  'creative_director',
  'Creative Director',
  'One-off creative direction, campaign strategy and production leadership projects',
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
WHERE ads.slug = 'creative_director'
ON CONFLICT (service_id, tier, country_id) DO NOTHING;


-- Subscription catalog.
INSERT INTO subscriptions (slug, name, description, is_active, sort_order)
SELECT
  'copy_content_writer',
  'Copy / Content Writer',
  'Brand copy, articles, scripts, email campaigns and search-focused content.',
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
WHERE s.slug = 'copy_content_writer'
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
  ON ads_sub.id = ads_plan.subscription_id AND ads_sub.slug = 'copy_content_writer'
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
  ('Website copy', 1),
  ('Blog articles', 2),
  ('SEO content', 3),
  ('Ad copy', 4),
  ('Email campaigns', 5),
  ('Social captions', 6),
  ('Video scripts', 7),
  ('Brand messaging', 8)
) AS d(name, sort_order)
WHERE s.slug = 'copy_content_writer'
ON CONFLICT (subscription_id, name) DO NOTHING;

-- Direct link to the SquadHire Copy / Content Writer category. The UUID is stable
-- and is seeded by Profiles migration 20261014130100.
INSERT INTO subscription_squadhire_profiles (subscription_id, squadhire_category_id)
SELECT s.id, 'ca148001-5800-4800-8800-000000000002'::uuid
FROM subscriptions s
WHERE s.slug = 'copy_content_writer'
ON CONFLICT (subscription_id, squadhire_category_id) DO NOTHING;

-- Assignment catalog entry. Copy existing Designer margins as a safe initial
-- baseline while keeping all values admin-editable.
INSERT INTO assignment_services (slug, name, description, is_active, sort_order)
SELECT
  'copy_content_writer',
  'Copy / Content Writer',
  'One-off copywriting, content writing and brand messaging projects',
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
WHERE ads.slug = 'copy_content_writer'
ON CONFLICT (service_id, tier, country_id) DO NOTHING;


-- Subscription catalog.
INSERT INTO subscriptions (slug, name, description, is_active, sort_order)
SELECT
  'social_media_manager',
  'Social Media Manager',
  'Social strategy, publishing, community management and organic audience growth.',
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
WHERE s.slug = 'social_media_manager'
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
  ON ads_sub.id = ads_plan.subscription_id AND ads_sub.slug = 'social_media_manager'
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
  ('Instagram', 1),
  ('Facebook', 2),
  ('LinkedIn', 3),
  ('YouTube', 4),
  ('TikTok', 5),
  ('X / Twitter', 6),
  ('Pinterest', 7),
  ('Community management', 8)
) AS d(name, sort_order)
WHERE s.slug = 'social_media_manager'
ON CONFLICT (subscription_id, name) DO NOTHING;

-- Direct link to the SquadHire Social Media Manager category. The UUID is stable
-- and is seeded by Profiles migration 20261014130100.
INSERT INTO subscription_squadhire_profiles (subscription_id, squadhire_category_id)
SELECT s.id, 'ca148001-5800-4800-8800-000000000003'::uuid
FROM subscriptions s
WHERE s.slug = 'social_media_manager'
ON CONFLICT (subscription_id, squadhire_category_id) DO NOTHING;

-- Assignment catalog entry. Copy existing Designer margins as a safe initial
-- baseline while keeping all values admin-editable.
INSERT INTO assignment_services (slug, name, description, is_active, sort_order)
SELECT
  'social_media_manager',
  'Social Media Manager',
  'One-off social strategy, publishing and community management projects',
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
WHERE ads.slug = 'social_media_manager'
ON CONFLICT (service_id, tier, country_id) DO NOTHING;


-- Subscription catalog.
INSERT INTO subscriptions (slug, name, description, is_active, sort_order)
SELECT
  'videographer_photographer',
  'Videographer / Photographer',
  'Brand, product, event and location photography and video production.',
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
WHERE s.slug = 'videographer_photographer'
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
  ON ads_sub.id = ads_plan.subscription_id AND ads_sub.slug = 'videographer_photographer'
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
  ('Product photography', 1),
  ('Brand films', 2),
  ('Events', 3),
  ('Portraits', 4),
  ('Food photography', 5),
  ('Real estate', 6),
  ('Interviews', 7),
  ('Social video shoots', 8)
) AS d(name, sort_order)
WHERE s.slug = 'videographer_photographer'
ON CONFLICT (subscription_id, name) DO NOTHING;

-- Direct link to the SquadHire Videographer / Photographer category. The UUID is stable
-- and is seeded by Profiles migration 20261014130100.
INSERT INTO subscription_squadhire_profiles (subscription_id, squadhire_category_id)
SELECT s.id, 'ca148001-5800-4800-8800-000000000004'::uuid
FROM subscriptions s
WHERE s.slug = 'videographer_photographer'
ON CONFLICT (subscription_id, squadhire_category_id) DO NOTHING;

-- Assignment catalog entry. Copy existing Designer margins as a safe initial
-- baseline while keeping all values admin-editable.
INSERT INTO assignment_services (slug, name, description, is_active, sort_order)
SELECT
  'videographer_photographer',
  'Videographer / Photographer',
  'One-off photography, video shoots and production projects',
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
WHERE ads.slug = 'videographer_photographer'
ON CONFLICT (service_id, tier, country_id) DO NOTHING;


-- Subscription catalog.
INSERT INTO subscriptions (slug, name, description, is_active, sort_order)
SELECT
  'ai_video_image_creator',
  'AI Video / Image Creator',
  'AI-assisted visual concepts, images and video with consistent creative finishing.',
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
WHERE s.slug = 'ai_video_image_creator'
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
  ON ads_sub.id = ads_plan.subscription_id AND ads_sub.slug = 'ai_video_image_creator'
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
  ('AI product images', 1),
  ('AI brand visuals', 2),
  ('AI video ads', 3),
  ('AI short films', 4),
  ('Storyboards', 5),
  ('Character design', 6),
  ('Image enhancement', 7),
  ('Visual concepts', 8)
) AS d(name, sort_order)
WHERE s.slug = 'ai_video_image_creator'
ON CONFLICT (subscription_id, name) DO NOTHING;

-- Direct link to the SquadHire AI Video / Image Creator category. The UUID is stable
-- and is seeded by Profiles migration 20261014130100.
INSERT INTO subscription_squadhire_profiles (subscription_id, squadhire_category_id)
SELECT s.id, 'ca148001-5800-4800-8800-000000000005'::uuid
FROM subscriptions s
WHERE s.slug = 'ai_video_image_creator'
ON CONFLICT (subscription_id, squadhire_category_id) DO NOTHING;

-- Assignment catalog entry. Copy existing Designer margins as a safe initial
-- baseline while keeping all values admin-editable.
INSERT INTO assignment_services (slug, name, description, is_active, sort_order)
SELECT
  'ai_video_image_creator',
  'AI Video / Image Creator',
  'One-off AI image, video and visual production projects',
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
WHERE ads.slug = 'ai_video_image_creator'
ON CONFLICT (service_id, tier, country_id) DO NOTHING;


COMMIT;
NOTIFY pgrst, 'reload schema';
