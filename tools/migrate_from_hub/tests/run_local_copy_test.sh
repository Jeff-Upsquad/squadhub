#!/bin/bash
# End-to-end local test of plan -> copy -> freeze on SYNTHETIC data.
# Spins up a throwaway Postgres 16 cluster (no Docker), loads the SaaS baseline
# with supabase/validate/validate_baseline.sh, runs the tools, checks results,
# re-runs for idempotency, then stops the cluster.
#
#   bash tools/migrate_from_hub/tests/run_local_copy_test.sh [WORKDIR]
#
# Never touches the Hub or any remote database (HUB_ENV_FILE is pointed at an
# empty file so even the Hub ref lookup falls back to the hard-coded ref).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
WORK="${1:-$ROOT/.tmp/migrate_test}"
PORT="${PGTEST_PORT:-5544}"
DB=saas_migrate_test
mkdir -p "$WORK"
export HUB_ENV_FILE="$WORK/empty.env"; : > "$HUB_ENV_FILE"
export PGHOST=127.0.0.1 PGPORT=$PORT PGUSER=postgres
TARGET="postgresql://postgres@127.0.0.1:$PORT/$DB"
cd "$ROOT"

if [ ! -d "$WORK/pg" ]; then
  LC_ALL=C initdb -D "$WORK/pg" -U postgres -A trust --no-locale -E UTF8 >/dev/null
fi
LC_ALL=C pg_ctl -D "$WORK/pg" -o "-p $PORT -c wal_level=logical" -l "$WORK/pg.log" -w start >/dev/null
trap 'pg_ctl -D "$WORK/pg" -m fast -w stop >/dev/null' EXIT

VALIDATE_DB=$DB bash supabase/validate/validate_baseline.sh | tail -1

M="python3 -m tools.migrate_from_hub"
python3 -m tools.migrate_from_hub.tests.make_fixture "$WORK/fixture.json" >/dev/null
$M.plan --fixture "$WORK/fixture.json" --out-dir "$WORK"

echo "== safety checks"
expect_fail() { if "$@" >/dev/null 2>"$WORK/err.txt"; then echo "FAIL: should have refused: $*"; exit 1; else echo "ok refused: $(tail -1 "$WORK/err.txt")"; fi; }
expect_fail $M.copy --plan "$WORK/migration_plan.json" --fixture "$WORK/fixture.json" --execute
expect_fail $M.copy --plan "$WORK/migration_plan.json" --fixture "$WORK/fixture.json" --execute --auth-mode local-stub \
  --allow-blockers --target "postgresql://postgres.kfxdbhwxzvptzzcuzlal:x@aws-0-ap-south-1.pooler.supabase.com:6543/postgres"
expect_fail $M.copy --plan "$WORK/migration_plan.json" --fixture "$WORK/fixture.json" --execute --auth-mode local-stub \
  --allow-blockers --target "postgresql://postgres:x@db.kfxdbhwxzvptzzcuzlal.supabase.co:5432/postgres"
expect_fail $M.copy --plan "$WORK/migration_plan.json" --fixture "$WORK/fixture.json" --execute --auth-mode local-stub --target "$TARGET"

echo "== dry run (no DB)"
$M.copy --plan "$WORK/migration_plan.json" --fixture "$WORK/fixture.json"
COUNT_BEFORE=$(psql -X -At -d $DB -c "select count(*) from public.workspaces")
[ "$COUNT_BEFORE" = "0" ] || { echo "FAIL: dry run wrote to the DB"; exit 1; }

echo "== execute"
$M.copy --plan "$WORK/migration_plan.json" --fixture "$WORK/fixture.json" --execute --auth-mode local-stub \
  --allow-blockers --target "$TARGET"
psql -X -q -d $DB -f tools/migrate_from_hub/tests/assertions.sql

snapshot() { psql -X -At -d $DB -c "select (select count(*) from users)||'/'||(select count(*) from workspaces)||'/'||(select count(*) from workspace_members)||'/'||(select count(*) from tasks)||'/'||(select count(*) from messages)||'/'||(select count(*) from resource_memberships)||'/'||(select count(*) from hub_migration.id_map)||'/'||(select count(*) from platform_audit_log)||'/'||(select count(*) from channels)"; }
S1=$(snapshot)
echo "== re-run (finished targets skipped)"
$M.copy --plan "$WORK/migration_plan.json" --fixture "$WORK/fixture.json" --execute --auth-mode local-stub \
  --allow-blockers --target "$TARGET"
S2=$(snapshot)
echo "== resync (everything re-inserted with ON CONFLICT DO NOTHING)"
$M.copy --plan "$WORK/migration_plan.json" --fixture "$WORK/fixture.json" --execute --auth-mode local-stub \
  --allow-blockers --resync --target "$TARGET"
S3=$(snapshot)
echo "row counts users/ws/members/tasks/messages/memberships/id_map/audit/channels: $S1 | rerun $S2 | resync $S3"
[ "$S1" = "$S2" ] && [ "$S1" = "$S3" ] || { echo "FAIL: re-run changed row counts"; exit 1; }
psql -X -q -d $DB -f tools/migrate_from_hub/tests/assertions.sql

echo "== freeze (generate only)"
$M.freeze --plan "$WORK/migration_plan.json" --fixture "$WORK/fixture.json" --out-dir "$WORK" --block-login
tail -1 "$WORK/hub_freeze.sql" | grep -q ROLLBACK || { echo "FAIL: freeze SQL must end with ROLLBACK"; exit 1; }
echo "ALL LOCAL MIGRATION TESTS PASSED"
