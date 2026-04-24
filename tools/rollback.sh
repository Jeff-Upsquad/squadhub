#!/usr/bin/env bash
# SquadHub rollback — retag prior timestamped images as :latest and restart.
# Usage: bash tools/rollback.sh <DEPLOY_TAG>
# Example: bash tools/rollback.sh 20260425-143000
#
# Every `bash tools/deploy.sh` (since the habits landed) tags squadhub-server,
# squadhub-web, and squadhub-admin with `squadhub-<svc>:<UTC-timestamp>` alongside
# `:latest`. This script flips all three `:latest` pointers at once, so rollback
# restores the full trio consistently.
#
# List available tags on the VPS:
#   ssh root@72.61.245.97 'docker images --format "{{.Repository}}:{{.Tag}}" | grep ^squadhub- | sort -r | head -30'
set -euo pipefail

VPS="root@72.61.245.97"
DEPLOY_DIR="/opt/squadhub"
SERVICES="server web admin"

if [ $# -lt 1 ]; then
    echo "Usage: bash tools/rollback.sh <DEPLOY_TAG>" >&2
    echo "" >&2
    echo "Available deploy tags on VPS:" >&2
    ssh "$VPS" 'docker images --format "{{.Repository}}:{{.Tag}}" | grep ^squadhub-server: | awk -F: "{print \$2}" | grep -E "^[0-9]{8}-[0-9]{6}\$" | sort -r | head -20' >&2
    exit 2
fi

TAG="$1"

echo "=== SquadHub Rollback ==="
echo "Target tag: $TAG"
echo ""

# Sanity: the tag must exist for ALL three services so rollback is consistent.
MISSING=""
for svc in $SERVICES; do
    if ! ssh "$VPS" "docker image inspect squadhub-${svc}:${TAG} >/dev/null 2>&1"; then
        MISSING="$MISSING squadhub-${svc}:${TAG}"
    fi
done

if [ -n "$MISSING" ]; then
    echo "Tag '$TAG' not found for:$MISSING" >&2
    echo "" >&2
    echo "Available tags:" >&2
    ssh "$VPS" 'docker images --format "{{.Repository}}:{{.Tag}}" | grep ^squadhub-server: | awk -F: "{print \$2}" | grep -E "^[0-9]{8}-[0-9]{6}\$" | sort -r | head -20' >&2
    exit 1
fi

ssh "$VPS" "TAG=$TAG bash -s" <<'REMOTE'
set -euo pipefail
cd /opt/squadhub

PRE_TAG="pre-rollback-$(date -u +%Y%m%d-%H%M%S)"

# Save current :latest tags as a rollback-the-rollback anchor.
for svc in server web admin; do
    docker tag "squadhub-${svc}:latest" "squadhub-${svc}:${PRE_TAG}" 2>/dev/null || true
done
echo "Saved current :latest as ${PRE_TAG}"

# Flip :latest for all three services atomically.
for svc in server web admin; do
    docker tag "squadhub-${svc}:${TAG}" "squadhub-${svc}:latest"
done

# Recreate containers from the new :latest.
docker compose up -d server web admin

echo ""
echo "=== Container Status ==="
docker compose ps
REMOTE

echo ""
echo "=== Verification ==="
curl -s -o /dev/null -w "squadhub.in: HTTP %{http_code}\n" --max-time 15 https://squadhub.in
curl -s -o /dev/null -w "admin.squadhub.in: HTTP %{http_code}\n" --max-time 15 https://admin.squadhub.in
curl -s -o /dev/null -w "api.squadhub.in/health: HTTP %{http_code}\n" --max-time 15 https://api.squadhub.in/health 2>/dev/null || \
    curl -s -o /dev/null -w "api.squadhub.in: HTTP %{http_code}\n" --max-time 15 https://api.squadhub.in

echo ""
echo "Rollback to $TAG complete. Pre-rollback tags saved for re-roll-forward."
echo "To roll forward: bash tools/rollback.sh <original-tag>"
