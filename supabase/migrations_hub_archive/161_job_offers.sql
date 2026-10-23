-- =============================================================
-- Job Cards (hiring service) — offer letters
-- =============================================================
-- offer_letter_templates are CANONICAL on SquadHub: admin authors them at
-- /admin/job-offer-templates; the SquadHire business-portal composer pulls
-- the template via the signed integration GET and edits sections/package
-- PER OFFER before sending (the rendered letter is frozen on the Profiles
-- side and mirrored back here into job_offers.rendered_body_html).
--
-- Template body structure follows the provided sample offer letter:
-- letterhead → greeting → offer paragraph (position / effective / join-by /
-- expiry) → boilerplate sections (duties, timings, remuneration, workplace,
-- probation, confirmation, NDA, IP, non-solicitation, service conditions) →
-- compensation table (training / probation / confirmed × per-month /
-- per-annum) → closing signatory. Merge fields use {{key}} placeholders.
-- =============================================================

CREATE TABLE offer_letter_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  -- Optional link: "the offer letter can also be created along with a job
  -- profile". NULL = generic template.
  job_profile_id UUID REFERENCES job_profiles(id) ON DELETE SET NULL,
  -- Ordered editable sections: [{key, title, body_html}] with {{merge}} fields.
  sections JSONB NOT NULL DEFAULT '[]',
  -- [{key, label, source: 'candidate'|'card'|'business'|'manual'}]
  merge_fields JSONB NOT NULL DEFAULT '[]',
  -- Default compensation rows: [{component: 'Training Period', cadence: 'per_month'}]
  compensation_schema JSONB NOT NULL DEFAULT '[]',
  -- {name, title, signature_image_url}
  signatory JSONB NOT NULL DEFAULT '{}',
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ
);

-- Exactly one live default template.
CREATE UNIQUE INDEX uq_offer_template_default ON offer_letter_templates((true))
  WHERE is_default AND archived_at IS NULL;

DROP TRIGGER IF EXISTS trg_offer_letter_templates_updated_at ON offer_letter_templates;
CREATE TRIGGER trg_offer_letter_templates_updated_at
  BEFORE UPDATE ON offer_letter_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Offers mirror (Profiles is canonical for candidate-visible offer state;
-- see migration 160 header for the single-write-path rule).
CREATE TABLE job_offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id UUID NOT NULL REFERENCES job_cards(id) ON DELETE CASCADE,
  candidate_id UUID NOT NULL REFERENCES job_card_candidates(id) ON DELETE CASCADE,
  external_offer_id TEXT UNIQUE,           -- Profiles' offer id
  template_id UUID REFERENCES offer_letter_templates(id) ON DELETE SET NULL,
  delivery_mode TEXT NOT NULL DEFAULT 'platform'
    CHECK (delivery_mode IN ('platform','manual_email')),
  rendered_body_html TEXT,                  -- merged snapshot at send time (immutable per revision)
  compensation JSONB NOT NULL DEFAULT '{}', -- {currency, training:{amount,cadence}, probation:{...}, confirmed:{...}}
  total_ctc INTEGER,
  ctc_currency TEXT NOT NULL DEFAULT 'INR',
  position_title TEXT,
  effective_date DATE,
  join_by_date DATE,
  joining_date DATE,
  offer_expires_at TIMESTAMPTZ,
  revision INTEGER NOT NULL DEFAULT 1,      -- bumped per counteroffer
  is_final BOOLEAN NOT NULL DEFAULT false,  -- final counteroffer — no further negotiation
  status TEXT NOT NULL DEFAULT 'sent'
    CHECK (status IN ('draft','sent','viewed','negotiation_requested','countered',
                      'accepted','declined','withdrawn','expired')),
  created_by_side TEXT NOT NULL DEFAULT 'admin' CHECK (created_by_side IN ('admin','business')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_job_offers_card ON job_offers(card_id);
CREATE INDEX idx_job_offers_candidate ON job_offers(candidate_id);

DROP TRIGGER IF EXISTS trg_job_offers_updated_at ON job_offers;
CREATE TRIGGER trg_job_offers_updated_at
  BEFORE UPDATE ON job_offers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Negotiation thread / audit (mirrored from Profiles offer_events).
CREATE TABLE job_offer_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id UUID NOT NULL REFERENCES job_offers(id) ON DELETE CASCADE,
  external_event_id TEXT UNIQUE,           -- Profiles' offer_events id (replay guard)
  event_type TEXT NOT NULL,                 -- sent|viewed|negotiation_requested|countered|
                                            -- final_countered|accepted|declined|withdrawn|
                                            -- expired|question_asked|question_answered
  actor_type TEXT CHECK (actor_type IN ('admin','business','talent','system')),
  actor_label TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',     -- e.g. {asked_amount, note}
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_job_offer_events_offer ON job_offer_events(offer_id, created_at);

-- RLS: service role bypasses; server routes enforce access (matches 044/157).
ALTER TABLE offer_letter_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_offer_events ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
