#!/usr/bin/env bash
set -euo pipefail

VPS="root@72.61.245.97"
DEPLOY_DIR="/opt/squadhub"
LOCK_FILE="/var/lock/squadhub-deploy.lock"
LOCK_TIMEOUT=600  # seconds — longer than any realistic full rebuild

# Timestamp-tag images per deploy so rollback is a cheap `docker tag + up`.
# See workflows/rollback.md for the rollback procedure.
DEPLOY_TAG="$(date -u +%Y%m%d-%H%M%S)"

echo "=== SquadHub Deploy ==="
echo "Deploy tag: $DEPLOY_TAG"
echo ""

# --- Local habit: .env / .env.example drift check ---
# Warn if any .env.example is missing a key that the real .env has,
# or has a key the real .env doesn't. Never blocks the deploy — just surfaces.
envdrift() {
  local real="$1"
  local example="$2"
  [ -f "$real" ] || return 0
  [ -f "$example" ] || return 0

  local real_keys example_keys
  real_keys=$(grep -oE '^[A-Z_][A-Z0-9_]*=' "$real" | sort -u)
  example_keys=$(grep -oE '^[A-Z_][A-Z0-9_]*=' "$example" | sort -u)

  local missing_in_example added_in_example
  missing_in_example=$(comm -23 <(echo "$real_keys") <(echo "$example_keys"))
  added_in_example=$(comm -13 <(echo "$real_keys") <(echo "$example_keys"))

  if [ -n "$missing_in_example" ] || [ -n "$added_in_example" ]; then
    echo "⚠ env drift: $real vs $example"
    [ -n "$missing_in_example" ] && echo "  missing from example: $(echo "$missing_in_example" | tr '\n' ' ')"
    [ -n "$added_in_example" ] && echo "  in example only:      $(echo "$added_in_example" | tr '\n' ' ')"
  fi
}

echo "Env file drift check..."
envdrift ".env" ".env.example"
envdrift "server/.env" "server/.env.example"
echo "  done"
echo ""

# Pre-lock: capture VPS HEAD so we can tell at the end if anything actually shipped.
BEFORE_SHA=$(ssh "$VPS" "cd $DEPLOY_DIR && git rev-parse HEAD")
echo "Current VPS commit: ${BEFORE_SHA:0:7}"

# Announce contention so the terminal doesn't sit silent while flock waits.
if ! ssh "$VPS" "flock -n $LOCK_FILE true" 2>/dev/null; then
    echo "Another deploy is in progress on the VPS. Waiting up to ${LOCK_TIMEOUT}s..."
fi

# Locked critical section: pull, detect, rebuild, caddy reload. All state is
# recomputed server-side inside the lock so a queued deploy sees post-first-deploy state.
# DEPLOY_TAG is passed via ssh env so the remote tagging step can use it.
set +e
ssh "$VPS" "DEPLOY_TAG=$DEPLOY_TAG flock -w $LOCK_TIMEOUT -E 78 $LOCK_FILE bash -s" <<'REMOTE'
set -euo pipefail
cd /opt/squadhub

BEFORE_SHA=$(git rev-parse HEAD)
echo ""
echo "Pulling latest from origin/main..."
git pull origin main
AFTER_SHA=$(git rev-parse HEAD)
echo "New VPS commit: ${AFTER_SHA:0:7}"

if [ "$BEFORE_SHA" = "$AFTER_SHA" ]; then
    echo ""
    echo "No new changes to deploy. VPS is already up to date."
    echo ""
    docker compose ps
    exit 0
fi

CHANGED_FILES=$(git diff --name-only "$BEFORE_SHA" "$AFTER_SHA")
echo ""
echo "Changed files:"
echo "$CHANGED_FILES"
echo ""

REBUILD_SERVER=false
REBUILD_WEB=false
REBUILD_ADMIN=false
REBUILD_ALL=false

if echo "$CHANGED_FILES" | grep -qE '^docker-compose\.yml$'; then
    REBUILD_ALL=true
fi
if echo "$CHANGED_FILES" | grep -qE '^package\.json$|^package-lock\.json$'; then
    REBUILD_ALL=true
fi
if echo "$CHANGED_FILES" | grep -qE '^shared/'; then
    REBUILD_SERVER=true
    REBUILD_WEB=true
    REBUILD_ADMIN=true
fi
if echo "$CHANGED_FILES" | grep -qE '^server/'; then
    REBUILD_SERVER=true
fi
if echo "$CHANGED_FILES" | grep -qE '^web/'; then
    REBUILD_WEB=true
fi
if echo "$CHANGED_FILES" | grep -qE '^admin/'; then
    REBUILD_ADMIN=true
fi

rm -f web/next.config.js admin/next.config.js 2>/dev/null || true

if [ "$REBUILD_ALL" = true ]; then
    SERVICES="server web admin"
    echo "Infrastructure change detected — rebuilding ALL services..."
else
    SERVICES=""
    [ "$REBUILD_SERVER" = true ] && SERVICES="$SERVICES server"
    [ "$REBUILD_WEB" = true ] && SERVICES="$SERVICES web"
    [ "$REBUILD_ADMIN" = true ] && SERVICES="$SERVICES admin"
    SERVICES=$(echo "$SERVICES" | xargs)
fi

if [ -z "$SERVICES" ]; then
    echo "Changes detected but no Docker services need rebuilding."
    echo "(Changed files are docs, workflows, or other non-service files.)"
    exit 0
fi

echo "Rebuilding: $SERVICES"
echo "---"
docker compose build $SERVICES && docker compose up -d $SERVICES

# Habit: tag ALL three images with the deploy timestamp, even if only some
# rebuilt. This gives a consistent 3-service snapshot per deploy — rolling back
# to a tag restores the full trio to the state it had at that moment.
for svc in server web admin; do
    if docker image inspect "squadhub-${svc}:latest" >/dev/null 2>&1; then
        docker tag "squadhub-${svc}:latest" "squadhub-${svc}:${DEPLOY_TAG}"
        echo "  tagged squadhub-${svc}:${DEPLOY_TAG}"
    fi
done

if echo "$CHANGED_FILES" | grep -qE '^Caddyfile$'; then
    echo ""
    echo "Reloading Caddy configuration..."
    docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile
fi
REMOTE
RC=$?
set -e

if [ "$RC" = "78" ]; then
    echo "Timed out after ${LOCK_TIMEOUT}s waiting for concurrent deploy to finish. Aborting — investigate the other deploy." >&2
    exit 78
elif [ "$RC" != "0" ]; then
    exit "$RC"
fi

# Verify outside the lock — read-only, safe while another deploy could be queuing.
AFTER_SHA=$(ssh "$VPS" "cd $DEPLOY_DIR && git rev-parse HEAD")

if [ "$BEFORE_SHA" = "$AFTER_SHA" ]; then
    # Nothing shipped (heredoc already showed status in the fast-exit path).
    exit 0
fi

echo ""
echo "=== Container Status ==="
ssh "$VPS" "cd $DEPLOY_DIR && docker compose ps"

echo ""
echo "=== Recent Logs ==="
for SVC in server web admin; do
    echo "--- $SVC ---"
    ssh "$VPS" "cd $DEPLOY_DIR && docker compose logs $SVC --tail 15 --no-log-prefix" 2>/dev/null || true
    echo ""
done

echo "Deploy complete: ${BEFORE_SHA:0:7} -> ${AFTER_SHA:0:7}  (tag: $DEPLOY_TAG)"
echo ""
echo "Rollback: bash tools/rollback.sh $DEPLOY_TAG  (or any prior tag from 'docker images | grep ^squadhub-' on the VPS)"
