// ============================================================
// bridgeSign — Squad Hub ⇄ Squad Hub SaaS bridge request signing.
//
// Shared helper: keep this file IDENTICAL in both repos (squadhub web +
// squadhub-saas). Server-to-server only; browsers never call the bridge.
//
// Headers on every bridge request:
//   X-Bridge-Timestamp: unix seconds
//   X-Bridge-Signature: hex HMAC-SHA256(secret,
//       `${timestamp}.${METHOD}.${pathWithQuery}.${sha256hex(rawBody || "")}`)
//   X-Bridge-Actor (optional): JSON {"hub_user_id": "...", "email": "..."}
//
// `pathWithQuery` is the path starting at `/bridge/` (e.g.
// `/bridge/v1/talent/abc/payouts?month=2026-10`). The receiver normalises its
// own URL to that same suffix, so a reverse-proxy prefix on either side (e.g.
// `/api`) doesn't break verification.
//
// The receiver rejects |now − timestamp| > 300s and compares signatures with
// crypto.timingSafeEqual. The raw request body is required for the hash, so
// mount the bridge router with express.json({ verify }) capturing `rawBody`
// (see `bridgeJsonParser` below).
// ============================================================
import crypto from 'crypto';
import express, { Request, Response, NextFunction, RequestHandler } from 'express';
import { config } from '../config';

export const BRIDGE_MAX_SKEW_SECONDS = 300;

export const BRIDGE_HEADERS = {
  timestamp: 'x-bridge-timestamp',
  signature: 'x-bridge-signature',
  actor: 'x-bridge-actor',
} as const;

export interface BridgeActor {
  hub_user_id?: string;
  email?: string;
}

declare global {
  namespace Express {
    interface Request {
      /** Raw JSON body string captured for bridge signature verification. */
      rawBody?: string;
      /** Parsed X-Bridge-Actor header (super-admin actions, for audit). */
      bridgeActor?: BridgeActor | null;
    }
  }
}

export function sha256Hex(input: string): string {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

/** Normalise a URL / path to the `/bridge/...` suffix that both sides sign. */
export function bridgePathWithQuery(urlOrPath: string): string {
  let p = urlOrPath;
  if (/^https?:\/\//i.test(p)) {
    const u = new URL(p);
    p = `${u.pathname}${u.search}`;
  }
  const idx = p.indexOf('/bridge/');
  return idx >= 0 ? p.slice(idx) : p;
}

export function bridgeSigningString(
  timestamp: string | number,
  method: string,
  pathWithQuery: string,
  rawBody: string | null | undefined,
): string {
  return `${timestamp}.${method.toUpperCase()}.${bridgePathWithQuery(pathWithQuery)}.${sha256Hex(rawBody || '')}`;
}

/**
 * Sign an outbound bridge request. Returns the headers to attach.
 * `now` (unix seconds) is injectable for tests.
 */
export function signBridgeRequest(
  method: string,
  pathWithQuery: string,
  rawBody: string | null | undefined,
  secret: string,
  now?: number,
): { 'X-Bridge-Timestamp': string; 'X-Bridge-Signature': string } {
  const ts = String(now ?? Math.floor(Date.now() / 1000));
  const signature = crypto
    .createHmac('sha256', secret)
    .update(bridgeSigningString(ts, method, pathWithQuery, rawBody))
    .digest('hex');
  return { 'X-Bridge-Timestamp': ts, 'X-Bridge-Signature': signature };
}

export type BridgeVerifyResult = { ok: true } | { ok: false; reason: string };

/** Minimal request shape so the verifier is unit-testable without Express. */
export interface BridgeVerifiableRequest {
  method: string;
  originalUrl?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  rawBody?: string;
}

function headerValue(h: string | string[] | undefined): string {
  if (Array.isArray(h)) return h[0] ?? '';
  return h ?? '';
}

/** Verify an inbound bridge request's timestamp + HMAC signature. */
export function verifyBridgeRequest(
  req: BridgeVerifiableRequest,
  secret: string,
  now?: number,
): BridgeVerifyResult {
  if (!secret) return { ok: false, reason: 'bridge_disabled' };
  const ts = headerValue(req.headers[BRIDGE_HEADERS.timestamp]).trim();
  const sig = headerValue(req.headers[BRIDGE_HEADERS.signature]).trim().toLowerCase();
  if (!ts || !sig) return { ok: false, reason: 'missing_signature' };
  if (!/^\d+$/.test(ts)) return { ok: false, reason: 'bad_timestamp' };

  const nowSec = now ?? Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - Number(ts)) > BRIDGE_MAX_SKEW_SECONDS) {
    return { ok: false, reason: 'stale_timestamp' };
  }
  if (!/^[0-9a-f]{64}$/.test(sig)) return { ok: false, reason: 'bad_signature' };

  const path = req.originalUrl || req.url || '';
  const expected = crypto
    .createHmac('sha256', secret)
    .update(bridgeSigningString(ts, req.method, path, req.rawBody ?? ''))
    .digest();
  const given = Buffer.from(sig, 'hex');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    return { ok: false, reason: 'bad_signature' };
  }
  return { ok: true };
}

/** Parse the optional X-Bridge-Actor header (never throws). */
export function parseBridgeActor(raw: string | string[] | undefined): BridgeActor | null {
  const v = headerValue(raw);
  if (!v) return null;
  try {
    const parsed = JSON.parse(v);
    if (!parsed || typeof parsed !== 'object') return null;
    const actor: BridgeActor = {};
    if (typeof parsed.hub_user_id === 'string') actor.hub_user_id = parsed.hub_user_id;
    if (typeof parsed.email === 'string') actor.email = parsed.email;
    return actor;
  } catch {
    return null;
  }
}

/**
 * JSON body parser for the bridge router that also keeps the exact raw body
 * string on `req.rawBody` (needed for the signature hash). Mount it BEFORE the
 * app-wide express.json() so it is the parser that runs for /bridge requests.
 */
export const bridgeJsonParser: RequestHandler = express.json({
  limit: '10mb',
  verify: (req, _res, buf) => {
    (req as Request).rawBody = buf.toString('utf8');
  },
});

/** Build the verifying middleware against a secret getter (testable). */
export function createRequireBridge(getSecret: () => string): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const secret = getSecret();
    if (!secret) {
      res.status(503).json({ success: false, error: 'Bridge is not configured' });
      return;
    }
    const result = verifyBridgeRequest(req, secret);
    if (!result.ok) {
      res.status(401).json({ success: false, error: `Bridge auth failed: ${result.reason}` });
      return;
    }
    req.bridgeActor = parseBridgeActor(req.headers[BRIDGE_HEADERS.actor]);
    next();
  };
}

/** Express middleware: 503 when SAAS_BRIDGE_SECRET is unset, 401 on bad signature. */
export const requireBridge: RequestHandler = createRequireBridge(() => config.saasBridgeSecret);
