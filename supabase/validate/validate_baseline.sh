#!/bin/bash
# Prove supabase/migrations/*.sql apply cleanly to a plain local Postgres
# (no Docker / Supabase CLI needed). Creates a throwaway database, loads the
# Supabase stand-ins (supabase_stubs.sql), applies every migration in order with
# ON_ERROR_STOP, then runs the tenancy smoke test (tenancy_smoke.sql).
#
# Usage: PGHOST=127.0.0.1 PGPORT=5432 PGUSER=postgres bash supabase/validate/validate_baseline.sh
# Never point this at a real Supabase project.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
DB="${VALIDATE_DB:-saas_baseline_check}"
psql -X -q -v ON_ERROR_STOP=1 -d postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB"
psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -c "ALTER DATABASE $DB SET search_path = public, extensions"
psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$HERE/supabase_stubs.sql" 2>&1 | grep -v "wal_level\|HINT:" || true
for f in $(ls "$ROOT"/supabase/migrations/*.sql | LC_ALL=C sort); do
  echo "applying $(basename "$f")"
  psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$f"
done
psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$HERE/tenancy_smoke.sql"
echo "OK: baseline applied and tenancy smoke test passed on database $DB"
