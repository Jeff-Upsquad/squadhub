-- ============================================================
-- Subscription tiers + country catalog
--   - Adds a countries table (admin-managed)
--   - Plans get a tier (Junior / Pro / Elite)
--   - Plan pricing moves to a per-country row (replaces price_inr/price_usd)
--   - clients.country / client_submissions.country → FK country_id
-- Assumes migration 025 has been applied.
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ------------------------------------------------------------
-- Countries catalog
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS countries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  currency TEXT NOT NULL CHECK (currency IN ('INR', 'USD')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_countries_updated_at ON countries;
CREATE TRIGGER trg_countries_updated_at
  BEFORE UPDATE ON countries
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Seed defaults (India is the only INR country; the rest are USD)
INSERT INTO countries (name, currency, sort_order)
VALUES
  ('India', 'INR', 1),
  ('United States', 'USD', 2),
  ('United Kingdom', 'USD', 3),
  ('United Arab Emirates', 'USD', 4),
  ('Canada', 'USD', 5),
  ('Australia', 'USD', 6),
  ('Singapore', 'USD', 7)
ON CONFLICT (name) DO NOTHING;

-- ------------------------------------------------------------
-- Subscription plans: add `tier`
-- ------------------------------------------------------------
ALTER TABLE subscription_plans
  ADD COLUMN IF NOT EXISTS tier TEXT NOT NULL DEFAULT 'Junior'
    CHECK (tier IN ('Junior', 'Pro', 'Elite'));

-- Seed tier from existing plan name.
-- Guard with `tier = 'Junior'` so a re-run never overwrites an admin choice.
UPDATE subscription_plans SET tier = 'Pro'
  WHERE plan IN ('Plus', 'Pro') AND tier = 'Junior';

UPDATE subscription_plans SET tier = 'Elite'
  WHERE plan = 'Personal' AND tier = 'Junior';

-- ------------------------------------------------------------
-- Per-country plan pricing
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS subscription_plan_pricing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES subscription_plans(id) ON DELETE CASCADE,
  country_id UUID NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
  price INTEGER NOT NULL CHECK (price >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (plan_id, country_id)
);
CREATE INDEX IF NOT EXISTS idx_sub_plan_pricing_plan ON subscription_plan_pricing(plan_id);
CREATE INDEX IF NOT EXISTS idx_sub_plan_pricing_country ON subscription_plan_pricing(country_id);

DROP TRIGGER IF EXISTS trg_sub_plan_pricing_updated_at ON subscription_plan_pricing;
CREATE TRIGGER trg_sub_plan_pricing_updated_at
  BEFORE UPDATE ON subscription_plan_pricing
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Migrate existing inline prices into the new table (if present)
-- India pricing from price_inr
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'subscription_plans' AND column_name = 'price_inr'
  ) THEN
    INSERT INTO subscription_plan_pricing (plan_id, country_id, price)
    SELECT sp.id, c.id, sp.price_inr
    FROM subscription_plans sp
    CROSS JOIN countries c
    WHERE c.name = 'India' AND sp.price_inr IS NOT NULL
    ON CONFLICT (plan_id, country_id) DO NOTHING;

    INSERT INTO subscription_plan_pricing (plan_id, country_id, price)
    SELECT sp.id, c.id, sp.price_usd
    FROM subscription_plans sp
    CROSS JOIN countries c
    WHERE c.name = 'United States' AND sp.price_usd IS NOT NULL
    ON CONFLICT (plan_id, country_id) DO NOTHING;

    ALTER TABLE subscription_plans DROP COLUMN price_inr;
    ALTER TABLE subscription_plans DROP COLUMN price_usd;
  END IF;
END $$;

-- ------------------------------------------------------------
-- Clients + submissions: text country → country_id FK
-- ------------------------------------------------------------
ALTER TABLE clients ADD COLUMN IF NOT EXISTS country_id UUID REFERENCES countries(id);
ALTER TABLE client_submissions ADD COLUMN IF NOT EXISTS country_id UUID REFERENCES countries(id);

-- Backfill from old text column, if it still exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'clients' AND column_name = 'country'
  ) THEN
    UPDATE clients SET country_id = (SELECT id FROM countries WHERE name = 'India')
      WHERE country_id IS NULL AND (country = 'India' OR country IS NULL);
    UPDATE clients SET country_id = (SELECT id FROM countries WHERE name = 'United States')
      WHERE country_id IS NULL AND country = 'International';
    ALTER TABLE clients DROP COLUMN country;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'client_submissions' AND column_name = 'country'
  ) THEN
    UPDATE client_submissions SET country_id = (SELECT id FROM countries WHERE name = 'India')
      WHERE country_id IS NULL AND (country = 'India' OR country IS NULL);
    UPDATE client_submissions SET country_id = (SELECT id FROM countries WHERE name = 'United States')
      WHERE country_id IS NULL AND country = 'International';
    ALTER TABLE client_submissions DROP COLUMN country;
  END IF;
END $$;

-- Fill any remaining NULLs with India as a safe default
UPDATE clients SET country_id = (SELECT id FROM countries WHERE name = 'India')
  WHERE country_id IS NULL;
UPDATE client_submissions SET country_id = (SELECT id FROM countries WHERE name = 'India')
  WHERE country_id IS NULL;

ALTER TABLE clients ALTER COLUMN country_id SET NOT NULL;
ALTER TABLE client_submissions ALTER COLUMN country_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_clients_country ON clients(country_id);
CREATE INDEX IF NOT EXISTS idx_client_submissions_country ON client_submissions(country_id);
