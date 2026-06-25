-- ✅ APPLIED 2026-06-10 (migration: harden_is_admin_use_app_metadata).
--    jeff@upsquadconnect.com badged with app_metadata.role='admin' first; verified
--    1 app_metadata admin, 0 user_metadata admins, is_admin() now reads app_metadata.
--    Kept for reference — the version actually applied is STABLE; otherwise identical.
--
-- Batch 5: Fix is_admin() privilege escalation — DO NOT RUN until admins are backfilled!
--
-- VULNERABILITY: is_admin() currently checks auth.jwt() -> 'user_metadata' ->> 'role'.
-- user_metadata is editable by the end user themselves (supabase.auth.updateUser({data: {role: 'admin'}})),
-- so ANY authenticated user can self-promote and pass all 28 admin RLS policies
-- (talent_users, business_users, categories, profile_share_links, invitations, ...).
--
-- PREREQUISITE (must happen first, via service role / server):
--   For every legitimate admin user, set app_metadata.role = 'admin' using the Auth Admin API:
--   supabase.auth.admin.updateUserById(userId, { app_metadata: { role: 'admin' } })
--   app_metadata is server-controlled and cannot be modified by the user.
--
-- THEN run this to switch the check:
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    RETURN (
        SELECT COALESCE(
            (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin',
            false
        )
    );
END;
$$;
