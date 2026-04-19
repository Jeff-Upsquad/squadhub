import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { supabaseAdmin } from '../supabase';
import { getDefaultRoleIdForUserType } from '../utils/defaultRole';
import type { UserType } from '@squadhub/shared';

const router = Router();

// All admin routes require auth + admin role
router.use(requireAuth);
router.use(requireAdmin);

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

    if (userType && ['internal', 'client', 'client_staff', 'partner'].includes(userType)) {
      query = query.eq('user_type', userType);
    }

    const { data: users, error, count } = await query;

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    // Fetch workspace member roles for all returned users
    const userIds = (users || []).map((u: any) => u.id);
    const { data: members } = await supabaseAdmin
      .from('workspace_members')
      .select('user_id, role_id, roles(id, name, color)')
      .in('user_id', userIds);

    // Build a map: user_id → custom_role
    const roleMap: Record<string, any> = {};
    (members || []).forEach((m: any) => {
      if (m.roles) {
        roleMap[m.user_id] = m.roles;
      }
    });

    // Attach custom_role to each user
    const usersWithRoles = (users || []).map((u: any) => ({
      ...u,
      custom_role: roleMap[u.id] || null,
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
    const [usersRes, workspacesRes, channelsRes, messagesRes, pendingRes, internalRes, clientRes, clientStaffRes, partnerRes] = await Promise.all([
      supabaseAdmin.from('users').select('*', { count: 'exact', head: true }),
      supabaseAdmin.from('workspaces').select('*', { count: 'exact', head: true }),
      supabaseAdmin.from('channels').select('*', { count: 'exact', head: true }),
      supabaseAdmin.from('messages').select('*', { count: 'exact', head: true }),
      supabaseAdmin.from('users').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
      supabaseAdmin.from('users').select('*', { count: 'exact', head: true }).eq('user_type', 'internal'),
      supabaseAdmin.from('users').select('*', { count: 'exact', head: true }).eq('user_type', 'client'),
      supabaseAdmin.from('users').select('*', { count: 'exact', head: true }).eq('user_type', 'client_staff'),
      supabaseAdmin.from('users').select('*', { count: 'exact', head: true }).eq('user_type', 'partner'),
    ]);

    res.json({
      success: true,
      data: {
        total_users: usersRes.count || 0,
        total_workspaces: workspacesRes.count || 0,
        total_channels: channelsRes.count || 0,
        total_messages: messagesRes.count || 0,
        pending_approvals: pendingRes.count || 0,
        users_by_type: {
          internal: internalRes.count || 0,
          client: clientRes.count || 0,
          client_staff: clientStaffRes.count || 0,
          partner: partnerRes.count || 0,
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

    // 1. Set status to active
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
      const { data: targetUser } = await supabaseAdmin
        .from('users')
        .select('user_type')
        .eq('id', id)
        .single();
      assignRoleId = await getDefaultRoleIdForUserType((targetUser?.user_type ?? 'internal') as UserType);
    }

    if (!assignRoleId) {
      res.status(500).json({ success: false, error: 'Could not resolve a role to assign — system roles may not be seeded' });
      return;
    }

    // 3. Add user as member of the workspace (idempotent — re-approval is safe)
    const { error: memberError } = await supabaseAdmin
      .from('workspace_members')
      .upsert(
        { workspace_id: workspace.id, user_id: id, role: 'member', role_id: assignRoleId },
        { onConflict: 'workspace_id,user_id' }
      );

    if (memberError) {
      res.status(500).json({ success: false, error: `Failed to add user to workspace: ${memberError.message}` });
      return;
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

    // Also update email in Supabase Auth if changed
    if (body.email) {
      await supabaseAdmin.auth.admin.updateUserById(id, { email: body.email });
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

// PUT /admin/users/:id/custom-role — change a user's custom role
router.put('/users/:id/custom-role', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const { role_id } = z.object({ role_id: z.string().uuid() }).parse(req.body);

    // Find the workspace
    const { data: workspace } = await supabaseAdmin
      .from('workspaces')
      .select('id')
      .limit(1)
      .single();

    if (!workspace) {
      res.status(404).json({ success: false, error: 'No workspace found' });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('workspace_members')
      .update({ role_id })
      .eq('user_id', id)
      .eq('workspace_id', workspace.id)
      .select('*, roles(id, name, color)')
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

    const { data, error } = await supabaseAdmin
      .from('users')
      .update({ is_admin: body.is_admin })
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
    console.error('Admin update role error:', err);
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

    const [spacesRes, foldersRes, listsRes, channelsRes] = await Promise.all([
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
    ]);

    res.json({
      success: true,
      data: {
        spaces: spacesRes.data || [],
        folders: foldersRes.data || [],
        lists: listsRes.data || [],
        channels: channelsRes.data || [],
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
      type: z.enum(['space', 'folder', 'list', 'channel']),
      id: z.string().uuid(),
    }).parse(req.body);

    const table = type === 'space' ? 'spaces' : type === 'folder' ? 'folders' : type === 'channel' ? 'channels' : 'lists';

    const { error } = await supabaseAdmin
      .from(table)
      .update({ deleted_at: null })
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
      type: z.enum(['space', 'folder', 'list', 'channel']),
      id: z.string().uuid(),
    }).parse(req.body);

    const table = type === 'space' ? 'spaces' : type === 'folder' ? 'folders' : type === 'channel' ? 'channels' : 'lists';

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
