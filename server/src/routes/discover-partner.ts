import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireUserType } from '../middleware/userType';
import { PARTNER_USER_TYPES } from '@squadhub/shared';
import { config } from '../config';

/**
 * Partner Discover — reads talent data directly from the SquadHire
 * Supabase database (categories + talent_profiles + talent_users).
 */

const router = Router();
router.use(requireAuth);
router.use(requireUserType(...PARTNER_USER_TYPES));

const TIMEOUT_MS = 8_000;
const CACHE_TTL_MS = 60_000;

// ---- Circuit breaker --------------------------------------------------------
const FAILURE_THRESHOLD = 4;
const OPEN_MS = 30_000;
const breaker = { failures: 0, openUntil: 0 };
const breakerIsOpen = () => Date.now() < breaker.openUntil;
function recordSuccess() { breaker.failures = 0; breaker.openUntil = 0; }
function recordFailure() {
  breaker.failures += 1;
  if (breaker.failures >= FAILURE_THRESHOLD) {
    breaker.openUntil = Date.now() + OPEN_MS;
    console.error(`[discover] circuit breaker OPEN for ${OPEN_MS}ms`);
  }
}

// ---- Cache ------------------------------------------------------------------
interface CacheEntry { status: number; body: string; expiresAt: number; }
const readCache = new Map<string, CacheEntry>();

// ---- Config check -----------------------------------------------------------
function configured(): boolean {
  return !!(config.supabaseUrl && config.supabaseServiceRoleKey);
}

// ---- Supabase helpers -------------------------------------------------------
function supabaseHeaders() {
  return {
    apikey: config.supabaseAnonKey,
    Authorization: `Bearer ${config.supabaseServiceRoleKey}`,
    'Content-Type': 'application/json',
  };
}

function buildSupabaseUrl(path: string, params?: Record<string, string>): string {
  const base = config.supabaseUrl.replace(/\/+$/, '');
  const url = new URL(`${base}/rest/v1/${path}`);
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return url.toString();
}

