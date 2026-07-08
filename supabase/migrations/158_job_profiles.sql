-- =============================================================
-- Job Cards (hiring service) — profile hierarchy
-- =============================================================
-- Onboarding entities for the Job Cards module:
--   business_profiles   — parent profile (everything a candidate should
--                         know about the business)
--   business_locations  — saved interview venues (reused via dropdown when
--                         scheduling physical interviews)
--   brand_profiles      — optional 0..n brands under a business
--   job_profiles        — n per business; each linked to the business
--                         itself OR one of its brands; carries the default
--                         candidate preference rules that job_cards can
--                         override per card.
--
-- Written/read only by the server via the service-role client (RLS enabled
-- with no policies — matches subscription_cards, migration 044).
-- =============================================================

CREATE TABLE business_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_submission_id UUID REFERENCES client_submissions(id) ON DELETE SET NULL,
  client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  about TEXT,
  industry TEXT,
  company_size TEXT,                                     -- e.g. '11-50'
  website TEXT,
  socials JSONB NOT NULL DEFAULT '{}',                   -- {linkedin, instagram, ...}
  logo_url TEXT,
  photos JSONB NOT NULL DEFAULT '[]',                    -- [{url, caption}]
  culture TEXT,
  perks JSONB NOT NULL DEFAULT '[]',                     -- [string]
  founded_year INTEGER,
  contact_name TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  -- A business profile always hangs off the lead pipeline: a submission
  -- (pre-conversion) or a converted client.
  CONSTRAINT chk_bp_owner CHECK (lead_submission_id IS NOT NULL OR client_id IS NOT NULL)
);

CREATE INDEX idx_business_profiles_submission ON business_profiles(lead_submission_id);
CREATE INDEX idx_business_profiles_client ON business_profiles(client_id);

DROP TRIGGER IF EXISTS trg_business_profiles_updated_at ON business_profiles;
CREATE TRIGGER trg_business_profiles_updated_at
  BEFORE UPDATE ON business_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TABLE business_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_profile_id UUID NOT NULL REFERENCES business_profiles(id) ON DELETE CASCADE,
  label TEXT NOT NULL,                                   -- 'Head Office'
  address TEXT NOT NULL,
  city TEXT,
  region TEXT,
  country_id UUID REFERENCES countries(id) ON DELETE SET NULL,
  postal_code TEXT,
  google_maps_url TEXT,
  latitude NUMERIC(9,6),
  longitude NUMERIC(9,6),
  is_primary BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_business_locations_profile ON business_locations(business_profile_id);

DROP TRIGGER IF EXISTS trg_business_locations_updated_at ON business_locations;
CREATE TRIGGER trg_business_locations_updated_at
  BEFORE UPDATE ON business_locations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TABLE brand_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_profile_id UUID NOT NULL REFERENCES business_profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  about TEXT,
  industry TEXT,
  website TEXT,
  socials JSONB NOT NULL DEFAULT '{}',
  logo_url TEXT,
  photos JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_brand_profiles_business ON brand_profiles(business_profile_id);

DROP TRIGGER IF EXISTS trg_brand_profiles_updated_at ON brand_profiles;
CREATE TRIGGER trg_brand_profiles_updated_at
  BEFORE UPDATE ON brand_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TABLE job_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_profile_id UUID NOT NULL REFERENCES business_profiles(id) ON DELETE CASCADE,
  -- NULL = job hangs directly off the business profile; set = off a brand.
  brand_profile_id UUID REFERENCES brand_profiles(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  responsibilities JSONB NOT NULL DEFAULT '[]',          -- [string]
  requirements JSONB NOT NULL DEFAULT '[]',              -- [string]
  skills TEXT[] NOT NULL DEFAULT '{}',
  min_experience_years INTEGER CHECK (min_experience_years >= 0),
  max_experience_years INTEGER,
  education TEXT,
  employment_type TEXT NOT NULL DEFAULT 'full_time'
    CHECK (employment_type IN ('full_time','part_time','contract','internship')),
  work_mode TEXT NOT NULL DEFAULT 'onsite'
    CHECK (work_mode IN ('onsite','remote','hybrid')),
  location_id UUID REFERENCES business_locations(id) ON DELETE SET NULL,
  working_days TEXT[] NOT NULL DEFAULT '{}',
  working_hours JSONB,                                   -- {start:'09:30', end:'18:00', timezone:'Asia/Kolkata'}
  salary_min INTEGER,
  salary_max INTEGER,
  salary_currency TEXT NOT NULL DEFAULT 'INR',
  salary_period TEXT NOT NULL DEFAULT 'monthly' CHECK (salary_period IN ('monthly','annual')),
  benefits JSONB NOT NULL DEFAULT '[]',                  -- [string]
  growth_path TEXT,
  -- Default candidate preference RULES. Keys use the SquadHire matcher
  -- vocabulary so mergeJobRules() output maps 1:1 onto the webhook
  -- match_rules: { min_age, max_age, target_genders, target_languages,
  --   target_country_ids, target_regions: [{country_id, region}],
  --   target_districts, target_tiers, min_experience_years }
  -- job_cards.rule_overrides overrides these key-by-key per card.
  preference_rules JSONB NOT NULL DEFAULT '{}',
  squadhire_category_ids UUID[] NOT NULL DEFAULT '{}',   -- Designer / Video Editor categories
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_job_profiles_business ON job_profiles(business_profile_id);
CREATE INDEX idx_job_profiles_brand ON job_profiles(brand_profile_id);

DROP TRIGGER IF EXISTS trg_job_profiles_updated_at ON job_profiles;
CREATE TRIGGER trg_job_profiles_updated_at
  BEFORE UPDATE ON job_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS: service role bypasses; server routes enforce access (matches 044/157).
ALTER TABLE business_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE brand_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_profiles ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
