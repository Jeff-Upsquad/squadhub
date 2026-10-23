/**
 * Squad Hub → SaaS bridge, mounted at /bridge/v1 (docs/bridge-contract.md,
 * "SaaS serves"). Server-to-server only: every request is HMAC-verified by
 * requireBridge (503 when SAAS_BRIDGE_SECRET is unset, 401 on a bad/stale
 * signature). Mounted BEFORE the app-wide express.json() so this router's own
 * parser keeps the raw body for the signature hash.
 *
 * Business logic lives in services/bridge/*; handlers only validate and shape.
 */
import express, { Router, Request, Response } from 'express';
import { z } from 'zod';
import { config } from '../../config';
import { requireBridge } from '../../utils/bridgeSign';
import { BridgeError } from '../../services/bridge/errors';
import { ensureBridgeAccount } from '../../services/bridge/accounts';
import { ensureSharedWorkspace, removeSharedMember, setSharedLifecycle } from '../../services/bridge/sharedWorkspaces';
import { notifySupportReply } from '../../services/bridge/support';
import * as admin from '../../services/bridge/admin';
import { linkStaff, staffSso, staffWorkspaces } from '../../services/bridge/staff';
import { isUuid } from '../../services/bridge/errors';

const router = Router();

router.use(
  express.json({
    limit: '2mb',
    verify: (req, _res, buf) => {
      (req as Request).rawBody = buf;
    },
  }),
);
// Secret read per request so tests / env reloads take effect.
router.use((req, res, next) => requireBridge(config.saasBridgeSecret)(req, res, next));

function actorOf(req: Request): admin.BridgeActor | null {
  return req.bridgeActor ?? null;
}
function actorHubId(req: Request): string | null {
  const id = req.bridgeActor?.hub_user_id;
  return isUuid(id) ? id : null;
}

type Handler = (req: Request) => Promise<{ status?: number; data: unknown }>;

function handle(fn: Handler) {
  return async (req: Request, res: Response) => {
    try {
      const { status, data } = await fn(req);
      res.status(status ?? 200).json({ success: true, data });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ success: false, error: err.errors[0]?.message || 'Invalid body' });
        return;
      }
      if (err instanceof BridgeError) {
        res.status(err.status).json({ success: false, error: err.message, ...(err.code ? { code: err.code } : {}) });
        return;
      }
      console.error(`[bridge] ${req.method} ${req.originalUrl} error:`, err);
      res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
    }
  };
}

const uuid = z.string().uuid();
const optUuid = uuid.nullable().optional();
const idParam = (req: Request, key = 'id') => String(req.params[key] ?? '');

// ---------------------------------------------------------------- accounts
const accountSchema = z.object({
  kind: z.enum(['business', 'talent']),
  owner: z.object({
    email: z.string().email(),
    name: z.string().trim().min(1).max(200),
    phone: z.string().max(40).nullable().optional(),
  }),
  name: z.string().trim().max(120).nullable().optional(),
  hub_client_id: optUuid,
  hub_partner_user_id: optUuid,
  squadhire_business_id: z.string().max(200).nullable().optional(),
  squadhire_talent_id: z.string().max(200).nullable().optional(),
  role_slug: z.string().max(80).nullable().optional(),
});

router.post(
  '/accounts',
  handle(async (req) => {
    const body = accountSchema.parse(req.body);
    const result = await ensureBridgeAccount(body, actorHubId(req));
    return { status: result.created ? 201 : 200, data: result };
  }),
);

// ---------------------------------------------------------------- shared workspaces
const ensureSchema = z.object({
  business_saas_account_id: optUuid,
  hub_client_id: optUuid,
  hub_card_id: uuid,
  card_category: z.string().max(120).nullable().optional(),
  hub_partner_user_id: optUuid,
  account_manager_hub_user_ids: z.array(z.string()).max(50).optional().default([]),
  supersedes_hub_card_id: optUuid,
});

router.post(
  '/shared-workspaces/ensure',
  handle(async (req) => ({ data: await ensureSharedWorkspace(ensureSchema.parse(req.body), actorHubId(req)) })),
);

const removeSchema = z
  .object({ hub_partner_user_id: optUuid, hub_user_id: optUuid })
  .refine((b) => b.hub_partner_user_id || b.hub_user_id, 'hub_partner_user_id or hub_user_id is required');

router.post(
  '/shared-workspaces/:id/members/remove',
  handle(async (req) => ({ data: await removeSharedMember(idParam(req), removeSchema.parse(req.body ?? {}), actorHubId(req)) })),
);

for (const action of ['pause', 'resume', 'close'] as const) {
  router.post(
    `/shared-workspaces/:id/${action}`,
    handle(async (req) => ({ data: await setSharedLifecycle(idParam(req), action, actorHubId(req)) })),
  );
}

