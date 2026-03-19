import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { supabaseAdmin } from '../supabase';

const router = Router();

// All admin routes require auth + admin role
router.use(requireAuth);
router.use(requireAdmin);

// GET /admin/users — list all users with optional search, includes custom role
router.get('/users', async (req: Request, res: Response) => {
  try {
    const search = (req.query.search as string) || '';
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
    const [usersRes, workspacesRes, channelsRes, messagesRes, pendingRes] = await Promise.all([
      supabaseAdmin.from('users').select('*', { count: 'exact', head: true }),
      supabaseAdmin.from('workspaces').select('*', { count: 'exact', head: true }),
      supabaseAdmin.from('channels').select('*', { count: 'exact', head: true }),
      supabaseAdmin.from('messages').select('*', { count: 'exact', head: true }),
      supabaseAdmin.from('users').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
    ]);

    res.json({
      success: true,
      data: {
        total_users: usersRes.count || 0,
        total_workspaces: workspacesRes.count || 0,
        total_channels: channelsRes.count || 0,
        total_messages: messagesRes.count || 0,
        pending_approvals: pendingRes.count || 0,
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

    // 1. Set status to approved
    const { data, error } = await supabaseAdmin
      .from('users')
      .update({ status: 'approved' })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    // 2. Find the workspace (there should be exactly one)
    const { data: workspace } = await supabaseAdmin
      .from('workspaces')
      .select('id')
      .limit(1)
      .single();

    if (workspace) {
      // Determine which custom role to assign
      let assignRoleId = roleId;
      if (!assignRoleId) {
        const { data: defaultRole } = await supabaseAdmin
          .from('roles')
          .select('id')
          .eq('is_default', true)
          .single();
        assignRoleId = defaultRole?.id || null;
      }

      // 3. Add user as member of the workspace
      await supabaseAdmin.from('workspace_members').insert({
        workspace_id: workspace.id,
        user_id: id,
        role: 'member',
        role_id: assignRoleId,
      });
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

// PUT /admin/users/:id/role — change a user's platform role
const updateRoleSchema = z.object({
  role: z.enum(['admin', 'member']),
});

router.put('/users/:id/role', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const body = updateRoleSchema.parse(req.body);

    // Prevent admin from demoting themselves
    if (id === req.userId && body.role !== 'admin') {
      res.status(400).json({ success: false, error: 'You cannot remove your own admin role' });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('users')
      .update({ role: body.role })
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

    // Update our users table
    const { data, error } = await supabaseAdmin
      .from('users')
      .update({ role: body.banned ? 'banned' : 'member' })
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

export default router;
