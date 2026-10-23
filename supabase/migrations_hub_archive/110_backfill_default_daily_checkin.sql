-- ============================================================
-- 110: Backfill default Daily Check-In mini app for existing users
-- Mirrors the on-invite default (see server/src/routes/auth.ts):
--   internal + partner_employee -> 'daily-checkin' (Teammates)
--   partner                     -> 'daily-checkin-partners' (Partners)
--   client / client_staff       -> nothing
-- Active users only; idempotent (existing grants are left untouched).
-- ============================================================

-- Daily Check-In Teammates -> internal users + partner employees
INSERT INTO mini_app_user_access (mini_app_id, user_id)
SELECT a.id, u.id
FROM users u
CROSS JOIN mini_apps a
WHERE a.slug = 'daily-checkin'
  AND u.user_type IN ('internal', 'partner_employee')
  AND u.status = 'active'
ON CONFLICT (mini_app_id, user_id) DO NOTHING;

-- Daily Check-In Partners -> partner users
INSERT INTO mini_app_user_access (mini_app_id, user_id)
SELECT a.id, u.id
FROM users u
CROSS JOIN mini_apps a
WHERE a.slug = 'daily-checkin-partners'
  AND u.user_type = 'partner'
  AND u.status = 'active'
ON CONFLICT (mini_app_id, user_id) DO NOTHING;
