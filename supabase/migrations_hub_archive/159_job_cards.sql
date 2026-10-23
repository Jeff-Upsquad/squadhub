-- =============================================================
-- Job Cards (hiring service) — card + activity log
-- =============================================================
-- job_cards is deliberately a NEW table, not subscription_cards rows with
-- card_type='hiring': the subscription sync sweepers query
-- subscription_cards, and a hiring row there could satisfy their filters
-- and leak a premature SquadHire delivery (the bug class fixed in the
-- never-published-guard work). Separate storage makes cross-leak
-- structurally impossible. card_type='hiring' remains the WIRE value the
-- payload builder sends to SquadHire (its generic ingest discriminates on
-- it) — see migration 117 where the enum value was reserved.
--
-- Canonical stored state is small (new → onboarding → published → closed);
-- the nine admin pipeline tabs (New Deals / Onboarding / Broadcasted /
-- Applicant Screening / Short Listing / Interview Process / Offer / Hired /
-- Placed) are DERIVED buckets computed from state + lifecycle stamps +
-- candidate rollup counters (see server/src/utils/jobStage.ts).
-- =============================================================

CREATE TABLE job_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Linkage: direct FKs into the lead/client pipeline (unlike subscription
  -- briefs, which re-match by email/phone at read time).
  lead_submission_id UUID REFERENCES client_submissions(id) ON DELETE SET NULL,
  client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
  -- NULL while state='new' (brief exists, onboarding not done yet).
  job_profile_id UUID REFERENCES job_profiles(id) ON DELETE SET NULL,
  source TEXT NOT NULL DEFAULT 'internal_brief'
    CHECK (source IN ('internal_brief','shared_form','landing_page_form')),

  state TEXT NOT NULL DEFAULT 'new'
    CHECK (state IN ('new','onboarding','published','closed')),

  -- Brief snapshot (pre-onboarding; the linked job profile supersedes these).
  role_service_type TEXT,                 -- 'Designers' | 'Editors'
  brief_note TEXT,
  customer_name TEXT,
  customer_company TEXT,
  customer_email TEXT,
  customer_phone TEXT,
  customer_location TEXT,

  -- Offered package on the card (can differ from the profile's advertised range).
  package_min INTEGER,
  package_max INTEGER,
  package_currency TEXT NOT NULL DEFAULT 'INR',
  package_period TEXT NOT NULL DEFAULT 'monthly' CHECK (package_period IN ('monthly','annual')),
  package_notes TEXT,
  openings_count INTEGER NOT NULL DEFAULT 1 CHECK (openings_count > 0),
  expected_joining_date DATE,
  expires_at TIMESTAMPTZ,

  -- Card-level OVERRIDES over job_profiles.preference_rules. Same JSONB key
  -- vocabulary; a key present here (including explicit null = "clear this
  -- rule") wins. Effective rules are computed by mergeJobRules() at
  -- payload-build/preview time — never stored.
  rule_overrides JSONB NOT NULL DEFAULT '{}',
  distribution TEXT NOT NULL DEFAULT 'broadcast' CHECK (distribution IN ('broadcast','manual')),
  squadhire_match_preview JSONB,          -- cached who-would-match preview (mirrors migration 150)

  -- Lifecycle stamps (subscription_cards vocabulary).
  published_at TIMESTAMPTZ,
  published_by UUID REFERENCES users(id) ON DELETE SET NULL,
  recalled_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ,
  paused_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  closed_reason TEXT CHECK (closed_reason IN ('filled','cancelled','expired')),
  deleted_at TIMESTAMPTZ,
  deleted_by UUID REFERENCES users(id) ON DELETE SET NULL,
  verified_by UUID REFERENCES users(id) ON DELETE SET NULL,
  verified_at TIMESTAMPTZ,
  -- Stamped from SquadHire's job_screening_started event; the "Applicant
  -- Screening" tab keys on this (NOT on applicant counts) — the card stays
  -- "Broadcasted" until Start Screening is clicked.
  screening_started_at TIMESTAMPTZ,

  -- Outbound sync bookkeeping. Own columns → own sweeper (startJobSyncSweeper
  -- queries job_cards ONLY; the subscription sweeper never sees these rows).
  squadhire_synced_at TIMESTAMPTZ,
  squadhire_sync_attempts INTEGER NOT NULL DEFAULT 0,
  squadhire_sync_last_error TEXT,

  -- Candidate rollups, maintained ONLY by inbound webhook handlers via
  -- recountJobCardRollups() (single aggregate query — replay-safe, never
  -- incremental math). These drive categorizeJobCard() cheaply.
  applicants_count INTEGER NOT NULL DEFAULT 0,
  screening_count INTEGER NOT NULL DEFAULT 0,
  shortlisted_count INTEGER NOT NULL DEFAULT 0,
  interview_count INTEGER NOT NULL DEFAULT 0,
  offer_count INTEGER NOT NULL DEFAULT 0,
  hired_count INTEGER NOT NULL DEFAULT 0,
  placed_count INTEGER NOT NULL DEFAULT 0,

  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_job_cards_submission ON job_cards(lead_submission_id);
CREATE INDEX idx_job_cards_client ON job_cards(client_id);
CREATE INDEX idx_job_cards_profile ON job_cards(job_profile_id);
CREATE INDEX idx_job_cards_state ON job_cards(state) WHERE deleted_at IS NULL;
CREATE INDEX idx_job_cards_unsynced ON job_cards(squadhire_synced_at)
  WHERE squadhire_synced_at IS NULL AND deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_job_cards_updated_at ON job_cards;
CREATE TRIGGER trg_job_cards_updated_at
  BEFORE UPDATE ON job_cards
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Append-only activity log (clone of subscription_card_events, migration 145).
CREATE TABLE job_card_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id UUID NOT NULL REFERENCES job_cards(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  actor_id TEXT,
  actor_type TEXT CHECK (actor_type IN ('admin','business','talent','system')),
  actor_label TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_job_card_events_card ON job_card_events(card_id, created_at);

-- RLS: service role bypasses; server routes enforce access (matches 044/157).
ALTER TABLE job_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_card_events ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
