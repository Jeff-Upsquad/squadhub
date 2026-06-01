# CMPD — Commit, Merge, Push, Deploy

## Objective
Stage, commit, push, and deploy changes to production in one coordinated flow. Also updates the plan file's completion status.

## Inputs
- `git status` — to confirm what's changed
- A descriptive commit message summarizing the changes

## Tools Used
- `git add -A` / `git commit` / `git push origin main`
- `tools/deploy.sh` — Docker-based VPS deployment
- `bash tools/rollback.sh <TAG>` — if rollback is needed

## Estimated Time
- 2–4 minutes (commit + push: ~1 min, deploy: ~2–3 min depending on Docker rebuild)

## Steps

### 0. Pre-check
- Ensure the working tree has changes worth shipping.
- Run typecheck/build to confirm code compiles:
  ```bash
  npx tsc --noEmit -p server/tsconfig.json
  ```
  For web changes, `npm run build -w web` is also validated by the deploy script's Docker build step.

### 1. Commit
```bash
git add -A
git commit -m "<descriptive message>"
```
- Imperative mood, under 72 chars.
- Reference what and why, not how.
- If on a feature branch, the merge step will handle origin.

### 2. Merge
If on a feature branch:
```bash
git checkout main
git merge <branch>
```
If already on `main` (hotfix/small change), skip this step — the commit was made directly to main.

### 3. Push
```bash
git push origin main
```

### 4. Deploy
```bash
bash tools/deploy.sh
```
The script:
- Pulls latest on the VPS
- Detects which packages changed (server, web, admin, shared)
- Rebuilds only affected Docker images
- Timestamp-tags all three images for rollback
- Restarts updated containers
- Prints rollback command

### 5. Verify
- Check `docker compose ps` on the VPS — all containers should be healthy.
- Visit the app and confirm the change works.

## Edge Cases
- **Push rejected (remote ahead):** `git pull --rebase origin main`, then retry push.
- **Deploy fails mid-build:** Run `bash tools/deploy.sh` again — it picks up from the current git state.
- **Bad deploy reaches production:** Roll back immediately with the printed rollback command, then investigate locally.
- **Nothing to commit:** Inform the user and stop.

## Example
```
$ git status
  modified: web/src/views/app/pm/SpaceTree.tsx
  modified: web/src/components/SettingsSlider.tsx

$ git add -A && git commit -m "Fix settings panel positioning via createPortal"
$ git push origin main
$ bash tools/deploy.sh
  → Deploy tag: 20260601-183722
  → All 4 containers healthy
```
