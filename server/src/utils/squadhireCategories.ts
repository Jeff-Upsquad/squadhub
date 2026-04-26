import { config } from '../config';

/**
 * In-memory, signed read-through to SquadHire's category list.
 *
 * Used both by /admin/integrations/squadhire/categories (the route the admin
 * panel calls) and by profile-access list hydration (so we can render
 * grants with category names rather than raw UUIDs). Single cache, single
 * fetcher — keep round-trips off the hot path.
 */

export interface SquadhireCategory {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  sort_order: number;
}

const CACHE_TTL_MS = 10 * 60 * 1_000;
const FETCH_TIMEOUT_MS = 5_000;

interface CacheEntry {
  data: SquadhireCategory[];
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_KEY = 'squadhire:categories';

async function fetchFromSquadhire(): Promise<SquadhireCategory[]> {
  const base = config.squadhireWebhookUrl;
  if (!base || !config.squadhireWebhookSecret) {
    throw new Error('SquadHire integration is not configured on this server');
  }

  // squadhireWebhookUrl points at .../api/webhooks/squadhub/cards — derive the
  // integrations base from the same origin.
  const url = new URL(base);
  url.pathname = '/api/integrations/squadhub/categories';
  url.search = '';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: { 'X-SquadHub-Signature': config.squadhireWebhookSecret },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`SquadHire responded ${res.status}`);
    }
    const body = (await res.json()) as { categories?: SquadhireCategory[] };
    return Array.isArray(body.categories) ? body.categories : [];
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchSquadhireCategories(): Promise<{
  data: SquadhireCategory[];
  cached: boolean;
}> {
  const cached = cache.get(CACHE_KEY);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return { data: cached.data, cached: true };
  }
  const data = await fetchFromSquadhire();
  cache.set(CACHE_KEY, { data, expiresAt: now + CACHE_TTL_MS });
  return { data, cached: false };
}

export function clearSquadhireCategoriesCache(): void {
  cache.delete(CACHE_KEY);
}
