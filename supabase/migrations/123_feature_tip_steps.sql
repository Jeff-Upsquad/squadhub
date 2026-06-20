-- 123_feature_tip_steps.sql
-- Turn Feature Tips (122) into optional MULTI-STEP guided tours.
--
-- A tip gains an optional `steps` JSONB array. When NULL/empty it behaves exactly
-- as before (a single coachmark / "What's new" card built from the top-level
-- title/body/target_view/target_anchor). When it has ≥1 entries the user-facing
-- overlay walks them in order (Back / Next), navigating between screens as each
-- step asks, and only accepts (permanently, like today) on the final step.
--
-- Each step element: { title, body, target_view, target_anchor } — same shape as
-- the single-card placement fields. Acknowledgement stays per-tip-per-revision:
-- finishing the tour = one accept, so all of 122's pending/accept/dismiss/snooze/
-- revision/audience/roster machinery is reused unchanged.
--
-- Also seeds the "Pin your apps to Home" tour (inactive — an admin triggers it).

BEGIN;

ALTER TABLE feature_tips
  ADD COLUMN IF NOT EXISTS steps JSONB;  -- NULL/[] ⇒ single card; else ordered tour steps

-- The pending helper must now also return `steps`. Adding a column to a
-- RETURNS TABLE changes the function's return type, which CREATE OR REPLACE
-- cannot do — drop and recreate.
DROP FUNCTION IF EXISTS feature_tips_pending_for_user(UUID);

CREATE FUNCTION feature_tips_pending_for_user(p_user_id UUID)
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
    AND (s.status IS DISTINCT FROM 'accepted')                         -- never re-show accepted
    AND (
      s.tip_id IS NULL                                                 -- never seen this revision
      OR (s.status = 'dismissed'
          AND COALESCE(s.dismissed_until, 'epoch'::timestamptz) <= NOW())  -- snooze elapsed
    )
  ORDER BY t.created_at ASC;
$$;

-- ------------------------------------------------------------
-- Seed: "Pin your apps to Home" — a 4-step coachmark tour mirroring how a user
-- pins a mini app. Inactive on insert; an admin triggers it (and may narrow the
-- audience) from the admin Feature Tips screen. Fixed id so re-running is a no-op.
-- ------------------------------------------------------------
INSERT INTO feature_tips (id, title, body, target_view, target_anchor, steps, audience, is_active)
VALUES (
  'f1f1f1f1-1111-4111-8111-111111111111',
  'Pin your apps to Home',
  'A quick tour of how to pin a mini app so it shows up on your Home.',
  NULL,
  NULL,
  '[
    {
      "title": "Your apps live here",
      "body": "Home has an Apps section for the mini apps you use most — pin one and it shows up right here for one-tap access.",
      "target_view": "hub",
      "target_anchor": "home.apps"
    },
    {
      "title": "Open the Apps module",
      "body": "Every mini app you can use lives behind the Apps icon in the left sidebar. Tap it to browse them all.",
      "target_view": "hub",
      "target_anchor": "rail.apps"
    },
    {
      "title": "Star an app to favorite it",
      "body": "Hover an app and tap the star. Starring pins it as a favorite — that is all it takes.",
      "target_view": "apps",
      "target_anchor": "apps.star"
    },
    {
      "title": "Find it back on Home",
      "body": "Your starred apps now appear in the Apps section on Home. Tap one to jump straight in.",
      "target_view": "hub",
      "target_anchor": "home.apps"
    }
  ]'::jsonb,
  '{}'::jsonb,
  false
)
ON CONFLICT (id) DO NOTHING;

NOTIFY pgrst, 'reload schema';

COMMIT;
