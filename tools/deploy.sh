#!/usr/bin/env bash
set -euo pipefail

VPS="root@72.61.245.97"
DEPLOY_DIR="/opt/squadhub"

echo "=== SquadHub Deploy ==="
echo ""

# Step 1: Capture current HEAD on VPS
BEFORE_SHA=$(ssh "$VPS" "cd $DEPLOY_DIR && git rev-parse HEAD")
echo "Current VPS commit: ${BEFORE_SHA:0:7}"

# Step 2: Pull latest changes
echo "Pulling latest from origin/main..."
ssh "$VPS" "cd $DEPLOY_DIR && git pull origin main"

AFTER_SHA=$(ssh "$VPS" "cd $DEPLOY_DIR && git rev-parse HEAD")
echo "New VPS commit: ${AFTER_SHA:0:7}"

# Step 3: Check if anything changed
if [ "$BEFORE_SHA" = "$AFTER_SHA" ]; then
    echo ""
    echo "No new changes to deploy. VPS is already up to date."
    echo ""
    ssh "$VPS" "cd $DEPLOY_DIR && docker compose ps"
    exit 0
fi

# Step 4: Detect which files changed
CHANGED_FILES=$(ssh "$VPS" "cd $DEPLOY_DIR && git diff --name-only $BEFORE_SHA $AFTER_SHA")
echo ""
echo "Changed files:"
echo "$CHANGED_FILES"
echo ""

# Step 5: Determine which services to rebuild
REBUILD_SERVER=false
REBUILD_WEB=false
REBUILD_ADMIN=false
REBUILD_ALL=false

# Infrastructure changes → full rebuild
if echo "$CHANGED_FILES" | grep -qE '^docker-compose\.yml$'; then
    REBUILD_ALL=true
fi

# Root package files → full rebuild (all Dockerfiles COPY these)
if echo "$CHANGED_FILES" | grep -qE '^package\.json$|^package-lock\.json$'; then
    REBUILD_ALL=true
fi

# shared/ changes → all services depend on it
if echo "$CHANGED_FILES" | grep -qE '^shared/'; then
    REBUILD_SERVER=true
    REBUILD_WEB=true
    REBUILD_ADMIN=true
fi

# Package-specific changes
if echo "$CHANGED_FILES" | grep -qE '^server/'; then
    REBUILD_SERVER=true
fi
if echo "$CHANGED_FILES" | grep -qE '^web/'; then
    REBUILD_WEB=true
fi
if echo "$CHANGED_FILES" | grep -qE '^admin/'; then
    REBUILD_ADMIN=true
fi

# Step 6: Remove rogue next.config.js files (known gotcha)
ssh "$VPS" "cd $DEPLOY_DIR && rm -f web/next.config.js admin/next.config.js" 2>/dev/null || true

# Step 7: Build and restart affected services
if [ "$REBUILD_ALL" = true ]; then
    SERVICES="server web admin"
    echo "Infrastructure change detected — rebuilding ALL services..."
else
    SERVICES=""
    [ "$REBUILD_SERVER" = true ] && SERVICES="$SERVICES server"
    [ "$REBUILD_WEB" = true ] && SERVICES="$SERVICES web"
    [ "$REBUILD_ADMIN" = true ] && SERVICES="$SERVICES admin"
    SERVICES=$(echo "$SERVICES" | xargs) # trim whitespace
fi

if [ -z "$SERVICES" ]; then
    echo "Changes detected but no Docker services need rebuilding."
    echo "(Changed files are docs, workflows, or other non-service files.)"
    exit 0
fi

echo "Rebuilding: $SERVICES"
echo "---"
ssh "$VPS" "cd $DEPLOY_DIR && docker compose build $SERVICES && docker compose up -d $SERVICES"

# Step 8: Reload Caddy if Caddyfile changed
if echo "$CHANGED_FILES" | grep -qE '^Caddyfile$'; then
    echo ""
    echo "Reloading Caddy configuration..."
    ssh "$VPS" "cd $DEPLOY_DIR && docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile"
fi

# Step 9: Verify
echo ""
echo "=== Container Status ==="
ssh "$VPS" "cd $DEPLOY_DIR && docker compose ps"

echo ""
echo "=== Recent Logs ==="
for SVC in $SERVICES; do
    echo "--- $SVC ---"
    ssh "$VPS" "cd $DEPLOY_DIR && docker compose logs $SVC --tail 15 --no-log-prefix" 2>/dev/null || true
    echo ""
done

echo "Deploy complete: ${BEFORE_SHA:0:7} -> ${AFTER_SHA:0:7}"
