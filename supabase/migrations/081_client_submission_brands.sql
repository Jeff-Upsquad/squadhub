-- ============================================================
-- Client Submission Brands
--   - Brief form (squadhub.in/connect) and the future landing-page
--     form now write a client_submissions row per CONTACT and a
--     client_submission_brands row per BRAND, so one lead can hold
--     several brands without overwriting earlier ones.
--   - subscription_cards (the publishable brief) gains a nullable
--     brand_id FK so the admin pipeline can group cards under their
--     parent brand.
--   - Backfills existing shared_form / landing_page_form cards so
--     they show up immediately in Clients > New Clients.
--
-- Depends on:
--   009 (client_submissions), 044 (subscription_cards + targeting),
--   045 (target_tiers plural), 076 (source values).
-- ============================================================

-- ------------------------------------------------------------
-- 1. Relax client_submissions NOT NULLs that the brief form
--    doesn't capture. business_address is the only one that's
--    incompatible; the rest of the brief form's contact fields
--    map cleanly to existing NOT NULL columns.
-- ------------------------------------------------------------
ALTER TABLE client_submissions
  ALTER COLUMN business_address DROP NOT NULL;

-- ------------------------------------------------------------
-- 2. client_submission_brands: one row per (lead, brand_name)
--    Same brand re-submitted -> UPDATE this row.
--    Different brand_name -> INSERT a new row under the same lead.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS client_submission_brands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id UUID NOT NULL
    REFERENCES client_submissions(id) ON DELETE CASCADE,
  brand_name TEXT NOT NULL,
  business_nature TEXT,
  business_note TEXT,
  requirement_note TEXT,
  -- Slug, not display label, so the form can rehydrate Step 1 roles
  -- directly without label<->slug reverse mapping.
  service_type TEXT
    CHECK (service_type IN ('designer','video_editor','designer_video_editor')),
  target_languages TEXT[] NOT NULL DEFAULT '{}',
  working_days TEXT[] NOT NULL DEFAULT '{}'
    CHECK (working_days <@ ARRAY['Mon','Tue','Wed','Thu','Fri','Sat','Sun']::text[]),
  country_id UUID REFERENCES countries(id) ON DELETE SET NULL,
  target_tiers TEXT[] NOT NULL DEFAULT '{}'
    CHECK (target_tiers <@ ARRAY['Junior','Pro','Elite','Custom']::text[]),
  business_location TEXT,
  source TEXT NOT NULL
    CHECK (source IN ('shared_form','landing_page_form')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Case-insensitive brand uniqueness per lead.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_client_submission_brand_per_lead
  ON client_submission_brands (submission_id, lower(brand_name));

CREATE INDEX IF NOT EXISTS idx_client_submission_brands_submission
  ON client_submission_brands (submission_id);

CREATE INDEX IF NOT EXISTS idx_client_submission_brands_updated
  ON client_submission_brands (updated_at DESC);

DROP TRIGGER IF EXISTS trg_client_submission_brands_updated_at ON client_submission_brands;
CREATE TRIGGER trg_client_submission_brands_updated_at
  BEFORE UPDATE ON client_submission_brands
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE client_submission_brands ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- 3. Per-region targeting per brand (mirrors
--    subscription_card_target_regions). Empty region set means
--    country-only match.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS client_submission_brand_regions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID NOT NULL
    REFERENCES client_submission_brands(id) ON DELETE CASCADE,
  country_id UUID NOT NULL
    REFERENCES countries(id) ON DELETE CASCADE,
  region TEXT NOT NULL,
  UNIQUE (brand_id, country_id, region)
);

CREATE INDEX IF NOT EXISTS idx_client_submission_brand_regions_brand
  ON client_submission_brand_regions (brand_id);

