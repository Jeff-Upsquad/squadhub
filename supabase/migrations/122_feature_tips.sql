-- 122_feature_tips.sql
-- Admin-triggered "Feature Tips" (coachmarks / "what's new" announcement cards).
--
-- feature_tips        = tip definitions. `current_revision` bumps each time the
--                       tip is re-triggered to EVERYONE, which re-surfaces it for
--                       all targeted users without deleting prior acceptances.
-- feature_tip_states  = per-user, per-tip, PER-REVISION acknowledgement. A user
--                       either ACCEPTED ("OK/Got it" — permanent for that round)
--                       or DISMISSED (snooze: hidden until dismissed_until, then
--                       pending again). Keyed by revision so acceptance history
--                       is preserved across re-issues.
--
-- "Shown only once" = once accepted at the current revision, never shown again.
-- The 3-hour Dismiss snooze and all eligibility math use server NOW()/timestamptz
-- — nothing is stored client-side (no localStorage), so it is consistent across
-- devices. Mirrors the per-user tracking style of 121_message_read_state.sql.

BEGIN;

CREATE TABLE IF NOT EXISTS feature_tips (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title             TEXT NOT NULL,
  body              TEXT NOT NULL,
  -- Optional placement. Both NULL ⇒ centered "What's New" card.
  target_view       TEXT,            -- a web HomeView key, e.g. 'tasks'
  target_anchor     TEXT,            -- a data-tip-anchor key, e.g. 'rail.tasks'
  -- Audience filter. '{}' ⇒ ALL active users. Otherwise keys (OR-unioned):
  --   { "user_types":[...], "workspace_roles":[...], "role_ids":[uuid],
  --     "department_ids":[uuid], "user_ids":[uuid] }
  audience          JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active         BOOLEAN NOT NULL DEFAULT false,  -- false until first trigger
  current_revision  INT NOT NULL DEFAULT 1,          -- bumps on re-trigger-to-everyone
  created_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_triggered_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_feature_tips_active ON feature_tips(is_active) WHERE is_active = true;

CREATE TABLE IF NOT EXISTS feature_tip_states (
  tip_id          UUID NOT NULL REFERENCES feature_tips(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  revision        INT  NOT NULL,                       -- the round this ack belongs to
  status          TEXT NOT NULL CHECK (status IN ('accepted', 'dismissed')),
  accepted_at     TIMESTAMPTZ,                         -- set when status='accepted'
  dismissed_until TIMESTAMPTZ,                         -- snooze high-water (hidden while > NOW())
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tip_id, user_id, revision)
);

CREATE INDEX IF NOT EXISTS idx_feature_tip_states_tip_rev ON feature_tip_states(tip_id, revision);
CREATE INDEX IF NOT EXISTS idx_feature_tip_states_user    ON feature_tip_states(user_id);

-- ------------------------------------------------------------
-- RLS. The server uses the service-role client (bypasses RLS), so these are
-- defense-in-depth for any direct authenticated access. Mirrors the
-- `auth.uid() = user_id` style of 011_time_tracking.sql.
-- ------------------------------------------------------------
ALTER TABLE feature_tips ENABLE ROW LEVEL SECURITY;
ALTER TABLE feature_tip_states ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read tips"
  ON feature_tips FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Users can view own tip states"
  ON feature_tip_states FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own tip states"
  ON feature_tip_states FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own tip states"
  ON feature_tip_states FOR UPDATE
  USING (auth.uid() = user_id);

-- ------------------------------------------------------------
-- Helper: candidate pending tips for one user, in a single round-trip.
-- A tip is a candidate when it is active AND, at the tip's CURRENT revision, the
-- user has not accepted it AND any dismissal snooze has elapsed. Audience is
-- applied in the route layer (it needs role/department joins) using the returned
-- `audience` JSON. A brand-new user with no state rows matches automatically
-- (the LEFT JOIN yields NULLs), so new joiners see active tips on first load.
-- Mirrors chat_unread_summary (121).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION feature_tips_pending_for_user(p_user_id UUID)
RETURNS TABLE (
  id UUID,
  title TEXT,
  body TEXT,
  target_view TEXT,
  target_anchor TEXT,
  revision INT,
  audience JSONB,
  created_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
AS $$
  SELECT t.id, t.title, t.body, t.target_view, t.target_anchor,
         t.current_revision, t.audience, t.created_at
  FROM feature_tips t
  LEFT JOIN feature_tip_states s
    ON s.tip_id = t.id
   AND s.user_id = p_user_id
   AND s.revision = t.current_revision
  WHERE t.is_active = true
    AND (s.status IS DISTINCT FROM 'accepted')                         -- never re-show accepted
    AND (
      s.tip_id IS NULL                                                 -- never seen this revision
      OR (s.status = 'dismissed'
          AND COALESCE(s.dismissed_until, 'epoch'::timestamptz) <= NOW())  -- snooze elapsed
    )
  ORDER BY t.created_at ASC;
$$;

-- ------------------------------------------------------------
-- Helper: acknowledgement counts for a tip at a given revision.
-- accepted; snoozed (dismissed and still hidden); dismissed_total (all dismiss
-- rows). "pending" is derived in the route against the resolved audience size.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION feature_tip_roster_counts(p_tip_id UUID, p_revision INT)
RETURNS TABLE (accepted_count BIGINT, snoozed_count BIGINT, dismissed_total BIGINT)
LANGUAGE sql
STABLE
AS $$
  SELECT
    COUNT(*) FILTER (WHERE status = 'accepted') AS accepted_count,
    COUNT(*) FILTER (WHERE status = 'dismissed'
                       AND COALESCE(dismissed_until, 'epoch'::timestamptz) > NOW()) AS snoozed_count,
    COUNT(*) FILTER (WHERE status = 'dismissed') AS dismissed_total
  FROM feature_tip_states
  WHERE tip_id = p_tip_id AND revision = p_revision;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
