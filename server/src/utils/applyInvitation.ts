/**
 * Everything that happens once a pending workspace invitation is accepted:
 * mark it accepted and put the user in the inviting workspace (account) with
 * the invited role.
 *
 * In the SaaS an invitation always targets one workspace — there is no
 * implicit "main" workspace any more. Best-effort by design: individual steps
 * log and continue rather than throw, since the auth user already exists by the
 * time this runs.
 */

import { supabaseAdmin } from '../supabase';
import { addWorkspaceMember, type WorkspaceRole } from './accounts';
import type { UserType } from '@squadhub/shared';

export interface PendingInvitation {
  id: string;
  workspace_id: string;
  role: string | null;
  user_type: string | null;
  invited_by: string | null;
}

/** Columns applyAcceptedInvitation needs — keep callers' selects in sync. */
export const INVITATION_COLUMNS = 'id, workspace_id, role, user_type, expires_at, invited_by';

const INVITABLE_ROLES = new Set<WorkspaceRole>(['admin', 'member', 'guest']);

export async function applyAcceptedInvitation(opts: {
  userId: string;
  userType: UserType;
  invitation: PendingInvitation;
}): Promise<void> {
  const { userId, invitation } = opts;

  await supabaseAdmin
    .from('invitations')
    .update({ status: 'accepted', accepted_at: new Date().toISOString() })
    .eq('id', invitation.id)
    .eq('workspace_id', invitation.workspace_id);

  // Owners are never created through an invitation.
  const role = INVITABLE_ROLES.has(invitation.role as WorkspaceRole)
    ? (invitation.role as WorkspaceRole)
    : 'member';
  try {
    await addWorkspaceMember(invitation.workspace_id, userId, role);
  } catch (err) {
    console.error('Failed to add invited user to workspace:', err);
  }
}
