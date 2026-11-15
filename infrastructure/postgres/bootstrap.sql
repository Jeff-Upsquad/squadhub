-- Apply to a NEW local database, or after restoring the reviewed archive.
-- Never run this against hosted production. Existing auth.users and its FKs
-- remain intact so UUID identities survive the replacement login service.
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY, instance_id uuid, aud text, role text, email text,
  encrypted_password text, email_confirmed_at timestamptz,
  confirmation_token text, recovery_token text, email_change_token_new text, email_change text,
  raw_app_meta_data jsonb DEFAULT '{}', raw_user_meta_data jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
  last_sign_in_at timestamptz, banned_until timestamptz, deleted_at timestamptz
);
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS invited_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS local_identity_email_unique ON auth.users(lower(email)) WHERE deleted_at IS NULL;
CREATE SCHEMA IF NOT EXISTS hub_identity;
REVOKE ALL ON SCHEMA hub_identity FROM PUBLIC;
CREATE TABLE IF NOT EXISTS hub_identity.sessions (
  id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  refresh_hash text NOT NULL UNIQUE, expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS local_sessions_user ON hub_identity.sessions(user_id);
CREATE TABLE IF NOT EXISTS hub_identity.login_tickets (
  token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
ALTER TABLE hub_identity.login_tickets ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'magiclink';
ALTER TABLE hub_identity.login_tickets ADD COLUMN IF NOT EXISTS redirect_to text;
CREATE TABLE IF NOT EXISTS hub_identity.rate_limits (
  key text PRIMARY KEY, attempts integer NOT NULL, reset_at timestamptz NOT NULL
);
REVOKE ALL ON ALL TABLES IN SCHEMA hub_identity FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA hub_identity, auth, public TO local_identity;
GRANT SELECT, INSERT, UPDATE, DELETE ON auth.users TO local_identity;
DROP POLICY IF EXISTS local_identity_users ON auth.users;
CREATE POLICY local_identity_users ON auth.users TO local_identity USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA hub_identity TO local_identity;
-- No CREATE on public for untrusted login roles. Source RLS / ACLs are retained
-- by the archive restore; don't grant anonymous/authenticated broad table access.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_namespace WHERE nspname='smm') THEN
    GRANT USAGE ON SCHEMA smm TO service_role;
    GRANT ALL ON ALL TABLES IN SCHEMA smm TO service_role;
    GRANT ALL ON ALL SEQUENCES IN SCHEMA smm TO service_role;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA smm TO service_role;
  END IF;
END $$;
-- Restored public.users is server-only with RLS. A narrow private function
-- exposes status checks without giving identity access to profile contents or
-- granting BYPASSRLS across the application database.
CREATE OR REPLACE FUNCTION hub_identity.account_status(user_id uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result text;
BEGIN
  SELECT status::text INTO result FROM public.users WHERE id=user_id;
  RETURN result;
END
$$;
REVOKE ALL ON FUNCTION hub_identity.account_status(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hub_identity.account_status(uuid) TO local_identity;
CREATE OR REPLACE FUNCTION hub_identity.check_session() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE claims jsonb := coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb;
BEGIN
  IF claims->>'role' = 'authenticated' THEN
    IF claims->>'iss' IS DISTINCT FROM current_setting('app.settings.jwt_issuer',true)
       OR NOT EXISTS (
         SELECT 1 FROM hub_identity.sessions s JOIN auth.users u ON u.id=s.user_id
         WHERE s.id=(claims->>'session_id')::uuid AND s.user_id=(claims->>'sub')::uuid
         AND s.revoked_at IS NULL AND s.expires_at>now() AND u.deleted_at IS NULL
         AND (u.banned_until IS NULL OR u.banned_until<=now())
       ) THEN RAISE sqlstate 'PT401' USING message='Invalid or revoked session'; END IF;
    IF EXISTS (SELECT 1 FROM public.users WHERE id=(claims->>'sub')::uuid
      AND status IN ('pending','rejected','banned','suspended')) THEN
      RAISE sqlstate 'PT403' USING message='Account is not active';
    END IF;
  ELSIF claims->>'role' = 'service_role' THEN
    IF claims->>'iss' IS DISTINCT FROM current_setting('app.settings.jwt_issuer',true) THEN
      RAISE sqlstate 'PT401' USING message='Invalid service identity';
    END IF;
  ELSIF claims->>'role' IS NOT NULL AND claims->>'role' <> 'anon' THEN
    RAISE sqlstate 'PT401' USING message='Unsupported role';
  END IF;
END $$;
REVOKE ALL ON FUNCTION hub_identity.check_session() FROM PUBLIC;
GRANT USAGE ON SCHEMA hub_identity TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION hub_identity.check_session() TO anon, authenticated, service_role;
-- These helpers are also used by existing imported policies and RPCs.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid
$$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role'
$$;
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb
$$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid(), auth.role(), auth.jwt() TO anon, authenticated, service_role;
