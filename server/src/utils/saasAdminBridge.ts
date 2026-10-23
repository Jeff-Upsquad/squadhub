/**
 * Minimal outbound client for the Squad Hub SaaS bridge (app.squadhub.in),
 * used by the super-admin "SaaS Accounts" module and the staff "Client
 * workspaces" sidebar.
 *
 * NOTE: this intentionally duplicates the signing half of the shared
 * `server/src/utils/bridgeSign.ts` / `saasBridgeClient.ts` helpers, which are
 * being written on a parallel branch. Once both land, replace
 * `signSaasBridgeRequest` / `saasBridgeRequest` here with those helpers
 * (the signature format below is the contract's, byte for byte).
 *
 * Contract (v1):
 *   X-Bridge-Timestamp: unix seconds
 *   X-Bridge-Signature: hex HMAC-SHA256(secret,
 *       `${timestamp}.${METHOD}.${pathWithQuery}.${sha256hex(rawBody || "")}`)
 *   X-Bridge-Actor (optional): JSON {"hub_user_id","email"} for audit
 *
 * Config: SAAS_API_URL + SAAS_BRIDGE_SECRET. If either is unset the bridge is
 * "not connected" and callers should answer 503 (see `saasNotConnected`).
 */
import crypto from 'crypto';
import type { Response } from 'express';

export interface SaasBridgeConfig {
  apiUrl: string;
  secret: string;
}

/** Read at call time (not import time) so tests / env reloads take effect. */
export function getSaasBridgeConfig(): SaasBridgeConfig | null {
  const apiUrl = (process.env.SAAS_API_URL || '').trim().replace(/\/+$/, '');
  const secret = (process.env.SAAS_BRIDGE_SECRET || '').trim();
  if (!apiUrl || !secret) return null;
  return { apiUrl, secret };
}

export function isSaasBridgeConfigured(): boolean {
  return getSaasBridgeConfig() !== null;
}

export function sha256Hex(input: string): string {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * Signs one bridge request per the contract. `pathWithQuery` is the exact
 * request target the receiver sees (path + `?query`, no origin).
 */
export function signSaasBridgeRequest(
  method: string,
  pathWithQuery: string,
  rawBody: string,
  secret: string,
  now: number = Math.floor(Date.now() / 1000),
): { timestamp: string; signature: string } {
  const timestamp = String(now);
  const payload = `${timestamp}.${method.toUpperCase()}.${pathWithQuery}.${sha256Hex(rawBody || '')}`;
  const signature = crypto.createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
  return { timestamp, signature };
}

export interface SaasBridgeActor {
  hub_user_id: string;
  email?: string | null;
}

export interface SaasBridgeResult {
  status: number;
  body: { success: boolean; data?: unknown; error?: string; [k: string]: unknown };
}

export class SaasNotConnectedError extends Error {
  constructor() {
    super('SaaS not connected');
    this.name = 'SaasNotConnectedError';
  }
}

const TIMEOUT_MS = 15_000;

/**
 * Calls the SaaS bridge. `path` must start with `/bridge/v1/`. Query values
 * that are undefined/empty are dropped. Never throws for HTTP errors — the
 * SaaS's `{ success:false, error }` body and status are returned as-is; network
 * failures come back as a 502 result. Throws SaasNotConnectedError when the
 * bridge isn't configured.
 */
export async function saasBridgeRequest(opts: {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  query?: Record<string, string | number | undefined | null>;
  body?: unknown;
  actor?: SaasBridgeActor | null;
}): Promise<SaasBridgeResult> {
  const cfg = getSaasBridgeConfig();
  if (!cfg) throw new SaasNotConnectedError();

  const base = new URL(cfg.apiUrl);
  // Preserve any path prefix on SAAS_API_URL (e.g. https://x/api) — the
  // receiver signs whatever path it is actually served on.
  const prefix = base.pathname.replace(/\/+$/, '');
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(opts.query || {})) {
    if (v === undefined || v === null || v === '') continue;
    qs.append(k, String(v));
  }
  const search = qs.toString();
  const pathWithQuery = `${prefix}${opts.path}${search ? `?${search}` : ''}`;

  const rawBody = opts.body === undefined || opts.method === 'GET' ? '' : JSON.stringify(opts.body);
  const { timestamp, signature } = signSaasBridgeRequest(opts.method, pathWithQuery, rawBody, cfg.secret);

  const headers: Record<string, string> = {
    'X-Bridge-Timestamp': timestamp,
    'X-Bridge-Signature': signature,
    Accept: 'application/json',
  };
  if (rawBody) headers['Content-Type'] = 'application/json';
  if (opts.actor?.hub_user_id) {
    headers['X-Bridge-Actor'] = JSON.stringify({
      hub_user_id: opts.actor.hub_user_id,
      email: opts.actor.email ?? null,
    });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(`${base.origin}${pathWithQuery}`, {
      method: opts.method,
      headers,
      body: rawBody || undefined,
      signal: controller.signal,
    });
    const text = await resp.text();
    let parsed: any = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    if (!parsed || typeof parsed !== 'object' || typeof parsed.success !== 'boolean') {
      return {
        status: resp.ok ? 502 : resp.status,
        body: { success: false, error: `SaaS returned an unexpected response (HTTP ${resp.status})` },
      };
    }
    return { status: resp.status, body: parsed };
  } catch (err: any) {
    const aborted = err?.name === 'AbortError';
    console.error('[saas-bridge] request failed', opts.method, opts.path, err?.message || err);
    return {
      status: aborted ? 504 : 502,
      body: { success: false, error: aborted ? 'SaaS did not respond in time' : 'Could not reach SaaS' },
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Uniform 503 the admin + web UIs detect via `code`. */
export function saasNotConnected(res: Response): void {
  res.status(503).json({
    success: false,
    error: 'SaaS not connected',
    code: 'saas_not_connected',
  });
}
