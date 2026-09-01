import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { supabaseAdmin } from '../supabase';
import { getDefaultRoleIdForUserType } from '../utils/defaultRole';
import { propagateEmailChange } from '../utils/propagateEmailChange';
import { propagateUserDisplayName } from '../utils/propagateIdentityNames';
import { notifySquadhireOfCardRecall } from '../utils/squadhireWebhook';
import { applyTempPassword, PasswordResetError } from '../services/passwordReset';
import {
  demotePlatformAdmin,
  getRoleSystemKey,
  normalizeRolesForUserType,
  promotePlatformAdmin,
} from '../utils/platformRoles';
import type { UserType } from '@squadhub/shared';

const router = Router();

// All routes in THIS router require auth + admin role.
//
// The gate is scoped to the paths this router actually serves rather than
// applied bare. This router is mounted at '/admin', so a bare `router.use()`
// runs for EVERY /admin/* request — including sibling routers mounted under
// the same prefix (subscription-cards, job-cards, checkin, …). Those siblings
// have their own, deliberately looser gates (requireMiniAppOrAdmin), and a
// bare admin gate here would 403 their mini-app users before those gates ever
// ran. Scoping keeps this fail-closed: a path missing from the list below is
// still handled by its own router's gate, never left ungated.
const OWN_PATHS = ['/users', '/stats', '/pending-users', '/trash'];
router.use(OWN_PATHS, requireAuth);
router.use(OWN_PATHS, requireAdmin);

