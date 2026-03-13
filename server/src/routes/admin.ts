import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { supabaseAdmin } from '../supabase';

const router = Router();

// All admin routes require auth + admin role
router.use(requireAuth);
router.use(requireAdmin);

// GET /admin/users — list all users with optional search
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

    res.json({
      success: true,
      data: users,
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
    const [usersRes, workspacesRes, channelsRes, messagesRes] = await Promise.all([
      supabaseAdmin.from('users').select('*', { count: 'exact', head: true }),
      supabaseAdmin.from('workspaces').select('*', { count: 'exact', head: true }),
      supabaseAdmin.from('channels').select('*', { count: 'exact', head: true }),
      supabaseAdmin.from('messages').select('*', { count: 'exact', head: true }),
    ]);

    res.json({
      success: true,
      data: {
        total_users: usersRes.count || 0,
        total_workspaces: workspacesRes.count || 0,
        total_channels: channelsRes.count || 0,
        total_messages: messagesRes.count || 0,
      },
    });
  } catch (err) {
    console.error('Admin stats error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PUT /admin/users/:id/role — change a user's role
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
