-- Batch 2: Lock down SECURITY DEFINER functions flagged as publicly executable
-- Advisor: anon/authenticated_security_definer_function_executable
-- NOTE: get_profile_share_link_by_token intentionally stays public — the token IS the
-- capability for the public share-link feature. is_admin() is handled separately
-- (see is_admin remediation — requires app_metadata backfill first).

-- Anonymous visitors must not be able to MINT share links for arbitrary profiles
REVOKE EXECUTE ON FUNCTION public.create_share_link(p_profile_id uuid, p_token text, p_expires_at timestamp with time zone, p_created_by uuid) FROM PUBLIC, anon;

-- Anonymous visitors must not be able to ENUMERATE share tokens for any profile
REVOKE EXECUTE ON FUNCTION public.get_share_links_by_profile(p_profile_id uuid) FROM PUBLIC, anon;

-- Event-trigger helper; clients never need to call it
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;

-- OPEN QUESTION (kept authenticated EXECUTE for now): do the web/admin apps call
-- create_share_link / get_share_links_by_profile directly as the logged-in user?
-- If everything goes through the Node server (service_role), also run:
-- REVOKE EXECUTE ON FUNCTION public.create_share_link(p_profile_id uuid, p_token text, p_expires_at timestamp with time zone, p_created_by uuid) FROM authenticated;
-- REVOKE EXECUTE ON FUNCTION public.get_share_links_by_profile(p_profile_id uuid) FROM authenticated;
