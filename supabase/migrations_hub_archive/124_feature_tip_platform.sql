-- 124_feature_tip_platform.sql
-- Split Feature Tips (122/123) by PLATFORM so the SquadHub web app and the native
-- partner Android app each get their own, independently-managed tips.
--
-- A tip now carries `platform` ('web' | 'app'). Existing rows default to 'web', so
-- every tip created before this migration keeps showing only on the web — nothing
-- changes for current users. App tips are authored from a separate admin section
-- and target app-specific screens/anchors (a phone has no left rail, etc.).
--
-- The eligibility helper gains a `p_platform` parameter (defaulting to 'web', so the
-- web route's existing 1-arg rpc call keeps working unchanged); the native client
-- passes p_platform => 'app'. All of 122/123's accept/dismiss/snooze/revision/
-- audience/roster machinery is reused as-is — platform is purely a routing filter.

BEGIN;

ALTER TABLE feature_tips
  ADD COLUMN IF NOT EXISTS platform TEXT NOT NULL DEFAULT 'web'
    CHECK (platform IN ('web', 'app'));

-- Active-tip lookups are now always scoped by platform; index the pair.
CREATE INDEX IF NOT EXISTS idx_feature_tips_platform_active
  ON feature_tips(platform, is_active) WHERE is_active = true;

-- Re-create the pending helper with a platform filter. Adding a parameter would
-- normally allow an overload, but the 123 version already has the final return
-- shape, so we DROP and recreate to keep a single canonical definition. The new
-- `p_platform` defaults to 'web' so any caller passing only p_user_id (the web
-- route) behaves exactly as before.
DROP FUNCTION IF EXISTS feature_tips_pending_for_user(UUID);

CREATE FUNCTION feature_tips_pending_for_user(p_user_id UUID, p_platform TEXT DEFAULT 'web')
RETURNS TABLE (
  id UUID,
  title TEXT,
  body TEXT,
  target_view TEXT,
  target_anchor TEXT,
  steps JSONB,
  revision INT,
  audience JSONB,
  created_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
AS $$
  SELECT t.id, t.title, t.body, t.target_view, t.target_anchor, t.steps,
         t.current_revision, t.audience, t.created_at
  FROM feature_tips t
  LEFT JOIN feature_tip_states s
    ON s.tip_id = t.id
   AND s.user_id = p_user_id
   AND s.revision = t.current_revision
  WHERE t.is_active = true
    AND t.platform = p_platform                                        -- web vs app
    AND (s.status IS DISTINCT FROM 'accepted')                         -- never re-show accepted
    AND (
      s.tip_id IS NULL                                                 -- never seen this revision
      OR (s.status = 'dismissed'
          AND COALESCE(s.dismissed_until, 'epoch'::timestamptz) <= NOW())  -- snooze elapsed
    )
  ORDER BY t.created_at ASC;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