// ---------------------------------------------------------------- support
const notifySchema = z.object({ ticket_id: uuid, saas_user_id: uuid, preview: z.string().max(4000).optional().default('') });
router.post('/support/notify', handle(async (req) => ({ data: await notifySupportReply(notifySchema.parse(req.body)) })));

// ---------------------------------------------------------------- admin
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

router.get(
  '/admin/accounts',
  handle(async (req) => ({
    data: await admin.listAccounts({ q: str(req.query.q), kind: str(req.query.kind), status: str(req.query.status), page: req.query.page }),
  })),
);
router.get('/admin/accounts/:id', handle(async (req) => ({ data: await admin.accountDetail(idParam(req)) })));
router.post(
  '/admin/accounts/:id/suspend',
  handle(async (req) => {
    const { reason } = z.object({ reason: z.string().trim().max(500).optional() }).parse(req.body ?? {});
    return { data: await admin.suspendAccount(idParam(req), reason, actorOf(req)) };
  }),
);
router.post('/admin/accounts/:id/reactivate', handle(async (req) => ({ data: await admin.reactivateAccount(idParam(req), actorOf(req)) })));
router.post(
  '/admin/accounts/:id/owner',
  handle(async (req) => {
    const { user_id } = z.object({ user_id: z.string().min(1) }).parse(req.body ?? {});
    return { data: await admin.changeOwner(idParam(req), user_id, actorOf(req)) };
  }),
);
router.post(
  '/admin/accounts/:id/members/:userId/remove',
  handle(async (req) => ({ data: await admin.removeMember(idParam(req), idParam(req, 'userId'), actorOf(req)) })),
);
router.post(
  '/admin/accounts/:id/plan',
  handle(async (req) => {
    const { plan_id } = z.object({ plan_id: z.string().min(1) }).parse(req.body ?? {});
    return { data: await admin.assignPlan(idParam(req), plan_id, actorOf(req)) };
  }),
);
router.post(
  '/admin/accounts/:id/mini-apps',
  handle(async (req) => {
    const { slug, enabled } = z.object({ slug: z.string().trim().min(1), enabled: z.boolean() }).parse(req.body ?? {});
    return { data: await admin.toggleMiniApp(idParam(req), slug, enabled, actorOf(req)) };
  }),
);

const planBody = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  price_inr: z.number().optional(),
  free_staff_seats: z.number().optional(),
  is_default: z.boolean().optional(),
});
router.get('/admin/plans', handle(async () => ({ data: await admin.listPlans() })));
router.post('/admin/plans', handle(async (req) => ({ status: 201, data: await admin.createPlan(planBody.parse(req.body ?? {}), actorOf(req)) })));
router.put('/admin/plans', handle(async (req) => ({ data: await admin.updatePlan(planBody.parse(req.body ?? {}), actorOf(req)) })));
// Tolerated alias: PUT /admin/plans/:id (id in the path).
router.put(
  '/admin/plans/:id',
  handle(async (req) => ({ data: await admin.updatePlan({ ...planBody.parse(req.body ?? {}), id: idParam(req) }, actorOf(req)) })),
);

router.get('/admin/mini-apps', handle(async () => ({ data: await admin.miniAppCatalog() })));

router.post(
  '/admin/impersonate',
  handle(async (req) => {
    const { user_id, reason } = z.object({ user_id: z.string().min(1), reason: z.string() }).parse(req.body ?? {});
    return { data: await admin.impersonate(user_id, reason, actorOf(req)) };
  }),
);

router.get(
  '/admin/audit',
  handle(async (req) => ({ data: await admin.listAudit({ account_id: str(req.query.account_id), page: req.query.page }) })),
);

// ---------------------------------------------------------------- check-ins
router.get(
  '/checkins',
  handle(async (req) => ({
    data: await admin.listCheckins({ from: str(req.query.from), to: str(req.query.to), hub_partner_user_id: str(req.query.hub_partner_user_id) }),
  })),
);

// ---------------------------------------------------------------- staff
router.post(
  '/staff/link',
  handle(async (req) => {
    const body = z
      .object({ hub_user_id: uuid, email: z.string().email().optional(), name: z.string().max(200).optional() })
      .parse(req.body ?? {});
    return { data: await linkStaff(body) };
  }),
);
router.get('/staff/:hubUserId/workspaces', handle(async (req) => ({ data: await staffWorkspaces(idParam(req, 'hubUserId')) })));
router.post(
  '/staff/sso',
  handle(async (req) => {
    const body = z.object({ hub_user_id: uuid, workspace_id: optUuid }).parse(req.body ?? {});
    return { data: await staffSso(body, actorOf(req)) };
  }),
);

router.use((_req, res) => {
  res.status(404).json({ success: false, error: 'Unknown bridge endpoint' });
});

export default router;
