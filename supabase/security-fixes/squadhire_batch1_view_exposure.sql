-- SquadHire security batch 1 — lock down views exposing auth.users (advisor ERRORs)
-- Project: cwgrooocsklytlmvwabv (SquadHire)
-- Findings addressed:
--   * auth_users_exposed (ERROR x2): v_talent_profile_tier, admin_talent_search readable by anon
--   * security_definer_view (ERROR x4): all four views run with owner (postgres) privileges
-- Verified safe (2026-06-11):
--   * All call sites use service_role only (talent-access / admin / subscription-matcher services).
--   * anon client is used solely for auth flows; no frontend talks to PostgREST.
--   * service_role has full grants on business_users + lead_submissions (invoker switch OK),
--     but NO grant on auth.users — so the two auth-joining views must stay definer-style.

begin;

-- 1) Remove API exposure: anon/authenticated currently hold ALL privileges on these views.
revoke all on public.admin_talent_search   from anon, authenticated;
revoke all on public.admin_business_search from anon, authenticated;
revoke all on public.admin_lead_search     from anon, authenticated;
revoke all on public.v_talent_profile_tier from anon, authenticated;

-- 2) Switch the two views that do NOT touch auth.users to invoker rights
--    (clears their security_definer_view lint; service_role keeps working).
alter view public.admin_business_search set (security_invoker = true);
alter view public.admin_lead_search     set (security_invoker = true);

-- admin_talent_search and v_talent_profile_tier intentionally remain definer-style:
-- they join auth.users, which only the view owner (postgres) may read. Their exposure
-- is eliminated by the revokes above; the residual security_definer_view lint on these
-- two is accepted. If either view is ever DROPped and re-CREATEd, default privileges
-- will re-grant anon/authenticated — re-apply the revokes in that migration.

commit;

-- Verification (expect 0 rows):
-- select table_name, grantee from information_schema.role_table_grants
--  where table_schema = 'public'
--    and table_name in ('v_talent_profile_tier','admin_talent_search',
--                       'admin_business_search','admin_lead_search')
--    and grantee in ('anon','authenticated');
