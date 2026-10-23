-- 133_squadhire_sso_codes.sql
-- One-time authorization codes for "Sign in with SquadHub" SSO into SquadHire's
-- /staff portal. SquadHub is the identity provider here: after an eligible,
-- logged-in SquadHub user authorizes, we mint a short-lived opaque code and
-- redirect the browser back to SquadHire. SquadHire then exchanges the code
-- server-to-server (shared-secret) for the user's identity. Codes are single-use
-- (consumed_at stamped on exchange) and expire within a couple of minutes.

CREATE TABLE IF NOT EXISTS squadhire_sso_codes (
  code          TEXT PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email         TEXT NOT NULL,
  display_name  TEXT,
  user_type     TEXT NOT NULL,
  redirect_uri  TEXT NOT NULL,
  expires_at    TIMESTAMPTZ NOT NULL,
  consumed_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_squadhire_sso_codes_expires ON squadhire_sso_codes (expires_at);
