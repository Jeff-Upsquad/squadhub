-- =============================================================
-- Job Cards (hiring service) — candidate / interview mirrors
-- =============================================================
-- SquadHire (Profiles) is CANONICAL for per-candidate funnel data — talents
-- apply, interview, and respond to offers there. These tables are the
-- SquadHub-side mirror, updated ONLY by the inbound events webhook
-- (integrations/squadhire-job-callbacks). Admin actions proxy to Profiles,
-- which applies canonically and echoes the event back — the mirror has a
-- single write path, so replays and races cannot double-apply.
-- =============================================================

CREATE TABLE job_card_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id UUID NOT NULL REFERENCES job_cards(id) ON DELETE CASCADE,
  external_system TEXT NOT NULL DEFAULT 'squadhire',
  external_candidate_id TEXT NOT NULL,     -- Profiles' job_candidates row id
  talent_user_id TEXT NOT NULL,            -- Profiles' talent user id
  talent_name TEXT,
  talent_email TEXT,
  talent_phone TEXT,
  status TEXT NOT NULL DEFAULT 'matched'
    CHECK (status IN ('matched','applied','screening','shortlisted','interview',
                      'offer','offer_accepted','hired','joined',
                      'rejected','withdrawn','on_hold')),
  applied_at TIMESTAMPTZ,
  screening_started_at TIMESTAMPTZ,
  shortlisted_at TIMESTAMPTZ,
  first_interview_at TIMESTAMPTZ,
  offered_at TIMESTAMPTZ,
  offer_accepted_at TIMESTAMPTZ,
  hired_at TIMESTAMPTZ,
  joining_date DATE,
  joined_at TIMESTAMPTZ,
  rejected_at TIMESTAMPTZ,
  rejection_stage TEXT,
  rejection_reason TEXT,
  snapshot JSONB NOT NULL DEFAULT '{}',    -- last full candidate payload from Profiles
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (card_id, external_system, external_candidate_id)
);

CREATE INDEX idx_jcc_card_status ON job_card_candidates(card_id, status);

DROP TRIGGER IF EXISTS trg_job_card_candidates_updated_at ON job_card_candidates;
CREATE TRIGGER trg_job_card_candidates_updated_at
  BEFORE UPDATE ON job_card_candidates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TABLE job_interviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id UUID NOT NULL REFERENCES job_cards(id) ON DELETE CASCADE,
  candidate_id UUID NOT NULL REFERENCES job_card_candidates(id) ON DELETE CASCADE,
  external_interview_id TEXT NOT NULL UNIQUE,   -- Profiles' invite id (idempotency key)
  round_number INTEGER NOT NULL DEFAULT 1,
  round_label TEXT,                              -- 'HR Round', 'Portfolio Review'
  mode TEXT NOT NULL CHECK (mode IN ('virtual','physical')),
  scheduled_at TIMESTAMPTZ,
  duration_minutes INTEGER,
  meeting_link TEXT,                             -- stored for admin visibility; reveal-on-start
                                                 -- gating happens on the Profiles side
  meeting_link_revealed_at TIMESTAMPTZ,
  location_id UUID REFERENCES business_locations(id) ON DELETE SET NULL,
  location_snapshot JSONB,                       -- {label, address, google_maps_url} frozen at scheduling
  status TEXT NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed','scheduled','completed','cancelled','no_show')),
  outcome TEXT CHECK (outcome IN ('selected','rejected','on_hold')),
  outcome_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_job_interviews_card ON job_interviews(card_id);
CREATE INDEX idx_job_interviews_candidate ON job_interviews(candidate_id);

DROP TRIGGER IF EXISTS trg_job_interviews_updated_at ON job_interviews;
CREATE TRIGGER trg_job_interviews_updated_at
  BEFORE UPDATE ON job_interviews
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TABLE job_interview_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  interview_id UUID NOT NULL REFERENCES job_interviews(id) ON DELETE CASCADE,
  external_slot_id TEXT NOT NULL UNIQUE,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','accepted','declined','expired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_job_interview_slots_interview ON job_interview_slots(interview_id);

-- RLS: service role bypasses; server routes enforce access (matches 044/157).
ALTER TABLE job_card_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_interviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_interview_slots ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