ALTER TABLE client_submission_brand_regions ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- 4. subscription_cards.brand_id — nullable, ON DELETE SET NULL.
--    Existing cards keep working; new shared_form / landing_page_form
--    cards point to a brand row.
-- ------------------------------------------------------------
ALTER TABLE subscription_cards
  ADD COLUMN IF NOT EXISTS brand_id UUID
    REFERENCES client_submission_brands(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_subscription_cards_brand
  ON subscription_cards (brand_id);

-- ------------------------------------------------------------
-- 5. Backfill — for every existing subscription_cards row that
--    came from the public forms, materialise the missing lead +
--    brand records and link the card. Idempotent: keyed inserts
--    use ON CONFLICT, region inserts use UNIQUE.
--
-- Notes:
--   * Lead match: lower(trim(email)) first, then last-10-digit
--     suffix on contact_number, then create new.
--   * Brand match: (submission_id, lower(brand_name)). If the
--     same brand has multiple cards, the most-recent card's
--     fields win (ORDER BY created_at DESC LIMIT 1).
--   * country_id on the lead defaults to India when no
--     subscription_card_target_countries row exists. Admin can fix.
-- ------------------------------------------------------------
DO $$
DECLARE
  india_country_id UUID;
  card RECORD;
  v_lead_id UUID;
  v_brand_id UUID;
  card_country_id UUID;
BEGIN
  SELECT id INTO india_country_id FROM countries WHERE name = 'India' LIMIT 1;

  FOR card IN
    SELECT *
    FROM subscription_cards
    WHERE source IN ('shared_form','landing_page_form')
      AND customer_email IS NOT NULL
      AND brand_id IS NULL
    ORDER BY created_at ASC
  LOOP
    -- Resolve a country for the lead row (NOT NULL). Prefer the card's
    -- first target country; else India; else any country (last resort).
    SELECT country_id INTO card_country_id
    FROM subscription_card_target_countries
    WHERE card_id = card.id
    LIMIT 1;

    IF card_country_id IS NULL THEN
      card_country_id := india_country_id;
    END IF;

    IF card_country_id IS NULL THEN
      SELECT id INTO card_country_id FROM countries ORDER BY sort_order LIMIT 1;
    END IF;

    -- 5a. Find or create the lead by email (case-insensitive) or
    -- last-10-digit phone suffix.
    SELECT id INTO v_lead_id
    FROM client_submissions
    WHERE lower(trim(email)) = lower(trim(card.customer_email))
       OR (
         card.customer_phone IS NOT NULL
         AND length(regexp_replace(card.customer_phone,'\D','','g')) >= 7
         AND right(regexp_replace(contact_number,'\D','','g'), 10)
             = right(regexp_replace(card.customer_phone,'\D','','g'), 10)
       )
    ORDER BY created_at ASC
    LIMIT 1;

    IF v_lead_id IS NULL THEN
      INSERT INTO client_submissions (
        business_name, contact_person, contact_number, email,
        country_id, status, created_at
      ) VALUES (
        COALESCE(NULLIF(card.brand_name,''), card.customer_name, 'Lead'),
        COALESCE(NULLIF(card.customer_name,''), 'Unknown'),
        COALESCE(card.customer_phone, ''),
        card.customer_email,
        card_country_id,
        'new',
        card.created_at
      )
      RETURNING id INTO v_lead_id;
    END IF;

    -- 5b. Find or create the brand for this lead + brand_name.
    -- Skip cards with no brand_name (rare for shared_form, but defensive).
    IF NULLIF(card.brand_name,'') IS NULL THEN
      CONTINUE;
    END IF;

    SELECT id INTO v_brand_id
    FROM client_submission_brands b
    WHERE b.submission_id = v_lead_id
      AND lower(b.brand_name) = lower(card.brand_name);

    IF v_brand_id IS NULL THEN
      INSERT INTO client_submission_brands (
        submission_id, brand_name, business_nature, business_note,
        requirement_note, service_type, target_languages, working_days,
        country_id, target_tiers, business_location, source,
        created_at, updated_at
      ) VALUES (
        v_lead_id,
        card.brand_name,
        NULLIF(card.business_nature,''),
        NULLIF(card.notes,''),
        NULLIF(card.requirement_note,''),
        -- Reverse-map the display label to the slug we use on brands.
        CASE card.service_type
          WHEN 'Designers' THEN 'designer'
          WHEN 'Editors' THEN 'video_editor'
          WHEN 'Designer plus Editor' THEN 'designer_video_editor'
          ELSE NULL
        END,
        COALESCE(card.target_languages, '{}'),
        COALESCE(card.working_days, '{}'),
        card_country_id,
        COALESCE(card.target_tiers, '{}'),
        NULLIF(card.customer_location,''),
        card.source,
        card.created_at,
        card.created_at
      )
      RETURNING id INTO v_brand_id;
    END IF;

    -- 5c. Copy region rows from this card into the brand. Safe to
    -- re-run because of the UNIQUE (brand_id, country_id, region).
    INSERT INTO client_submission_brand_regions (brand_id, country_id, region)
    SELECT v_brand_id, r.country_id, r.region
    FROM subscription_card_target_regions r
    WHERE r.card_id = card.id
    ON CONFLICT DO NOTHING;

    -- 5d. Link the card to its brand.
    UPDATE subscription_cards SET brand_id = v_brand_id WHERE id = card.id;
  END LOOP;
END
$$;
