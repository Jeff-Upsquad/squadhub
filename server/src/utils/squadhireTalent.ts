import { config } from '../config';

// Fetches talents' self-declared availability (virtual office hours → weekly
// hours) from the Profiles/SquadHire integration surface, keyed by
// talent_user_id. Used by the per-user Subscription Assignments view to show
// "available hours" next to committed hours. Degrades gracefully: any failure
// (unconfigured, network, non-200) yields an empty map so the caller can still
// render payments/committed hours without the availability column.

const FETCH_TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 2 * 60 * 1_000;
const BATCH_LIMIT = 50;

export interface TalentAvailability {
  talent_user_id: string;
  weekly_hours: number;
  virtual_office_hours: Array<{ day?: string; from?: string; to?: string }>;
}

const cache = new Map<string, { value: TalentAvailability | null; expiresAt: number }>();

export async function fetchTalentAvailability(
  talentUserIds: string[],
): Promise<Map<string, TalentAvailability>> {
  const result = new Map<string, TalentAvailability>();
  const ids = Array.from(new Set(talentUserIds.filter(Boolean)));
  if (ids.length === 0) return result;

  const base = config.squadhireWebhookUrl;
  if (!base || !config.squadhireWebhookSecret) return result;

  const now = Date.now();
  const uncached: string[] = [];
  for (const id of ids) {
    const hit = cache.get(id);
    if (hit && hit.expiresAt > now) {
      if (hit.value) result.set(id, hit.value);
    } else {
      uncached.push(id);
    }
  }
  if (uncached.length === 0) return result;

  // Chunk to the upstream batch limit.
  for (let i = 0; i < uncached.length; i += BATCH_LIMIT) {
    const chunk = uncached.slice(i, i + BATCH_LIMIT);
    try {
      const url = new URL(base);
      url.pathname = '/api/integrations/squadhub/talents/availability';
      url.search = '';

      const res = await fetch(url.toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-SquadHub-Signature': config.squadhireWebhookSecret,
        },
        body: JSON.stringify({ talent_user_ids: chunk }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });

      if (!res.ok) {
        console.error(`[squadhire-talent] availability responded ${res.status}`);
        continue; // leave this chunk uncached so a later call retries
      }

      const body = (await res.json()) as {
        success?: boolean;
        data?: Record<string, { weekly_hours?: number; virtual_office_hours?: any[] }>;
      };
      const map = body.data ?? {};
      for (const id of chunk) {
        const raw = map[id];
        const value: TalentAvailability | null = raw
          ? {
              talent_user_id: id,
              weekly_hours: Number(raw.weekly_hours) || 0,
              virtual_office_hours: Array.isArray(raw.virtual_office_hours)
                ? raw.virtual_office_hours
                : [],
            }
          : null;
        cache.set(id, { value, expiresAt: now + CACHE_TTL_MS });
        if (value) result.set(id, value);
      }
    } catch (err: any) {
      console.error('[squadhire-talent] availability fetch failed:', err?.message);
      // Leave the chunk uncached; the rest of the response still renders.
    }
  }

  return result;
}
