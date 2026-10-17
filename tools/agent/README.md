# Build Agent tooling

Turns SquadHub tasks into a build queue. A task moved to **READY TO CODE** is
picked up by an executor (ZCode automation on the dev Mac today; a VPS runner
later), built, delivered through the repo's normal SOP (CMPD + CU, mobile
go-live when instructed), and reported back on the task.

The full procedure lives in `workflows/agent-build.md` — this directory holds
the config only.

## Files

| File | Committed | Purpose |
|---|---|---|
| `repo-map.json` | yes | Maps SquadHub lists/folders → repo (path, type, delivery SOP). No secrets. |
| `runtime.json` | **no** (gitignored) | Executor-local settings: `base_url` of the SquadHub server + `agent_api_token`. |

## repo-map.json

- `repos` — named repo entries. `path` is the local checkout (change it on a
  VPS — everything else stays identical). `delivery` says which SOP runs after
  the code is written: `cmpd`, `cmpd+cashbook-release`, or `none`.
- `routes` — match order: `list_id` (exact UUID) → `list_name` → `folder_name`.
  First match wins; unmatched tasks fall back to `defaults.repo`.
- To point a new list at a repo: find the list name in SquadHub, add a route
  entry, done. Use `list_id` when two lists share a name.

## runtime.json (create on each machine)

```json
{
  "base_url": "http://localhost:4000",
  "agent_api_token": "<same value as server .env AGENT_API_TOKEN>"
}
```

- Local dev: `http://localhost:4000` (server default port) while `npm run dev`
  is running.
- Remote/VPS: point at the production server URL. The token is the one set in
  that server's `AGENT_API_TOKEN` env.

## Server-side env (server/.env)

```
AGENT_API_TOKEN=<openssl rand -hex 32>
AGENT_USER_ID=<uuid of the dedicated "Build Agent" user>
```

- `AGENT_API_TOKEN` gates every `/agent/*` endpoint (503 when unset).
- `AGENT_USER_ID` attributes comments/activity. Create one user in SquadHub
  (e.g. "SquadBot Build Agent", internal type), grab its UUID from the `users`
  table. Without it, status writes still work but comments are rejected.

## VPS provisioning (later)

Everything executor-specific is in `runtime.json` + repo `path` values. To move
off the Mac: clone the repos on the VPS, update the `path` fields, set the two
env vars on the VPS server deployment, and run the same SOP headless. The
SquadHub contract (`/agent/*` endpoints, statuses, description conventions)
does not change.
