/**
 * Start a SquadHub session for a SquadHire talent who arrived over SSO.
 *
 * The talent twin of squadhireBusinessSession. Businesses become clients;
 * talents become partners — they're the people doing the work on a
 * subscription card, which is what the partner side of SquadHub is for.
 *
 * The difference that matters is what says they're allowed in. A business has a
 * client invitation raised on our side at card assignment; a talent has
 * nothing here, because nothing in SquadHub has ever created an account for
 * one. SquadHire is the authority instead: it only mints a code for a talent
 * with a live assigned card, and the code is redeemed over the shared-secret
 * channel, so the hand-off carries the same weight the invitation does.
 *
 * The card's category picks their role — a designer lands as a Designer, a
 * video editor as a Video Editor, and so on. The role is set once, when the
 * account is created; later cards in other categories never silently move
 * someone out of the role their existing work sits under.
 *
 * As with the business flow, there's no password to seed with, so the account
 * is created with a random one and flagged `squadhire_password_pending` —
 * seedSquadhireClientLogin adopts their SquadHire password the first time they
 * type it into our login form.
 */

import { randomBytes } from 'crypto';
import { supabaseAdmin } from '../supabase';
import { assertSignInAllowed, mintSession, SquadhireSsoError } from './squadhireSsoShared';
import type { SquadhireSsoSession } from './squadhireSsoShared';
import type { SquadhireTalentSsoIdentity } from './squadhireTalentSso';
import { ensureAccount } from './accounts';
import { unlockPartnerWork } from './workAccess';

/** The only account types a SquadHire talent may sign in as. */
const PARTNER_USER_TYPES = new Set(['partner', 'partner_employee']);

/**
 * Ensure the talent's own SaaS account (workspace kind 'talent'). Idempotent on
 * squadhire_talent_id. Default mini apps (check-ins, partner-payments) are
 * switched on when the account is first created (see utils/accounts).
 */
export async function ensureTalentAccount(
  userId: string,
  identity: { talent_user_id?: string | null; name: string | null; email: string },
): Promise<string> {
  const { id } = await ensureAccount({
    kind: 'talent',
    name: identity.name || identity.email.split('@')[0],
    ownerUserId: userId,
    squadhire_talent_id: identity.talent_user_id ?? null,
  });
  return id;
}

/**
 * Legacy auth-only partners predate the first-login adoption marker. Add it
 * once without re-arming accounts that have already adopted a password.
 */
async function ensurePasswordAdoptionPending(userId: string): Promise<void> {
  const { data, error } = await supabaseAdmin.auth.admin.getUserById(userId);
  if (error || !data.user) {
    throw new SquadhireSsoError(500, 'Could not prepare your SquadHub login. Please try again.');
  }
  const metadata = data.user.user_metadata ?? {};
  if (Object.prototype.hasOwnProperty.call(metadata, 'squadhire_password_pending')) return;

  const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
    user_metadata: { ...metadata, squadhire_password_pending: true },
  });
  if (updateError) {
    throw new SquadhireSsoError(500, 'Could not prepare your SquadHub login. Please try again.');
  }
}

