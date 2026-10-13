# CU — Cleanup after CMPD

## Objective

Safely remove the worktree(s) and branch(es) **created in the current session** after CMPD (or after the user cancels that session's work), stop that session's localhost development servers, then reclaim that session's secondary local + VPS resources.

**Scope rule (user instruction, 2026-09-23):** CU only ever touches work done in the current session. Never list, offer, or delete other sessions' worktrees or branches — even if they are merged — because concurrent Claude/Codex sessions may still be using them. Must not prune Docker images belonging to other projects sharing the VPS.

**Authorization rule (user instruction, 2026-10-14):** Invoking `CU` authorizes the cleanup described here. Do not ask for an additional confirmation to remove this session's merged branches, clean worktrees, verified session-owned development servers, or regenerable temporary resources. Keep all ownership, merge, and clean-worktree checks. If ownership is uncertain or a target contains uncommitted or unmerged work, skip that target and report why; ask only when a decision outside this authorized scope is necessary.

## Preconditions

- The preceding CMPD completed and `origin/main` contains the feature work.
- Cleanup runs from the primary checkout at `/Users/jeffzeena/squadhub web`.

## Steps

1. Fetch origin and inspect `git worktree list`, local branches merged into `main`, and matching remote branches.
2. Use a branch named by the user. Otherwise the target is the branch/worktree this session created (e.g. its own `git worktree add -b …`). If this session created none, skip branch/worktree deletion and continue with its localhost servers and secondary resources — do not pick another session's branch.
3. Verify the branch is present in both local `main` and `origin/main`. Inspect the target worktree's status; stop if it contains changes.
4. List the exact worktree path, local branch, remote branch, and temporary files to be removed, then proceed without another permission request.
5. Remove the clean worktree, delete the local branch with safe `git branch -d`, and delete the remote branch only if it exists.
6. Stop localhost development servers started by this session, including servers running from the primary checkout even when no worktree was created or removed. Invoking CU authorizes stopping these session-owned servers; no additional confirmation is needed. Identify each server using the session's recorded tool session or process ID, then verify its current command, working directory, process tree, and listening port before stopping it. Stop the supervisor and its children gracefully so it cannot restart the server, and verify those processes and listeners are gone. Never kill a process solely because it occupies a familiar port or shares the checkout; preserve servers started by other sessions. If ownership cannot be established, leave that server running and report it. Report the localhost URLs stopped.
7. Clean verified session-owned secondary resources — list exact targets first, then proceed without another permission request. Skip resources whose ownership cannot be established:
   - Local `/tmp` junk (`/tmp/squadhub*.tar.gz` etc.)
   - Any `.claude/launch.json` entries this session added for its localhost servers or worktree
   - VPS items below only if this session deployed.
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
8. Report each removed item and stopped localhost server, and whether it was regenerable or recoverable.

## Edge cases

- Never force-remove a dirty worktree or use `git branch -D` without explicit instruction.
- Never delete an unmerged branch.
- If there is no branch/worktree target from this session, do not invent one or fall back to other sessions' merged branches; still stop this session's localhost servers and clean its verified temporary files.
- If the user explicitly cancels this session's unmerged work (e.g. "cancel it"), that is the instruction to discard it: `git worktree remove --force` + `git branch -D` are allowed for that session-owned target only.
- Do not run `docker system prune`, `docker image prune -a`, or broad VPS cleanup; the VPS is shared.
- If Docker prune reclaims 0 B, it was already pruned recently — not an error.
