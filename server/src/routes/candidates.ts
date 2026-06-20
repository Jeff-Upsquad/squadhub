import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requireMiniAppOrAdmin } from '../middleware/miniApp';
import { config } from '../config';
import { allowedCandidateCategories, isCategoryRestricted } from '../utils/candidateCategories';

/**
 * Candidates mini app — thin proxy to SquadHire (Profiles).
 *
 * SquadHub renders the UI; SquadHire owns the data. Every request is forwarded
 * to SquadHire's signed integration surface (/api/integrations/squadhub/
 * candidates/*) over the shared X-SquadHub-Signature secret, with the acting
 * user's email in X-SquadHub-Actor for the audit trail.
 *
 * Resilience (so a SquadHire wobble doesn't take this app down):
 *   - per-call timeout (fail fast)
 *   - circuit breaker (stop hammering a dead upstream; UI shows "unavailable")
 *   - short read cache w/ stale-while-revalidate (reads still render when down)
 *   - writes blocked while degraded (clear 503; UI hides Save)
 *   - zod boundary validation (off-contract upstream → controlled 502, no crash)
 *   - kill switches: mini_apps.is_enabled=false OR CANDIDATES_PROXY_ENABLED=false
 */

const router = Router();
router.use(requireAuth);
router.use(requireMiniAppOrAdmin('candidates'));

const UPSTREAM_BASE_PATH = '/api/integrations/squadhub/candidates';
const TIMEOUT_MS = 6_000;
const CACHE_TTL_MS = 60_000;

// ---- Circuit breaker (module-level, shared across requests) -----------------
const FAILURE_THRESHOLD = 4;
const OPEN_MS = 30_000;
const breaker = { failures: 0, openUntil: 0 };
const breakerIsOpen = () => Date.now() < breaker.openUntil;
function recordSuccess() {
  breaker.failures = 0;
  breaker.openUntil = 0;
}
function recordFailure() {
  breaker.failures += 1;
  if (breaker.failures >= FAILURE_THRESHOLD) {
    breaker.openUntil = Date.now() + OPEN_MS;
    console.error(`[candidates] circuit breaker OPEN for ${OPEN_MS}ms after ${breaker.failures} failures`);
  }
}

// ---- Short read cache (stale-while-revalidate) ------------------------------
interface CacheEntry {
  status: number;
  body: string;
  expiresAt: number;
}
const readCache = new Map<string, CacheEntry>();

// ---- Boundary contract (tolerant reader) ------------------------------------
const listSchema = z
  .object({
    leads: z.array(z.unknown()),
    total: z.number(),
    page: z.number(),
    limit: z.number(),
    total_pages: z.number(),
  })
  .passthrough();
const detailSchema = z.object({ id: z.string() }).passthrough();
const notesSchema = z.object({ notes: z.array(z.unknown()) }).passthrough();
const interviewsSchema = z
  .object({
    invitations: z.array(z.unknown()),
    total: z.number(),
    page: z.number(),
    limit: z.number(),
    total_pages: z.number(),
  })
  .passthrough();

function configured(): boolean {
  return !!(config.candidatesProxyEnabled && config.squadhireWebhookUrl && config.squadhireWebhookSecret);
}

function buildUrl(suffix: string, search: string): string {
  const url = new URL(config.squadhireWebhookUrl);
  url.pathname = `${UPSTREAM_BASE_PATH}${suffix}`;
  url.search = search || '';
  return url.toString();
}

interface UpstreamResult {
  ok: boolean;
  status: number;
  body: string;
}

