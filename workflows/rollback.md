# Rollback

## Objective

Revert production to a previously-deployed Docker image trio (server + web + admin) in ~30 seconds, without rebuilding from source or reverting commits.

## When to Use

- A deploy broke something user-visible (HTTP 5xx, UI regressions, API errors).
- Root-cause investigation will take longer than your users are willing to wait.
- The previous deploy was known-good.

Don't use this if the root cause is a DB schema change — rolling back the app won't undo a migration. In that case, fix forward or restore the schema first.

## Preconditions

- At least one prior deploy has tagged images (the timestamp-tagging habit landed in commit `deploy-habits`; every deploy after that tags `squadhub-{server,web,admin}:YYYYMMDD-HHMMSS` alongside `:latest`).
- You know which tag to roll back to, or you'll list available tags from the VPS.

## Steps

1. **List available tags.**
   ```bash
   ssh root@72.61.245.97 \
     'docker images --format "{{.Repository}}:{{.Tag}}" | grep ^squadhub-server: | awk -F: "{print \$2}" | grep -E "^[0-9]{8}-[0-9]{6}$" | sort -r | head -20'
   ```
   Tags are UTC timestamps. Newest = current `:latest` (what you're rolling back from). Pick the one just before the bad deploy.

2. **Confirm with the user** before rolling back — downtime is brief (~5s container restart across three services) but the bad deploy disappears from `:latest`.

3. **Run the rollback script.**
   ```bash
   cd /Users/jeffzeena/squadhub
   bash tools/rollback.sh <TAG>
   ```
   Example: `bash tools/rollback.sh 20260425-143000`

   The script:
   - Verifies the tag exists for **all three** services (server, web, admin). Rollback is all-or-nothing.
   - Saves the current `:latest` across all three as `pre-rollback-<now>` (insurance to re-roll-forward).
   - Retags the target tag as `:latest` for all three services.
   - `docker compose up -d server web admin` to pick up the new image trio.
   - Verifies `squadhub.in`, `admin.squadhub.in`, `api.squadhub.in`.

4. **Verify.**
   - Script prints HTTP codes automatically.
   - Click-test the path that was broken.
   - Tail logs: `ssh root@72.61.245.97 'cd /opt/squadhub && docker compose logs server web admin --tail 30 -f'`.

5. **Report to the user.** Include:
   - Which tag is running now.
   - Which tag was rolled away from (the bad one).
   - Suggested next action (investigate root cause locally, fix forward, or permanent revert).

## Edge Cases

- **Target tag missing for one service.** Script exits 1 with the missing image name. Either pick another tag or accept that rolling back isn't consistent and you need a forward fix instead.
- **Rollback itself makes things worse.** Use `ssh root@72.61.245.97 'docker images | grep pre-rollback-'` to find the tag saved before the rollback, then `bash tools/rollback.sh <that-tag>` to roll forward again.
- **Older tag built against incompatible DB schema.** App will fail to boot with schema errors. `ssh root@... 'cd /opt/squadhub && docker compose logs server --tail 50'`. Options: (a) fix forward with a patch, (b) restore schema (dangerous on prod data). Prefer (a).
- **Caddyfile changed alongside the bad deploy.** Rollback script doesn't touch Caddy. If Caddyfile was part of the regression, restore from git (`git checkout <good-sha> -- Caddyfile`) and reload: `docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile`.
- **Concurrent deploy in flight.** Rollback doesn't take the deploy flock — they can theoretically race. If a deploy is running, wait for it or kill its build. Then roll back.
- **Image pruning removed the target tag.** If you aggressively ran `docker image prune -a`, the only rollback path is git revert + redeploy. The timestamp-tagged images *are* the rollback surface — don't prune old-but-valuable tags. See `workflows/cleanup.md` (in SquadCRM for reference) for a safe prune procedure.

## Out of scope

- **Database rollback.** `rollback.sh` changes container images only. Supabase migrations are one-way by default — always write migrations as additive. Use Supabase's point-in-time recovery if data itself is corrupted.
- **Caddy config rollback.** Separate concern; use `git` for that.
- **Customer data rollback.** Once a write commits, it stays. If a deploy corrupted data, restore from Supabase backup (dashboard → Database → Backups).

## Related

- [deploy.md](deploy.md) — every deploy creates the timestamp tag this script consumes.
- [push.md](push.md) — ships the fix-forward commit once rollback has bought time.
