# Workflow: Enable Google Meet links in the meeting scheduler

**Objective:** Make "Google Meet" appear in the meeting-scheduler provider dropdown so virtual meetings get a real `meet.google.com` link instead of Jitsi.

**Tool:** `tools/google_meet_auth.mjs` (mints + verifies the refresh token). No code changes required — the provider already exists at `server/src/services/meetingProviders/googleMeet.ts` and is hidden from the dropdown until its three secrets are present.

## How it works

The server owns **one** Google identity (an OAuth refresh token for a Workspace user). For each virtual meeting it creates a Google Calendar event on that user's calendar with an auto-generated Meet conference and stores the link on `meeting_events.link_url`. On slot confirm the link is regenerated against the locked time. If Google errors, the meeting silently falls back to Jitsi.

Required env (server):

| Var | Value |
| --- | --- |
| `GOOGLE_MEET_CLIENT_ID` | OAuth client id from Google Cloud |
| `GOOGLE_MEET_CLIENT_SECRET` | OAuth client secret |
| `GOOGLE_MEET_REFRESH_TOKEN` | minted by the tool |
| `GOOGLE_MEET_CALENDAR_ID` | optional, default `primary` |

## Steps (human — needs the Workspace login; the agent cannot sign in)

1. **Google Cloud console** — <https://console.cloud.google.com>, signed in with the squadhub.in Workspace admin.
   - Create a project (e.g. `SquadHub Meetings`).
   - **APIs & Services → Library → Google Calendar API → Enable.**
2. **OAuth consent screen** (APIs & Services → OAuth consent screen / "Google Auth Platform → Branding + Audience").
   - Audience: **Internal**. This is the important bit: Internal apps need no verification *and* their refresh tokens never hit the 7-day "Testing" expiry.
   - App name `SquadHub`, support email = your address. Scopes can be left empty (the tool requests `calendar.events` at auth time).
3. **Credentials → Create credentials → OAuth client ID.**
   - Type **Web application**, name `SquadHub server`.
   - Authorised redirect URI: `http://localhost:8765/callback`.
   - Copy the **Client ID** and **Client secret**.
4. **Mint the refresh token** — from the repo root:

   ```bash
   node tools/google_meet_auth.mjs --client-id <CLIENT_ID> --client-secret <CLIENT_SECRET>
   ```

   A browser tab opens. **Sign in as the account that should own the meetings.** Prefer a dedicated user such as `meetings@squadhub.in` over a personal one — every Meet lands on this calendar and recordings go to its Drive. Approve the Calendar scope. The tool exchanges the code, creates and deletes a throwaway test Meet to prove it works, then prints the three `GOOGLE_MEET_*` lines.
5. **Configure + deploy** (agent can do this once given the values):
   - Append the printed lines to `server/.env.production` (and `server/.env` for local dev).
   - Deploy via `workflows/cmpd.md` / `bash tools/deploy.sh`. No migration.
6. **Verify:** Meetings → New → kind *Virtual* → the provider dropdown now lists **Google Meet**. Create one; the card shows a `meet.google.com/…` link and the event appears on the owner account's Google Calendar.

## Gotchas / known limits of the current implementation

- **Host admission.** The token's account is the Meet host. Guests outside squadhub.in who aren't calendar attendees must "ask to join", and if the host never opens the call nobody admits them. Workarounds, in order of effort: check Workspace Admin → Meet → *Host management* / *Quick access* defaults; add guests as `attendees` on the event (invited people join directly); or switch the provider to the Meet REST API v2 `spaces.create` with `accessType: OPEN` (no calendar event at all). None of these are built yet.
- **Orphan events.** Confirming a slot creates a *new* calendar event rather than patching the one in `link_meta.event_id`; cancelling a meeting never deletes the Google event. Cosmetic on the owner's calendar, but worth fixing if the calendar is watched by a human.
- **Token revocation.** The refresh token dies if the owner account revokes the app (myaccount.google.com/permissions), is suspended/deleted, or an admin removes the OAuth client. Symptom: every virtual meeting silently falls back to Jitsi and the server logs `[meetingProviders] google_meet failed`. Re-run step 4.
- **`no refresh_token returned`** from the tool = the account already consented once and Google skipped re-issuing. Revoke the app at myaccount.google.com/permissions and re-run (the tool already sends `prompt=consent`, so this is rare).
- Port 8765 busy → `--port <n>` and add the matching redirect URI in step 3.
