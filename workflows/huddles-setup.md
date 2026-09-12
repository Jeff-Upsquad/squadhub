# Workflow: Huddles (in-app calls) — setup, dev, and operations

**Objective:** Slack-style audio/video huddles inside SquadHub, attached to a channel or DM, with a public share link for guests. Media runs on **LiveKit**; SquadHub only owns the lifecycle and mints join tokens.

## Moving parts

| Piece | Where |
| --- | --- |
| Tables `huddles`, `huddle_participants`, `messages.huddle_id` | `supabase/migrations/20260912120000_huddles.sql` (applied to prod 2026-09-12) |
| LiveKit wrapper (token mint, list/close room) | `server/src/services/livekit.ts` |
| Routes `/huddles/*` (start/join/leave/end, public share link) | `server/src/routes/huddles.ts` |
| Presence backstop sweeper (30s) | `server/src/cron/huddle-cron.ts` — reconciles DB rows against LiveKit's participant list, ends empty huddles |
| Call UI (tiles + controls) | `web/src/views/app/huddles/HuddleCall.tsx` + `huddle.css` |
| In-app dock (full screen ⇄ floating pill) | `web/src/views/app/huddles/HuddleDock.tsx`, state in `web/src/stores/huddleStore.ts` |
| Header button / chat card | `HuddleHeaderButton.tsx`, `web/src/views/app/chat/HuddleCard.tsx` |
| Guest page | `web/src/app/huddle/[code]/page.tsx` → `/huddle/<code>` |

The feature is **env-gated**: with no `LIVEKIT_*` vars the header button is hidden and `/huddles/config` reports `enabled: false`. Safe to deploy unconfigured.

## Production setup (LiveKit Cloud — recommended)

1. Sign up at <https://cloud.livekit.io> (human step — the agent can't create accounts). Create a project (e.g. `squadhub`). Free tier covers a small team; usage-priced after.
2. Project → **Settings → Keys → Create key**. Copy the API key + secret. The project URL is on the project overview (`wss://<name>-xxxx.livekit.cloud`).
3. Append to `/opt/squadhub/server/.env.production` on the VPS (and `server/.env` locally if wanted):
   ```
   LIVEKIT_URL=wss://<name>-xxxx.livekit.cloud
   LIVEKIT_API_KEY=API...
   LIVEKIT_API_SECRET=...
   ```
4. `docker compose up -d server` (env is read at container start; `deploy.sh` never ships env files).
5. Verify: open any channel → the **Huddle** headset button appears in the header.

### Self-hosting instead

`livekit-server` can run on the VPS but needs UDP 50000–60000 (or a TURN setup) opened in the Hostinger firewall plus a TLS websocket endpoint through Caddy. Only worth it if Cloud pricing becomes a problem.

## Local dev

`.claude/launch.json` has three configs: **Huddles LiveKit** (`livekit-server --dev`, ws://localhost:7880, key `devkey` / secret `secret`), **Huddles Server** (port 4050, `DISABLE_CRONS=true`, LiveKit env preset), **Huddles Web** (port 3050 → 4050). Install the dev server once with `brew install livekit`.

To test the guest path against a signed-in tab, open the share link on `http://127.0.0.1:3050/…` — a different origin, so it has no `squadhub-auth` in localStorage.

## Behaviour notes / gotchas

- **One live huddle per conversation** (partial unique indexes). Starting when one is live just joins it.
- **Presence is client-reported** (join/leave endpoints). A crashed tab is caught by the sweeper (asks LiveKit who's really connected, 45s grace for fresh tokens). With `DISABLE_CRONS=true` locally, stale rows linger until someone leaves.
- **Last person out ends the huddle** and deletes the LiveKit room; "End for all" is starter/admin only.
- **Same identity twice**: opening the share link in a browser while already in the huddle in-app (same account) replaces the earlier connection — LiveKit kicks the first one. Expected.
- **Mic on / camera off by default.** The Browser pane used for agent verification blocks device capture — don't treat mic/camera as broken from there.
- **Mac desktop app (Tauri/WKWebView): no screen sharing** (no `getDisplayMedia`) — the button hides itself. Mic/camera need the usage strings in `desktop-app/src-tauri/Info.plist` (added; ships with the next desktop release).
- **Socket subscription** must use `connectSocket()` not `getSocket()` in hooks mounted below MainLayout — child effects run before the parent's connect effect, so `getSocket()` is null on first mount.
- The chat card's message text (`🎧 Started a huddle`) is hidden in the bubble when the card renders; it still feeds sidebar previews/notifications.
