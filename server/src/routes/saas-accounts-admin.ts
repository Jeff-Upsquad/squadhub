/**
 * Super-admin "SaaS Accounts" — a thin, signed proxy to the Squad Hub SaaS
 * (app.squadhub.in) bridge `/bridge/v1/admin/*` endpoints. Hub stores none of
 * this data; every call goes over the bridge with `X-Bridge-Actor` set to the
 * acting admin so the SaaS platform audit log records who did what.
 *
 * Mounted at /admin/saas. Gated by requireAuth + requireAdmin (users.is_admin).
 * When SAAS_API_URL / SAAS_BRIDGE_SECRET are unset every endpoint (except
 * /status) answers 503 { code: 'saas_not_connected' }.
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import {
  isSaasBridgeConfigured,
  saasBridgeRequest,
  saasNotConnected,
  SaasNotConnectedError,
} from '../utils/saasAdminBridge';

const router = Router();

router.use(requireAuth);
router.use(requireAdmin);

/** Cashbook is never offered on the SaaS — filtered on read, rejected on write. */
const HIDDEN_MINI_APP_SLUGS = new Set(['cashbook']);

const enc = encodeURIComponent;

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
}

function actorOf(req: Request) {
  return { hub_user_id: req.userId as string, email: req.userEmail ?? null };
}

async function forward(
  req: Request,
  res: Response,
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  opts: { query?: Record<string, string | undefined>; body?: unknown; transform?: (data: any) => any } = {},
): Promise<void> {
  try {
    const result = await saasBridgeRequest({
      method,
      path,
      query: opts.query,
      body: opts.body,
      actor: actorOf(req),
    });
    if (opts.transform && result.body.success) {
      res.status(result.status).json({ ...result.body, data: opts.transform(result.body.data) });
      return;
    }
    res.status(result.status).json(result.body);
  } catch (err) {
    if (err instanceof SaasNotConnectedError) {
      saasNotConnected(res);
      return;
    }
    console.error('[saas-accounts-admin]', method, path, err);
    res.status(500).json({ success: false, error: 'SaaS request failed' });
  }
}

function badRequest(res: Response, error: z.ZodError | string): void {
  res.status(400).json({
    success: false,
    error: typeof error === 'string' ? error : error.issues.map((i) => i.message).join('; '),
  });
}

// ── Connection status (never 503 — lets the UI render its "not connected" state)
router.get('/status', (_req: Request, res: Response) => {
  res.json({ success: true, data: { connected: isSaasBridgeConfigured() } });
});

// ── Accounts ────────────────────────────────────────────────────────────────
router.get('/accounts', (req, res) =>
  forward(req, res, 'GET', '/bridge/v1/admin/accounts', {
    query: {
      q: str(req.query.q),
      kind: str(req.query.kind),
      status: str(req.query.status),
      page: str(req.query.page),
    },
  }),
);

router.get('/accounts/:id', (req, res) =>
  forward(req, res, 'GET', `/bridge/v1/admin/accounts/${enc(req.params.id)}`),
);

const reasonSchema = z.object({ reason: z.string().trim().max(500).optional() }).passthrough();

router.post('/accounts/:id/suspend', (req, res) => {
  const parsed = reasonSchema.safeParse(req.body ?? {});
  if (!parsed.success) return badRequest(res, parsed.error);
  return forward(req, res, 'POST', `/bridge/v1/admin/accounts/${enc(req.params.id)}/suspend`, {
    body: parsed.data.reason ? { reason: parsed.data.reason } : {},
  });
});

router.post('/accounts/:id/reactivate', (req, res) =>
  forward(req, res, 'POST', `/bridge/v1/admin/accounts/${enc(req.params.id)}/reactivate`, { body: {} }),
);

const ownerSchema = z.object({ user_id: z.string().trim().min(1, 'user_id is required') });

router.post('/accounts/:id/owner', (req, res) => {
  const parsed = ownerSchema.safeParse(req.body ?? {});
  if (!parsed.success) return badRequest(res, parsed.error);
  return forward(req, res, 'POST', `/bridge/v1/admin/accounts/${enc(req.params.id)}/owner`, {
    body: { user_id: parsed.data.user_id },
  });
});

