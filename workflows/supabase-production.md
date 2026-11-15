# Current production database target

Production moved to VPS PostgreSQL on 16 November 2026. The checked-in
`supabase/production-target.json` identifies **`squadhub-local`**, its container,
database and unique deployment marker. SquadHub, Bots, SMM and Clips share this
backend. CRM and SquadHire CRM use separate databases and are outside this target.
The hosted `hvcpoxgkdybyscaebtik` source and older `kfxdbhwxzvptzzcuzlal` project
are retired. CLI caches, old credentials and account logins are not authoritative.

## Before migrations or CMPD/PD

1. Inspect the full deployment range, including other merged migrations.
2. Run `python3 tools/supabase-production.py status`. It verifies the checked-in
   container identity, isolated database network and unique deployment marker,
   then reads the migration ledger in a read-only transaction over SSH.
3. Select exactly one intended migration at a time:
   `python3 tools/supabase-production.py dry-run --migration <14-digit-version>`.
   Inspect the SQL and ledger status. Apply before dependent code with
   `python3 tools/supabase-production.py apply --migration <14-digit-version>`.
   A CMPD/PD request authorizes required migrations within the existing review
   workflow. Creating a file does not apply it.
4. Verify the ledger and follow the normal deployment workflow.

The PostgreSQL helper runs the selected migration and its real ledger entry in
one transaction. Bulk replay is disabled. Do not replay historical migrations,
repair history with placeholders, or restore a snapshot over the live database.
Deployment does not apply SQL automatically.

## Credentials and backups

The PostgreSQL helper uses the existing verified SSH connection to the VPS; it
requires no local database password or Supabase CLI login. It refuses a database
with exposed host ports or a different deployment marker. Private runtime files
under `/opt/squadhub/infrastructure/postgres/` must never be printed or committed.

Encrypted PostgreSQL backups use Cloudflare R2 under
`backups/postgres/squadhub-local/`, with separate state and backup, watchdog and
restore-check systemd timers. Preserve the retired hosted backup namespace and
configuration for historical recovery; those archives do not authorize restoring
or migrating into a retired source.

For a read-only historical source audit only, the helper retains the explicit
`status --source-backup-config /etc/squadhub-backup/.env` option on the VPS. It
requires the dedicated source backup role and verified TLS. Ordinary production
commands must use the checked-in PostgreSQL target.
