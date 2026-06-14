-- ============================================================
-- 108: Per-card client pre-fill share links (24h, single-use)
--   A salesperson generates an unguessable tokenized link for a single
--   form-request DRAFT card. The client opens it (unauthenticated),
--   reviews the pre-filled brief, confirms email + phone, and submits.
--   On submit the SAME card is updated (no new card) and the link is
--   marked completed. Links expire 24h after creation regardless.
--   Mirrors 036 (client_onboarding_links). Idempotent — safe to re-run.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS subscription_card_share_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),           -- = the token
  card_id UUID NOT NULL REFERENCES subscription_cards(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,        -- set when the client submits (single-use)
  revoked_at TIMESTAMPTZ,          -- set when regenerated/revoked
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_card_share_links_card
  ON subscription_card_share_links(card_id);
CREATE INDEX IF NOT EXISTS idx_card_share_links_expires
  ON subscription_card_share_links(expires_at);

-- At most ONE active (not revoked, not completed) link per card. Regenerating
-- must revoke the old link first; this partial unique index makes a race that
-- would leave two live links on the same card impossible.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_card_share_link_active
  ON subscription_card_share_links(card_id)
  WHERE revoked_at IS NULL AND completed_at IS NULL;

-- Server accesses this table exclusively via the service role (supabaseAdmin),
-- matching client_onboarding_links (036) and client_submission_brands (081).
ALTER TABLE subscription_card_share_links ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
COMMIT;
