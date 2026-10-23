import { describe, it, expect } from 'vitest';
import { signBridgeRequest, verifyBridgeRequest, bridgeSigningPath } from '../utils/bridgeSign';

const SECRET = 'test-bridge-secret';

function req(method: string, url: string, headers: Record<string, string>, body = '') {
  return {
    method,
    originalUrl: url,
    rawBody: Buffer.from(body),
    header: (name: string) => headers[name.toLowerCase()],
  } as any;
}

describe('bridge signing', () => {
  it('strips proxy prefixes before signing', () => {
    expect(bridgeSigningPath('/api/bridge/v1/accounts?x=1')).toBe('/bridge/v1/accounts?x=1');
  });

  it('round-trips a signed request (proxy prefix on one side only)', () => {
    const body = JSON.stringify({ kind: 'talent' });
    const now = 1_800_000_000;
    const { timestamp, signature } = signBridgeRequest('POST', '/bridge/v1/accounts', body, SECRET, now);
    const r = req('POST', '/api/bridge/v1/accounts', { 'x-bridge-timestamp': timestamp, 'x-bridge-signature': signature }, body);
    expect(verifyBridgeRequest(r, SECRET, now + 10)).toEqual({ ok: true });
  });

  it('rejects tampered bodies, wrong secrets and stale timestamps', () => {
    const now = 1_800_000_000;
    const { timestamp, signature } = signBridgeRequest('POST', '/bridge/v1/accounts', '{}', SECRET, now);
    const h = { 'x-bridge-timestamp': timestamp, 'x-bridge-signature': signature };
    expect(verifyBridgeRequest(req('POST', '/bridge/v1/accounts', h, '{"a":1}'), SECRET, now).ok).toBe(false);
    expect(verifyBridgeRequest(req('POST', '/bridge/v1/accounts', h, '{}'), 'other', now).ok).toBe(false);
    expect(verifyBridgeRequest(req('POST', '/bridge/v1/accounts', h, '{}'), SECRET, now + 301).ok).toBe(false);
  });
});
