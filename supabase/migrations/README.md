# Supabase migration permissions

Supabase no longer automatically exposes new tables in the `public` schema to
the Data API. Every migration that creates a table must include explicit grants
for the roles that use it.

Use the smallest permission set the feature needs. For example:

```sql
-- Public read-only data, when genuinely required.
GRANT SELECT ON TABLE public.your_table TO anon;

-- Access for signed-in users. RLS policies still apply.
GRANT SELECT, INSERT, UPDATE, DELETE
ON TABLE public.your_table
TO authenticated;

-- Access for the SquadHub server.
GRANT SELECT, INSERT, UPDATE, DELETE
ON TABLE public.your_table
TO service_role;
```

For server-only tables, grant access only to `service_role`. Do not grant
`anon` or `authenticated` access unless the table is intentionally queried
through a user-scoped Data API client. Keep RLS enabled and define policies for
every table exposed to `anon` or `authenticated`.

If a new table uses a serial or identity sequence, grant the required sequence
permissions too:

```sql
GRANT USAGE, SELECT
ON SEQUENCE public.your_table_id_seq
TO authenticated, service_role;
```
