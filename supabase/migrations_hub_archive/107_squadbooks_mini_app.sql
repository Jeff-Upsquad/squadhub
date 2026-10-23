-- Register SquadBooks as a mini-app. Invisible until an admin grants role/user
-- access via /admin/mini-apps, then a SquadBooks Access grant is assigned via
-- /admin/squadbooks-access.
INSERT INTO mini_apps (slug, name, description, icon, is_enabled)
VALUES (
  'squadbooks',
  'SquadBooks',
  'Accounts & finance — customers, invoices, expenses, banking and reports',
  'book-open',
  true
)
ON CONFLICT (slug) DO NOTHING;
