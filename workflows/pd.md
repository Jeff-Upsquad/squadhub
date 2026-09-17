# PD — Sync, Deploy

## Objective

Sync an already merged `main` and deploy to production only when the merged change touched deployable code. PD never publishes a desktop app release. Code reaches `origin/main` exclusively through merged PRs; PD does not push feature work.

## Steps

1. Confirm the primary checkout is on `main`:

   ```bash
   git -C "/Users/jeffzeena/squadhub web" status --short --branch
   ```

   If it is dirty, stop and report — PD never commits, and direct commits on `main` are not allowed.
2. Sync with the merged result (PD always runs from the primary checkout):

   ```bash
   git -C "/Users/jeffzeena/squadhub web" fetch origin
   git -C "/Users/jeffzeena/squadhub web" pull --ff-only origin main
   ```

   If the fast-forward fails, stop and report before doing anything else.
3. Determine deployment scope from the merged PR itself — never from `origin/main~1`, which may point at a different, newer merge if another PR landed in between:

   ```bash
   gh pr view <PR-number> --repo Jeff-Upsquad/squadhub --json files --jq '.files[].path'
   ```

   When run from CMPD, use the PR number recorded there.

   `tools/deploy.sh` always pulls and deploys **every** commit between the VPS's current HEAD and the latest `origin/main`, not just the recorded PR. If another PR (e.g. with a migration) merged before this invocation, that commit will also ship — so migration checks must cover the full `VPS_HEAD..origin/main` range, not just the single PR.
4. Verify local `main` matches `origin/main`. There is normally nothing to push — code reaches `origin/main` through the merged PR, not through PD.

5. If there are new DB migrations in `supabase/migrations/`, apply them **before** deploying. Two ways (same durable procedure as [deploy.md](deploy.md)):
   - **Supabase CLI** (machine is logged in): stage the migration as a timestamped file (`YYYYMMDDHHMMSS_name.sql`) in `supabase/migrations/`, then `supabase db push --dry-run` → confirm it lists ONLY your file → `supabase db push`. Gotcha: prod history uses timestamped versions while most repo files use the `NNN_` convention, so a plain push fails or replays old files. If the dry-run lists more than your file, stash the `NNN_` files, add empty placeholder files named after each remote version (`supabase migration list` → JSON), re-dry-run until exactly yours remains, push, then restore everything.
   - **SQL Editor paste** (dashboard) — fallback when the CLI isn't available.

   Then, if the recorded paths include deployable code **or** `supabase/migrations/`, run the deploy:

   ```bash
   cd "/Users/jeffzeena/squadhub web"
   bash tools/deploy.sh
   ```

   Deployable paths (see `tools/deploy.sh` and [deploy.md](deploy.md)):

   | Changed path | Effect |
   |---|---|
   | `server/` | rebuilds `server` |
   | `web/` | rebuilds `web` |
   | `admin/` | rebuilds `admin` (and `web` if `admin/src/**` via the shared bridge) |
   | `shared/` | rebuilds `server`, `web`, `admin` |
   | `package.json` / `package-lock.json` | rebuilds all three |
   | `docker-compose.yml` | rebuilds all three |
   | `supabase/migrations/` | apply migrations (triggers deploy; may not need rebuild if migration-only but `deploy.sh` still syncs the repo) |
   | `Caddyfile` | Caddy reload (no rebuild) |
   | `tools/set-r2-cors.ts` | R2 CORS apply |

   Docs, workflows, CI-only, and other non-service changes require no deployment. Desktop app releases belong exclusively to a tagged `desktop-app-v*` push or manual dispatch of `desktop-app-release.yml`.

6. Verify applicable endpoints:
   - Source: `main` matches `origin/main`.
   - Deploy: `https://squadhub.in` and `https://admin.squadhub.in` respond (try logging in to confirm API proxying).
7. Summarize what was pushed, whether deploy ran, and how to test it (see [test-handoff.md](test-handoff.md)).

## Safety and edge cases

- If the fast-forward sync fails, fetch and inspect before doing anything else. Never force local `main` past `origin/main`. Preserve local work.
- If a deploy fails mid-build, re-run `bash tools/deploy.sh` — it picks up from the current git state.
- A request for PD is not authorization to dispatch `desktop-app-release.yml` or tag a desktop release.
