# PD — Push, Deploy

## Objective
Push the current `main` to `origin` and deploy it to production. Assumes the changes are **already committed and merged** (e.g. you just ran **CM**). The shipping half of **CMPD**.

## Inputs
- A clean working tree on `main` with commits ready to ship (`git status`)

## Tools Used
- `git push origin main`
- `tools/deploy.sh` — pulls on the VPS and rebuilds only the changed Docker services
- `bash tools/rollback.sh <TAG>` — if rollback is needed

## Estimated Time
- ~2–4 minutes (push ~1 min, deploy ~2–3 min depending on Docker rebuild)

## Steps

### 0. Pre-check
- Confirm you're on `main` and the working tree is clean:
  ```bash
  git branch --show-current   # expect: main
  git status --short          # expect: empty
  ```
  If there are uncommitted changes, run **CM** first ([cm.md](cm.md)) — PD does not commit.
- If there are new DB migrations in `supabase/migrations/`, run them in the Supabase SQL Editor **before** deploying.

### 1. Push
```bash
git push origin main
```

### 2. Deploy
```bash
bash tools/deploy.sh
```
The script SSHes to the VPS (`/opt/squadhub`), pulls `origin/main`, rebuilds only the changed services (`server`/`web`/`admin`), timestamp-tags the images for rollback, reloads Caddy if `Caddyfile` changed, and prints the rollback command. See [deploy.md](deploy.md) for details.

### 3. Verify
Try logging in on https://squadhub.in and https://admin.squadhub.in to confirm API proxying works.

### 4. Hand off for testing
Give the user a plain-language summary of what shipped and how to test it — see [test-handoff.md](test-handoff.md). Do this automatically, don't wait to be asked.

## Edge Cases
- **Push rejected (remote ahead):** `git pull --rebase origin main`, then retry.
- **Working tree dirty:** stop — run **CM** first, then PD.
- **Deploy fails mid-build:** re-run `bash tools/deploy.sh` (it picks up from the current git state).
- **Bad deploy:** `bash tools/rollback.sh <TAG>` (printed by the deploy script). See [rollback.md](rollback.md).
