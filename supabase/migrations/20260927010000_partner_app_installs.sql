-- Who has the native partner app (in.squadhub.partner) installed and which
-- build they run. One current-state row per user, written by the app's
-- launch check-in (POST /partner-app/checkin) and by push-token registration
-- (POST /push/register, for builds that predate the check-in). SquadHire reads
-- it through GET /integrations/squadhire/partner-app/installs to tick the
-- "Partner app downloaded" step on its onboarding boards.
--
-- Kept apart from partner_push_tokens: those rows are dropped on logout and
-- when FCM reports a token stale, so they can't answer "first installed when".
CREATE TABLE IF NOT EXISTS partner_app_installs (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL DEFAULT 'android' CHECK (platform IN ('ios', 'android')),
  -- NULL until a build with the check-in reports it (push-token path only).
  version_name TEXT,
  version_code INTEGER,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_partner_app_installs_last_seen
  ON partner_app_installs(last_seen_at DESC);

ALTER TABLE partner_app_installs ENABLE ROW LEVEL SECURITY;

-- Server-only table: the API's service-role client is the sole reader/writer.
REVOKE ALL ON TABLE partner_app_installs FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE partner_app_installs TO service_role;

-- Backfill from the devices that already registered for push, so existing
-- installs show up without waiting for each partner to reopen the app.
INSERT INTO partner_app_installs (user_id, platform, first_seen_at, last_seen_at)
SELECT DISTINCT ON (user_id)
  user_id,
  platform,
  MIN(created_at) OVER (PARTITION BY user_id),
  MAX(last_seen_at) OVER (PARTITION BY user_id)
FROM partner_push_tokens
ORDER BY user_id, last_seen_at DESC
ON CONFLICT (user_id) DO NOTHING;
