# CU — Cleanup after CMPD

## Objective

Safely remove a fully merged feature worktree and branch after CMPD, then reclaim secondary local + VPS resources. Must not prune Docker images belonging to other projects sharing the VPS.

## Preconditions

- The preceding CMPD completed and `origin/main` contains the feature work.
- Cleanup runs from the primary checkout at `/Users/jeffzeena/squadhub web`.

## Steps

1. Fetch origin and inspect `git worktree list`, local branches merged into `main`, and matching remote branches.
2. Use a branch named by the user. Otherwise identify the most recently merged non-`main` branch that still has a worktree. If none exists, report that there is no branch/worktree cleanup target.
3. Verify the branch is present in both local `main` and `origin/main`. Inspect the target worktree's status; stop if it contains changes.
4. List the exact worktree path, local branch, remote branch, and temporary files proposed for deletion. Ask for explicit confirmation before deleting any worktree or branch.
5. After confirmation, remove the clean worktree, delete the local branch with safe `git branch -d`, and delete the remote branch only if it exists.
6. Clean secondary resources — list exact targets first and require confirmation:
   - Local `/tmp` junk (`/tmp/squadhub*.tar.gz` etc.)
   - Orphaned local dev servers for the removed worktree
   - VPS Caddyfile backups — keep the 5 most recent:
     ```bash
     ssh root@72.61.245.97 'cd /opt/squadhub && ls -t Caddyfile.bak.* 2>/dev/null | tail -n +6 | xargs -r rm -v'
     ```
    - Dangling SquadHub images on VPS (each rebuild leaves the prior `:latest` as `<none>`):
      Dangling images report `REPOSITORY` as `<none>`, so filtering by `^squadhub-` never matches. Use a label that survives untagging (compose adds `com.docker.compose.project=squadhub` at build time):
      ```bash
      ssh root@72.61.245.97 'df -h / | tail -1; docker image prune -f --filter label=com.docker.compose.project=squadhub; df -h / | tail -1'
      ```
      If the label filter is unavailable on an older Docker, fall back to pruning only SquadHub-tagged old deploy images (already kept to 5 by `tools/deploy.sh`) and skip generic dangling prune. Do not use unfiltered `docker image prune -f`, `docker system prune -a`, or `docker system prune --volumes` — the VPS is shared with other products (CRM, SquadHire, kia, etc.).
7. Report each removed item and whether it was regenerable or recoverable.

## Edge cases

- Never force-remove a dirty worktree or use `git branch -D` without explicit instruction.
- Never delete an unmerged branch.
- If there is no branch/worktree target, do not invent one; temporary-file cleanup may still be offered separately.
- Do not run `docker system prune`, `docker image prune -a`, or broad VPS cleanup; the VPS is shared.
- If Docker prune reclaims 0 B, it was already pruned recently — not an error.
