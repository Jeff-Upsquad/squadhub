#!/usr/bin/env node
// One-time helper: mint the Google OAuth refresh token that the Google Meet
// meeting-link provider (server/src/services/meetingProviders/googleMeet.ts)
// needs. Runs a throwaway localhost callback server, opens the consent URL,
// exchanges the code, verifies the token by creating + deleting a test Meet,
// and prints the env lines to paste into server/.env.production.
//
// Usage:
//   node tools/google_meet_auth.mjs --client-id <id> --client-secret <secret> [--port 8765]
//
// The OAuth client in Google Cloud must list http://localhost:<port>/callback
// as an authorised redirect URI. Zero dependencies (node >= 18).
import http from 'node:http';
import { execFile } from 'node:child_process';

const SCOPE = 'https://www.googleapis.com/auth/calendar.events';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const clientId = arg('client-id', process.env.GOOGLE_MEET_CLIENT_ID);
const clientSecret = arg('client-secret', process.env.GOOGLE_MEET_CLIENT_SECRET);
const port = Number(arg('port', '8765'));
if (!clientId || !clientSecret) {
  console.error('Usage: node tools/google_meet_auth.mjs --client-id <id> --client-secret <secret> [--port 8765]');
  process.exit(1);
}

const redirectUri = `http://localhost:${port}/callback`;
const state = Math.random().toString(36).slice(2);
const authUrl =
  'https://accounts.google.com/o/oauth2/v2/auth?' +
  new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline', // -> refresh_token
    prompt: 'consent', // force a refresh_token even if previously consented
    state,
  });

async function exchange(code) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) throw new Error(`token exchange ${res.status}: ${await res.text()}`);
  return res.json();
}

// Smoke test: create a Meet-backed event 1h from now, read the link, delete it.
async function verify(accessToken) {
  const start = new Date(Date.now() + 60 * 60 * 1000);
  const end = new Date(start.getTime() + 15 * 60 * 1000);
  const create = await fetch(
    'https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        summary: 'SquadHub Meet integration test (auto-deleted)',
        start: { dateTime: start.toISOString() },
        end: { dateTime: end.toISOString() },
        conferenceData: {
          createRequest: { requestId: `squadhub-test-${Date.now()}`, conferenceSolutionKey: { type: 'hangoutsMeet' } },
        },
      }),
    },
  );
  if (!create.ok) throw new Error(`calendar create ${create.status}: ${await create.text()}`);
  const ev = await create.json();
  const link = ev.hangoutLink || ev.conferenceData?.entryPoints?.find((e) => e.entryPointType === 'video')?.uri;
  await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(ev.id)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return link;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, redirectUri);
  if (url.pathname !== '/callback') return void res.writeHead(404).end();
  const err = url.searchParams.get('error');
  const code = url.searchParams.get('code');
  if (err || !code || url.searchParams.get('state') !== state) {
    res.writeHead(400, { 'Content-Type': 'text/plain' }).end(`OAuth failed: ${err || 'bad state/code'}`);
    console.error('OAuth failed:', err || 'bad state/code');
    return void server.close(() => process.exit(1));
  }
  try {
    const tok = await exchange(code);
    if (!tok.refresh_token) throw new Error('no refresh_token returned (revoke the app at myaccount.google.com/permissions and retry)');
    const link = await verify(tok.access_token);
    res.writeHead(200, { 'Content-Type': 'text/plain' }).end('SquadHub: Google Meet connected. You can close this tab.');
    console.log('\nVerified — test Meet link was created and deleted:', link);
    console.log('\nPaste these into server/.env.production (and server/.env for local):\n');
    console.log(`GOOGLE_MEET_CLIENT_ID=${clientId}`);
    console.log(`GOOGLE_MEET_CLIENT_SECRET=${clientSecret}`);
    console.log(`GOOGLE_MEET_REFRESH_TOKEN=${tok.refresh_token}`);
    console.log('# GOOGLE_MEET_CALENDAR_ID=primary   (optional; a secondary calendar id to keep events out of the main one)\n');
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/plain' }).end(`Failed: ${e.message}`);
    console.error('Failed:', e.message);
  }
  server.close(() => process.exit(0));
});

server.listen(port, () => {
  console.log(`Listening on ${redirectUri}`);
  console.log('Sign in as the Workspace account that should own the meetings (e.g. meetings@squadhub.in).');
  console.log('If the browser does not open, visit:\n\n' + authUrl + '\n');
  execFile('open', [authUrl], () => {});
});
