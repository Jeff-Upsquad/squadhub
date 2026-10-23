-- ============================================================
-- New subscription: "Accountant" (slug: accountant)
-- ============================================================
-- Adds accountant as a first-class subscription so the new
-- /connect/accountant Client Brief form can create publishable
-- subscription_cards that flow through the same admin pipeline
-- as designer / video_editor.
--
-- Mirrors migration 067 (Designer + Editor):
--   - relax the service_type CHECK on client_submission_brands
--   - 15 plan rows (5 plans × 3 tiers) with the same hour bands
--   - per-country pricing copied from the Designer subscription
--   - accountant-specific deliverable types
--
-- The link to SquadHire's accountant category is left for the
-- admin to set via the "SquadHire Profiles" dropdown, so this
-- migration doesn't need to know SquadHire's category UUIDs.

-- ------------------------------------------------------------
-- 1. Allow 'accountant' as a brand service_type slug. The inline
--    CHECK from migration 081 is auto-named; find and drop it by
--    definition so this works regardless of the generated name.
-- ------------------------------------------------------------
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
  CHECK (service_type IN ('designer','video_editor','designer_video_editor','accountant'));

-- ------------------------------------------------------------
-- 2. The subscription row. sort_order is appended after the
--    existing subscriptions.
-- ------------------------------------------------------------
INSERT INTO subscriptions (slug, name, description, is_active, sort_order)
SELECT
  'accountant',
  'Accountant',
  'Accounting talent — bookkeeping, GST & TDS, payroll, and financial reporting.',
  true,
  (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM subscriptions)
ON CONFLICT (slug) DO NOTHING;

-- ------------------------------------------------------------
-- 3. 15 plan rows (5 plans × 3 tiers) from a Cartesian join,
--    mirroring migration 067's hour bands.
-- ------------------------------------------------------------
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
    ('Basic',    2, 2.0, 10),
    ('Plus',     3, 4.0, 20),
    ('Pro',      4, 6.0, 30),
    ('Personal', 5, 8.0, 40)
) AS p(plan, sort_order, daily_hours, weekly_hours)
CROSS JOIN (
  VALUES ('Junior'), ('Pro'), ('Elite')
) AS t(tier)
WHERE s.slug = 'accountant'
  AND NOT EXISTS (
    SELECT 1 FROM subscription_plans sp
    WHERE sp.subscription_id = s.id
      AND sp.plan = p.plan
      AND sp.tier = t.tier
  );

-- ------------------------------------------------------------
-- 4. Per-country pricing copied from the Designer subscription
--    (same plan + tier) so accountant has full per-country
--    pricing on day one. Admin can adjust per-country prices.
-- ------------------------------------------------------------
INSERT INTO subscription_plan_pricing (plan_id, country_id, price, margin_value, margin_type)
SELECT
  new_sp.id,
  base_pricing.country_id,
  base_pricing.price,
  base_pricing.margin_value,
  base_pricing.margin_type
FROM subscription_plans new_sp
JOIN subscriptions new_sub ON new_sub.id = new_sp.subscription_id AND new_sub.slug = 'accountant'
JOIN subscriptions base_sub ON base_sub.slug = 'designer'
JOIN subscription_plans base_sp
  ON base_sp.subscription_id = base_sub.id
 AND base_sp.plan = new_sp.plan
 AND base_sp.tier = new_sp.tier
JOIN subscription_plan_pricing base_pricing ON base_pricing.plan_id = base_sp.id
ON CONFLICT (plan_id, country_id) DO NOTHING;

-- ------------------------------------------------------------
-- 5. Accountant-specific deliverable types (the card editor's
--    deliverable dropdown). Distinct from designer/editor outputs.
-- ------------------------------------------------------------
INSERT INTO subscription_deliverable_types (subscription_id, name, is_active, sort_order)
SELECT s.id, dt.name, true, dt.sort_order
FROM subscriptions s
CROSS JOIN (
  VALUES
    ('Bookkeeping', 1),
    ('GST & TDS filing', 2),
    ('Payroll processing', 3),
    ('Financial reporting (MIS)', 4),
    ('Income tax filing', 5),
    ('Audit support', 6)
) AS dt(name, sort_order)
WHERE s.slug = 'accountant'
ON CONFLICT (subscription_id, name) DO NOTHING;
