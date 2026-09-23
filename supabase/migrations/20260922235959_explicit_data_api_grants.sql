-- Preserve the Data API permissions that existing SquadHub projects received
-- automatically before Supabase changed its public-schema defaults.
--
-- This is intentionally a one-time compatibility grant for tables and
-- sequences created by all earlier migrations. It does not change default
-- privileges: every future CREATE TABLE migration must grant only the access
-- that table needs in the same migration.
--
-- RLS remains the row-level security boundary for anon and authenticated.
-- Grant base tables only: `GRANT ... ON ALL TABLES` also includes views and
-- could undo intentional view-level revokes.
DO $$
DECLARE
  target_table RECORD;
BEGIN
  FOR target_table IN
    SELECT schemaname, tablename
    FROM pg_tables
    WHERE schemaname = 'public'
  LOOP
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I.%I TO anon, authenticated, service_role',
      target_table.schemaname,
      target_table.tablename
    );
  END LOOP;
END
$$;

-- Required by tables that use serial/identity-backed values.
GRANT USAGE, SELECT
ON ALL SEQUENCES IN SCHEMA public
TO anon, authenticated, service_role;
