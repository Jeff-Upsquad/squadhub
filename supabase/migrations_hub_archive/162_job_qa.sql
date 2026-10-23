-- =============================================================
-- Job Cards (hiring service) — Q&A mirror
-- =============================================================
-- Talents ask questions on a job card in SquadHire; the business (or admin)
-- answers there; answered questions are published on the job profile for
-- all candidates. Profiles is canonical; this mirror powers the admin Q&A
-- moderation view. Admin delete = signed proxy to Profiles + local
-- tombstone; the tombstone survives event replays (a moderated question
-- never resurrects).
-- =============================================================

CREATE TABLE job_card_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id UUID NOT NULL REFERENCES job_cards(id) ON DELETE CASCADE,
  -- Published Q&A lives on the profile (survives card re-publishes).
  job_profile_id UUID REFERENCES job_profiles(id) ON DELETE SET NULL,
  external_question_id TEXT NOT NULL UNIQUE,   -- Profiles' question id
  talent_user_id TEXT,
  talent_name TEXT,
  question TEXT NOT NULL,
  answer TEXT,
  answered_at TIMESTAMPTZ,                     -- answered ⇒ published (contract §7)
  answered_by_label TEXT,
  deleted_at TIMESTAMPTZ,                      -- moderation tombstone
  deleted_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_jcq_card ON job_card_questions(card_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_jcq_profile_published ON job_card_questions(job_profile_id)
  WHERE answered_at IS NOT NULL AND deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_job_card_questions_updated_at ON job_card_questions;
CREATE TRIGGER trg_job_card_questions_updated_at
  BEFORE UPDATE ON job_card_questions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS: service role bypasses; server routes enforce access (matches 044/157).
ALTER TABLE job_card_questions ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
