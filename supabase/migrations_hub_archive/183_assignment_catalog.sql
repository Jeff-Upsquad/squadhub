-- ============================================================
-- Assignment margin catalog
--
-- Assignments are one-off projects: the price is whatever the two sides
-- agree on, so — unlike the subscription catalog — there is no list price
-- here. What the catalog owns is OUR CUT, per service and experience level:
--
--   assignment_services → assignment_service_margins (level × country)
--
-- The margin is a flat amount or a percentage, and it applies in whichever
-- direction the deal runs:
--   priced brief   — the business commits an amount; the talent is shown
--                    that amount MINUS the margin
--   unpriced brief — the talent quotes; the business is shown that quote
--                    PLUS the margin
-- Both directions already exist in shared/ as partnerPriceFromCustomer and
-- customerPriceFromPartner; this table is the margin they read for
-- assignment cards (subscription cards read subscription_plan_pricing).
--
-- Per-country rows because a flat amount is currency-bound; percentages are
-- normally the same everywhere, so one India row is a complete setup for an
-- INR-only service.
--
-- RLS: enabled with no policies, matching the subscription catalog —
-- only the service role (the API) reads/writes these tables.
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ------------------------------------------------------------
-- Services. Admin-managed: the assignment line-up ("Content") is not the
-- same as the subscription line-up, so these are not a fixed seed.
-- `slug` is what a card's service_type resolves to.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS assignment_services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- The margin we keep, per level and country. No price column: assignments
-- have no catalog rate, only a cut.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS assignment_service_margins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id UUID NOT NULL REFERENCES assignment_services(id) ON DELETE CASCADE,
  tier TEXT NOT NULL CHECK (tier IN ('Junior', 'Pro', 'Top Talents')),
  country_id UUID NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
  margin_value INTEGER NOT NULL DEFAULT 0 CHECK (margin_value >= 0),
  margin_type TEXT NOT NULL DEFAULT 'fixed' CHECK (margin_type IN ('fixed', 'percent')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (service_id, tier, country_id)
);
CREATE INDEX IF NOT EXISTS idx_asg_margins_service ON assignment_service_margins(service_id);
CREATE INDEX IF NOT EXISTS idx_asg_margins_country ON assignment_service_margins(country_id);

-- ------------------------------------------------------------
-- updated_at triggers
-- ------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_assignment_services_updated_at ON assignment_services;
CREATE TRIGGER trg_assignment_services_updated_at
  BEFORE UPDATE ON assignment_services
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_assignment_margins_updated_at ON assignment_service_margins;
CREATE TRIGGER trg_assignment_margins_updated_at
  BEFORE UPDATE ON assignment_service_margins
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ------------------------------------------------------------
-- RLS: service-role only, same as the subscription catalog
-- ------------------------------------------------------------
ALTER TABLE assignment_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE assignment_service_margins ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- Seed the services that assignment cards can already be raised for, on the
-- same slugs the card editor maps service_type to. Admin adds the rest.
-- Margins start empty — nothing is assumed about our cut.
-- ------------------------------------------------------------
INSERT INTO assignment_services (slug, name, description, is_active, sort_order)
VALUES
  ('designer', 'Designer', 'One-off graphic design projects', true, 1),
  ('video_editor', 'Video Editor', 'One-off video editing projects', true, 2),
  ('designer_video_editor', 'Designer + Editor', 'One-off projects needing both design and video editing', true, 3),
  ('accountant', 'Accountant', 'One-off finance projects', true, 4)
ON CONFLICT (slug) DO NOTHING;

COMMENT ON TABLE assignment_service_margins IS
  'Our cut on an assignment, per service and experience level. Subtracted from a business-committed price; added to a talent-quoted price.';
