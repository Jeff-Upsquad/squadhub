/**
 * Phase 5 — give a converted client Squad Hub access as a Client User.
 *
 * When a contact becomes a client (or an admin creates a client with a real
 * email), we either:
 *   1. Grant client_user_access to an existing active user with that email, or
 *   2. Create / refresh a pending invitation (user_type=client, Client User
 *      role) so they can sign up and land with access already wired.
 *
 * Never throws to the convert path — portal access is best-effort.
 */

import { supabaseAdmin } from '../supabase';
import { getDefaultRoleIdForUserType } from './defaultRole';

const PLACEHOLDER_EMAIL_RE = /@placeholder\.|@example\.|@test\./i;

export type EnsureClientPortalResult = {
  ok: boolean;
  skipped?: string;
  userId?: string | null;
  invitationId?: string | null;
  grantedAccess?: boolean;
  createdInvitation?: boolean;
};

async function getClientUserRoleId(): Promise<string | null> {
  // Prefer the named Client User role used by the Access UI.
  const { data: named } = await supabaseAdmin
    .from('roles')
    .select('id')
    .eq('name', 'Client User')
    .limit(1)
    .maybeSingle();
  if (named?.id) return named.id;
  return getDefaultRoleIdForUserType('client');
}

async function getClientSpaceId(clientId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('spaces')
    .select('id')
    .eq('client_id', clientId)
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle();
  return data?.id || null;
}

async function mirrorGrantToSpace(
  clientId: string,
  userId: string,
  invitedBy: string | null,
): Promise<void> {
  const spaceId = await getClientSpaceId(clientId);
  if (!spaceId) return;
  await supabaseAdmin.from('resource_memberships').upsert(
    {
      resource_type: 'space',
      resource_id: spaceId,
      user_id: userId,
      access_level: 'member',
      invited_by: invitedBy,
    },
    { onConflict: 'resource_type,resource_id,user_id' },
  );
}

/** client_user_access.created_by is NOT NULL — fall back to any active admin. */
async function resolveActorId(preferred?: string | null): Promise<string | null> {
  if (preferred) return preferred;
  const { data } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('is_admin', true)
    .eq('status', 'active')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}

/**
 * Grant Client User access on a client. Idempotent (unique on client_id+user_id).
 */
export async function grantClientUserAccess(opts: {
  clientId: string;
  userId: string;
  createdBy?: string | null;
}): Promise<boolean> {
  const roleId = await getClientUserRoleId();
  const createdBy = await resolveActorId(opts.createdBy);
  if (!createdBy) {
    console.error('[ensureClientPortalAccess] no actor for created_by');
    return false;
  }

  // Already granted?
  const { data: existing } = await supabaseAdmin
    .from('client_user_access')
    .select('id')
    .eq('client_id', opts.clientId)
    .eq('user_id', opts.userId)
    .maybeSingle();
  if (existing) {
    await mirrorGrantToSpace(opts.clientId, opts.userId, createdBy);
    return true;
  }

  const { error } = await supabaseAdmin.from('client_user_access').insert({
    client_id: opts.clientId,
    user_id: opts.userId,
    role_id: roleId,
    created_by: createdBy,
  });
  if (error) {
    if (error.code === '23505') return true;
    console.error('[ensureClientPortalAccess] grant failed:', error.message);
    return false;
  }
  await mirrorGrantToSpace(opts.clientId, opts.userId, createdBy);
  return true;
}

/**
 * Ensure the contact person for this client can log into Squad Hub as a
 * client user with Access to this client.
 */
export async function ensureClientPortalAccess(opts: {
  clientId: string;
  email: string | null | undefined;
  displayName?: string | null;
  createdBy?: string | null;
}): Promise<EnsureClientPortalResult> {
  try {
    const email = (opts.email || '').trim().toLowerCase();
    if (!email || !email.includes('@') || PLACEHOLDER_EMAIL_RE.test(email)) {
      return { ok: true, skipped: 'no_real_email' };
    }

    // 1. Existing user?
    const { data: existingUser } = await supabaseAdmin
      .from('users')
      .select('id, status, user_type')
      .ilike('email', email)
      .maybeSingle();

    if (existingUser?.id) {
      // Soft-promote user_type to client if they were pending/generic and
      // not an internal/partner account.
      if (
        existingUser.user_type !== 'internal' &&
        existingUser.user_type !== 'partner' &&
        existingUser.user_type !== 'partner_employee' &&
        existingUser.user_type !== 'client' &&
        existingUser.user_type !== 'client_staff'
      ) {
        await supabaseAdmin
          .from('users')
          .update({ user_type: 'client' })
          .eq('id', existingUser.id);
      }

      const granted = await grantClientUserAccess({
        clientId: opts.clientId,
        userId: existingUser.id,
        createdBy: opts.createdBy,
      });
      return {
        ok: true,
        userId: existingUser.id,
        grantedAccess: granted,
        createdInvitation: false,
      };
    }

    // 2. No user yet — create or refresh a pending invitation so signup
    //    auto-approves them as a client with this client_id attached.
    const roleId = await getClientUserRoleId();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days

    const { data: pending } = await supabaseAdmin
      .from('invitations')
      .select('id, client_id, role_id, user_type')
      .eq('email', email)
      .eq('status', 'pending')
      .maybeSingle();

    if (pending?.id) {
      await supabaseAdmin
        .from('invitations')
        .update({
          client_id: opts.clientId,
          user_type: 'client',
          role_id: roleId || pending.role_id,
          expires_at: expiresAt,
        })
        .eq('id', pending.id);
      return {
        ok: true,
        invitationId: pending.id,
        grantedAccess: false,
        createdInvitation: false,
      };
    }

    const invitedBy = await resolveActorId(opts.createdBy);
    const { data: invitation, error: invErr } = await supabaseAdmin
      .from('invitations')
      .insert({
        email,
        role_id: roleId,
        invited_by: invitedBy,
        status: 'pending',
        expires_at: expiresAt,
        user_type: 'client',
        client_id: opts.clientId,
      })
      .select('id')
      .single();

    if (invErr || !invitation) {
      console.error('[ensureClientPortalAccess] invite create failed:', invErr?.message);
      return { ok: false, skipped: invErr?.message || 'invite_failed' };
    }

    return {
      ok: true,
      invitationId: invitation.id,
      grantedAccess: false,
      createdInvitation: true,
    };
  } catch (err: any) {
    console.error('[ensureClientPortalAccess] unexpected:', err?.message);
    return { ok: false, skipped: err?.message || 'error' };
  }
}
