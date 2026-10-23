import crypto from 'crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  bridgePathWithQuery,
  createRequireBridge,
  parseBridgeActor,
  sha256Hex,
  signBridgeRequest,
  verifyBridgeRequest,
} from '../utils/bridgeSign';

const SECRET = 'test-bridge-secret';
const NOW = 1_800_000_000;

function signedReq(opts: {
  method?: string;
  path?: string;
  body?: string;
  secret?: string;
  signedAt?: number;
  receivedPath?: string;
}) {
  const method = opts.method ?? 'POST';
  const path = opts.path ?? '/bridge/v1/support/tickets';
  const body = opts.body ?? '{"a":1}';
  const headers = signBridgeRequest(method, path, body, opts.secret ?? SECRET, opts.signedAt ?? NOW);
  return {
    method,
    originalUrl: opts.receivedPath ?? path,
    headers: {
      'x-bridge-timestamp': headers['X-Bridge-Timestamp'],
      'x-bridge-signature': headers['X-Bridge-Signature'],
    } as Record<string, string>,
    rawBody: body,
  };
}

describe('bridgeSign', () => {
  it('signs exactly the documented string', () => {
    const body = '{"x":true}';
    const h = signBridgeRequest('post', '/bridge/v1/time-totals', body, SECRET, NOW);
    const expected = crypto
      .createHmac('sha256', SECRET)
      .update(`${NOW}.POST./bridge/v1/time-totals.${sha256Hex(body)}`)
      .digest('hex');
    expect(h['X-Bridge-Timestamp']).toBe(String(NOW));
    expect(h['X-Bridge-Signature']).toBe(expected);
  });

  it('hashes an empty body as sha256("")', () => {
    const h = signBridgeRequest('GET', '/bridge/v1/staff/u1', undefined, SECRET, NOW);
    const expected = crypto
      .createHmac('sha256', SECRET)
      .update(`${NOW}.GET./bridge/v1/staff/u1.${sha256Hex('')}`)
      .digest('hex');
    expect(h['X-Bridge-Signature']).toBe(expected);
  });

  it('verifies a valid request', () => {
    expect(verifyBridgeRequest(signedReq({}), SECRET, NOW)).toEqual({ ok: true });
  });

  it('includes the query string in the signature', () => {
    const req = signedReq({ method: 'GET', path: '/bridge/v1/talent/t1/payouts?month=2026-10', body: '' });
    expect(verifyBridgeRequest(req, SECRET, NOW).ok).toBe(true);
    req.originalUrl = '/bridge/v1/talent/t1/payouts?month=2026-11';
    expect(verifyBridgeRequest(req, SECRET, NOW)).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('normalises a proxy prefix on either side to the /bridge/ suffix', () => {
    expect(bridgePathWithQuery('https://app.squadhub.in/api/bridge/v1/accounts?x=1')).toBe('/bridge/v1/accounts?x=1');
    const req = signedReq({ path: 'https://saas.example/api/bridge/v1/accounts', receivedPath: '/bridge/v1/accounts' });
    expect(verifyBridgeRequest(req, SECRET, NOW).ok).toBe(true);
  });

  it('rejects a tampered body', () => {
    const req = signedReq({});
    req.rawBody = '{"a":2}';
    expect(verifyBridgeRequest(req, SECRET, NOW)).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('rejects a different method', () => {
    const req = signedReq({});
    req.method = 'PUT';
    expect(verifyBridgeRequest(req, SECRET, NOW).ok).toBe(false);
  });

  it('rejects a wrong secret', () => {
    const req = signedReq({ secret: 'other' });
    expect(verifyBridgeRequest(req, SECRET, NOW)).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('rejects timestamps outside the 300s window (both directions)', () => {
    expect(verifyBridgeRequest(signedReq({ signedAt: NOW - 301 }), SECRET, NOW)).toEqual({
      ok: false,
      reason: 'stale_timestamp',
    });
    expect(verifyBridgeRequest(signedReq({ signedAt: NOW + 301 }), SECRET, NOW).ok).toBe(false);
    expect(verifyBridgeRequest(signedReq({ signedAt: NOW - 300 }), SECRET, NOW).ok).toBe(true);
  });

  it('rejects missing / malformed headers', () => {
    const req = signedReq({});
    expect(verifyBridgeRequest({ ...req, headers: {} }, SECRET, NOW)).toEqual({ ok: false, reason: 'missing_signature' });
    expect(
      verifyBridgeRequest({ ...req, headers: { ...req.headers, 'x-bridge-signature': 'zz' } }, SECRET, NOW),
    ).toEqual({ ok: false, reason: 'bad_signature' });
    expect(
      verifyBridgeRequest({ ...req, headers: { ...req.headers, 'x-bridge-timestamp': 'abc' } }, SECRET, NOW),
    ).toEqual({ ok: false, reason: 'bad_timestamp' });
  });

  it('treats an empty secret as disabled', () => {
    expect(verifyBridgeRequest(signedReq({}), '', NOW)).toEqual({ ok: false, reason: 'bridge_disabled' });
  });

  it('parses the actor header defensively', () => {
    expect(parseBridgeActor('{"hub_user_id":"u1","email":"a@b.c","x":1}')).toEqual({ hub_user_id: 'u1', email: 'a@b.c' });
    expect(parseBridgeActor('not json')).toBeNull();
    expect(parseBridgeActor(undefined)).toBeNull();
  });

  describe('requireBridge middleware', () => {
    function mockRes() {
      const res: any = {};
      res.status = vi.fn(() => res);
      res.json = vi.fn(() => res);
      return res;
    }

    it('returns 503 when the secret is unset', () => {
      const mw = createRequireBridge(() => '');
      const res = mockRes();
      const next = vi.fn();
      mw(signedReq({}) as any, res, next);
      expect(res.status).toHaveBeenCalledWith(503);
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 401 on a bad signature', () => {
      const mw = createRequireBridge(() => SECRET);
      const res = mockRes();
      const next = vi.fn();
      mw(signedReq({ secret: 'nope', signedAt: Math.floor(Date.now() / 1000) }) as any, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('calls next and attaches the actor on a valid signature', () => {
      const mw = createRequireBridge(() => SECRET);
      const res = mockRes();
      const next = vi.fn();
      const req: any = signedReq({ signedAt: Math.floor(Date.now() / 1000) });
      req.headers['x-bridge-actor'] = '{"hub_user_id":"admin-1"}';
      mw(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(req.bridgeActor).toEqual({ hub_user_id: 'admin-1' });
    });
  });
});
