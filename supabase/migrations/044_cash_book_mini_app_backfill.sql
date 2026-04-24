-- Backfill mini_app_user_access for the 'cash-book' mini-app.
--
-- The cash-book mini-app was registered in migration 018 but the sidebar
-- gated Cash Book on user_type only, so access never flowed through the
-- mini-app system. This migration seeds mini_app_user_access for every user
-- who already has effective Cash Book access today:
--   - partners with an enabled row in cash_book_partner_access
--   - client users with an active row in cash_book_users
-- After this ships, the sidebar will gate on useHasMiniApp('cash-book') and
-- these users won't lose access.

INSERT INTO mini_app_user_access (mini_app_id, user_id)
SELECT ma.id, cbpa.user_id
FROM mini_apps ma
JOIN cash_book_partner_access cbpa ON cbpa.is_enabled = true
WHERE ma.slug = 'cash-book'
ON CONFLICT (mini_app_id, user_id) DO NOTHING;

INSERT INTO mini_app_user_access (mini_app_id, user_id)
SELECT ma.id, cbu.user_id
FROM mini_apps ma
JOIN cash_book_users cbu ON cbu.is_active = true
WHERE ma.slug = 'cash-book'
ON CONFLICT (mini_app_id, user_id) DO NOTHING;
