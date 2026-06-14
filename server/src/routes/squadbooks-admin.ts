import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { config } from '../config';

/**
 * Proxies SquadBooks access management to the SquadBooks app's admin API
 * (books.squadhub.in/api/admin/access). The SquadBooks service-role key stays
 * inside SquadBooks; SquadHub authenticates with a shared SQUADBOOKS_ADMIN_API_KEY.
 * `orgId` here is the SquadHub workspace id (SquadBooks scopes data by it).
 */
const router = Router();
router.use(requireAuth);
router.use(requireAdmin);

function configured(): boolean {
  return Boolean(config.squadbooksUrl && config.squadbooksAdminApiKey);
}

async function sb(path: string, init: RequestInit = {}): Promise<globalThis.Response> {
  return fetch(`${config.squadbooksUrl}/api/admin${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'x-admin-key': config.squadbooksAdminApiKey,
      ...(init.headers || {}),
    },
  });
}

router.get('/', async (req: Request, res: Response) => {
  if (!configured()) {
    res.status(503).json({ success: false, error: 'SquadBooks integration not configured' });
    return;
  }
  const orgId = req.query.orgId as string | undefined;
  if (!orgId) {
    res.status(400).json({ success: false, error: 'orgId is required' });
    return;
  }
  try {
    const r = await sb(`/access?orgId=${encodeURIComponent(orgId)}`);
    const data = (await r.json()) as { error?: string };
    if (!r.ok) {
      res.status(r.status).json({ success: false, error: data?.error || 'Failed to load access' });
      return;
    }
    res.json({ success: true, data });
  } catch {
    res.status(502).json({ success: false, error: 'SquadBooks is unreachable' });
  }
});

router.post('/', async (req: Request, res: Response) => {
  if (!configured()) {
    res.status(503).json({ success: false, error: 'SquadBooks integration not configured' });
    return;
  }
  const { orgId, userId, accessLevel, allowedModules } = req.body || {};
  if (!orgId || !userId || !accessLevel) {
    res.status(400).json({ success: false, error: 'orgId, userId and accessLevel are required' });
    return;
  }
  try {
    const r = await sb('/access', {
      method: 'POST',
      body: JSON.stringify({ orgId, userId, accessLevel, allowedModules: allowedModules || [] }),
    });
    const data = (await r.json()) as { error?: string };
    if (!r.ok) {
      res.status(r.status).json({ success: false, error: data?.error || 'Failed to save access' });
      return;
    }
    res.json({ success: true, data });
  } catch {
    res.status(502).json({ success: false, error: 'SquadBooks is unreachable' });
  }
});

router.delete('/', async (req: Request, res: Response) => {
  if (!configured()) {
    res.status(503).json({ success: false, error: 'SquadBooks integration not configured' });
    return;
  }
  const orgId = req.query.orgId as string | undefined;
  const userId = req.query.userId as string | undefined;
  if (!orgId || !userId) {
    res.status(400).json({ success: false, error: 'orgId and userId are required' });
    return;
  }
  try {
    const r = await sb(
      `/access?orgId=${encodeURIComponent(orgId)}&userId=${encodeURIComponent(userId)}`,
      { method: 'DELETE' },
    );
    if (!r.ok) {
      const data = (await r.json().catch(() => ({}))) as { error?: string };
      res.status(r.status).json({ success: false, error: data?.error || 'Failed to revoke access' });
      return;
    }
    res.json({ success: true });
  } catch {
    res.status(502).json({ success: false, error: 'SquadBooks is unreachable' });
  }
});

export default router;
