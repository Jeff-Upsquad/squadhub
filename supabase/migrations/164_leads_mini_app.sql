-- ============================================================
-- 164: Leads — new-deal management mini app
-- Surfaces the three admin pipeline modules (Job Cards,
-- Subscription Cards, Assignments) inside the web app as a single
-- mini app with one tab per module. The web app compiles the same
-- module source the admin panel renders (see web/next.config.mjs
-- `@admin-modules` alias) — one implementation, two hosts — so the
-- team gets full parity without a second copy to keep in sync.
--
-- Every endpoint those modules call is gated by
-- requireMiniAppOrAdmin('leads'), so holders of this grant get
-- admin-grade access to the lead pipelines and nothing else.
-- Visible to nobody until an admin grants access via Access Control.
-- ============================================================

INSERT INTO mini_apps (slug, name, description, icon, is_enabled)
VALUES (
  'leads',
  'Leads',
  'Manage new deals across job cards, subscription cards & assignments: review, publish, broadcast, assign, and run the hiring pipeline',
  'inbox-stack',
  true
)
ON CONFLICT DO NOTHING;
