/**
 * Shared machinery for the two SquadHire → SquadHub auto-login flows.
 *
 * Businesses arrive as clients (squadhireBusinessSession) and talents arrive as
 * partners (squadhireTalentSession). The two differ in who they become and what
 * entitles them, but the session minting and the account-state rules are the
 * same, so they live here rather than being copied.
 */

import { supabase, supabaseAdmin } from '../supabase';

export class SquadhireSsoError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface SquadhireSsoSession {
  user: Record<string, unknown>;
  access_token: string;
  refresh_token: string;
}

/** Account states that block sign-in — mirrors POST /auth/login. */
const BLOCKED_STATUSES: Record<string, string> = {
  pending: 'Your account is pending admin approval.',
  rejected: 'Your account has been rejected.',
  banned: 'Your account has been banned.',
  suspended: 'Your account has been suspended.',
};

/** Throws with the same wording /auth/login uses when the account can't sign in. */
export function assertSignInAllowed(status: unknown): void {
  const blocked = BLOCKED_STATUSES[String(status)];
  if (blocked) throw new SquadhireSsoError(403, blocked);
}

/**
 * Mint a real Supabase session for an existing user without their password.
 *
 * generateLink hands back the magic-link token without sending any email; we
 * redeem it immediately ourselves. The result is an ordinary session — same
 * tokens, same expiry, same refresh path as a password sign-in.
 */
export async function mintSession(
  email: string,
): Promise<{ access_token: string; refresh_token: string }> {
  const { data: link, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
    type: 'magiclink',
    email,
  });
  const tokenHash = link?.properties?.hashed_token;
  if (linkError || !tokenHash) {
    console.error('[squadhire-sso] generateLink failed:', linkError?.message);
    throw new SquadhireSsoError(500, 'Could not start your SquadHub session. Please try again.');
  }

  const { data, error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: 'magiclink',
  });
  if (error || !data.session) {
    console.error('[squadhire-sso] verifyOtp failed:', error?.message);
    throw new SquadhireSsoError(500, 'Could not start your SquadHub session. Please try again.');
  }

  return {
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
  };
}
