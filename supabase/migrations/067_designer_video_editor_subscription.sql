-- ============================================================
-- New subscription: "Designer + Editor" (slug: designer_video_editor)
-- ============================================================
-- Mirrors the Video Editor subscription's structure:
--  - 15 plan rows (5 plans × 3 tiers) seeded with the same hours
--  - per-country pricing rows copied from video_editor
--  - same default deliverable types
--
-- The link to SquadHire's "Designer + Editor" category is left for
-- the admin to set via the "SquadHire Profiles" dropdown so the
-- migration doesn't have to know SquadHire's category UUIDs.

INSERT INTO subscriptions (slug, name, description, is_active, sort_order)
VALUES (
  'designer_video_editor',
  'Designer + Editor',
  'Hybrid talent — graphic design and video editing in one resource.',
  true,
  3
)
ON CONFLICT (slug) DO NOTHING;

-- 15 plan rows (5 plans × 3 tiers) seeded from a Cartesian join, mirroring
-- the seed pattern used in migration 027.
INSERT INTO subscription_plans (subscription_id, plan, tier, is_active, sort_order, daily_hours, weekly_hours)
SELECT
  s.id,
  p.plan,
  t.tier,
  true,
  p.sort_order,
  p.daily_hours,
  p.weekly_hours
FROM subscriptions s
CROSS JOIN (
  VALUES
    ('Starter',  1, 1.0,  5),
    ('Basic',    2, 2.5, 10),
    ('Plus',     3, 4.5, 20),
    ('Pro',      4, 6.5, 30),
    ('Personal', 5, 8.0, 40)
) AS p(plan, sort_order, daily_hours, weekly_hours)
CROSS JOIN (
  VALUES ('Junior'), ('Pro'), ('Elite')
) AS t(tier)
WHERE s.slug = 'designer_video_editor'
  AND NOT EXISTS (
    SELECT 1 FROM subscription_plans sp
    WHERE sp.subscription_id = s.id
      AND sp.plan = p.plan
      AND sp.tier = t.tier
  );

-- Copy per-country pricing rows from the matching Video Editor plan
-- (same plan name + tier). Includes margin_value/margin_type so the new
-- subscription has identical economics to Video Editor on day one.
INSERT INTO subscription_plan_pricing (plan_id, country_id, price, margin_value, margin_type)
SELECT
  new_sp.id,
  ve_pricing.country_id,
  ve_pricing.price,
  ve_pricing.margin_value,
  ve_pricing.margin_type
FROM subscription_plans new_sp
JOIN subscriptions new_sub ON new_sub.id = new_sp.subscription_id AND new_sub.slug = 'designer_video_editor'
JOIN subscriptions ve_sub ON ve_sub.slug = 'video_editor'
JOIN subscription_plans ve_sp
  ON ve_sp.subscription_id = ve_sub.id
 AND ve_sp.plan = new_sp.plan
 AND ve_sp.tier = new_sp.tier
JOIN subscription_plan_pricing ve_pricing ON ve_pricing.plan_id = ve_sp.id
ON CONFLICT (plan_id, country_id) DO NOTHING;

-- Mirror Video Editor's default deliverable types so the new subscription
-- has the same dropdown options on the card editor.
INSERT INTO subscription_deliverable_types (subscription_id, name, is_active, sort_order)
SELECT new_sub.id, ve_dt.name, ve_dt.is_active, ve_dt.sort_order
FROM subscriptions new_sub
JOIN subscriptions ve_sub ON ve_sub.slug = 'video_editor'
JOIN subscription_deliverable_types ve_dt ON ve_dt.subscription_id = ve_sub.id
WHERE new_sub.slug = 'designer_video_editor'
ON CONFLICT (subscription_id, name) DO NOTHING;
