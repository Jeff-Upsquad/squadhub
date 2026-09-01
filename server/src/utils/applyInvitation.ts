/**
 * Everything that happens once a pending invitation is accepted: mark it
 * accepted, put the user in the workspace with the invited role, share the
 * default check-in mini app, apply CRM access, and wire up client links.
 *
 * Extracted from POST /auth/register so the same wiring runs when a SquadHire
 * business user is provisioned just-in-time on their first SquadHub login
 * (see POST /auth/login) — the two paths must land users in exactly the same
 * state, or a seeded account would be missing its workspace membership or
 * client access.
 *
 * Best-effort by design: individual steps log and continue rather than throw,
 * since the auth user already exists by the time this runs.
 */

import { supabaseAdmin } from '../supabase';
import { getDefaultRoleIdForUserType } from './defaultRole';
import { grantClientUserAccess } from './ensureClientPortalAccess';
import type { UserType } from '@squadhub/shared';
import { getRoleSystemKey } from './platformRoles';

export interface PendingInvitation {
  id: string;
  role_id: string | null;
  user_type: string | null;
  client_id: string | null;
  invited_by: string | null;
  crm_access: unknown;
}

/** Columns applyAcceptedInvitation needs — keep callers' selects in sync. */
export const INVITATION_COLUMNS =
  'id, role_id, user_type, client_id, expires_at, invited_by, crm_access';

export async function applyAcceptedInvitation(opts: {
  userId: string;
  userType: UserType;
  invitation: PendingInvitation;
}): Promise<void> {
  const { userId, userType, invitation } = opts;

  // Mark invitation as accepted
  await supabaseAdmin
    .from('invitations')
    .update({ status: 'accepted', accepted_at: new Date().toISOString() })
    .eq('id', invitation.id);

  // Add user to workspace with assigned role
  const { data: workspace } = await supabaseAdmin
    .from('workspaces')
    .select('id')
    .limit(1)
    .single();

  if (workspace) {
    let roleId = invitation.role_id;
    if (!roleId) {
      roleId = await getDefaultRoleIdForUserType(userType);
    }

    let selectedSystemKey = await getRoleSystemKey(roleId);

    // Invitations created before the hierarchy migration may not have gone
    // through today's validation. Never let one attach an Internal-only role
    // to an external account when it is eventually accepted.
    if (userType !== 'internal' && (selectedSystemKey === 'admin' || selectedSystemKey === 'manager')) {
      console.warn(
        `Replacing legacy ${selectedSystemKey} invitation role for external user ${userId}`,
      );
      roleId = await getDefaultRoleIdForUserType(userType);
      selectedSystemKey = await getRoleSystemKey(roleId);
    }

    let canCreateMembership = true;
    if (selectedSystemKey === 'admin') {
      const { error: adminError } = await supabaseAdmin
        .from('users')
        .update({ is_admin: true })
        .eq('id', userId);
      if (adminError) {
        console.error('Failed to grant invited Admin access:', adminError);
        canCreateMembership = false;
      }
    }

    if (canCreateMembership) {
      const { error: memberError } = await supabaseAdmin.from('workspace_members').insert({
        workspace_id: workspace.id,
        user_id: userId,
        role: selectedSystemKey === 'admin' ? 'admin' : 'member',
        role_id: roleId,
      });
      if (memberError) {
        console.error('Failed to add invited user to workspace:', memberError);
        if (selectedSystemKey === 'admin') {
          await supabaseAdmin.from('users').update({ is_admin: false }).eq('id', userId);
        }
      }
    }
  }

  // Share the daily check-in mini app by default, picking the variant that
  // matches the user's type. Teammates app for internal users and partner
  // employees; partners app for partner users. Clients and client staff
  // don't get a default check-in app.
  const defaultMiniAppSlug =
    userType === 'internal' || userType === 'partner_employee'
      ? 'daily-checkin'
      : userType === 'partner'
        ? 'daily-checkin-partners'
        : null;

  if (defaultMiniAppSlug) {
    const { data: miniApp } = await supabaseAdmin
      .from('mini_apps')
      .select('id')
      .eq('slug', defaultMiniAppSlug)
      .maybeSingle();

    if (miniApp) {
      const { error: shareError } = await supabaseAdmin
        .from('mini_app_user_access')
        .upsert(
          { mini_app_id: miniApp.id, user_id: userId },
          { onConflict: 'mini_app_id,user_id', ignoreDuplicates: true },
        );
      if (shareError) {
        console.error('Failed to share default daily check-in mini app:', shareError);
      }
    }
  }

  // Apply CRM access from the invitation (set in the admin CRM-access UI).
  if (invitation.crm_access) {
    const crm = invitation.crm_access as {
      app?: string;
      workspace_id?: string;
      role?: string;
      modules?: Record<string, string>;
    };
    if (crm.workspace_id && crm.role) {
      const crmApp = crm.app || 'squadcrm';
      await supabaseAdmin.from('crm_app_access').upsert(
        {
          user_id: userId,
          workspace_id: crm.workspace_id,
          app: crmApp,
          role: crm.role,
          enabled: true,
          granted_by: invitation.invited_by,
        },
        { onConflict: 'user_id,workspace_id,app' },
      );
      const moduleRows = Object.entries(crm.modules || {}).map(([module, level]) => ({
        user_id: userId,
        workspace_id: crm.workspace_id,
        app: crmApp,
        module,
        level,
        granted_by: invitation.invited_by,
      }));
      if (moduleRows.length > 0) {
        await supabaseAdmin
          .from('crm_module_access')
          .upsert(moduleRows, { onConflict: 'user_id,workspace_id,app,module' });
      }
    }
  }

  // If invitation links to a client, create the partner-client assignment
  if (
    invitation.client_id &&
    (userType === 'partner' ||
      userType === 'partner_employee' ||
      userType === 'client' ||
      userType === 'client_staff')
  ) {
    await supabaseAdmin.from('partner_client_assignments').insert({
      user_id: userId,
      client_id: invitation.client_id,
    });
  }

  // Phase 5: client / client_staff invitations grant client_user_access so
  // the client appears under Areas / Shared with me after signup.
  if (invitation.client_id && (userType === 'client' || userType === 'client_staff')) {
    await grantClientUserAccess({
      clientId: invitation.client_id,
      userId,
      createdBy: invitation.invited_by,
    });
  }

  // If invitation links to a client with cash book access, create cash_book_users entry
  if (invitation.client_id) {
    const { data: cbAccess } = await supabaseAdmin
      .from('cash_book_client_access')
      .select('id')
      .eq('client_id', invitation.client_id)
      .eq('is_enabled', true)
      .maybeSingle();

    if (cbAccess) {
      // Check if this is the first cash book user for the client
      const { count } = await supabaseAdmin
        .from('cash_book_users')
        .select('*', { count: 'exact', head: true })
        .eq('client_id', invitation.client_id);

      await supabaseAdmin.from('cash_book_users').insert({
        user_id: userId,
        client_id: invitation.client_id,
        role: count === 0 ? 'client_admin' : 'staff',
        invited_by: invitation.invited_by,
      });
    }
  }
}
