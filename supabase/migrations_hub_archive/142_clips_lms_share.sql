-- ============================================================
-- 142: Squad Clips — login-gated "share to Learning" link
-- A second, independent share channel on clips, alongside the
-- public share_token (096). lms_token gates the chrome-free
-- /embed/lms/<token> player, which — unlike the public /share
-- token — resolves the media URL only after a valid logged-in
-- Squad Hub viewer is verified. Lets a clip be embeddable inside
-- LMS content without also being publicly shareable.
-- Owned by the Squad Clips app (separate repo, service role).
-- ============================================================

ALTER TABLE clips ADD COLUMN IF NOT EXISTS lms_token   TEXT;
ALTER TABLE clips ADD COLUMN IF NOT EXISTS lms_enabled BOOLEAN NOT NULL DEFAULT false;

-- Token lookups must be unique (revoke + re-enable rotates it).
CREATE UNIQUE INDEX IF NOT EXISTS uq_clips_lms_token
  ON clips(lms_token) WHERE lms_token IS NOT NULL;
