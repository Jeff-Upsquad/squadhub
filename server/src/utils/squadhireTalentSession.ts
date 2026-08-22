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
import { getDefaultRoleIdForUserType } from './defaultRole';
import type { SquadhireTalentSsoIdentity } from './squadhireTalentSso';

/** The only account types a SquadHire talent may sign in as. */
const PARTNER_USER_TYPES = new Set(['partner', 'partner_employee']);

/**
 * SquadHire card category → SquadHub role. The combined "Designer + Editor"
 * role is created by migration 185; the rest predate this flow.
 */
const ROLE_BY_CATEGORY: Record<string, string> = {
  designer: 'Designer',
  'video-editor': 'Video Editor',
  'designer-editor': 'Designer + Editor',
  accountant: 'Accountant',
  sales: 'Sales',
};

/** Resolve the role for a card category, falling back to the partner default. */
async function resolveRoleId(categorySlug: string | null): Promise<string | null> {
  const roleName = categorySlug ? ROLE_BY_CATEGORY[categorySlug] : undefined;
  if (roleName) {
    const { data } = await supabaseAdmin
      .from('roles')
      .select('id')
      .eq('name', roleName)
      .maybeSingle();
    if (data?.id) return data.id;
    // A renamed or missing role shouldn't block someone from signing in.
    console.error(`[squadhire-talent-sso] role "${roleName}" not found — using partner default`);
  }
  return getDefaultRoleIdForUserType('partner');
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

  if (authError || !authData?.user) {
    console.error('[squadhire-talent-sso] createUser failed:', authError?.message);
    throw new SquadhireSsoError(500, 'Could not set up your SquadHub account. Please try again.');
  }

  const userId = authData.user.id;

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
  }

  // Workspace membership with the craft role — without this they sign in to an
  // empty app. Same wiring applyAcceptedInvitation does for invited signups.
  const { data: workspace } = await supabaseAdmin
    .from('workspaces')
    .select('id')
    .limit(1)
    .single();

  if (workspace) {
    const roleId = await resolveRoleId(identity.category_slug);
    const { error: memberError } = await supabaseAdmin.from('workspace_members').insert({
      workspace_id: workspace.id,
      user_id: userId,
      role: 'member',
      role_id: roleId,
    });
    if (memberError) {
      console.error('[squadhire-talent-sso] workspace member insert failed:', memberError.message);
    }
  }

  console.log(
    `[squadhire-talent-sso] provisioned partner account for ${identity.email} (${identity.category_slug ?? 'no category'})`,
  );
  return userId;
}

export async function startSquadhireTalentSession(
  identity: SquadhireTalentSsoIdentity,
): Promise<SquadhireSsoSession> {
  const { data: existing } = await supabaseAdmin
    .from('users')
    .select('*')
    .ilike('email', identity.email)
    .maybeSingle();

  if (existing?.id) {
    // An email already spoken for by a client or internal account is never
    // opened this way — same rule the business flow applies in reverse.
    if (!PARTNER_USER_TYPES.has(existing.user_type)) {
      throw new SquadhireSsoError(
        403,
        'This email is already used by another SquadHub account. Please sign in with your password.',
      );
    }
    assertSignInAllowed(existing.status);

    const tokens = await mintSession(identity.email);
    return { user: existing, ...tokens };
  }

  const userId = await provisionPartner(identity);
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
