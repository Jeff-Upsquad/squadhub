# CU — Cleanup after CMPD

## Objective
After a successful CMPD, remove the local worktree for the just-merged branch and delete the branch locally and on origin. Then reclaim secondary local + VPS resources (old `/tmp` junk, dangling Docker images, Caddyfile backups).

## When to Use
When the user says "CU" (case-insensitive). Assumes CMPD just completed successfully and the feature branch is fully merged into `origin/main`.

## Preconditions
- Last CMPD verified green (squadhub.in / admin.squadhub.in / api.squadhub.in all healthy).
- The feature branch has been merged to `main` and pushed to `origin`. Verify with `git branch --merged main` before deleting.
- You're in the main checkout (`/Users/jeffzeena/squadhub web`), not inside the worktree you're about to remove.

## Steps

### A. Worktree + branch removal

1. **Discover target.** If the user named a branch, use it. Otherwise find the most-recently-merged branch and its worktree path from `git worktree list`.
2. **Verify merged.** `git branch --merged main` must list `$BRANCH`. If not, **stop and report** — never delete unmerged work. Confirm the merge is on `origin/main` too (`git fetch && git log origin/main --grep "$BRANCH"`).
3. **Announce & confirm.** List the worktree path, local branch, and remote branch to be deleted. **Wait for explicit user OK** — never delete branches/worktrees without confirmation.
4. **Remove the worktree.**
   ```bash
   cd "/Users/jeffzeena/squadhub web"
   git worktree remove "$WT"
   ```
   If it refuses due to uncommitted changes, stop — don't `--force` without asking; show that worktree's `git status`.
5. **Delete the local branch** (safe `-d`, refuses if unmerged):
   ```bash
   git branch -d "$BRANCH"
   ```
6. **Delete the remote branch (if any):**
   ```bash
   git ls-remote --exit-code --heads origin "$BRANCH" && git push origin --delete "$BRANCH" || echo "no remote branch"
   ```

### B. Local + VPS resource cleanup

7. **Stop orphaned local dev servers** for that worktree (ask first if other worktrees have long-running edits).
8. **Clean local /tmp junk** (`rm -f /tmp/squadhub*.tar.gz` etc.).
9. **Prune old Caddyfile backups on VPS** — keep the 5 most recent:
   ```bash
   ssh root@72.61.245.97 'cd /opt/squadhub && ls -t Caddyfile.bak.* 2>/dev/null | tail -n +6 | xargs -r rm -v'
   ```
10. **Prune dangling Docker images on VPS** (each rebuild leaves the prior `:latest` as `<none>`):
    ```bash
    ssh root@72.61.245.97 'df -h / | tail -1; docker image prune -f; df -h / | tail -1'
    ```
    **Do not** use `docker system prune -a` — it would delete other projects' images sharing this VPS (CRM, SquadHire, etc.).
11. **Report.** One-line summary: worktree removed, branches deleted, /tmp cleaned, VPS Caddyfile backups kept, Docker images pruned + GB reclaimed.

## Edge Cases
- **Branch not merged.** Stop. Never `git branch -D` without explicit instruction.
- **Worktree has uncommitted changes.** Stop; surface `git status`. Don't `--force`.
- **Worktree path stale.** `git worktree prune`, then retry.
- **Docker prune reclaims 0 B.** Already pruned recently — not an error.
- **"Clean everything" request.** Clarify scope — `docker system prune -a --volumes` on this shared VPS would wipe other projects' certs/volumes. Require explicit per-service confirmation.
