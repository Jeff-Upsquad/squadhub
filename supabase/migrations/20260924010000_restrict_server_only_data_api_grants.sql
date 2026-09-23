-- Keep server-only tables inaccessible to user-scoped Data API roles on both
-- sides of Supabase's 2026-10-30 public-schema privilege default change.
--
-- Before the cutoff, new public tables may still receive automatic grants;
-- after it, they do not. Explicit revokes make the intended access identical
-- in either environment. RLS remains enabled as an additional boundary.
REVOKE ALL PRIVILEGES ON TABLE public.skill_grants
FROM anon, authenticated;

REVOKE ALL PRIVILEGES ON TABLE public.partner_payment_statuses
FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE
ON TABLE public.skill_grants, public.partner_payment_statuses
TO service_role;
