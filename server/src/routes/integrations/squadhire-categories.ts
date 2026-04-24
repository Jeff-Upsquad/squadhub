import { Router, Request, Response } from 'express';
import { requireAuth } from '../../middleware/auth';
import { requireSalesLeadsAccess } from '../onboarding-links';
import { config } from '../../config';

/**
 * Signed read-through proxy for SquadHire's category list.
 *
 * The subscription-card drawer uses this to populate a multi-select picker
 * so admins pick real SquadHire category IDs (which then flow into
 * match_rules.category_ids on publish). Gated behind the same sales-leads
 * app gate as the card editor itself.
 *
 * In-memory cache keeps round-trips off the hot path; 10-minute TTL means
 * fresh categories in SquadHire show up in the admin UI within ten minutes.
 */

const router = Router();

router.use(requireAuth);

interface Category {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  sort_order: number;
}

const CACHE_TTL_MS = 10 * 60 * 1_000;
const FETCH_TIMEOUT_MS = 5_000;

interface CacheEntry {
  data: Category[];
  expiresAt: number;
}
const cache = new Map<string, CacheEntry>();
const CACHE_KEY = 'squadhire:categories';

async function fetchCategoriesFromSquadhire(): Promise<Category[]> {
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
    const body = (await res.json()) as { categories?: Category[] };
    return Array.isArray(body.categories) ? body.categories : [];
  } finally {
    clearTimeout(timer);
  }
}

router.get(
  '/categories',
  requireSalesLeadsAccess,
  async (_req: Request, res: Response) => {
    try {
      const cached = cache.get(CACHE_KEY);
      const now = Date.now();
      if (cached && cached.expiresAt > now) {
        res.json({ success: true, data: cached.data, cached: true });
        return;
      }

      const data = await fetchCategoriesFromSquadhire();
      cache.set(CACHE_KEY, { data, expiresAt: now + CACHE_TTL_MS });
      res.json({ success: true, data, cached: false });
    } catch (err: any) {
      console.error('[squadhire-categories] fetch failed:', err);
      res.status(502).json({
        success: false,
        error: err?.message || 'Failed to load SquadHire categories',
      });
    }
  },
);

// Exposed for tests / ops: clear the in-memory cache. Not wired to a route
// today, but keeps the cache inspectable from an REPL or a future admin tool.
export function clearSquadhireCategoriesCache(): void {
  cache.delete(CACHE_KEY);
}

export default router;
