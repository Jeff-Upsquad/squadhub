// ============================================================
// Squad Hub SaaS bridge — signed "act-as" passthrough.
//
//   ALL /bridge/v1/as/:hubUserId/<inner path>
//
// Lets the Squad Hub SaaS (app.squadhub.in) serve the Partner / Business mobile
// apps' Hub-owned features by running the EXISTING Hub route handlers as one
// Hub user, instead of re-implementing them on the bridge.
//
// Contract (the SaaS side codes against this):
//   - Signing: identical to every other bridge call (utils/bridgeSign.ts). The
//     signed path is the full path from `/bridge/` INCLUDING the query string,
//     e.g. `/bridge/v1/as/<uuid>/lms/my-items?limit=20`, and the body hash is
//     over the exact raw JSON body sent (empty string when there is none).
//   - :hubUserId must be a Hub `users.id` UUID whose row has user_type in
//     (partner, partner_employee, client, client_staff), status 'active' and
//     is_admin false. Anything else → 403 {success:false,error}. Internal /
//     staff / admin accounts can never be acted as.
//   - Inner path must match the allowlist below (method + exact shape). Any
//     other path, `..`, `%`-encoded characters (incl. encoded slashes),
//     backslashes or empty segments → 404 {success:false,error}.
//   - The inner request is dispatched to the same Hub router the mobile apps
//     hit directly, with req.userId / userEmail / userType / userName set to
//     that user. Response status + JSON body are exactly the Hub route's.
//     Any Authorization header sent on the bridge call is ignored and removed.
//   - JSON bodies only (no multipart uploads on this passthrough).
//
// Allowlist (inner path, after /as/:hubUserId; `:id` = [A-Za-z0-9_-]+):
//   GET    /lms/my-items | /lms/my-due | /lms/shared-with-me | /lms/items/:id
//   POST   /lms/assignments/:id/start
//   POST   /lms/assignments/:id/lessons/:id/complete
//   POST   /lms/assignments/:id/quiz/:id/submit
//   GET    /lms/collab/items/:id/comments      POST same
//   GET    /off-days      POST /off-days      DELETE /off-days/:id
//   GET    /partner/discover/opportunities
//   PATCH  /partner/discover/opportunities/:id/respond
//   GET    /partner/discover/opportunities/:id/offer     POST same
//   POST   /partner/discover/opportunities/:id/offer/respond
//   POST   /partner/discover/opportunities/:id/notification-response
//   GET    /partner/opportunities
//   POST   /partner/opportunities/:id/(accept|reject)
//   GET    /partner/talent/my-clients | /partner/talent/squadhire-token
// Partner-only routes (/partner/*) still apply their own requireUserType gate,
// so a client user acting through them gets the normal 403.
//
// Identity marker: markBridgeActingUser() stores the identity in a
// module-private WeakMap keyed by this Request object (middleware/auth.ts).
// It is never read from a header/body, cannot be set by a client, and cannot
// outlive or cross requests. requireAuth honours it in place of a JWT.
//
// Audit: one `[bridge-act-as]` log line per call (hub user, method, inner
// path, status).
// ============================================================
import { Router, Request, Response, NextFunction, RequestHandler } from 'express';
import type { UserType } from '@squadhub/shared';
import { supabaseAdmin } from '../../supabase';
import { markBridgeActingUser } from '../../middleware/auth';

export const ACT_AS_USER_TYPES: readonly UserType[] = ['partner', 'partner_employee', 'client', 'client_staff'];

const ID = '[A-Za-z0-9_-]+';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const rule = (methods: string[], pattern: string) => ({ methods, re: new RegExp(`^${pattern}$`) });

