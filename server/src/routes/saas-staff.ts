/**
 * Internal staff → Squad Hub SaaS "Client workspaces".
 *
 *   GET  /saas/my-workspaces  → SaaS GET  /bridge/v1/staff/:hubUserId/workspaces
 *   POST /saas/sso            → SaaS POST /bridge/v1/staff/sso { hub_user_id, workspace_id? }
 *
 * Internal users only. When the bridge isn't configured both answer 503
 * { code: 'saas_not_connected' } and the web sidebar hides the section.
 */
import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth } from '../middleware/auth';
import {
  saasBridgeRequest,
  saasNotConnected,
  SaasNotConnectedError,
} from '../utils/saasAdminBridge';

const router = Router();

router.use(requireAuth);
router.use((req: Request, res: Response, next: NextFunction) => {
  if (req.userType && req.userType !== 'internal') {
    res.status(403).json({ success: false, error: 'Internal staff only' });
    return;
  }
  next();
});

async function call(
  req: Request,
  res: Response,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<void> {
  try {
    const result = await saasBridgeRequest({
      method,
      path,
      body,
      actor: { hub_user_id: req.userId as string, email: req.userEmail ?? null },
    });
    res.status(result.status).json(result.body);
  } catch (err) {
    if (err instanceof SaasNotConnectedError) {
      saasNotConnected(res);
      return;
    }
    console.error('[saas-staff]', method, path, err);
    res.status(500).json({ success: false, error: 'SaaS request failed' });
  }
}

router.get('/my-workspaces', (req, res) =>
  call(req, res, 'GET', `/bridge/v1/staff/${encodeURIComponent(req.userId as string)}/workspaces`),
);

router.post('/sso', (req, res) => {
  // Only the landing workspace comes from the client; the identity is always the caller's own.
  const workspaceId = typeof req.body?.workspace_id === 'string' ? req.body.workspace_id : undefined;
  return call(req, res, 'POST', '/bridge/v1/staff/sso', {
    hub_user_id: req.userId,
    ...(workspaceId ? { workspace_id: workspaceId } : {}),
  });
});

export default router;
