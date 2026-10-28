import { supabaseAdmin } from '../supabase';

/**
 * Per-user timezone handling for background jobs. Clients send their IANA zone
 * as X-Time-Zone on every authenticated request; the auth middleware persists
 * it here (debounced) so server-side sweeps can compute day boundaries in the
 * user's LOCAL time instead of UTC.
 */

// Users with no stored zone (older clients, partner portal, API-only users).
// Matches the offset fallback already used by task reminders (330 = IST).
export const FALLBACK_TIME_ZONE = 'Asia/Kolkata';

export function isValidTimeZone(tz: string): boolean {
  if (!tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// userId -> last zone this process persisted. Keeps the auth middleware's
// capture at O(1) per request: the UPDATE only fires when the zone changes.
const lastPersisted = new Map<string, string>();

/**
 * Remember the caller's timezone on their users row. Fire-and-forget — a
 * failure never affects the request. Safe to call on every request.
 */
export function rememberUserTimeZone(userId: string, tz: string): void {
  if (!userId || !isValidTimeZone(tz)) return;
  if (lastPersisted.get(userId) === tz) return;
  lastPersisted.set(userId, tz);
  void (async () => {
    try {
      const { error } = await supabaseAdmin
        .from('users')
        .update({ time_zone: tz })
        .eq('id', userId)
        .or(`time_zone.is.null,time_zone.neq.${tz}`);
      if (error) {
        console.error(`[userTimeZone] failed to persist zone for ${userId}:`, error);
        lastPersisted.delete(userId); // retry on a later request
      }
    } catch (err) {
      console.error('[userTimeZone] persist threw:', err);
      lastPersisted.delete(userId);
    }
  })();
}

/** Local calendar date (YYYY-MM-DD) of `date` in `tz`; falls back on a bad zone. */
export function localDateKeyInZone(tz: string | null | undefined, date: Date = new Date()): string {
  const zone = tz && isValidTimeZone(tz) ? tz : FALLBACK_TIME_ZONE;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}

/** users.time_zone for the given ids (missing rows/zones resolve to null). */
export async function getTimeZonesByUser(userIds: string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>(userIds.map((id) => [id, null]));
  const unique = Array.from(new Set(userIds));
  const PAGE = 500;
  for (let i = 0; i < unique.length; i += PAGE) {
    const { data, error } = await supabaseAdmin
      .from('users')
      .select('id, time_zone')
      .in('id', unique.slice(i, i + PAGE));
    if (error) {
      console.error('[userTimeZone] users lookup failed:', error);
      break;
    }
    for (const u of (data || []) as any[]) out.set(u.id, u.time_zone ?? null);
  }
  return out;
}
