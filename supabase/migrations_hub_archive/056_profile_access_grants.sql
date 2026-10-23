-- ============================================================
-- 056: profile_access_grants
--
-- Local mirror of SquadHire's talent_access_grants. A SquadHub
-- salesperson grants someone email-gated access to talent profiles
-- in chosen categories with an expiry; the grant is created here
-- and synced to SquadHire via webhook so the talent-facing
-- /talent-access flow on upsquadconnect.com keeps working.
--
-- Either side can originate a grant. SquadHub-originated rows have
-- created_by = the SquadHub user id; rows originated on the
-- SquadHire admin side arrive via the inbound callback and have
-- created_by = NULL. profiles_grant_id ties the two halves together
-- and is the join key for callbacks.
--
-- Categories are externally owned (SquadHire's `categories` table)
-- so we keep them as a UUID[] round-trip, not a join table —
-- mirrors how subscription_cards.squadhire_category_ids works.
-- ============================================================

CREATE TABLE profile_access_grants (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email                    TEXT NOT NULL,
  expires_at               TIMESTAMPTZ NOT NULL,
  revoked_at               TIMESTAMPTZ,
  notes                    TEXT,
  -- NULL when the grant came from the SquadHire admin side via callback.
  created_by               UUID REFERENCES users(id) ON DELETE SET NULL,
  category_ids             UUID[] NOT NULL DEFAULT '{}',
  -- talent_access_grants.id on SquadHire. Set after a successful sync /
  -- on inbound callback. UNIQUE so callbacks are idempotent.
  profiles_grant_id        UUID UNIQUE,
  profiles_synced_at       TIMESTAMPTZ,
  profiles_sync_attempts   INTEGER NOT NULL DEFAULT 0,
  profiles_sync_last_error TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The user-app list filters by created_by; an index makes it cheap.
CREATE INDEX idx_profile_access_grants_created_by
  ON profile_access_grants(created_by)
  WHERE created_by IS NOT NULL;

-- The admin search filters by email substring, lowercased.
CREATE INDEX idx_profile_access_grants_email_lower
  ON profile_access_grants(LOWER(email));

-- Partial index for the sync sweeper — small and stays small because
-- successfully-synced rows drop out of it.
CREATE INDEX idx_profile_access_grants_pending_sync
  ON profile_access_grants(updated_at)
  WHERE profiles_synced_at IS NULL AND profiles_sync_attempts < 10;

CREATE TRIGGER trg_profile_access_grants_updated_at
  BEFORE UPDATE ON profile_access_grants
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

NOTIFY pgrst, 'reload schema';
