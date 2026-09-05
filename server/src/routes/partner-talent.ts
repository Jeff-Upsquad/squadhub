import { Router, Request, Response } from 'express';
import { PARTNER_USER_TYPES } from '@squadhub/shared';
import { config } from '../config';
import { requireAuth } from '../middleware/auth';
import { requireUserType } from '../middleware/userType';

const router = Router();
const FETCH_TIMEOUT_MS = 15_000;

router.use(requireAuth, requireUserType(...PARTNER_USER_TYPES));

/**
 * Mint a SquadHire talent session for the signed-in partner — feeds the
 * partner app's in-app WebView (`?app_token=`). Same person, same account:
 * the email comes from the authenticated SquadHub user, never the client.
 */
router.get('/squadhire-token', async (req: Request, res: Response) => {
  if (!req.userEmail) {
    res.status(400).json({ success: false, error: 'Your account has no email address.' });
    return;
  }
  try {
    const upstream = await fetch(squadhireUrl('/api/integrations/squadhub/talent/app-session'), {
      method: 'POST',
      headers: signedHeaders(),
      body: JSON.stringify({ email: req.userEmail }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const body = await readJson(upstream);
    if (!upstream.ok) throw upstreamError(upstream.status, body);
    res.json({
      success: true,
      data: {
        token: body?.token ?? null,
        refresh_token: body?.refresh_token ?? body?.refreshToken ?? null,
      },
    });
  } catch (err: any) {
    console.error('[partner-talent] squadhire token failed:', err?.message);
    res.status(err?.status || 502).json({
      success: false,
      error: err?.message || 'Could not sign you into SquadHire.',
    });
  }
});

function squadhireUrl(pathname: string) {
  if (!config.squadhireWebhookUrl || !config.squadhireWebhookSecret) {
    const err = new Error('SquadHire integration is not configured.') as Error & { status?: number };
    err.status = 503;
    throw err;
  }
  const url = new URL(config.squadhireWebhookUrl);
  url.pathname = pathname;
  url.search = '';
  return url.toString();
}

function signedHeaders() {
  return {
    'Content-Type': 'application/json',
    'X-SquadHub-Signature': config.squadhireWebhookSecret,
  };
}

async function readJson(response: globalThis.Response): Promise<any> {
  const text = await response.text();
  if (!text) return {};
  try { return JSON.parse(text); } catch { return {}; }
}

function upstreamError(status: number, body: any) {
  const err = new Error(body?.error || body?.message || `SquadHire responded ${status}`) as Error & { status?: number };
  err.status = status >= 400 && status < 500 ? status : 502;
  return err;
}

export default router;
