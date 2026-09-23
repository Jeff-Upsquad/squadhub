/**
 * Pre-work sign-in for SquadHire talents.
 *
 * Until now a talent only got a SquadHub account when they were assigned their
 * first card: SquadHire minted an SSO code (squadhireTalentSso) or the
 * assignment callback provisioned them. Discover changed the order — a talent
 * needs to be *in* the Partner app to find and accept their first opportunity.
 *
 * So the Partner app's own login form now accepts a talent who has no SquadHub
 * account at all: they type the same email and password they use in SquadHire,
 * we ask SquadHire whether those really are their credentials, and if so we
 * create the partner account with that same password and let the sign-in
 * proceed. The account starts with Work locked (users.work_unlocked_at IS NULL)
 * — Discover only — and unlocks when their first card is assigned.
 *
 * Safety properties (the same ones seedSquadhireClientLogin relies on):
 *   • Only ever runs after a password sign-in has ALREADY failed, so it can't
 *     shadow or weaken normal authentication.
 *   • Never touches an email that already has a SquadHub account — that case is
 *     handled ahead of this, and a failed login there is simply a wrong
 *     password.
 *   • SquadHire is the sole authority on the password. A wrong password, an
 *     unknown email and an unreachable SquadHire are indistinguishable here, so
 *     an outage can never become an auth bypass and nothing can be used to
 *     probe which emails exist.
 *   • The typed password goes straight to Supabase Auth (which stores a hash)
 *     and is never logged or persisted here. It's a seed, not a sync: changing
 *     it later on either side doesn't affect the other.
 *   • Verification is throttled per email, because this is the one path where a
 *     failed SquadHub login makes an outbound credential check against
 *     SquadHire.
 */

import { supabaseAdmin } from '../supabase';
import { verifySquadhireTalentCredentials } from './squadhireCredentials';
import { ensurePartnerWorkspaceMembership } from './squadhireTalentSession';

/** Verify attempts allowed per email per window. */
const VERIFY_MAX = 8;
const VERIFY_WINDOW_MS = 15 * 60 * 1000;
const verifyBuckets = new Map<string, { count: number; resetAt: number }>();

function verifyBudgetSpent(email: string): boolean {
  const now = Date.now();
  if (verifyBuckets.size > 5_000) {
    for (const [k, v] of verifyBuckets) if (v.resetAt <= now) verifyBuckets.delete(k);
  }
  const bucket = verifyBuckets.get(email);
  if (!bucket || bucket.resetAt <= now) {
    verifyBuckets.set(email, { count: 1, resetAt: now + VERIFY_WINDOW_MS });
    return false;
  }
  bucket.count += 1;
  return bucket.count > VERIFY_MAX;
}

/**
 * @returns true when the caller should retry signInWithPassword — the account
 *          now exists with the password that was typed. The retry is what
 *          authenticates, so a true here never grants access on its own.
 */
export async function provisionPreWorkTalentPartner(input: {
  email: string;
  password: string;
}): Promise<boolean> {
  const email = (input.email || '').trim().toLowerCase();
  if (!email || !input.password) return false;

  if (verifyBudgetSpent(email)) {
    console.warn('[talent-self-signin] verification throttled for this email');
    return false;
  }

  const identity = await verifySquadhireTalentCredentials({ email, password: input.password });
  if (!identity) return false;

  const displayName = identity.name || email.split('@')[0];
  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password: input.password,
    email_confirm: true,
    user_metadata: { display_name: displayName },
  });

  if (authError || !authData?.user) {
    // Two cases end up here, and both are safe to answer with a plain retry:
    // a concurrent login that created the account a moment ago (the retry signs
    // them in), and a legacy auth record with no users row, whose password we
    // deliberately do NOT rewrite (the retry then fails as an ordinary wrong
    // password, and the assignment/SSO repair path owns repairing that account).
    const alreadyExists = /already|registered|exists/i.test(authError?.message || '');
    if (!alreadyExists) console.error('[talent-self-signin] createUser failed:', authError?.message);
    return alreadyExists;
  }

  const userId = authData.user.id;
  // work_unlocked_at stays NULL: Discover now, Work when they're assigned.
  const { error: dbError } = await supabaseAdmin.from('users').insert({
    id: userId,
    email,
    display_name: displayName,
    status: 'active',
    user_type: 'partner',
    phone: identity.phone,
    work_unlocked_at: null,
  });
  if (dbError) {
    console.error('[talent-self-signin] user row insert failed:', dbError.message);
    // Undo only what this attempt created, so a retry can start clean.
    await supabaseAdmin.auth.admin.deleteUser(userId).catch(() => undefined);
    return false;
  }

  // Without a workspace membership the app has no workspace to sit in at all.
  // They get the default partner role and no resource memberships, so every
  // work surface is empty until an assignment grants them one.
  try {
    await ensurePartnerWorkspaceMembership(userId, null);
  } catch (err: any) {
    console.error('[talent-self-signin] workspace membership failed:', err?.message);
  }

  console.log(`[talent-self-signin] provisioned pre-work partner account for ${email}`);
  return true;
}
