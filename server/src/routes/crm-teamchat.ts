import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireAnyMiniAppOrAdmin } from '../middleware/miniApp';

// Proxy for the CRM TeamChat mini-apps embedded in SquadHub.
//
// SquadCRM and SquadHireCRM each own a TeamChat module (GET /team-chats/open,
// GET /team-chats/unread, POST /team-chats/:id/read|close|reopen) on their own
// API servers. Browsers can't call those directly (CRM CORS only allows the
// CRM web origin), and the two CRMs share Supabase auth with SquadHub, so the
// SquadHub JWT the browser already holds is valid there. This router forwards
// the call server-to-server with the same Authorization header.
//
// Sources:
//   crm   -> SquadCRM      (CRM_API_URL, default http://localhost:4100)
//   shcrm -> SquadHireCRM  (SHCRM_API_URL, default http://localhost:4101)

const router = Router();
router.use(requireAuth);
router.use(requireAnyMiniAppOrAdmin(['squadcrm-teamchat', 'squadhire-teamchat']));

type Source = 'crm' | 'shcrm';

function baseFor(source: Source): string | null {
  if (source === 'crm') {
    return process.env.CRM_API_URL || 'http://localhost:4100';
  }
  return process.env.SHCRM_API_URL || 'http://localhost:4101';
}

async function proxy(
  req: Request,
  res: Response,
  source: Source,
  upstreamPath: string,
  method: 'GET' | 'POST',
) {
  const base = baseFor(source);
  if (!base) {
    res.status(503).json({ success: false, error: 'CRM API not configured' });
    return;
  }
  const qs = new URLSearchParams();
  const workspaceId = (req.query.workspace_id as string) || (req.body?.workspace_id as string);
  if (workspaceId) qs.set('workspace_id', workspaceId);
  // Pass through extra read query params (limit, channel_id, q).
  for (const k of ['limit', 'channel_id', 'q']) {
    const v = req.query[k];
    if (typeof v === 'string' && v) qs.set(k, v);
  }
  const url = `${base.replace(/\/$/, '')}${upstreamPath}${qs.toString() ? `?${qs}` : ''}`;
  try {
    const upstream = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: req.headers.authorization || '',
      },
      body: method === 'POST' ? JSON.stringify({}) : undefined,
    });
    const data = await upstream.json().catch(() => null);
    res.status(upstream.status).json(data ?? { success: false, error: 'Empty upstream response' });
  } catch (err) {
    console.error(`crm-teamchat proxy ${source} ${upstreamPath} failed:`, err);
    res.status(502).json({ success: false, error: 'CRM unreachable — is the CRM API running?' });
  }
}

router.get('/:source/open', (req: Request, res: Response) => {
  const source = req.params.source as Source;
  if (source !== 'crm' && source !== 'shcrm') {
    res.status(404).json({ success: false, error: 'Unknown source' });
    return;
  }
  void proxy(req, res, source, '/team-chats/open', 'GET');
});

router.get('/:source/unread', (req: Request, res: Response) => {
  const source = req.params.source as Source;
  if (source !== 'crm' && source !== 'shcrm') {
    res.status(404).json({ success: false, error: 'Unknown source' });
    return;
  }
  void proxy(req, res, source, '/team-chats/unread', 'GET');
});

router.post('/:source/:channelId/read', (req: Request, res: Response) => {
  const source = req.params.source as Source;
  if (source !== 'crm' && source !== 'shcrm') {
    res.status(404).json({ success: false, error: 'Unknown source' });
    return;
  }
  void proxy(req, res, source, `/team-chats/${req.params.channelId}/read`, 'POST');
});

router.post('/:source/:channelId/close', (req: Request, res: Response) => {
  const source = req.params.source as Source;
  if (source !== 'crm' && source !== 'shcrm') {
    res.status(404).json({ success: false, error: 'Unknown source' });
    return;
  }
  void proxy(req, res, source, `/team-chats/${req.params.channelId}/close`, 'POST');
});

router.post('/:source/:channelId/reopen', (req: Request, res: Response) => {
  const source = req.params.source as Source;
  if (source !== 'crm' && source !== 'shcrm') {
    res.status(404).json({ success: false, error: 'Unknown source' });
    return;
  }
  void proxy(req, res, source, `/team-chats/${req.params.channelId}/reopen`, 'POST');
});

export default router;