/** Create the partner account the talent's assigned card entitles them to. */
async function provisionPartner(identity: SquadhireTalentSsoIdentity): Promise<string> {
  const displayName = identity.name || identity.email.split('@')[0];

  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email: identity.email,
    password: randomBytes(24).toString('base64url'),
    email_confirm: true,
    user_metadata: { display_name: displayName, squadhire_password_pending: true },
  });

  let authUser = authData?.user ?? null;
  let createdAuthUser = Boolean(authUser);
  if (!authUser && authError) {
    // Legacy SSO attempts could leave an auth.users record without its public
    // users twin. Adopt that record so assignment retries repair the account
    // instead of failing forever on Auth's duplicate-email guard.
    const { data: listed, error: listError } = await supabaseAdmin.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });
    authUser = listed?.users.find(
      (candidate) => candidate.email?.toLowerCase() === identity.email.toLowerCase(),
    ) ?? null;
    createdAuthUser = false;
    if (listError || !authUser) {
      console.error('[squadhire-talent-sso] createUser failed:', authError.message);
      throw new SquadhireSsoError(500, 'Could not set up your SquadHub account. Please try again.');
    }
  }

  if (!authUser) {
    throw new SquadhireSsoError(500, 'Could not set up your SquadHub account. Please try again.');
  }
  const userId = authUser.id;
  if (!createdAuthUser) {
    await ensurePasswordAdoptionPending(userId);
  }

  const { error: dbError } = await supabaseAdmin.from('users').insert({
    id: userId,
    email: identity.email,
    display_name: displayName,
    status: 'active',
    user_type: 'partner',
    phone: identity.phone,
  });
  if (dbError) {
    console.error('[squadhire-talent-sso] user row insert failed:', dbError.message);
    // Only undo auth state created by this attempt. A pre-existing auth-only
    // user may own sessions or credentials and must never be deleted.
    if (createdAuthUser) {
      await supabaseAdmin.auth.admin.deleteUser(userId).catch(() => undefined);
    }
    throw new SquadhireSsoError(500, 'Could not set up your SquadHub account. Please try again.');
  }

  // Their own talent account — without this they sign in to an empty app.
  await ensureTalentAccount(userId, identity);

  console.log(
    `[squadhire-talent-sso] provisioned partner account for ${identity.email} (${identity.category_slug ?? 'no category'})`,
  );
  return userId;
}

export interface SquadhireTalentProvisionResult {
  user: Record<string, unknown>;
  created: boolean;
}

/**
 * Idempotently create or repair the partner account an assigned talent needs.
 * Assignment-time callers use strict access sync so webhook retries repair any
 * client-space failure; interactive SSO keeps the historic best-effort sync so
 * an unrelated space configuration problem never blocks sign-in.
 */
export async function ensureSquadhireTalentProvisioned(
  identity: SquadhireTalentSsoIdentity,
  options: { strictAccessSync?: boolean } = {},
): Promise<SquadhireTalentProvisionResult> {
  const { data: existing, error: existingError } = await supabaseAdmin
    .from('users')
    .select('*')
    .ilike('email', identity.email)
    .maybeSingle();
  if (existingError) {
    throw new SquadhireSsoError(500, 'Could not check your SquadHub account. Please try again.');
  }

  let user: Record<string, unknown>;
  let created = false;
  if (existing?.id) {
    if (!PARTNER_USER_TYPES.has(existing.user_type)) {
      throw new SquadhireSsoError(
        403,
        'This email is already used by another SquadHub account. Please sign in with your password.',
      );
    }
    assertSignInAllowed(existing.status);
    await ensurePasswordAdoptionPending(existing.id);
    await ensureTalentAccount(existing.id, identity);
    user = existing;
  } else {
    const userId = await provisionPartner(identity);
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('id', userId)
      .maybeSingle();
    if (profileError || !profile) {
      throw new SquadhireSsoError(500, 'Could not finish setting up your SquadHub account.');
    }
    user = profile;
    created = true;
  }

  // Both callers of this function are entitlement-backed — the assignment
  // callback checks the local card, and SquadHire only mints an SSO code for a
  // talent with a live assigned card — so arriving here IS the first work that
  // opens the Work surface for a talent who signed in to Discover beforehand.
  await unlockPartnerWork(String(user.id), 'squadhire assignment');
  (user as Record<string, unknown>).work_unlocked_at =
    (user.work_unlocked_at as string | null) || new Date().toISOString();

  // Shared (client ⇄ talent) workspaces are created by the Hub over the
  // bridge (POST /bridge/v1/shared-workspaces/ensure), not here.
  void options;

  return { user, created };
}

export async function startSquadhireTalentSession(
  identity: SquadhireTalentSsoIdentity,
): Promise<SquadhireSsoSession> {
  const provisioned = await ensureSquadhireTalentProvisioned(identity);
  const tokens = await mintSession(identity.email);
  return { user: provisioned.user, ...tokens };
}
