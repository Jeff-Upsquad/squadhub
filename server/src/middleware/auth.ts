import { Request, Response, NextFunction } from 'express';
import { supabaseAuth } from '../supabase';
import { supabaseAdmin } from '../supabase';
import type { UserType } from '@squadhub/shared';

// Extend Express Request to include user info
declare global {
  namespace Express {
    interface Request {
      userId?: string;
      userEmail?: string;
      userName?: string;
      userType?: UserType;
    }
  }
}

type VerifiedRequestIdentity = {
  authorization: string;
  userId: string;
  userEmail: string | undefined;
  userType: UserType;
  userName: string | undefined;
};
// Sibling routers can all run this middleware for one HTTP request. Keep its
// verified identity on that request only; every new request still contacts Auth.
const verifiedRequests = new WeakMap<Request, VerifiedRequestIdentity>();

// ── Squad Hub SaaS bridge "act-as" identity ────────────────────────────────
// The signed bridge passthrough (routes/bridge/actAs.ts) runs a small allowlist
// of existing Hub routes as a partner/client user. It marks the request here,
// in a module-private WeakMap keyed by the live Request object: nothing a
// client sends (headers, body, query) can create or alter an entry, and the
// entry dies with that one request object, so it cannot leak to another call.
export type BridgeActingUser = {
  userId: string;
  userEmail: string | undefined;
  userType: UserType;
  userName: string | undefined;
};
const bridgeActingUsers = new WeakMap<Request, Readonly<BridgeActingUser>>();

/** Only the verified bridge act-as handler may call this. */
export function markBridgeActingUser(req: Request, user: BridgeActingUser): void {
  bridgeActingUsers.set(req, Object.freeze({ ...user }));
}

export function getBridgeActingUser(req: Request): Readonly<BridgeActingUser> | undefined {
  return bridgeActingUsers.get(req);
}

// Verify token using Supabase's own auth verification
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  // Bridge act-as: the bridge handler already verified the HMAC signature and
  // re-checked this user's type/status/admin flag moments ago.
  const acting = bridgeActingUsers.get(req);
  if (acting) {
    req.userId = acting.userId;
    req.userEmail = acting.userEmail;
    req.userType = acting.userType;
    req.userName = acting.userName;
    next();
    return;
  }

  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: 'Missing or invalid authorization header' });
    return;
  }

  const verified = verifiedRequests.get(req);
  if (verified?.authorization === authHeader) {
    req.userId = verified.userId;
    req.userEmail = verified.userEmail;
    req.userType = verified.userType;
    req.userName = verified.userName;
    next();
    return;
  }

  const token = authHeader.split(' ')[1];

  try {
    const { data, error } = await supabaseAuth.auth.getUser(token);

    if (error && (error.status === 0 || (error.status ?? 0) >= 500 || error.name === 'AuthRetryableFetchError')) {
      res.status(503).json({ success: false, error: 'Authentication temporarily unavailable. Please retry.' });
      return;
    }

    if (error || !data.user) {
      res.status(401).json({ success: false, error: 'Invalid or expired token' });
      return;
    }

    req.userId = data.user.id;
    req.userEmail = data.user.email;

    const { data: profile, error: profileError } = await supabaseAdmin
      .from('users')
      .select('user_type, status, display_name')
      .eq('id', data.user.id)
      .abortSignal(AbortSignal.timeout(10_000))
      .single();

    if (profileError) {
      res.status(503).json({ success: false, error: 'Account verification temporarily unavailable. Please retry.' });
      return;
    }

    if (profile?.status === 'banned') {
      res.status(403).json({ success: false, error: 'Your account has been banned.' });
      return;
    }
    if (profile?.status === 'suspended') {
      res.status(403).json({ success: false, error: 'Your account has been suspended.' });
      return;
    }

    req.userType = (profile?.user_type as UserType) || 'internal';
    req.userName = (profile?.display_name as string) || undefined;
    verifiedRequests.set(req, { authorization: authHeader, userId: req.userId,
      userEmail: req.userEmail, userType: req.userType, userName: req.userName });

    next();
  } catch {
    res.status(503).json({ success: false, error: 'Authentication temporarily unavailable. Please retry.' });
  }
}

// Check if user has super_admin role in the workspace
export function requireSuperAdmin(req: Request, res: Response, next: NextFunction): void {
  if ((req as any).workspaceRole !== 'super_admin') {
    res.status(403).json({ success: false, error: 'Super admin access required' });
    return;
  }
  next();
}
