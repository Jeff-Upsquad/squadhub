-- 126_seed_calendar_feature_tip.sql
-- Seed an inactive Feature Tip (122/123/124) introducing the Calendar app — the
-- 'cal' rail section shipped in 2e24073 (full-width task palette + Month / Week /
-- 5-Day / 4-Day / Day grids, drag-to-schedule).
--
-- Single coachmark anchored on the Calendar rail icon (data-tip-anchor="rail.cal",
-- already in TIP_ANCHOR_KEYS and always visible in the left rail) — no target_view,
-- so it just points at the icon from wherever the user is, no navigation.
--
-- is_active = false → SAVED but NOT triggered: it shows to nobody until an admin
-- hits Trigger in Admin → Feature Tips (and may narrow the audience first). Fixed
-- id so re-running is a no-op. platform defaults to 'web'.

BEGIN;

INSERT INTO feature_tips (id, title, body, target_view, target_anchor, steps, audience, is_active, platform)
VALUES (
  'f2f2f2f2-2222-4222-8222-222222222222',
  'Meet Calendar',
  'Plan your tasks visually. Open Calendar here to drag tasks onto a day or a time slot, switch between Month, Week, 5/4-Day and Day views, and drag blocks to reschedule — your view and start-of-week sync across devices.',
  NULL,
  'rail.cal',
  NULL,
  '{}'::jsonb,
  false,
  'web'
)
ON CONFLICT (id) DO NOTHING;

NOTIFY pgrst, 'reload schema';

COMMIT;
