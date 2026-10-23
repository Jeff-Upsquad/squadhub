/**
 * Bridge: find-or-create SaaS users for identities the Hub hands us (account
 * owners, talents, Upsquad staff). Accounts are created without a usable
 * password — owners sign in through SquadHire SSO / password reset, staff
 * through "Sign in with Squad Hub" (one-time login links).
 */
import { randomBytes } from 'crypto';
import { supabaseAdmin } from '../../supabase';
import { hub, HubRequestError, HubUnavailableError } from '../../utils/hubBridgeClient';

export type BridgeUserType = 'client' | 'partner' | 'internal';

export interface BridgeUser {
  id: string;
  email: string;
  display_name: string;
  user_type: string;
  status: string;
  hub_user_id: string | null;
}

const USER_COLUMNS = 'id, email, display_name, user_type, status, hub_user_id';

export function normalizeEmail(email: string): string {
  return String(email || '').trim().toLowerCase();
}

/** ilike with LIKE metacharacters escaped = case-insensitive equality. */
function exactILike(value: string): string {
  return value.replace(/[\\%_]/g, (m) => `\\${m}`);
}

export async function findUserByHubUserId(hubUserId: string): Promise<BridgeUser | null> {
  const { data } = await supabaseAdmin.from('users').select(USER_COLUMNS).eq('hub_user_id', hubUserId).maybeSingle();
  return (data as BridgeUser) ?? null;
}

export async function findUserByEmail(email: string): Promise<BridgeUser | null> {
  const e = normalizeEmail(email);
  if (!e) return null;
  const { data } = await supabaseAdmin.from('users').select(USER_COLUMNS).ilike('email', exactILike(e)).limit(1);
  return ((data as BridgeUser[] | null) || [])[0] ?? null;
}

export async function getUserById(userId: string): Promise<BridgeUser | null> {
  const { data } = await supabaseAdmin.from('users').select(USER_COLUMNS).eq('id', userId).maybeSingle();
  return (data as BridgeUser) ?? null;
}

/** Stamp hub_user_id on a user that has none (never overwrites, never steals). */
export async function linkHubUserId(user: BridgeUser, hubUserId: string | null | undefined): Promise<void> {
  if (!hubUserId || user.hub_user_id) return;
  const taken = await findUserByHubUserId(hubUserId);
  if (taken && taken.id !== user.id) return;
  await supabaseAdmin.from('users').update({ hub_user_id: hubUserId }).eq('id', user.id);
  user.hub_user_id = hubUserId;
}

/**
 * Find a user by hub_user_id, then by email; create one (Supabase auth user +
 * users row) when neither exists. Returns `created` so callers can audit it.
 */
export async function findOrCreateUser(input: {
  email: string;
  name?: string | null;
  phone?: string | null;
  userType: BridgeUserType;
  hubUserId?: string | null;
}): Promise<{ user: BridgeUser; created: boolean }> {
  const email = normalizeEmail(input.email);
  if (!email || !email.includes('@')) throw new Error('A valid email is required');

  const byHub = input.hubUserId ? await findUserByHubUserId(input.hubUserId) : null;
  if (byHub) return { user: byHub, created: false };

  const byEmail = await findUserByEmail(email);
  if (byEmail) {
    await linkHubUserId(byEmail, input.hubUserId);
    return { user: byEmail, created: false };
  }

  const displayName = (input.name || '').trim() || email.split('@')[0];
  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password: randomBytes(24).toString('base64url'),
    email_confirm: true,
    user_metadata: { display_name: displayName, created_via: 'hub_bridge' },
  });
  if (authError || !authData?.user) {
    throw new Error(`Could not create the user: ${authError?.message || 'unknown error'}`);
  }

  const hubIdFree = input.hubUserId ? !(await findUserByHubUserId(input.hubUserId)) : false;
  const row = {
    id: authData.user.id,
    email,
    display_name: displayName.slice(0, 50),
    status: 'active',
    user_type: input.userType,
    phone: input.phone || null,
    hub_user_id: hubIdFree ? input.hubUserId ?? null : null,
  };
  const { error: dbError } = await supabaseAdmin.from('users').insert(row);
  if (dbError) throw new Error(`Could not create the user profile: ${dbError.message}`);
  return {
    user: { id: row.id, email, display_name: row.display_name, user_type: row.user_type, status: 'active', hub_user_id: row.hub_user_id },
    created: true,
  };
}

/**
 * Link-or-create the SaaS user for an internal Upsquad staff member. Looks up
 * by hub_user_id; otherwise asks the Hub who they are (GET /bridge/v1/staff/:id)
 * and refuses inactive / non-staff users. When the Hub can't be reached,
 * `fallback` (from the signed request itself) is used.
 */
export async function linkOrCreateStaffUser(
  hubUserId: string,
  fallback: { email?: string | null; name?: string | null } = {},
): Promise<{ user: BridgeUser; created: boolean }> {
  const existing = await findUserByHubUserId(hubUserId);
  if (existing) return { user: existing, created: false };

  let email = fallback.email || null;
  let name = fallback.name || null;
  try {
    const staff = await hub.staff(hubUserId);
    if (!staff?.active) throw new StaffNotActiveError();
    email = staff.email || email;
    name = staff.name || name;
  } catch (err) {
    if (err instanceof StaffNotActiveError || err instanceof HubRequestError) throw new StaffNotActiveError();
    if (!(err instanceof HubUnavailableError)) throw err;
    // Hub unreachable: the caller's own signed payload is the best we have.
  }
  if (!email) throw new Error('Could not resolve the staff member’s email from Squad Hub');
  return findOrCreateUser({ email, name, userType: 'internal', hubUserId });
}

export class StaffNotActiveError extends Error {
  constructor() {
    super('Only active internal Squad Hub staff can sign in');
    this.name = 'StaffNotActiveError';
  }
}
