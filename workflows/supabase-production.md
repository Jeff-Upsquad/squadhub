# Current Supabase production target

Production moved on 28 October 2026. This repository uses **`hvcpoxgkdybyscaebtik`**
([SQL Editor](https://supabase.com/dashboard/project/hvcpoxgkdybyscaebtik/sql/new)),
shared by **SquadHub / Squad CRM**. `kfxdbhwxzvptzzcuzlal` is retired. Do not restore, migrate,
or deploy against the retired project. `supabase/production-target.json` is the
checked-in project identity; CLI caches, old sessions and old account logins are
not authoritative.

## Before migrations or CMPD/PD

1. Read the full deployment range for migrations, including other merged work.
2. Run `python3 tools/supabase-production.py status`. This checks the project,
   uses an explicit database connection with verified TLS, and reads migration
   history. It does not change database schema or data.
3. Run `python3 tools/supabase-production.py dry-run`. Inspect the complete
   proposed migration list. Apply only the intended new migrations, before
   dependent application code: `python3 tools/supabase-production.py apply`.
   A CMPD/PD request authorizes its required migrations under the existing review
   workflow; do not treat creating a migration file as applying it.
4. Verify the migration ledger, then follow the normal deployment workflow.

`apply` runs `supabase db push` and can change production. The repository and
remote history include legacy numbered migrations and share a ledger with a
sibling app. A dry run listing old/unrelated migrations or missing remote files
must be reconciled before applying. Do not use `--include-all`, repair remote
history, or manufacture placeholder history to force a bulk replay. The SQL
Editor above is an alternative: apply only the reviewed migration and record
its real version/statements in `supabase_migrations.schema_migrations` in the
same transaction. Never replay historical migrations or restore an old snapshot
over the live database.

## Local credentials and new worktrees

The helper reads ignored, private `supabase/.env` and `supabase/.ca.crt` from the
current checkout, falling back to the primary checkout through Git's common
directory. Credentials contain `PROJECT_REF`, `PGHOST`, `PGPORT=5432`,
`PGUSER`, `PGPASSWORD`, `PGDATABASE=postgres`, and `PGSSLMODE=verify-full`.
Use the new project's direct connection or session pooler, with its own password
and CA certificate. These files must never be committed or printed. A new machine
needs those credentials installed securely; it fails closed when absent.

The helper connects directly and does not depend on the temporary migration
access token, its expiration, or the globally logged-in Supabase account.
CLI `supabase/.temp/` is ignored local state. For plain linked CLI commands,
first link to **`hvcpoxgkdybyscaebtik`** with an account authorized for its organization and
verify the linked identity; never let an old CLI login select production.

Application deployment preserves the VPS's new Supabase environment settings;
deploy scripts do not automatically apply SQL. Existing backup tools deliberately
support old project refs to recover historical archives; that is not permission
to use those refs for application migrations.
