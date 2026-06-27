import { config } from '../../config';
import { MeetingLinkProvider, MeetingLinkContext, PROVIDER_FETCH_TIMEOUT_MS } from './types';

// Google Meet via the Calendar API. Configured with a single service identity
// (OAuth refresh token) that owns the events; each meeting becomes a calendar
// event with an auto-created Meet conference. Hidden from the dropdown unless
// the client id/secret/refresh-token trio is present.
async function getAccessToken(): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.googleMeetClientId,
      client_secret: config.googleMeetClientSecret,
      refresh_token: config.googleMeetRefreshToken,
      grant_type: 'refresh_token',
    }),
    signal: AbortSignal.timeout(PROVIDER_FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`google token ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as { access_token?: string };
  if (!body.access_token) throw new Error('google token: no access_token');
  return body.access_token;
}

function windowFor(ctx: MeetingLinkContext): { start: string; end: string } {
  // Meet needs a time window. Use the provided start (representative/confirmed
  // slot) or fall back to "soon"; duration defaults to 30m.
  const startMs = ctx.startsAt ? Date.parse(ctx.startsAt) : Date.now() + 60 * 60 * 1000;
  const dur = (ctx.durationMin && ctx.durationMin > 0 ? ctx.durationMin : 30) * 60 * 1000;
  return { start: new Date(startMs).toISOString(), end: new Date(startMs + dur).toISOString() };
}

export const googleMeetProvider: MeetingLinkProvider = {
  id: 'google_meet',
  label: 'Google Meet',
  isConfigured() {
    return !!(
      config.googleMeetClientId &&
      config.googleMeetClientSecret &&
      config.googleMeetRefreshToken
    );
  },
  async generate(ctx) {
    const token = await getAccessToken();
    const { start, end } = windowFor(ctx);
    const calId = encodeURIComponent(config.googleMeetCalendarId || 'primary');
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${calId}/events?conferenceDataVersion=1`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          summary: ctx.title,
          start: { dateTime: start },
          end: { dateTime: end },
          conferenceData: {
            createRequest: {
              requestId: ctx.meetingEventId,
              conferenceSolutionKey: { type: 'hangoutsMeet' },
            },
          },
        }),
        signal: AbortSignal.timeout(PROVIDER_FETCH_TIMEOUT_MS),
      },
    );
    if (!res.ok) throw new Error(`google calendar ${res.status}: ${await res.text()}`);
    const ev = (await res.json()) as {
      id?: string;
      hangoutLink?: string;
      conferenceData?: { entryPoints?: { uri?: string; entryPointType?: string }[] };
    };
    const url =
      ev.hangoutLink ||
      ev.conferenceData?.entryPoints?.find((e) => e.entryPointType === 'video')?.uri;
    if (!url) throw new Error('google meet: no conference link returned');
    return { provider: 'google_meet', url, meta: { event_id: ev.id ?? null } };
  },
};
