/**
 * One-time login links (mounted at /auth, before the main auth router).
 *
 *   GET /auth/one-time?token=   redeem a link minted by the Hub bridge
 *                               (super-admin "Log in as", staff "Sign in with
 *                               Squad Hub"), then redirect into the web app.
 *                               The session travels in the URL FRAGMENT (never
 *                               sent to a server) to /signin/one-time, which
 *                               stores it and wipes the fragment.
 *   GET /auth/impersonation     is the caller's session an impersonation? The
 *                               web shows a banner for the whole session.
 */
import { Router, Request, Response } from 'express';
import { config } from '../config';
import { requireAuth } from '../middleware/auth';
import { rateLimit } from '../utils/rateLimit';
import { BridgeError } from '../services/bridge/errors';
import { impersonationForAccessToken, redeemLoginToken } from '../services/bridge/loginTokens';

const router = Router();

function webUrl(path: string): string {
  return `${config.webAppUrl.replace(/\/+$/, '')}${path}`;
}

router.get(
  '/one-time',
  rateLimit({ windowMs: 15 * 60 * 1000, max: 60 }),
  async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    const token = typeof req.query.token === 'string' ? req.query.token : '';
    try {
      const r = await redeemLoginToken(token);
      const frag = new URLSearchParams({
        access_token: r.access_token,
        refresh_token: r.refresh_token,
        purpose: r.purpose,
        ...(r.workspace_id ? { workspace_id: r.workspace_id } : {}),
      });
      res.redirect(302, webUrl(`/signin/one-time#${frag.toString()}`));
    } catch (err) {
      const message =
        err instanceof BridgeError ? err.message : 'Could not sign you in. Please ask for a new link.';
      if (!(err instanceof BridgeError)) console.error('[one-time login] error:', err);
      res.redirect(302, webUrl(`/signin/one-time#${new URLSearchParams({ error: message }).toString()}`));
    }
  },
);

router.get('/impersonation', requireAuth, async (req: Request, res: Response) => {
  try {
    const token = (req.headers.authorization || '').split(' ')[1] || '';
    const imp = await impersonationForAccessToken(token);
    res.json({ success: true, data: imp ? { active: true, ...imp } : { active: false } });
  } catch (err) {
    console.error('[impersonation] error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
