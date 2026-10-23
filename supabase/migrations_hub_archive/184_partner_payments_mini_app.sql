-- ============================================================
-- 184: Partner Payments mini app
-- Lets partners (and admins previewing any partner) see their
-- assigned clients, monthly payouts and commission status inside
-- the web app. Data is derived live from subscription assignment
-- terms + card billing — no new tables. Gated API-side by
-- requireMiniAppOrAdmin('partner-payments').
-- Visible to nobody until an admin grants access via Access Control.
-- ============================================================

INSERT INTO mini_apps (slug, name, description, icon, is_enabled)
VALUES (
  'partner-payments',
  'Partner Payments',
  'Assigned clients, monthly payouts and commission status for your engagements.',
  'banknotes',
  true
)
ON CONFLICT DO NOTHING;