async function supabaseQuery(
  table: string,
  params: Record<string, string>,
): Promise<{ ok: boolean; status: number; body: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const startedAt = Date.now();

  try {
    const url = buildSupabaseUrl(table, params);
    const res = await fetch(url, { headers: supabaseHeaders(), signal: controller.signal });
    const text = await res.text();
    if (res.status >= 500) {
      recordFailure();
      console.error(`[discover] supabase ${table} → ${res.status} (${Date.now() - startedAt}ms)`);
    } else {
      recordSuccess();
    }
    return { ok: res.ok, status: res.status, body: text };
  } catch (err) {
    recordFailure();
    console.error(`[discover] supabase ${table} failed (${Date.now() - startedAt}ms):`, (err as Error)?.message);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ---- GET proxy with cache + breaker -----------------------------------------
async function proxyRead(
  req: Request,
  res: Response,
  table: string,
  params: Record<string, string>,
) {
  if (!configured()) {
    res.status(503).json({ success: false, error: 'Discover is not configured' });
    return;
  }

  const cacheKey = `${table}?${JSON.stringify(params)}`;
  const cached = readCache.get(cacheKey);
  const now = Date.now();

  if (cached && cached.expiresAt > now) {
    res.status(cached.status).type('application/json').send(cached.body);
    return;
  }

  if (breakerIsOpen()) {
    if (cached) {
      res.setHeader('X-Discover-Stale', '1');
      res.status(cached.status).type('application/json').send(cached.body);
      return;
    }
    res.status(503).json({ success: false, error: 'SquadHire is temporarily unavailable' });
    return;
  }

  try {
    const result = await supabaseQuery(table, params);
    if (result.ok) {
      readCache.set(cacheKey, { status: result.status, body: result.body, expiresAt: now + CACHE_TTL_MS });
    }
    res.status(result.status).type('application/json').send(result.body);
  } catch {
    if (cached) {
      res.setHeader('X-Discover-Stale', '1');
      res.status(cached.status).type('application/json').send(cached.body);
      return;
    }
    res.status(503).json({ success: false, error: 'SquadHire is temporarily unavailable' });
  }
}

// ---- Routes -----------------------------------------------------------------

/** GET /partner/discover/categories — list all active talent categories */
router.get('/categories', (req: Request, res: Response) => {
  proxyRead(req, res, 'categories', {
    select: 'id,name,slug,description,icon_url',
    is_active: 'eq.true',
    order: 'name.asc',
  });
});

/** GET /partner/discover/:categorySlug — list profiles in a category */
router.get('/:categorySlug', async (req: Request, res: Response) => {
  if (!configured()) {
    res.status(503).json({ success: false, error: 'Discover is not configured' });
    return;
  }

  const categorySlug = String(req.params.categorySlug);
  const search = req.originalUrl.split('?')[1] ?? '';
  const params = new URLSearchParams(search);
  const page = Math.max(1, parseInt(params.get('page') || '1', 10));
  const limit = Math.min(50, Math.max(1, parseInt(params.get('limit') || '20', 10)));
  const searchQuery = params.get('q') || '';
  const offset = (page - 1) * limit;

  // First, resolve category slug to ID
  const cacheKey = `cat:${categorySlug}`;
  const cached = readCache.get(cacheKey);
  const now = Date.now();

  let categoryId: string | null = null;

  if (cached && cached.expiresAt > now) {
    try { categoryId = JSON.parse(cached.body)[0]?.id; } catch { /* ignore */ }
  }

  if (!categoryId) {
    try {
      const catResult = await supabaseQuery('categories', {
        select: 'id',
        slug: `eq.${categorySlug}`,
        is_active: 'eq.true',
      });
      if (catResult.ok) {
        const cats = JSON.parse(catResult.body);
        if (cats.length > 0) {
          categoryId = cats[0].id;
          readCache.set(cacheKey, { status: 200, body: catResult.body, expiresAt: now + CACHE_TTL_MS });
        }
      }
    } catch {
      res.status(503).json({ success: false, error: 'Failed to resolve category' });
      return;
    }
  }

  if (!categoryId) {
    res.status(404).json({ success: false, error: 'Category not found' });
    return;
  }

  // Build talent_profiles query
  const profileParams: Record<string, string> = {
    select: 'id,category_id,status,field_data,tier,talent_users!inner(id,full_name,profile_photo_url,current_location)',
    category_id: `eq.${categoryId}`,
    is_active: 'eq.true',
    order: 'created_at.desc',
    limit: String(limit),
    offset: String(offset),
  };

  if (searchQuery) {
    profileParams.or = `(talent_users.full_name.ilike.%${searchQuery}%)`;
  }

  const profileCacheKey = `profiles:${categorySlug}:${search}:${page}:${limit}`;
  const profileCached = readCache.get(profileCacheKey);

  if (profileCached && profileCached.expiresAt > now) {
    res.status(profileCached.status).type('application/json').send(profileCached.body);
    return;
  }

  try {
    const result = await supabaseQuery('talent_profiles', profileParams);
    if (result.ok) {
      readCache.set(profileCacheKey, { status: result.status, body: result.body, expiresAt: now + CACHE_TTL_MS });
    }
    res.status(result.status).type('application/json').send(result.body);
  } catch {
    if (profileCached) {
      res.setHeader('X-Discover-Stale', '1');
      res.status(profileCached.status).type('application/json').send(profileCached.body);
      return;
    }
    res.status(503).json({ success: false, error: 'SquadHire is temporarily unavailable' });
  }
});

/** GET /partner/discover/:categorySlug/:id — single profile detail */
router.get('/:categorySlug/:id', (req: Request, res: Response) => {
  const id = String(req.params.id);

  proxyRead(req, res, 'talent_profiles', {
    select: 'id,category_id,status,field_data,tier,created_at,talent_users!inner(id,full_name,profile_photo_url,current_location,phone)',
    id: `eq.${id}`,
    is_active: 'eq.true',
  });
});

export default router;