// GET /admin/users — list all users with optional search, includes custom role
router.get('/users', async (req: Request, res: Response) => {
  try {
    const search = (req.query.search as string) || '';
    const userType = req.query.user_type as string | undefined;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));
    const offset = (page - 1) * limit;

    let query = supabaseAdmin
      .from('users')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (search) {
      query = query.or(`display_name.ilike.%${search}%,email.ilike.%${search}%`);
    }

    if (userType && ['internal', 'client', 'client_staff', 'partner', 'partner_employee'].includes(userType)) {
      query = query.eq('user_type', userType);
    }

    const { data: users, error, count } = await query;

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    // Fetch workspace member (primary) roles for all returned users
    const userIds = (users || []).map((u: any) => u.id);
    const { data: members } = await supabaseAdmin
      .from('workspace_members')
      .select('id, user_id, role_id, roles(id, name, color)')
      .in('user_id', userIds);

    const primaryRoleMap: Record<string, any> = {};
    const memberIdToUserId: Record<string, string> = {};
    (members || []).forEach((m: any) => {
      if (m.roles) primaryRoleMap[m.user_id] = m.roles;
      memberIdToUserId[m.id] = m.user_id;
    });

    // Fetch secondary roles for all workspace members
    const memberIds = Object.keys(memberIdToUserId);
    const secondaryRolesByUserId: Record<string, any[]> = {};
    if (memberIds.length > 0) {
      const { data: secRows } = await supabaseAdmin
        .from('workspace_member_secondary_roles')
        .select('workspace_member_id, roles(id, name, color)')
        .in('workspace_member_id', memberIds);
      (secRows || []).forEach((row: any) => {
        const uid = memberIdToUserId[row.workspace_member_id];
        if (!uid || !row.roles) return;
        (secondaryRolesByUserId[uid] ||= []).push(row.roles);
      });
    }

    const usersWithRoles = (users || []).map((u: any) => ({
      ...u,
      custom_role: primaryRoleMap[u.id] || null,
      secondary_roles: secondaryRolesByUserId[u.id] || [],
    }));

    res.json({
      success: true,
      data: usersWithRoles,
      total: count || 0,
      page,
      limit,
    });
  } catch (err) {
    console.error('Admin list users error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /admin/stats — basic platform stats
router.get('/stats', async (_req: Request, res: Response) => {
  try {
    // The unreviewed-assigned count depends on migration 078 (admin_reviewed_at).
    // If the migration hasn't been applied yet, treat the count as 0 rather
    // than failing the whole /stats response.
    const unreviewedAssignedPromise = supabaseAdmin
      .from('subscription_cards')
      .select('*', { count: 'exact', head: true })
      .not('selected_recipient_id', 'is', null)
      .is('admin_reviewed_at', null)
      .then((r) => r, () => ({ count: 0 } as { count: number }));

    const [usersRes, workspacesRes, channelsRes, messagesRes, pendingRes, internalRes, clientRes, clientStaffRes, partnerRes, partnerEmployeeRes, unreviewedAssignedRes] = await Promise.all([
      supabaseAdmin.from('users').select('*', { count: 'exact', head: true }),
      supabaseAdmin.from('workspaces').select('*', { count: 'exact', head: true }),
      supabaseAdmin.from('channels').select('*', { count: 'exact', head: true }),
      supabaseAdmin.from('messages').select('*', { count: 'exact', head: true }),
      supabaseAdmin.from('users').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
      supabaseAdmin.from('users').select('*', { count: 'exact', head: true }).eq('user_type', 'internal'),
      supabaseAdmin.from('users').select('*', { count: 'exact', head: true }).eq('user_type', 'client'),
      supabaseAdmin.from('users').select('*', { count: 'exact', head: true }).eq('user_type', 'client_staff'),
      supabaseAdmin.from('users').select('*', { count: 'exact', head: true }).eq('user_type', 'partner'),
      supabaseAdmin.from('users').select('*', { count: 'exact', head: true }).eq('user_type', 'partner_employee'),
      unreviewedAssignedPromise,
    ]);

    res.json({
      success: true,
      data: {
        total_users: usersRes.count || 0,
        total_workspaces: workspacesRes.count || 0,
        total_channels: channelsRes.count || 0,
        total_messages: messagesRes.count || 0,
        pending_approvals: pendingRes.count || 0,
        unreviewed_assigned_cards: unreviewedAssignedRes.count || 0,
        users_by_type: {
          internal: internalRes.count || 0,
          client: clientRes.count || 0,
          client_staff: clientStaffRes.count || 0,
          partner: partnerRes.count || 0,
          partner_employee: partnerEmployeeRes.count || 0,
        },
      },
    });
  } catch (err) {
    console.error('Admin stats error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /admin/pending-users — list users awaiting approval
router.get('/pending-users', async (_req: Request, res: Response) => {
  try {
    const { data: users, error } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.json({ success: true, data: users });
  } catch (err) {
    console.error('Admin pending users error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PUT /admin/users/:id/approve — approve a pending user & auto-join workspace
router.put('/users/:id/approve', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const roleId = req.body?.role_id || null;

    const { data: targetUser, error: targetError } = await supabaseAdmin
      .from('users')
      .select('user_type')
      .eq('id', id)
      .single();
    if (targetError || !targetUser) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }

    // 2. Find the workspace (oldest one — stable pick when more than one exists)
    const { data: workspace, error: wsError } = await supabaseAdmin
      .from('workspaces')
      .select('id')
      .order('created_at', { ascending: true })
      .limit(1)
      .single();

    if (wsError || !workspace) {
      res.status(500).json({ success: false, error: 'No workspace available to assign user to' });
      return;
    }

    // Determine which custom role to assign. If caller didn't pick one,
    // fall back to the system default role for this user's user_type.
    let assignRoleId = roleId;
    if (!assignRoleId) {
      assignRoleId = await getDefaultRoleIdForUserType((targetUser?.user_type ?? 'internal') as UserType);
    }

    if (!assignRoleId) {
      res.status(500).json({ success: false, error: 'Could not resolve a role to assign — system roles may not be seeded' });
      return;
    }

    const selectedSystemKey = await getRoleSystemKey(assignRoleId);
    if ((selectedSystemKey === 'admin' || selectedSystemKey === 'manager') && targetUser.user_type !== 'internal') {
      res.status(400).json({ success: false, error: 'Admin and Managers roles can only be assigned to Internal users' });
      return;
    }

    // Set status only after role validation so a rejected Admin/Managers
    // assignment cannot partially activate an external account.
    const { data, error } = await supabaseAdmin
      .from('users')
      .update({ status: 'active' })
      .eq('id', id)
      .select()
      .single();
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    // 3. Add user as member of the workspace (idempotent — re-approval is safe)
    const { error: memberError } = await supabaseAdmin
      .from('workspace_members')
      .upsert(
        {
          workspace_id: workspace.id,
          user_id: id,
          role: selectedSystemKey === 'admin' ? 'admin' : 'member',
          role_id: assignRoleId,
        },
        { onConflict: 'workspace_id,user_id' }
      );

    if (memberError) {
      res.status(500).json({ success: false, error: `Failed to add user to workspace: ${memberError.message}` });
      return;
    }

    if (selectedSystemKey === 'admin') {
      const { error: adminError } = await supabaseAdmin
        .from('users')
        .update({ is_admin: true })
        .eq('id', id);
      if (adminError) {
        const fallbackRoleId = await getDefaultRoleIdForUserType('internal');
        await supabaseAdmin
          .from('workspace_members')
          .update({ role: 'member', role_id: fallbackRoleId })
          .eq('workspace_id', workspace.id)
          .eq('user_id', id);
        res.status(500).json({ success: false, error: `Failed to grant Admin access: ${adminError.message}` });
        return;
      }
    }

    res.json({ success: true, data });
  } catch (err) {
    console.error('Admin approve user error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PUT /admin/users/:id/reject — reject a pending user
router.put('/users/:id/reject', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    const { data, error } = await supabaseAdmin
      .from('users')
      .update({ status: 'rejected' })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.json({ success: true, data });
  } catch (err) {
    console.error('Admin reject user error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PUT /admin/users/:id/profile — update a user's display name and email
const updateProfileSchema = z.object({
  display_name: z.string().min(1).max(50).optional(),
  email: z.string().email().optional(),
});

router.put('/users/:id/profile', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const body = updateProfileSchema.parse(req.body);

    const updates: Record<string, string> = {};
    if (body.display_name !== undefined) updates.display_name = body.display_name;
    if (body.email !== undefined) updates.email = body.email;

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ success: false, error: 'No fields to update' });
      return;
    }

    // Update in our users table
    const { data, error } = await supabaseAdmin
      .from('users')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    // Also update email in Supabase Auth if changed, and propagate it to the
    // denormalized customer-email copies (clients, submissions, card snapshots)
    // so client-facing card lists keep resolving the user by email.
    if (body.email) {
      await supabaseAdmin.auth.admin.updateUserById(id, { email: body.email });
      await propagateEmailChange(id, body.email);
    }
    if (body.display_name) {
      void propagateUserDisplayName(id, body.display_name);
    }

    res.json({ success: true, data });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Admin update profile error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PUT /admin/users/:id/custom-role — change a user's primary role and/or secondary roles.
// Both fields are optional; at least one must be present. Sending only secondary_role_ids
// leaves the existing primary untouched (which is useful for users whose primary is null).
router.put('/users/:id/custom-role', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const { role_id, secondary_role_ids } = z
      .object({
        role_id: z.string().uuid().optional(),
        secondary_role_ids: z.array(z.string().uuid()).optional(),
      })
      .parse(req.body);

    if (role_id === undefined && secondary_role_ids === undefined) {
      res.status(400).json({ success: false, error: 'Provide role_id and/or secondary_role_ids' });
      return;
    }

    const { data: targetUser } = await supabaseAdmin
      .from('users')
      .select('is_admin, user_type')
      .eq('id', id)
      .single();
    const selectedSystemKey = role_id ? await getRoleSystemKey(role_id) : null;
    if (selectedSystemKey === 'admin' && !targetUser?.is_admin) {
      res.status(400).json({ success: false, error: 'Use “Make Admin” to assign the protected Admin role' });
      return;
    }
    if (targetUser?.is_admin && role_id !== undefined && selectedSystemKey !== 'admin') {
      res.status(400).json({ success: false, error: 'Remove Admin access before changing this user’s primary role' });
      return;
    }
    if ((selectedSystemKey === 'admin' || selectedSystemKey === 'manager') && targetUser?.user_type !== 'internal') {
      res.status(400).json({ success: false, error: 'Admin and Managers roles can only be assigned to Internal users' });
      return;
    }
    if (secondary_role_ids?.length) {
      const { data: secondarySystemRoles } = await supabaseAdmin
        .from('roles')
        .select('id, system_key')
        .in('id', secondary_role_ids);
      if ((secondarySystemRoles || []).some((role: any) => role.system_key === 'admin')) {
        res.status(400).json({ success: false, error: 'Admin is a protected primary role and cannot be assigned as a secondary role' });
        return;
      }
      if (targetUser?.user_type !== 'internal' &&
          (secondarySystemRoles || []).some((role: any) => role.system_key === 'manager')) {
        res.status(400).json({ success: false, error: 'Managers can only be assigned to Internal users' });
        return;
      }
    }

    const { data: workspace } = await supabaseAdmin
      .from('workspaces')
      .select('id')
      .limit(1)
      .single();

    if (!workspace) {
      res.status(404).json({ success: false, error: 'No workspace found' });
      return;
    }

    // Load the existing member row (primary may be null; that's fine).
    const { data: existing, error: existErr } = await supabaseAdmin
      .from('workspace_members')
      .select('id, role_id')
      .eq('user_id', id)
      .eq('workspace_id', workspace.id)
      .single();

    if (existErr || !existing) {
      res.status(404).json({ success: false, error: 'Workspace member not found for user' });
      return;
    }

    const effectivePrimary = role_id !== undefined ? role_id : (existing.role_id as string | null);

    if (secondary_role_ids && effectivePrimary && secondary_role_ids.includes(effectivePrimary)) {
      res.status(400).json({ success: false, error: 'A secondary role cannot match the primary role' });
      return;
    }

    // Update primary only if explicitly provided.
    let member: any;
    if (role_id !== undefined) {
      const { data, error: updateErr } = await supabaseAdmin
        .from('workspace_members')
        .update({ role_id })
        .eq('id', existing.id)
        .select('*, roles(id, name, color)')
        .single();
      if (updateErr || !data) {
        res.status(500).json({ success: false, error: updateErr?.message || 'Failed to update primary role' });
        return;
      }
      member = data;
    } else {
      const { data } = await supabaseAdmin
        .from('workspace_members')
        .select('*, roles(id, name, color)')
        .eq('id', existing.id)
        .single();
      member = data;
    }

    // Replace the full secondary set when the caller sends the field.
    if (secondary_role_ids !== undefined) {
      const { error: delErr } = await supabaseAdmin
        .from('workspace_member_secondary_roles')
        .delete()
        .eq('workspace_member_id', member.id);
      if (delErr) {
        res.status(500).json({ success: false, error: delErr.message });
        return;
      }

      const protectedSecondaryIds = new Set(secondary_role_ids);
      if (targetUser?.is_admin) {
        const { data: backup } = await supabaseAdmin
          .from('platform_admin_role_backups')
          .select('previous_role_id')
          .eq('workspace_member_id', member.id)
          .maybeSingle();
        if (backup?.previous_role_id) protectedSecondaryIds.add(backup.previous_role_id as string);
      }

      const rows = Array.from(protectedSecondaryIds)
        .filter((rid) => rid !== effectivePrimary)
        .map((rid) => ({ workspace_member_id: member.id, role_id: rid }));

      if (rows.length > 0) {
        const { error: insertErr } = await supabaseAdmin
          .from('workspace_member_secondary_roles')
          .insert(rows);
        if (insertErr) {
          res.status(500).json({ success: false, error: insertErr.message });
          return;
        }
      }
    } else if (role_id !== undefined) {
      // Primary changed and caller didn't re-send secondaries: drop any stale secondary
      // that now duplicates the new primary.
      await supabaseAdmin
        .from('workspace_member_secondary_roles')
        .delete()
        .eq('workspace_member_id', member.id)
        .eq('role_id', role_id);
    }

    const { data: secRows } = await supabaseAdmin
      .from('workspace_member_secondary_roles')
      .select('roles(id, name, color)')
      .eq('workspace_member_id', member.id);

    const secondary_roles = (secRows || [])
      .map((r: any) => r.roles)
      .filter((r: any) => !!r);

    res.json({
      success: true,
      data: { ...member, secondary_roles },
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Admin update custom role error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PUT /admin/users/:id/role — grant or revoke platform admin privilege
const updateRoleSchema = z.object({
  is_admin: z.boolean(),
});

router.put('/users/:id/role', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const body = updateRoleSchema.parse(req.body);

    // Prevent admin from demoting themselves
    if (id === req.userId && !body.is_admin) {
      res.status(400).json({ success: false, error: 'You cannot remove your own admin role' });
      return;
    }

    // Only internal users can be promoted to admin
    if (body.is_admin) {
      const { data: targetUser } = await supabaseAdmin
        .from('users')
        .select('user_type')
        .eq('id', id)
        .single();

      if (targetUser?.user_type !== 'internal') {
        res.status(400).json({ success: false, error: 'Only internal users can be promoted to admin' });
        return;
      }
    }

    if (body.is_admin) await promotePlatformAdmin(id);
    else await demotePlatformAdmin(id);

    const { data, error } = await supabaseAdmin.from('users').select('*').eq('id', id).single();
    if (error) throw new Error(error.message);

    res.json({ success: true, data });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Admin update role error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PUT /admin/users/:id/user-type — change a user's user_type classification.
const updateUserTypeSchema = z.object({
  user_type: z.enum(['internal', 'client', 'client_staff', 'partner', 'partner_employee']),
});

router.put('/users/:id/user-type', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const body = updateUserTypeSchema.parse(req.body);

    if (id === req.userId && body.user_type !== 'internal') {
      res.status(400).json({ success: false, error: 'You cannot change your own user_type away from internal' });
      return;
    }

    const { data: currentUser } = await supabaseAdmin
      .from('users')
      .select('is_admin')
      .eq('id', id)
      .single();
    if (body.user_type !== 'internal' && currentUser?.is_admin) {
      await demotePlatformAdmin(id);
    }
    await normalizeRolesForUserType(id, body.user_type as UserType);

    const updates: Record<string, unknown> = { user_type: body.user_type };

    const { data, error } = await supabaseAdmin
      .from('users')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.json({ success: true, data });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Admin update user_type error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PUT /admin/users/:id/suspend — suspend or unsuspend a user.
// Softer than /ban: app-level block only (login + auth middleware reject),
// no Supabase Auth ban_duration applied, so it's reversible without re-issuing tokens.
const suspendSchema = z.object({
  suspended: z.boolean(),
});

router.put('/users/:id/suspend', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const body = suspendSchema.parse(req.body);

    if (id === req.userId) {
      res.status(400).json({ success: false, error: 'You cannot suspend yourself' });
      return;
    }

    const updates: Record<string, unknown> = {
      status: body.suspended ? 'suspended' : 'active',
    };
    if (body.suspended) {
      const { data: target } = await supabaseAdmin.from('users').select('is_admin').eq('id', id).single();
      if (target?.is_admin) await demotePlatformAdmin(id);
      updates.is_admin = false;
    }

    const { data, error } = await supabaseAdmin
      .from('users')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.json({ success: true, data });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Admin suspend user error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PUT /admin/users/:id/ban — ban or unban a user
const banSchema = z.object({
  banned: z.boolean(),
});

router.put('/users/:id/ban', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const body = banSchema.parse(req.body);

    // Prevent admin from banning themselves
    if (id === req.userId) {
      res.status(400).json({ success: false, error: 'You cannot ban yourself' });
      return;
    }

    // Ban/unban in Supabase Auth
    const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(id, {
      ban_duration: body.banned ? '876000h' : 'none', // ~100 years or unban
    });

    if (authError) {
      res.status(500).json({ success: false, error: authError.message });
      return;
    }

    // Update our users table.
    // On ban, also clear is_admin so unban doesn't silently restore admin rights.
    const updates: Record<string, unknown> = {
      status: body.banned ? 'banned' : 'active',
    };
    if (body.banned) {
      const { data: target } = await supabaseAdmin.from('users').select('is_admin').eq('id', id).single();
      if (target?.is_admin) await demotePlatformAdmin(id);
      updates.is_admin = false;
    }
    const { data, error } = await supabaseAdmin
      .from('users')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.json({ success: true, data });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Admin ban user error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /admin/users/:id/reset-password — mint a temp password, force a change
// on next login, and return the temp password so the admin can relay it.
// Same credential shape as the self-serve WhatsApp flow (word-word).
router.post('/users/:id/reset-password', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    const { data: target, error: userErr } = await supabaseAdmin
      .from('users')
      .select('id, email, display_name, status')
      .eq('id', id)
      .maybeSingle();

    if (userErr) {
      res.status(500).json({ success: false, error: userErr.message });
      return;
    }
    if (!target) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }
    if (target.status === 'banned' || target.status === 'rejected') {
      res.status(400).json({ success: false, error: 'Cannot reset password for a banned or rejected account' });
      return;
    }

    const { tempPassword, email } = await applyTempPassword(id);

    res.json({
      success: true,
      data: {
        email,
        display_name: target.display_name,
        temp_password: tempPassword,
      },
    });
  } catch (err) {
    if (err instanceof PasswordResetError) {
      res.status(err.status).json({ success: false, error: err.message });
      return;
    }
    console.error('Admin reset password error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /admin/users/:id — delete a user
router.delete('/users/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    // Prevent admin from deleting themselves
    if (id === req.userId) {
      res.status(400).json({ success: false, error: 'You cannot delete yourself' });
      return;
    }

    // Delete from Supabase Auth (this cascades)
    const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(id);

    if (authError) {
      res.status(500).json({ success: false, error: authError.message });
      return;
    }

    // Delete from our users table
    const { error } = await supabaseAdmin.from('users').delete().eq('id', id);

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.json({ success: true, message: 'User deleted' });
  } catch (err) {
    console.error('Admin delete user error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============================================================
// Trash Management (soft-deleted spaces, folders, lists)
// ============================================================

// GET /admin/trash — list all soft-deleted items
router.get('/trash', async (req: Request, res: Response) => {
  try {
    const workspaceId = req.query.workspace_id as string;

    const [spacesRes, foldersRes, listsRes, channelsRes, cardsRes] = await Promise.all([
      supabaseAdmin
        .from('spaces')
        .select('id, name, color, icon, deleted_at, created_by, workspace_id')
        .not('deleted_at', 'is', null)
        .order('deleted_at', { ascending: false })
        .then(async (r) => {
          if (!r.data) return r;
          // Attach creator info
          const userIds = [...new Set(r.data.map((s: any) => s.created_by).filter(Boolean))];
          if (userIds.length === 0) return r;
          const { data: users } = await supabaseAdmin.from('users').select('id, display_name').in('id', userIds);
          const userMap = new Map((users || []).map((u: any) => [u.id, u.display_name]));
          return { ...r, data: r.data.map((s: any) => ({ ...s, created_by_name: userMap.get(s.created_by) || null })) };
        }),
      supabaseAdmin
        .from('folders')
        .select('id, name, space_id, deleted_at, created_by, spaces!inner(name, workspace_id)')
        .not('deleted_at', 'is', null)
        .order('deleted_at', { ascending: false })
        .then(async (r) => {
          if (!r.data) return r;
          const userIds = [...new Set(r.data.map((f: any) => f.created_by).filter(Boolean))];
          if (userIds.length === 0) return r;
          const { data: users } = await supabaseAdmin.from('users').select('id, display_name').in('id', userIds);
          const userMap = new Map((users || []).map((u: any) => [u.id, u.display_name]));
          return { ...r, data: r.data.map((f: any) => ({ ...f, created_by_name: userMap.get(f.created_by) || null })) };
        }),
      supabaseAdmin
        .from('lists')
        .select('id, name, space_id, folder_id, deleted_at, created_by, spaces!inner(name, workspace_id)')
        .not('deleted_at', 'is', null)
        .order('deleted_at', { ascending: false })
        .then(async (r) => {
          if (!r.data) return r;
          const userIds = [...new Set(r.data.map((l: any) => l.created_by).filter(Boolean))];
          if (userIds.length === 0) return r;
          const { data: users } = await supabaseAdmin.from('users').select('id, display_name').in('id', userIds);
          const userMap = new Map((users || []).map((u: any) => [u.id, u.display_name]));
          return { ...r, data: r.data.map((l: any) => ({ ...l, created_by_name: userMap.get(l.created_by) || null })) };
        }),
      supabaseAdmin
        .from('channels')
        .select('id, name, deleted_at, created_by, workspace_id')
        .not('deleted_at', 'is', null)
        .order('deleted_at', { ascending: false })
        .then(async (r) => {
          if (!r.data) return r;
          const userIds = [...new Set(r.data.map((c: any) => c.created_by).filter(Boolean))];
          if (userIds.length === 0) return r;
          const { data: users } = await supabaseAdmin.from('users').select('id, display_name').in('id', userIds);
          const userMap = new Map((users || []).map((u: any) => [u.id, u.display_name]));
          return { ...r, data: r.data.map((c: any) => ({ ...c, created_by_name: userMap.get(c.created_by) || null })) };
        }),
      // Subscription cards — soft-deleted via DELETE /admin/subscription-cards/:id.
      // Only top-level cards (secondaries cascade with their parent on final purge).
      // "Deleted by" reflects the admin who deleted it (deleted_by), not the creator.
      supabaseAdmin
        .from('subscription_cards')
        .select('id, brand_name, card_code, card_type, state, deleted_at, deleted_by')
        .is('parent_card_id', null)
        .not('deleted_at', 'is', null)
        .order('deleted_at', { ascending: false })
        .then(async (r) => {
          if (!r.data) return r;
          const userIds = [...new Set(r.data.map((c: any) => c.deleted_by).filter(Boolean))];
          const { data: users } = userIds.length
            ? await supabaseAdmin.from('users').select('id, display_name').in('id', userIds)
            : { data: [] as any[] };
          const userMap = new Map((users || []).map((u: any) => [u.id, u.display_name]));
          return {
            ...r,
            data: r.data.map((c: any) => ({
              id: c.id,
              name: c.brand_name || c.card_code || 'Untitled card',
              card_type: c.card_type,
              card_code: c.card_code,
              state: c.state,
              deleted_at: c.deleted_at,
              created_by_name: c.deleted_by ? userMap.get(c.deleted_by) || null : null,
            })),
          };
        }),
    ]);

    res.json({
      success: true,
      data: {
        spaces: spacesRes.data || [],
        folders: foldersRes.data || [],
        lists: listsRes.data || [],
        channels: channelsRes.data || [],
        cards: cardsRes.data || [],
      },
    });
  } catch (err) {
    console.error('Admin get trash error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PUT /admin/trash/restore — restore a soft-deleted item
router.put('/trash/restore', async (req: Request, res: Response) => {
  try {
    const { type, id } = z.object({
      type: z.enum(['space', 'folder', 'list', 'channel', 'card']),
      id: z.string().uuid(),
    }).parse(req.body);

    const table = type === 'space' ? 'spaces'
      : type === 'folder' ? 'folders'
      : type === 'channel' ? 'channels'
      : type === 'card' ? 'subscription_cards'
      : 'lists';

    // A restored card returns to its prior draft/archived state (both already
    // out of talent feeds), so we only clear the trash markers here.
    const restoreFields = type === 'card' ? { deleted_at: null, deleted_by: null } : { deleted_at: null };

    const { error } = await supabaseAdmin
      .from(table)
      .update(restoreFields)
      .eq('id', id);

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    // If restoring a space, also restore its child folders and lists
    if (type === 'space') {
      await supabaseAdmin.from('folders').update({ deleted_at: null }).eq('space_id', id);
      await supabaseAdmin.from('lists').update({ deleted_at: null }).eq('space_id', id);
    }

    // If restoring a folder, also restore its child lists
    if (type === 'folder') {
      await supabaseAdmin.from('lists').update({ deleted_at: null }).eq('folder_id', id);
    }

    res.json({ success: true, message: `${type} restored` });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Admin restore error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /admin/trash/permanent — permanently delete a soft-deleted item
router.delete('/trash/permanent', async (req: Request, res: Response) => {
  try {
    const { type, id } = z.object({
      type: z.enum(['space', 'folder', 'list', 'channel', 'card']),
      id: z.string().uuid(),
    }).parse(req.body);

    const table = type === 'space' ? 'spaces'
      : type === 'folder' ? 'folders'
      : type === 'channel' ? 'channels'
      : type === 'card' ? 'subscription_cards'
      : 'lists';

    // For a card, drop SquadHire's mirror rows before the row (and its
    // recipients + secondary cards, via FK cascade) disappear for good.
    if (type === 'card') {
      notifySquadhireOfCardRecall(id).catch((err) => {
        console.error('[admin-trash-permanent] squadhire mirror drop error', err);
      });
    }

    const { error } = await supabaseAdmin
      .from(table)
      .delete()
      .eq('id', id);

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.json({ success: true, message: `${type} permanently deleted` });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Admin permanent delete error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
