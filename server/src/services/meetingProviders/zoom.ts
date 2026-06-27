import { config } from '../../config';
import { MeetingLinkProvider, MeetingLinkContext, PROVIDER_FETCH_TIMEOUT_MS } from './types';

// Zoom via a Server-to-Server OAuth app. One host account creates the meetings.
// Hidden from the dropdown unless the account id + client id/secret are present.
async function getAccessToken(): Promise<string> {
  const basic = Buffer.from(`${config.zoomClientId}:${config.zoomClientSecret}`).toString('base64');
  const res = await fetch(
    `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(
      config.zoomAccountId,
    )}`,
    {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}` },
      signal: AbortSignal.timeout(PROVIDER_FETCH_TIMEOUT_MS),
    },
  );
  if (!res.ok) throw new Error(`zoom token ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as { access_token?: string };
  if (!body.access_token) throw new Error('zoom token: no access_token');
  return body.access_token;
}

export const zoomProvider: MeetingLinkProvider = {
  id: 'zoom',
  label: 'Zoom',
  isConfigured() {
    return !!(config.zoomAccountId && config.zoomClientId && config.zoomClientSecret);
  },
  async generate(ctx: MeetingLinkContext) {
    const token = await getAccessToken();
    const startIso = ctx.startsAt
      ? new Date(ctx.startsAt).toISOString()
      : new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const res = await fetch('https://api.zoom.us/v2/users/me/meetings', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        topic: ctx.title,
        type: 2, // scheduled
        start_time: startIso,
        duration: ctx.durationMin && ctx.durationMin > 0 ? ctx.durationMin : 30,
      }),
      signal: AbortSignal.timeout(PROVIDER_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`zoom create ${res.status}: ${await res.text()}`);
    const m = (await res.json()) as {
      id?: number;
      join_url?: string;
      start_url?: string;
      password?: string;
    };
    if (!m.join_url) throw new Error('zoom: no join_url returned');
    return {
      provider: 'zoom',
      url: m.join_url,
      meta: { meeting_id: m.id ?? null, start_url: m.start_url ?? null, password: m.password ?? null },
    };
  },
};
