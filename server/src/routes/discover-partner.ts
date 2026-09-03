import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireUserType } from '../middleware/userType';
import { PARTNER_USER_TYPES } from '@squadhub/shared';
import { config } from '../config';

/**
 * Partner Discover — thin proxy to SquadHire's business discover API.
 *
 * Categories are fetched from the public endpoint (any authenticated user).
 * Profile search/detail uses the business discover endpoint with a service
 * account token for server-to-server auth.
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
  return !!config.squadhireApiUrl;
}

function buildUrl(path: string, search?: string): string {
  const base = config.squadhireApiUrl.replace(/\/+$/, '');
  const url = new URL(`${base}${path}`);
  if (search) url.search = search;
  return url.toString();
}

// ---- Upstream call ----------------------------------------------------------
async function callUpstream(
  method: string,
  path: string,
  search = '',
  body?: unknown,
): Promise<{ ok: boolean; status: number; body: string }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (config.squadhireBusinessToken) {
    headers['Authorization'] = `Bearer ${config.squadhireBusinessToken}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const startedAt = Date.now();

  try {
    const res = await fetch(buildUrl(path, search), {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const text = await res.text();
    if (res.status >= 500) {
      recordFailure();
      console.error(`[discover] upstream ${method} ${path} → ${res.status} (${Date.now() - startedAt}ms)`);
    } else {
      recordSuccess();
    }
    return { ok: res.ok, status: res.status, body: text };
  } catch (err) {
    recordFailure();
    console.error(`[discover] upstream ${method} ${path} failed (${Date.now() - startedAt}ms):`, (err as Error)?.message);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ---- GET proxy with cache + breaker -----------------------------------------
async function proxyRead(req: Request, res: Response, path: string) {
  if (!configured()) {
    res.status(503).json({ success: false, error: 'Discover is not configured' });
    return;
  }

  const search = req.originalUrl.split('?')[1] ?? '';
  const cacheKey = `${path}?${search}`;
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
    const result = await callUpstream('GET', path, search);
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

/** GET /partner/discover/categories — list all talent categories */
router.get('/categories', (req: Request, res: Response) => {
  proxyRead(req, res, '/public/categories');
});

/** GET /partner/discover/:categorySlug — list profiles in a category */
router.get('/:categorySlug', (req: Request, res: Response) => {
  const categorySlug = String(req.params.categorySlug);
  proxyRead(req, res, `/business/discover/${encodeURIComponent(categorySlug)}`);
});

/** GET /partner/discover/:categorySlug/:id — single profile detail */
router.get('/:categorySlug/:id', (req: Request, res: Response) => {
  const categorySlug = String(req.params.categorySlug);
  const id = String(req.params.id);
  proxyRead(req, res, `/business/discover/${encodeURIComponent(categorySlug)}/${encodeURIComponent(id)}`);
});

export default router;
