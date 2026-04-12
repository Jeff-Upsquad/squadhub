# SquadHub Deployment

## Overview
Deploy SquadHub to the Hostinger VPS running Docker Compose. The stack is: Caddy (reverse proxy) + Server (Express) + Web (Next.js) + Admin (Next.js).

## Pre-Deploy

1. Ensure code compiles:
   ```bash
   npx tsc --noEmit -p server/tsconfig.json
   ```
2. Commit and push to `origin/main`
3. If there are DB migrations in `supabase/migrations/`, run them in the [Supabase SQL Editor](https://supabase.com/dashboard) **before** deploying code

## Deploy

Run the deploy script from the repo root:

```bash
bash tools/deploy.sh
```

The script automatically:
1. SSHes to the VPS and pulls latest from `origin/main`
2. Detects which packages changed (server, web, admin, shared)
3. Rebuilds only the affected Docker services
4. Removes rogue `next.config.js` files (see Known Gotchas #3)
5. Reloads Caddy if `Caddyfile` changed
6. Shows container status and recent logs

### Change detection mapping

| Changed path | Services rebuilt |
|---|---|
| `server/` | server |
| `web/` | web |
| `admin/` | admin |
| `shared/` | server, web, admin |
| `package.json` / `package-lock.json` | server, web, admin |
| `docker-compose.yml` | server, web, admin |
| `Caddyfile` | caddy reload (no rebuild) |
| docs, workflows, etc. | none |

### Post-deploy verification

Try logging in on both https://squadhub.in and https://admin.squadhub.in to confirm API proxying works.

## Architecture Reference

| Detail | Value |
|--------|-------|
| VPS | Hostinger, Ubuntu 24.04, `72.61.245.97` |
| Deployment dir | `/opt/squadhub` (NOT `/root/upsquad`) |
| Git remote | `https://github.com/Jeff-Upsquad/squadhub.git` |
| Docker services | `caddy`, `server`, `web`, `admin` |
| Caddy routing | `squadhub.in` -> `web:3000`, `admin.squadhub.in` -> `admin:3001` |
| API proxying | Next.js rewrites route `/api/*` and `/auth/*` to `server:4000` via Docker network |
| `INTERNAL_API_URL` | Set to `http://server:4000` — baked at Docker **build time** (ARG in Dockerfile), not runtime |
| DB | Supabase (hosted), migrations in `supabase/migrations/` |
| Server env | `./server/.env.production` on VPS |

## Known Gotchas

1. **`localhost` doesn't work between Docker containers.** Use Docker service names (`server`, `web`, `admin`) for inter-container communication.
2. **Next.js rewrites are baked at build time.** The `INTERNAL_API_URL` env var must be present during `docker compose build`, not just at runtime. This is handled via `ARG` in the Dockerfiles.
3. **`next.config.js` overrides `next.config.mjs`.** Never create manual `.js` config files on the VPS — they silently replace the git-tracked `.mjs` files and break API proxying.
4. **Old repo at `/root/upsquad`** is a different project. The SquadHub deployment is at `/opt/squadhub`.
