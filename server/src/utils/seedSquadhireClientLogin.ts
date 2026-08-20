/**
 * First-login credential seeding for SquadHire business users.
 *
 * When a card is assigned, SquadHub already creates a pending `client`
 * invitation for the business's email (see ensureClientPortalAccess). Normally
 * that invitation is consumed by /auth/register, where the user picks a new
 * password. Business users shouldn't have to: they're told to sign in with the
 * same credentials they use in SquadHire.
 *
 * So when a login fails and the email has a pending client invitation but no
 * SquadHub account yet, we ask SquadHire to verify the typed password. If it
 * checks out, we create the SquadHub account with that same password and run
 * the normal invitation wiring — then the caller retries the sign-in, which is
 * what actually authenticates them.
 *
 * This is a one-time seed, not a sync: afterwards the SquadHub account is
 * ordinary and independent, and a password change on either side does not
 * affect the other.
 *
 * Safety properties:
 *   • Only ever runs when the password sign-in has ALREADY failed, so it can't
 *     shadow or weaken normal authentication.
 *   • Only for emails with a pending, unexpired client invitation — i.e. someone
 *     SquadHub already decided to give access to.
 *   • Never creates an account for an email that already has a SquadHub user;
 *     for them a failed login is simply a wrong password. The one exception is
 *     an account provisioned over SSO (see squadhireBusinessSession), which has
 *     a random password nobody has ever been told — it carries
 *     `squadhire_password_pending` and is allowed to adopt the SquadHire
 *     password on the same terms, so arriving via the auto-login link first
 *     doesn't lock the business out of typing their credentials later.
 *   • The seeded password is never persisted or logged here — it goes straight
 *     to Supabase Auth, which stores only a hash.
 */

import { supabaseAdmin } from '../supabase';
import { verifySquadhireBusinessCredentials } from './squadhireCredentials';
import {
  applyAcceptedInvitation,
  INVITATION_COLUMNS,
  type PendingInvitation,
} from './applyInvitation';
import type { UserType } from '@squadhub/shared';

/** User types eligible for credential seeding — business/client logins only. */
const SEEDABLE_USER_TYPES = new Set(['client', 'client_staff']);

/**
 * @returns true when the caller should retry signInWithPassword — either we
 *          just created the account, or a concurrent request did. The retry is
 *          what verifies the password, so a true here never grants access on
 *          its own.
 */
export async function seedSquadhireClientLogin(input: {
  email: string;
  password: string;
}): Promise<boolean> {
  const email = (input.email || '').trim().toLowerCase();
  if (!email || !input.password) return false;

  try {
    // 0. An account that came in over the auto-login link has a random password
    //    nobody was ever given. If this email is one of those, the business is
    //    typing their SquadHire password here for the first time — verify it
    //    with SquadHire and adopt it, then let the caller retry.
    const { data: existingUser } = await supabaseAdmin
      .from('users')
      .select('id, user_type')
      .ilike('email', email)
      .maybeSingle();

    if (existingUser?.id) {
      return await adoptSquadhirePassword({
        userId: existingUser.id as string,
        userType: (existingUser.user_type as string) || '',
        email,
        password: input.password,
      });
    }

    // 1. Must have a pending, unexpired client invitation.
    const { data: invitation } = await supabaseAdmin
      .from('invitations')
      .select(INVITATION_COLUMNS)
      .eq('email', email)
      .eq('status', 'pending')
      .maybeSingle<PendingInvitation & { expires_at: string }>();

    if (!invitation) return false;

    const userType = (invitation.user_type || 'client') as UserType;
    if (!SEEDABLE_USER_TYPES.has(userType)) return false;

    // Client invitations raised at card assignment are allowed to be expired.
    // ensureClientPortalAccess stamps a 30-day expiry, but the SquadHub tab that
    // sends the business here appears the moment a card is assigned and never
    // goes away — so a business that takes two months to come across is
    // otherwise locked out of an engagement it is actively paying for. The
    // 30-day window guards stale *staff* invites, where the invitation is the
    // whole entitlement; here the entitlement is the assigned card, and the
    // caller must still prove the SquadHire password for this exact email.
    // Invitations with no client_id aren't engagement-backed, so they still expire.
    if (new Date(invitation.expires_at) <= new Date() && !invitation.client_id) {
      return false;
    }

    // 2. Ask SquadHire whether these really are their credentials.
    const identity = await verifySquadhireBusinessCredentials({
      email,
      password: input.password,
    });
    if (!identity) return false;

    // 3. Create the SquadHub auth user with the same password.
    const displayName = identity.name || identity.company_name || email.split('@')[0];
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: input.password,
      email_confirm: true,
      user_metadata: { display_name: displayName },
    });

    if (authError || !authData?.user) {
      // Another request may have created it a moment ago; letting the caller
      // retry the sign-in resolves that safely (and fails closed otherwise).
      const alreadyExists = /already|registered|exists/i.test(authError?.message || '');
      if (!alreadyExists) {
        console.error('[seed-squadhire-login] createUser failed:', authError?.message);
      }
      return alreadyExists;
    }

    // 4. Profile row. Active immediately — the invitation is the approval.
    const { error: dbError } = await supabaseAdmin.from('users').insert({
      id: authData.user.id,
      email,
      display_name: displayName,
      status: 'active',
      user_type: userType,
      phone: identity.phone,
    });
    if (dbError) {
      console.error('[seed-squadhire-login] user row insert failed:', dbError.message);
    }

    // 5. Same wiring an invited signup gets (workspace, role, client access).
    await applyAcceptedInvitation({
      userId: authData.user.id,
      userType,
      invitation,
    });

    console.log(`[seed-squadhire-login] provisioned SquadHub account for ${email}`);
    return true;
  } catch (err: any) {
    console.error('[seed-squadhire-login] unexpected:', err?.message);
    return false;
  }
}

/**
 * Adopt the SquadHire password for an account that was provisioned over the
 * auto-login link and has never had a password of its own.
 *
 * Same bar as seeding a brand-new account: the account must be a client-side
 * one, must still be flagged `squadhire_password_pending`, and SquadHire must
 * confirm the typed password belongs to this exact email. Any other existing
 * account gets a plain false — a failed login there is simply a wrong password.
 */
async function adoptSquadhirePassword(input: {
  userId: string;
  userType: string;
  email: string;
  password: string;
}): Promise<boolean> {
  if (!SEEDABLE_USER_TYPES.has(input.userType)) return false;

  const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(input.userId);
  const metadata = authUser?.user?.user_metadata ?? {};
  if (metadata.squadhire_password_pending !== true) return false;

  const identity = await verifySquadhireBusinessCredentials({
    email: input.email,
    password: input.password,
  });
  if (!identity) return false;

  const { error } = await supabaseAdmin.auth.admin.updateUserById(input.userId, {
    password: input.password,
    user_metadata: { ...metadata, squadhire_password_pending: false },
  });
  if (error) {
    console.error('[seed-squadhire-login] password adoption failed:', error.message);
    return false;
  }

  console.log(`[seed-squadhire-login] adopted SquadHire password for ${input.email}`);
  return true;
}