export const ACT_AS_ALLOWLIST: ReadonlyArray<{ methods: string[]; re: RegExp }> = [
  rule(['GET'], '/lms/my-items'),
  rule(['GET'], '/lms/my-due'),
  rule(['GET'], '/lms/shared-with-me'),
  rule(['GET'], `/lms/items/${ID}`),
  rule(['POST'], `/lms/assignments/${ID}/start`),
  rule(['POST'], `/lms/assignments/${ID}/lessons/${ID}/complete`),
  rule(['POST'], `/lms/assignments/${ID}/quiz/${ID}/submit`),
  rule(['GET', 'POST'], `/lms/collab/items/${ID}/comments`),
  rule(['GET', 'POST'], '/off-days/?'),
  rule(['DELETE'], `/off-days/${ID}`),
  rule(['GET'], '/partner/discover/opportunities'),
  rule(['PATCH'], `/partner/discover/opportunities/${ID}/respond`),
  rule(['GET', 'POST'], `/partner/discover/opportunities/${ID}/offer`),
  rule(['POST'], `/partner/discover/opportunities/${ID}/offer/respond`),
  rule(['POST'], `/partner/discover/opportunities/${ID}/notification-response`),
  rule(['GET'], '/partner/opportunities/?'),
  rule(['POST'], `/partner/opportunities/${ID}/(accept|reject)`),
  rule(['GET'], '/partner/talent/my-clients'),
  rule(['GET'], '/partner/talent/squadhire-token'),
];

/** True when `method innerUrl` (query allowed) is on the act-as allowlist. */
export function isActAsAllowed(method: string, innerUrl: string): boolean {
  const q = innerUrl.indexOf('?');
  const path = q >= 0 ? innerUrl.slice(0, q) : innerUrl;
  // Raw (undecoded) path: refuse traversal, any percent-encoding (covers
  // %2f / %5c / %2e), backslashes and empty segments before matching.
  if (!path.startsWith('/') || path.includes('..') || path.includes('%') || path.includes('\\') || path.includes('//')) {
    return false;
  }
  const m = method.toUpperCase();
  return ACT_AS_ALLOWLIST.some((r) => r.methods.includes(m) && r.re.test(path));
}

type ActAsUserRow = {
  id: string;
  email: string | null;
  user_type: string | null;
  status: string | null;
  is_admin: boolean | null;
  display_name: string | null;
};

async function loadActAsUser(id: string): Promise<{ ok: true; user: ActAsUserRow | null } | { ok: false }> {
  try {
    const { data, error } = await supabaseAdmin
      .from('users')
      .select('id, email, user_type, status, is_admin, display_name')
      .eq('id', id)
      .maybeSingle();
    if (error) return { ok: false };
    return { ok: true, user: (data as ActAsUserRow | null) ?? null };
  } catch {
    return { ok: false };
  }
}

/**
 * Build the act-as handler. `inner` is the router holding the real Hub routes
 * at their normal mount paths (injectable for tests).
 */
export function createActAsRouter(inner: RequestHandler): Router {
  const router = Router();

  router.use('/as/:hubUserId', async (req: Request, res: Response, _next: NextFunction) => {
    const hubUserId = String(req.params.hubUserId || '');
    // Inside router.use, req.url is already the inner path (+ query).
    const innerUrl = req.url;
    const innerPath = innerUrl.split('?')[0];

    res.on('finish', () => {
      console.log(
        `[bridge-act-as] hub_user=${hubUserId} method=${req.method} path=${innerPath} status=${res.statusCode}`,
      );
    });

    if (!UUID_RE.test(hubUserId) || !isActAsAllowed(req.method, innerUrl)) {
      res.status(404).json({ success: false, error: 'Unknown bridge endpoint' });
      return;
    }

    const lookup = await loadActAsUser(hubUserId);
    if (!lookup.ok) {
      res.status(503).json({ success: false, error: 'User lookup temporarily unavailable' });
      return;
    }
    const user = lookup.user;

    if (
      !user ||
      !ACT_AS_USER_TYPES.includes(user.user_type as UserType) ||
      user.status !== 'active' ||
      user.is_admin === true
    ) {
      res.status(403).json({ success: false, error: 'This user cannot be acted as' });
      return;
    }

    // Never let a caller-supplied token or pre-set identity fields through.
    delete req.headers.authorization;
    req.userId = undefined;
    req.userEmail = undefined;
    req.userType = undefined;
    req.userName = undefined;

    markBridgeActingUser(req, {
      userId: user.id,
      userEmail: user.email ?? undefined,
      userType: user.user_type as UserType,
      userName: user.display_name ?? undefined,
    });

    inner(req, res, (err?: unknown) => {
      if (res.headersSent) return;
      if (err) {
        console.error('[bridge-act-as] handler error:', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
        return;
      }
      res.status(404).json({ success: false, error: 'Unknown bridge endpoint' });
    });
  });

  return router;
}
