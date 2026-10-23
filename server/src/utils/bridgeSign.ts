/**
 * Squad Hub ⇄ Squad Hub SaaS bridge signing (docs/bridge-contract.md, v1.1).
 * Keep this file IDENTICAL in both repos.
 *
 *   X-Bridge-Timestamp: unix seconds
 *   X-Bridge-Signature: hex HMAC-SHA256(secret,
 *       `${timestamp}.${METHOD}.${pathWithQuery}.${sha256hex(rawBody || "")}`)
 *
 * pathWithQuery starts at `/bridge/` — any proxy prefix (e.g. `/api`) is
 * stripped before signing and verifying. Receivers reject |now − ts| > 300s
 * and compare with crypto.timingSafeEqual. With no secret configured the
 * bridge is disabled: requireBridge answers 503.
 */
import { createHash, createHmac, timingSafeEqual } from 'crypto';
import type { Request, Response, NextFunction } from 'express';

export const BRIDGE_MAX_SKEW_SECONDS = 300;

declare global {
  namespace Express {
    interface Request {
      /** Raw request body bytes (set by the bridge's express.json verify hook). */
      rawBody?: Buffer;
      bridgeActor?: { hub_user_id?: string; email?: string } | null;
    }
  }
}

/** Normalize to the path the signature covers: from `/bridge/` on, with query. */
export function bridgeSigningPath(pathWithQuery: string): string {
  const i = pathWithQuery.indexOf('/bridge/');
  return i >= 0 ? pathWithQuery.slice(i) : pathWithQuery;
}

function sha256hex(body: string | Buffer): string {
  return createHash('sha256').update(body).digest('hex');
}

export function signBridgeRequest(
  method: string,
  pathWithQuery: string,
  rawBody: string | Buffer | null | undefined,
  secret: string,
  now: number = Math.floor(Date.now() / 1000),
): { timestamp: string; signature: string } {
  const timestamp = String(now);
  const payload = `${timestamp}.${method.toUpperCase()}.${bridgeSigningPath(pathWithQuery)}.${sha256hex(rawBody ?? '')}`;
  const signature = createHmac('sha256', secret).update(payload).digest('hex');
  return { timestamp, signature };
}

export function verifyBridgeRequest(
  req: Pick<Request, 'method' | 'originalUrl' | 'header'> & { rawBody?: Buffer },
  secret: string,
  now: number = Math.floor(Date.now() / 1000),
): { ok: true } | { ok: false; reason: string } {
  const ts = req.header('x-bridge-timestamp');
  const sig = req.header('x-bridge-signature');
  if (!ts || !sig) return { ok: false, reason: 'Missing bridge signature' };
  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum) || Math.abs(now - tsNum) > BRIDGE_MAX_SKEW_SECONDS) {
    return { ok: false, reason: 'Stale or invalid bridge timestamp' };
  }
  const { signature } = signBridgeRequest(req.method, req.originalUrl, req.rawBody ?? '', secret, tsNum);
  const a = Buffer.from(signature, 'hex');
  const b = Buffer.from(sig, 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: 'Invalid bridge signature' };
  return { ok: true };
}

/**
 * Express guard for /bridge/v1/* routes. Requires the router to capture the raw
 * body: `express.json({ verify: (req, _res, buf) => { (req as any).rawBody = buf; } })`.
 */
export function requireBridge(secret: string | undefined) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!secret) {
      res.status(503).json({ success: false, error: 'Bridge disabled' });
      return;
    }
    const result = verifyBridgeRequest(req, secret);
    if (!result.ok) {
      res.status(401).json({ success: false, error: result.reason });
      return;
    }
    const actor = req.header('x-bridge-actor');
    try {
      req.bridgeActor = actor ? JSON.parse(actor) : null;
    } catch {
      req.bridgeActor = null;
    }
    next();
  };
}
