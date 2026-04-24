-- ============================================================
-- Subscription Cards
--   - Partners get targeting fields (tier / experience / location / languages)
--   - Each staged subscription on a lead can have a "card" capturing the brief,
--     working days, custom deliverables, and publish-to audience
--   - Publishing snapshots matching partners into a recipients table
--
-- Depends on 025 (subscriptions), 026 (countries/tiers),
-- and 043 (lead subs allow duplicates).
-- ============================================================

-- ------------------------------------------------------------
-- Partner targeting fields on users
-- Columns are nullable so non-partner users (internal/client/staff) are unaffected.
-- 'Custom' is a partner-only tier and deliberately NOT mirrored onto
-- subscription_plans.tier, whose CHECK stays (Junior/Pro/Elite).
-- ------------------------------------------------------------
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS tier TEXT
    CHECK (tier IN ('Junior','Pro','Elite','Custom')),
  ADD COLUMN IF NOT EXISTS min_experience_years INTEGER
    CHECK (min_experience_years >= 0),
  ADD COLUMN IF NOT EXISTS country_id UUID REFERENCES countries(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS state_region TEXT,
  ADD COLUMN IF NOT EXISTS languages TEXT[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_users_partner_match
  ON users(user_type, tier, country_id)
  WHERE user_type = 'partner' AND status = 'active';

CREATE INDEX IF NOT EXISTS idx_users_languages_gin
  ON users USING GIN (languages)
  WHERE user_type = 'partner';

-- ------------------------------------------------------------
-- subscription_cards: 1:1 with a staged subscription on a lead
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS subscription_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_subscription_id UUID NOT NULL UNIQUE
    REFERENCES client_submission_subscriptions(id) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'draft'
    CHECK (state IN ('draft','published','closed')),
  working_days TEXT[] NOT NULL DEFAULT '{}'
    CHECK (working_days <@ ARRAY['Mon','Tue','Wed','Thu','Fri','Sat','Sun']::text[]),
  brand_name TEXT,
  business_nature TEXT,
  notes TEXT,
  target_tier TEXT
    CHECK (target_tier IN ('Junior','Pro','Elite','Custom')),
  min_experience_years INTEGER NOT NULL DEFAULT 0
    CHECK (min_experience_years >= 0),
  target_languages TEXT[] NOT NULL DEFAULT '{}',
  -- Custom deliverables attached to the card (not to the plan/client).
  -- Shape per element: { id, name, kind: 'hours'|'item', per_day, per_week, per_month }
  custom_deliverables JSONB NOT NULL DEFAULT '[]',
  published_at TIMESTAMPTZ,
  published_by UUID REFERENCES users(id) ON DELETE SET NULL,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_subscription_cards_updated_at ON subscription_cards;
CREATE TRIGGER trg_subscription_cards_updated_at
  BEFORE UPDATE ON subscription_cards
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ------------------------------------------------------------
-- Target countries (0-N per card; empty = all countries match)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS subscription_card_target_countries (
  card_id UUID NOT NULL REFERENCES subscription_cards(id) ON DELETE CASCADE,
  country_id UUID NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
  PRIMARY KEY (card_id, country_id)
);

-- ------------------------------------------------------------
-- Target regions per country (0-N per (card, country))
-- If a country has zero region rows, country-match is enough.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS subscription_card_target_regions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id UUID NOT NULL REFERENCES subscription_cards(id) ON DELETE CASCADE,
  country_id UUID NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
  region TEXT NOT NULL,
  UNIQUE (card_id, country_id, region)
);
CREATE INDEX IF NOT EXISTS idx_sub_card_regions_card
  ON subscription_card_target_regions(card_id);

-- ------------------------------------------------------------
-- Recipients: matching partners snapshotted at publish time
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS subscription_card_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id UUID NOT NULL REFERENCES subscription_cards(id) ON DELETE CASCADE,
  partner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','accepted','rejected')),
  responded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (card_id, partner_id)
);

CREATE INDEX IF NOT EXISTS idx_scr_partner_pending
  ON subscription_card_recipients(partner_id, status)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_scr_card
  ON subscription_card_recipients(card_id);

CREATE INDEX IF NOT EXISTS idx_scr_partner
  ON subscription_card_recipients(partner_id);

-- ------------------------------------------------------------
-- RLS: service role bypasses; server routes enforce access.
-- Matches the pattern used by LMS (031) and subscriptions (025).
-- ------------------------------------------------------------
ALTER TABLE subscription_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_card_target_countries ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_card_target_regions ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_card_recipients ENABLE ROW LEVEL SECURITY;
