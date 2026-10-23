-- ============================================================
-- Subscriptions restructure:
--   - Promote subscriptions to a top-level module
--   - Hardcode 2 subscriptions: Designer, Video Editor
--   - 5 fixed plans per subscription with INR + USD pricing
--   - Per-subscription deliverable-type catalog
--   - Plan-level + per-client deliverable rows
--   - Client country (India / International)
-- Only 1 test row existed previously, so we do a full rewrite.
-- ============================================================

-- Ensure the shared updated_at trigger function exists (idempotent)
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ------------------------------------------------------------
-- Drop old tables (fresh start; only test data existed)
-- ------------------------------------------------------------
DROP TABLE IF EXISTS client_subscriptions CASCADE;
DROP TABLE IF EXISTS subscriptions CASCADE;

-- ------------------------------------------------------------
-- Clients + submissions: add country
-- ------------------------------------------------------------
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS country TEXT NOT NULL DEFAULT 'India'
    CHECK (country IN ('India', 'International'));

ALTER TABLE client_submissions
  ADD COLUMN IF NOT EXISTS country TEXT NOT NULL DEFAULT 'India'
    CHECK (country IN ('India', 'International'));

-- ------------------------------------------------------------
-- Subscriptions catalog (hardcoded: 2 rows)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Plan tiers per subscription (5 rows per subscription)
CREATE TABLE IF NOT EXISTS subscription_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id UUID NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  plan TEXT NOT NULL CHECK (plan IN ('Starter', 'Basic', 'Plus', 'Pro', 'Personal')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  price_inr INTEGER CHECK (price_inr IS NULL OR price_inr >= 0),
  price_usd INTEGER CHECK (price_usd IS NULL OR price_usd >= 0),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (subscription_id, plan)
);
CREATE INDEX IF NOT EXISTS idx_sub_plans_sub ON subscription_plans(subscription_id);

-- Per-subscription deliverable-type catalog (e.g., "Poster Design")
CREATE TABLE IF NOT EXISTS subscription_deliverable_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id UUID NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (subscription_id, name)
);
CREATE INDEX IF NOT EXISTS idx_sub_dtypes_sub ON subscription_deliverable_types(subscription_id);

-- Plan-level default deliverables
-- kind='hours' => deliverable_type_id IS NULL
-- kind='item'  => deliverable_type_id IS NOT NULL
CREATE TABLE IF NOT EXISTS subscription_plan_deliverables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES subscription_plans(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('hours', 'item')),
  deliverable_type_id UUID REFERENCES subscription_deliverable_types(id) ON DELETE RESTRICT,
  per_day NUMERIC(8,2) NOT NULL DEFAULT 0,
  per_week NUMERIC(8,2) NOT NULL DEFAULT 0,
  per_month NUMERIC(8,2) NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (kind = 'hours' AND deliverable_type_id IS NULL)
    OR
    (kind = 'item' AND deliverable_type_id IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_sub_plan_delivs_plan ON subscription_plan_deliverables(plan_id);

-- ------------------------------------------------------------
-- Client subscription assignments (rewritten)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS client_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  subscription_id UUID NOT NULL REFERENCES subscriptions(id),
  plan_id UUID NOT NULL REFERENCES subscription_plans(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, subscription_id)
);
CREATE INDEX IF NOT EXISTS idx_cs_client ON client_subscriptions(client_id);
CREATE INDEX IF NOT EXISTS idx_cs_plan ON client_subscriptions(plan_id);

-- Per-client deliverable rows (copied from plan defaults on assignment, editable thereafter)
CREATE TABLE IF NOT EXISTS client_subscription_deliverables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_subscription_id UUID NOT NULL REFERENCES client_subscriptions(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('hours', 'item')),
  deliverable_type_id UUID REFERENCES subscription_deliverable_types(id) ON DELETE RESTRICT,
  per_day NUMERIC(8,2) NOT NULL DEFAULT 0,
  per_week NUMERIC(8,2) NOT NULL DEFAULT 0,
  per_month NUMERIC(8,2) NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (kind = 'hours' AND deliverable_type_id IS NULL)
    OR
    (kind = 'item' AND deliverable_type_id IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_csd_cs ON client_subscription_deliverables(client_subscription_id);

-- ------------------------------------------------------------
-- updated_at triggers
-- ------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_subscriptions_updated_at ON subscriptions;
CREATE TRIGGER trg_subscriptions_updated_at
  BEFORE UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_sub_plans_updated_at ON subscription_plans;
CREATE TRIGGER trg_sub_plans_updated_at
  BEFORE UPDATE ON subscription_plans
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_sub_dtypes_updated_at ON subscription_deliverable_types;
CREATE TRIGGER trg_sub_dtypes_updated_at
  BEFORE UPDATE ON subscription_deliverable_types
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_sub_plan_delivs_updated_at ON subscription_plan_deliverables;
CREATE TRIGGER trg_sub_plan_delivs_updated_at
  BEFORE UPDATE ON subscription_plan_deliverables
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_client_subscriptions_updated_at ON client_subscriptions;
CREATE TRIGGER trg_client_subscriptions_updated_at
  BEFORE UPDATE ON client_subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_csd_updated_at ON client_subscription_deliverables;
CREATE TRIGGER trg_csd_updated_at
  BEFORE UPDATE ON client_subscription_deliverables
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ------------------------------------------------------------
-- Seed: 2 hardcoded subscriptions
-- ------------------------------------------------------------
INSERT INTO subscriptions (slug, name, description, is_active, sort_order)
VALUES
  ('designer', 'Designer', 'Graphic design services', true, 1),
  ('video_editor', 'Video Editor', 'Video editing services', true, 2)
ON CONFLICT (slug) DO NOTHING;

-- Seed: 5 plans per subscription (10 rows), prices NULL until admin sets them
INSERT INTO subscription_plans (subscription_id, plan, is_active, sort_order)
SELECT s.id, p.plan, true, p.sort_order
FROM subscriptions s
CROSS JOIN (
  VALUES
    ('Starter', 1),
    ('Basic', 2),
    ('Plus', 3),
    ('Pro', 4),
    ('Personal', 5)
) AS p(plan, sort_order)
ON CONFLICT (subscription_id, plan) DO NOTHING;

-- Seed: default deliverable types per subscription
INSERT INTO subscription_deliverable_types (subscription_id, name, is_active, sort_order)
SELECT s.id, d.name, true, d.sort_order
FROM subscriptions s
JOIN LATERAL (
  SELECT name, sort_order
  FROM (
    VALUES
      ('designer', 'Poster Design', 1),
      ('designer', 'Logo Design', 2),
      ('designer', 'Social Media Post', 3),
      ('designer', 'Banner', 4),
      ('video_editor', 'Reel Edit', 1),
      ('video_editor', 'Long-Form Edit', 2),
      ('video_editor', 'Short Video', 3),
      ('video_editor', 'Thumbnail', 4)
  ) AS seed(slug, name, sort_order)
  WHERE seed.slug = s.slug
) d ON TRUE
ON CONFLICT (subscription_id, name) DO NOTHING;
