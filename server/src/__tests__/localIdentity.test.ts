import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../config', () => ({ config: { supabaseUrl: 'http://local-identity.invalid', supabaseAnonKey: 'public-key' } }));
import { localIdentityRequest, redeemLocalInvitation } from '../services/localIdentity';
afterEach(() => vi.unstubAllGlobals());
describe('user-scoped local identity calls', () => {
  it('forwards the caller credential without elevating to a service identity', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 }); vi.stubGlobal('fetch', fetch);
    await localIdentityRequest('Bearer caller', 'PUT', 'user', { password: 'new-password' });
    expect(fetch).toHaveBeenCalledWith('http://local-identity.invalid/auth/v1/user', expect.objectContaining({
      method: 'PUT', headers: { authorization: 'Bearer caller', apikey: 'public-key', 'Content-Type': 'application/json' },
    }));
  });
  it('treats an expired logout as complete but does not hide server errors', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: false, status: 401 }); vi.stubGlobal('fetch', fetch);
    await expect(localIdentityRequest('Bearer caller', 'POST', 'logout', {})).resolves.toBeUndefined();
    await expect(localIdentityRequest('Bearer caller', 'PUT', 'user', {})).rejects.toThrow();
    fetch.mockResolvedValue({ ok: false, status: 503 });
    await expect(localIdentityRequest('Bearer caller', 'POST', 'logout', {})).rejects.toThrow();
  });
  it('keeps invite redemption redirects on the server and rejects invalid tickets',async()=>{
    const fetch=vi.fn().mockResolvedValue({status:303,headers:new Headers({location:'https://crm.example/accept-invite#private-session'})});
    vi.stubGlobal('fetch',fetch);
    await expect(redeemLocalInvitation('a'.repeat(64))).resolves.toContain('/accept-invite#');
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/auth/v1/verify?'),expect.objectContaining({redirect:'manual'}));
    await expect(redeemLocalInvitation('invalid')).rejects.toThrow();
  });
});