router.post('/accounts/:id/members/:userId/remove', (req, res) =>
  forward(
    req,
    res,
    'POST',
    `/bridge/v1/admin/accounts/${enc(req.params.id)}/members/${enc(req.params.userId)}/remove`,
    { body: {} },
  ),
);

const assignPlanSchema = z.object({ plan_id: z.string().trim().min(1, 'plan_id is required') });

router.post('/accounts/:id/plan', (req, res) => {
  const parsed = assignPlanSchema.safeParse(req.body ?? {});
  if (!parsed.success) return badRequest(res, parsed.error);
  return forward(req, res, 'POST', `/bridge/v1/admin/accounts/${enc(req.params.id)}/plan`, {
    body: { plan_id: parsed.data.plan_id },
  });
});

const toggleMiniAppSchema = z.object({
  slug: z.string().trim().min(1, 'slug is required'),
  enabled: z.boolean({ required_error: 'enabled is required' }),
});

router.post('/accounts/:id/mini-apps', (req, res) => {
  const parsed = toggleMiniAppSchema.safeParse(req.body ?? {});
  if (!parsed.success) return badRequest(res, parsed.error);
  if (HIDDEN_MINI_APP_SLUGS.has(parsed.data.slug)) {
    return badRequest(res, 'This mini app is not available on Squad Hub SaaS');
  }
  return forward(req, res, 'POST', `/bridge/v1/admin/accounts/${enc(req.params.id)}/mini-apps`, {
    body: parsed.data,
  });
});

// ── Plans ───────────────────────────────────────────────────────────────────
const planSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80),
  price_inr: z.number().min(0, 'Price cannot be negative'),
  free_staff_seats: z.number().int().min(0, 'Free staff seats cannot be negative'),
  is_default: z.boolean().optional().default(false),
});

router.get('/plans', (req, res) => forward(req, res, 'GET', '/bridge/v1/admin/plans'));

router.post('/plans', (req, res) => {
  const parsed = planSchema.safeParse(req.body ?? {});
  if (!parsed.success) return badRequest(res, parsed.error);
  return forward(req, res, 'POST', '/bridge/v1/admin/plans', { body: parsed.data });
});

// Contract lists PUT on `/bridge/v1/admin/plans` (no id segment) — the plan id
// travels in the body.
router.put('/plans/:id', (req, res) => {
  const parsed = planSchema.partial().safeParse(req.body ?? {});
  if (!parsed.success) return badRequest(res, parsed.error);
  return forward(req, res, 'PUT', '/bridge/v1/admin/plans', {
    body: { ...parsed.data, id: req.params.id },
  });
});

// ── Mini-app catalog ────────────────────────────────────────────────────────
router.get('/mini-apps', (req, res) =>
  forward(req, res, 'GET', '/bridge/v1/admin/mini-apps', {
    transform: (data) =>
      Array.isArray(data) ? data.filter((a: any) => !HIDDEN_MINI_APP_SLUGS.has(String(a?.slug))) : data,
  }),
);

// ── Impersonation ("Log in as") — reason mandatory, audited on the SaaS ─────
const impersonateSchema = z.object({
  user_id: z.string().trim().min(1, 'user_id is required'),
  reason: z.string().trim().min(5, 'A reason (at least 5 characters) is required').max(500),
});

router.post('/impersonate', (req, res) => {
  const parsed = impersonateSchema.safeParse(req.body ?? {});
  if (!parsed.success) return badRequest(res, parsed.error);
  return forward(req, res, 'POST', '/bridge/v1/admin/impersonate', { body: parsed.data });
});

// ── Audit log ───────────────────────────────────────────────────────────────
router.get('/audit', (req, res) =>
  forward(req, res, 'GET', '/bridge/v1/admin/audit', {
    query: { account_id: str(req.query.account_id), page: str(req.query.page) },
  }),
);

// ── Talent check-ins ────────────────────────────────────────────────────────
router.get('/checkins', (req, res) =>
  forward(req, res, 'GET', '/bridge/v1/checkins', {
    query: {
      from: str(req.query.from),
      to: str(req.query.to),
      hub_partner_user_id: str(req.query.hub_partner_user_id),
    },
  }),
);

export default router;
