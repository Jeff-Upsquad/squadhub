/**
 * One-time login links (super-admin "Log in as" and staff "Sign in with Squad
 * Hub"). The raw token only lives in the URL; `login_tokens` keeps its SHA-256.
 * A link is valid for 10 minutes and works exactly once: redemption is a single
 * conditional UPDATE (used_at IS NULL AND expires_at > now()), so two
 * concurrent clicks can't both win.
 */
import { createHash, randomBytes } from 'crypto';
import { config } from '../../config';
import { supabaseAdmin } from '../../supabase';
import { mintSession } from '../../utils/squadhireSsoShared';
import { BridgeError } from './errors';

export const LOGIN_TOKEN_TTL_MS = 10 * 60 * 1000;

export type LoginPurpose = 'impersonate' | 'staff_sso';

export function hashLoginToken(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

/** The public URL that redeems a token (the web origin proxies /auth/* to the API). */
export function oneTimeLoginUrl(raw: string): string {
  return `${config.webAppUrl.replace(/\/+$/, '')}/auth/one-time?token=${encodeURIComponent(raw)}`;
}

export async function createLoginToken(input: {
  userId: string;
  purpose: LoginPurpose;
  workspaceId?: string | null;
  actorHubUserId?: string | null;
  actorEmail?: string | null;
  reason?: string | null;
  now?: number;
}): Promise<{ token: string; url: string; expires_at: string }> {
  const raw = randomBytes(32).toString('base64url');
  const expiresAt = new Date((input.now ?? Date.now()) + LOGIN_TOKEN_TTL_MS).toISOString();
  const { error } = await supabaseAdmin.from('login_tokens').insert({
    token_hash: hashLoginToken(raw),
    user_id: input.userId,
    purpose: input.purpose,
    workspace_id: input.workspaceId ?? null,
    actor_hub_user_id: input.actorHubUserId ?? null,
    actor_email: input.actorEmail ?? null,
    reason: input.reason ?? null,
    expires_at: expiresAt,
  });
  if (error) throw new Error(`Could not create the login link: ${error.message}`);
  return { token: raw, url: oneTimeLoginUrl(raw), expires_at: expiresAt };
}

export interface RedeemedLogin {
  user_id: string;
  purpose: LoginPurpose;
  workspace_id: string | null;
  access_token: string;
  refresh_token: string;
}

/** Claim the token (single use, unexpired). Returns the token row or null. */
export async function claimLoginToken(raw: string, now: number = Date.now()): Promise<any | null> {
  if (!raw || raw.length < 20 || raw.length > 200) return null;
  const nowIso = new Date(now).toISOString();
  const { data } = await supabaseAdmin
    .from('login_tokens')
    .update({ used_at: nowIso })
    .eq('token_hash', hashLoginToken(raw))
    .is('used_at', null)
    .gt('expires_at', nowIso)
    .select('id, user_id, purpose, workspace_id')
    .maybeSingle();
  return data ?? null;
}

/** Supabase access tokens carry the auth session id; refreshes keep it. */
export function sessionIdOf(accessToken: string): string | null {
  try {
    const payload = JSON.parse(Buffer.from(accessToken.split('.')[1] || '', 'base64url').toString('utf8'));
    return typeof payload?.session_id === 'string' ? payload.session_id : null;
  } catch {
    return null;
  }
}

/** Exchange a one-time token for a real Supabase session. */
export async function redeemLoginToken(raw: string): Promise<RedeemedLogin> {
  const row = await claimLoginToken(raw);
  if (!row) throw new BridgeError(401, 'This sign-in link has expired or was already used.');

  const { data: user } = await supabaseAdmin
    .from('users')
    .select('id, email, status')
    .eq('id', row.user_id)
    .maybeSingle();
  if (!user?.email) throw new BridgeError(404, 'This account no longer exists.');
  if (['banned', 'suspended', 'rejected'].includes(String(user.status))) {
    throw new BridgeError(403, 'This account cannot sign in.');
  }

  const session = await mintSession(user.email as string);
  const sessionId = sessionIdOf(session.access_token);
  if (sessionId) await supabaseAdmin.from('login_tokens').update({ session_id: sessionId }).eq('id', row.id);

  return {
    user_id: row.user_id,
    purpose: row.purpose,
    workspace_id: row.workspace_id ?? null,
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  };
}

/** The impersonation behind an access token's session, if any. */
export async function impersonationForAccessToken(accessToken: string): Promise<{
  actor_email: string | null;
  actor_hub_user_id: string | null;
  reason: string | null;
  started_at: string | null;
} | null> {
  const sessionId = sessionIdOf(accessToken);
  if (!sessionId) return null;
  const { data } = await supabaseAdmin
    .from('login_tokens')
    .select('actor_email, actor_hub_user_id, reason, used_at')
    .eq('session_id', sessionId)
    .eq('purpose', 'impersonate')
    .limit(1);
  const row = ((data as any[]) || [])[0];
  if (!row) return null;
  return {
    actor_email: row.actor_email ?? null,
    actor_hub_user_id: row.actor_hub_user_id ?? null,
    reason: row.reason ?? null,
    started_at: row.used_at ?? null,
  };
}