async function callUpstream(
  req: Request,
  method: string,
  suffix: string,
  search = '',
): Promise<UpstreamResult> {
  const headers: Record<string, string> = {
    'X-SquadHub-Signature': config.squadhireWebhookSecret,
  };
  if (req.userEmail) headers['X-SquadHub-Actor'] = req.userEmail;
  let body: string | undefined;
  if (method !== 'GET' && method !== 'HEAD') {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(req.body ?? {});
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const startedAt = Date.now();
  try {
    const res = await fetch(buildUrl(suffix, search), { method, headers, body, signal: controller.signal });
    const text = await res.text();
    // 5xx = upstream failure (counts against the breaker); 4xx = a real answer
    // (e.g. 404/validation) that we pass straight through.
    if (res.status >= 500) {
      recordFailure();
      console.error(`[candidates] upstream ${method} ${suffix} → ${res.status} (${Date.now() - startedAt}ms)`);
    } else {
      recordSuccess();
    }
    return { ok: res.ok, status: res.status, body: text };
  } catch (err) {
    recordFailure();
    console.error(`[candidates] upstream ${method} ${suffix} failed (${Date.now() - startedAt}ms):`, (err as Error)?.message);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** GET proxy: cache + stale-while-revalidate + breaker + boundary validation. */
async function proxyRead(req: Request, res: Response, suffix: string, schema?: z.ZodTypeAny) {
  if (!configured()) {
    res.status(503).json({ success: false, error: 'Candidates is not configured on this server' });
    return;
  }
  const cacheKey = `${suffix}?${req.originalUrl.split('?')[1] ?? ''}`;
  const cached = readCache.get(cacheKey);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    res.status(cached.status).type('application/json').send(cached.body);
    return;
  }

  // Breaker open and nothing fresh — serve stale if we have it, else 503.
  if (breakerIsOpen()) {
    if (cached) {
      res.setHeader('X-Candidates-Stale', '1');
      res.status(cached.status).type('application/json').send(cached.body);
      return;
    }
    res.status(503).json({ success: false, error: 'SquadHire is temporarily unavailable' });
    return;
  }

  try {
    const result = await callUpstream(req, 'GET', suffix, req.originalUrl.split('?')[1] ?? '');
    if (result.ok && schema) {
      try {
        schema.parse(JSON.parse(result.body));
      } catch (e) {
        console.error(`[candidates] boundary validation failed for GET ${suffix}:`, (e as Error)?.message);
        res.status(502).json({ success: false, error: 'Unexpected response from SquadHire' });
        return;
      }
    }
    if (result.ok) {
      readCache.set(cacheKey, { status: result.status, body: result.body, expiresAt: now + CACHE_TTL_MS });
    }
    res.status(result.status).type('application/json').send(result.body);
  } catch {
    // Network/timeout: fall back to stale cache if present.
    if (cached) {
      res.setHeader('X-Candidates-Stale', '1');
      res.status(cached.status).type('application/json').send(cached.body);
      return;
    }
    res.status(503).json({ success: false, error: 'SquadHire is temporarily unavailable' });
  }
}

/** Non-GET proxy: blocked while degraded; never cached. */
async function proxyWrite(req: Request, res: Response, method: string, suffix: string) {
  if (!configured()) {
    res.status(503).json({ success: false, error: 'Candidates is not configured on this server' });
    return;
  }
  if (breakerIsOpen()) {
    res.status(503).json({ success: false, error: 'SquadHire is temporarily unavailable — try again shortly' });
    return;
  }
  try {
    const result = await callUpstream(req, method, suffix);
    // Any successful write may have changed the underlying data — drop the cache.
    if (result.ok) readCache.clear();
    res.status(result.status).type('application/json').send(result.body);
  } catch {
    res.status(502).json({ success: false, error: 'SquadHire is unreachable' });
  }
}

// ---- Category access (which of Creative/Accountant/Sales a user may see) ----
/** Per-request cached list of categories this user may access. */
async function allowedCats(req: Request): Promise<string[]> {
  const r = req as Request & { _allowedCats?: string[] };
  if (!r._allowedCats) r._allowedCats = await allowedCandidateCategories(req.userId!, req.userType);
  return r._allowedCats;
}

/** Guard for list endpoints: a scoped user must request an allowed form_type. */
async function ensureFormTypeAllowed(req: Request, res: Response): Promise<boolean> {
  const allowed = await allowedCats(req);
  if (!isCategoryRestricted(allowed)) return true;
  const ft = (req.query.form_type as string) || '';
  if (!ft || !allowed.includes(ft)) {
    res.status(403).json({ success: false, error: 'You do not have access to this candidate category' });
    return false;
  }
  return true;
}

/** Guard for by-id writes: resolve the candidate's category and check access. */
async function ensureCandidateAllowed(req: Request, res: Response, id: string): Promise<boolean> {
  const allowed = await allowedCats(req);
  if (!isCategoryRestricted(allowed)) return true;
  try {
    const detail = await callUpstream(req, 'GET', `/${id}`);
    if (detail.ok) {
      const ft = (JSON.parse(detail.body) as { form_type?: string })?.form_type;
      if (ft && allowed.includes(ft)) return true;
    }
  } catch {
    /* fall through to 403 */
  }
  res.status(403).json({ success: false, error: 'You do not have access to this candidate' });
  return false;
}

// ---- Routes -----------------------------------------------------------------
// Health: reports proxy wiring + breaker state without hitting upstream.
router.get('/health', (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: { enabled: config.candidatesProxyEnabled, configured: configured(), degraded: breakerIsOpen() },
  });
});

// Categories this user may access (drives the hub cards + category tabs).
router.get('/categories', async (req, res) => {
  res.json({ success: true, categories: await allowedCats(req) });
});

// Reads — literal sub-collections (onboarding / interviews) before the /:id route.
router.get('/', async (req, res) => { if (!(await ensureFormTypeAllowed(req, res))) return; proxyRead(req, res, '', listSchema); });
router.get('/onboarding', async (req, res) => { if (!(await ensureFormTypeAllowed(req, res))) return; proxyRead(req, res, '/onboarding', listSchema); });
router.get('/interviews', async (req, res) => { if (!(await ensureFormTypeAllowed(req, res))) return; proxyRead(req, res, '/interviews', interviewsSchema); });
router.get('/:id/notes', (req, res) => proxyRead(req, res, `/${req.params.id}/notes`, notesSchema));
router.get('/:id', (req, res) => proxyRead(req, res, `/${req.params.id}`, detailSchema));

// Writes (notes-specific paths registered before the generic /:id ones)
router.patch('/interviews/:id/reviewed', (req, res) => proxyWrite(req, res, 'PATCH', `/interviews/${req.params.id}/reviewed`));
router.post('/:id/notes', async (req, res) => { if (!(await ensureCandidateAllowed(req, res, req.params.id))) return; proxyWrite(req, res, 'POST', `/${req.params.id}/notes`); });
router.patch('/notes/:noteId', (req, res) => proxyWrite(req, res, 'PATCH', `/notes/${req.params.noteId}`));
router.delete('/notes/:noteId', (req, res) => proxyWrite(req, res, 'DELETE', `/notes/${req.params.noteId}`));
router.patch('/:id/status', async (req, res) => { if (!(await ensureCandidateAllowed(req, res, req.params.id))) return; proxyWrite(req, res, 'PATCH', `/${req.params.id}/status`); });
router.patch('/:id/restore', async (req, res) => { if (!(await ensureCandidateAllowed(req, res, req.params.id))) return; proxyWrite(req, res, 'PATCH', `/${req.params.id}/restore`); });
router.delete('/:id', async (req, res) => { if (!(await ensureCandidateAllowed(req, res, req.params.id))) return; proxyWrite(req, res, 'DELETE', `/${req.params.id}`); });

export default router;
