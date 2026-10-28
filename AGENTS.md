# Repository instructions

Read `CLAUDE.md` for this repository's architecture and release workflows.
Before production database work, migrations, CMPD or PD, read
`workflows/supabase-production.md` and verify
`supabase/production-target.json` using
`python3 tools/supabase-production.py status`.
Use the explicit production helper for migration status, dry-run and apply.
Old CLI sessions, copied caches and retired project refs are not authoritative.
Never commit or print `supabase/.env` or other credentials. Deployment does not
apply SQL migrations automatically; inspect the full deployment range and apply
only its intended migrations before dependent code.
