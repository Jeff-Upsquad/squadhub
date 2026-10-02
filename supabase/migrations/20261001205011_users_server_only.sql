-- Make public.users server-only.
--
-- APPLIED to production (kfxdbhwxzvptzzcuzlal) on 2026-10-02 via MCP
-- apply_migration as version 20261001205011. Verified afterwards: no policies,
-- no anon/authenticated grants, RLS on, server reads of users still 200, and
-- no permission-denied errors in the Postgres logs.
--
-- requireAdmin trusts users.is_admin, and requireAuth trusts users.status and
-- users.user_type. But anon and authenticated held every privilege on this
-- table, and two policies applied to them:
--   "Users can update own profile"  UPDATE  USING (auth.uid() = id), no WITH CHECK
--   "Users can read all profiles"   SELECT  USING (true)
-- So any signed-in user could promote themselves with one Data API call,
--   PATCH /rest/v1/users?id=eq.<own id>  {"is_admin": true}
-- and could also lift their own ban or suspension or change their user_type.
-- With only the anon key, anyone could also read every row, including email
-- and phone. The anon key is public: Squad CRM's web app (same project) ships
-- it in its browser bundle.
--
-- Nothing needs anon/authenticated access here. Checked 2026-10-02:
--   * SquadHub server (requireAuth, requireAdmin, every route) and Squad CRM
--     server read and write users only through the service-role client.
--   * No SquadHub web, admin, partner-portal, desktop or Android client has a
--     Supabase data client. Squad CRM's browser client only does auth
--     (getSession / onAuthStateChange / signOut).
--   * 24h of API logs: 73,748 /rest/v1/users requests, all with the secret
--     key. 0 /rest/v1 requests of any kind came with a user JWT or the anon key.
--   * No views read users. Realtime does not publish users.
--   * The notify_* and chat_dm_validate_pair trigger functions read users as
--     the invoking role. They fire on writes that today come only from the
--     service role, so they keep working.
--
-- This follows supabase/migrations/AGENTS.md for server-only tables. RLS stays
-- enabled. With no policies left, a future GRANT to anon/authenticated still
-- exposes nothing until a deliberate policy is added.

DROP POLICY IF EXISTS "Users can update own profile" ON public.users;
DROP POLICY IF EXISTS "Users can read all profiles" ON public.users;

REVOKE ALL PRIVILEGES ON TABLE public.users FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.users TO service_role;

-- Verification. Expect no policies, no anon/authenticated grants, RLS on.
-- SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'users';
-- SELECT grantee, string_agg(privilege_type, ',') FROM information_schema.role_table_grants
--  WHERE table_schema = 'public' AND table_name = 'users' GROUP BY grantee;
-- SELECT relrowsecurity FROM pg_class WHERE oid = 'public.users'::regclass;
--
-- Rollback:
-- GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.users TO anon, authenticated;
-- CREATE POLICY "Users can read all profiles" ON public.users FOR SELECT USING (true);
-- CREATE POLICY "Users can update own profile" ON public.users FOR UPDATE
--   USING ((SELECT auth.uid()) = id);
