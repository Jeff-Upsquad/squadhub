import { config } from '../config';

/** Authenticated, user-scoped operations; never send the service key here. */
export async function localIdentityRequest(
  authorization: string,
  method: 'PUT' | 'POST',
  endpoint: 'user' | 'logout',
  body: Record<string, unknown>,
): Promise<void> {
  const response = await fetch(`${config.supabaseUrl}/auth/v1/${endpoint}`, {
    method,
    headers: { authorization, apikey: config.supabaseAnonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  // Expired/revoked tokens are already logged out. Never mask a server failure.
  if (endpoint === 'logout' && response.status === 401) return;
  if (!response.ok) throw new Error('Local identity operation failed');
}

export async function redeemLocalInvitation(tokenHash: string): Promise<string> {
  if (!/^[a-f0-9]{64}$/.test(tokenHash)) throw new Error('Invalid invitation');
  const query = new URLSearchParams({ token_hash: tokenHash, type: 'invite' });
  const response = await fetch(`${config.supabaseUrl}/auth/v1/verify?${query}`, {
    redirect: 'manual', signal: AbortSignal.timeout(10_000),
  });
  const location = response.headers.get('location');
  if (response.status !== 303 || !location) throw new Error('Invitation expired or unavailable');
  return location;
}
