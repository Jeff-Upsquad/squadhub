/**
 * Start a SquadHub session for a SquadHire business user who arrived over SSO.
 *
 * SquadHire has already proven who they are (see redeemSquadhireBusinessSsoCode)
 * and only mints a code for a business with a live assigned card — the same
 * event that makes us raise their client invitation. So by the time we get
 * here, the account either exists or is one invitation away from existing.
 *
 * Two paths:
 *   • Account exists → mint a session for it. No password involved.
 *   • No account, pending client invitation → create it now with the same
 *     wiring an invited signup gets (workspace, role, client access), then mint
 *     the session. This is the passwordless twin of seedSquadhireClientLogin,
 *     which does the same provisioning when the business types their SquadHire
 *     password into our login form instead.
 *
 * Because there is no password to seed with, the account is created with a
 * random one and flagged `squadhire_password_pending`. seedSquadhireClientLogin
 * watches for that flag: the first time the business types their SquadHire
 * password into our login form, we verify it with SquadHire and adopt it, so
 * "use your SquadHire login" keeps working for anyone who came in via SSO
 * first.
 *
 * Everything is gated on user_type: SSO can only ever land on a client-side
 * account. An email that belongs to an internal or partner user is refused
 * outright — a business account on SquadHire must never be able to open someone
 * else's staff session here just because the addresses match.
 */

import { randomBytes } from 'crypto';
import { supabaseAdmin } from '../supabase';
import {
  assertSignInAllowed,
  mintSession,
  SquadhireSsoError,
  type SquadhireSsoSession,
} from './squadhireSsoShared';
import {
  applyAcceptedInvitation,
  INVITATION_COLUMNS,
  type PendingInvitation,
} from './applyInvitation';
import type { SquadhireBusinessSsoIdentity } from './squadhireBusinessSso';
import type { UserType } from '@squadhub/shared';
import { syncClientFolderMemberships } from './activatedClientSpaces';

export { SquadhireSsoError };
export type { SquadhireSsoSession };

/** The only account types a SquadHire business user may sign in as. */
const CLIENT_USER_TYPES = new Set(['client', 'client_staff']);

/** Create the SquadHub account an assigned card entitles this business to. */
async function provisionFromInvitation(
  identity: SquadhireBusinessSsoIdentity,
  invitation: PendingInvitation,
  userType: UserType,
): Promise<string> {
  const displayName =
    identity.name || identity.company_name || identity.email.split('@')[0];

  // No password to adopt yet — see the flag note in the file header.
  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email: identity.email,
    password: randomBytes(24).toString('base64url'),
    email_confirm: true,
    user_metadata: { display_name: displayName, squadhire_password_pending: true },
  });

  if (authError || !authData?.user) {
    console.error('[squadhire-sso] createUser failed:', authError?.message);
    throw new SquadhireSsoError(500, 'Could not set up your SquadHub account. Please try again.');
  }

  const { error: dbError } = await supabaseAdmin.from('users').insert({
    id: authData.user.id,
    email: identity.email,
    display_name: displayName,
    status: 'active',
    user_type: userType,
    phone: identity.phone,
  });
  if (dbError) {
    console.error('[squadhire-sso] user row insert failed:', dbError.message);
  }

  await applyAcceptedInvitation({ userId: authData.user.id, userType, invitation });
  console.log(`[squadhire-sso] provisioned SquadHub account for ${identity.email}`);

  return authData.user.id;
}

export async function startSquadhireBusinessSession(
  identity: SquadhireBusinessSsoIdentity,
): Promise<SquadhireSsoSession> {
  const { data: existing } = await supabaseAdmin
    .from('users')
    .select('*')
    .ilike('email', identity.email)
    .maybeSingle();

  if (existing?.id) {
    if (!CLIENT_USER_TYPES.has(existing.user_type)) {
      throw new SquadhireSsoError(
        403,
        'This email is already used by a SquadHub team account. Please sign in with your password.',
      );
    }
    assertSignInAllowed(existing.status);

    const { data: access } = await supabaseAdmin
      .from('client_user_access')
      .select('client_id')
      .eq('user_id', existing.id);
    await Promise.all(
      (access ?? []).map((row: any) => syncClientFolderMemberships(row.client_id, existing.id)),
    ).catch((err) => console.error('[squadhire-sso] client folder sync failed:', err));

    const tokens = await mintSession(identity.email);
    return { user: existing, ...tokens };
  }

  // No account yet — the invitation raised when their card was assigned is what
  // says they're allowed one.
  const { data: invitation } = await supabaseAdmin
    .from('invitations')
    .select(INVITATION_COLUMNS)
    .eq('email', identity.email)
    .eq('status', 'pending')
    .maybeSingle<PendingInvitation>();

  const userType = (invitation?.user_type || 'client') as UserType;
  if (!invitation || !CLIENT_USER_TYPES.has(userType)) {
    throw new SquadhireSsoError(
      403,
      "Your SquadHub workspace isn't ready yet. Please check back shortly.",
    );
  }

  const userId = await provisionFromInvitation(identity, invitation, userType);
  if (invitation.client_id) {
    await syncClientFolderMemberships(invitation.client_id, userId).catch((err) =>
      console.error('[squadhire-sso] client folder sync failed:', err),
    );
  }
  const tokens = await mintSession(identity.email);

  const { data: profile } = await supabaseAdmin
    .from('users')
    .select('*')
    .eq('id', userId)
    .maybeSingle();

  return {
    user: profile ?? { id: userId, email: identity.email },
    ...tokens,
  };
}
