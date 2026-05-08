import { config } from '../config';

const FETCH_TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 2 * 60 * 1_000;

interface LookupMatch {
  talent_user_id: string;
  name: string;
}

const cache = new Map<string, { match: LookupMatch | null; expiresAt: number }>();

export async function lookupSquadhireUsers(
  emails: string[],
): Promise<Map<string, LookupMatch>> {
  const result = new Map<string, LookupMatch>();
  if (emails.length === 0) return result;

  const base = config.squadhireWebhookUrl;
  if (!base || !config.squadhireWebhookSecret) return result;

  const now = Date.now();
  const uncached: string[] = [];

  for (const email of emails) {
    const key = email.toLowerCase();
    const hit = cache.get(key);
    if (hit && hit.expiresAt > now) {
      if (hit.match) result.set(email, hit.match);
    } else {
      uncached.push(email);
    }
  }

  if (uncached.length === 0) return result;

  try {
    const url = new URL(base);
    url.pathname = '/api/integrations/squadhub/users/lookup';
    url.search = '';

    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-SquadHub-Signature': config.squadhireWebhookSecret,
      },
      body: JSON.stringify({ emails: uncached }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!res.ok) {
      console.error(`[squadhire-lookup] SquadHire responded ${res.status}`);
      return result;
    }

    const body = (await res.json()) as {
      success: boolean;
      data?: Record<string, LookupMatch>;
    };
    const matches = body.data ?? {};

    for (const email of uncached) {
      const key = email.toLowerCase();
      const match = matches[key] || matches[email] || null;
      cache.set(key, { match, expiresAt: now + CACHE_TTL_MS });
      if (match) result.set(email, match);
    }
  } catch (err: any) {
    console.error('[squadhire-lookup] fetch failed:', err?.message);
  }

  return result;
}
