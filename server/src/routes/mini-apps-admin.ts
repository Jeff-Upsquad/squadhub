import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { supabaseAdmin } from '../supabase';

const router = Router();

router.use(requireAuth);
router.use(requireAdmin);

// Helper: enrich mini app with role and user access details
async function enrichMiniApp(app: any) {
  // Get role access with role details
  const { data: roleAccess } = await supabaseAdmin
    .from('mini_app_role_access')
    .select('id, mini_app_id, role_id, created_at')
    .eq('mini_app_id', app.id);

  const roleIds = (roleAccess || []).map((ra: any) => ra.role_id);
  let rolesMap: Record<string, any> = {};
  if (roleIds.length > 0) {
    const { data: roles } = await supabaseAdmin
      .from('roles')
      .select('id, name, color')
      .in('id', roleIds);
    (roles || []).forEach((r: any) => { rolesMap[r.id] = r; });
  }

  // Get user access with user details
  const { data: userAccess } = await supabaseAdmin
    .from('mini_app_user_access')
    .select('id, mini_app_id, user_id, created_at')
    .eq('mini_app_id', app.id);

  const userIds = (userAccess || []).map((ua: any) => ua.user_id);
  let usersMap: Record<string, any> = {};
  if (userIds.length > 0) {
    const { data: users } = await supabaseAdmin
      .from('users')
      .select('id, display_name, email')
      .in('id', userIds);
    (users || []).forEach((u: any) => { usersMap[u.id] = u; });
  }

  return {
    ...app,
    role_access: (roleAccess || []).map((ra: any) => ({
      ...ra,
      role: rolesMap[ra.role_id] || null,
    })),
    user_access: (userAccess || []).map((ua: any) => ({
      ...ua,
      user: usersMap[ua.user_id] || null,
    })),
  };
}

// ============================================================
// Mini App CRUD
// ============================================================

// GET /admin/mini-apps — list all mini apps with access info
router.get('/', async (_req: Request, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('mini_apps')
      .select('*')
      .order('name');

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    const enriched = await Promise.all((data || []).map(enrichMiniApp));
    res.json({ success: true, data: enriched });
  } catch (err) {
    console.error('List mini apps error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /admin/mini-apps/:id — get single mini app
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('mini_apps')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error) {
      res.status(404).json({ success: false, error: 'Mini app not found' });
      return;
    }

    const enriched = await enrichMiniApp(data);
    res.json({ success: true, data: enriched });
  } catch (err) {
    console.error('Get mini app error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PUT /admin/mini-apps/:id — update a mini app
const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  icon: z.string().max(50).optional(),
  is_enabled: z.boolean().optional(),
});

router.put('/:id', async (req: Request, res: Response) => {
  try {
    const body = updateSchema.parse(req.body);

    const { data, error } = await supabaseAdmin
      .from('mini_apps')
      .update({ ...body, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
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
    console.error('Update mini app error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============================================================
// Role Access Management
// ============================================================

// POST /admin/mini-apps/:id/roles — add role access
const addRoleSchema = z.object({
  role_id: z.string().uuid(),
});

router.post('/:id/roles', async (req: Request, res: Response) => {
  try {
    const body = addRoleSchema.parse(req.body);

    const { data, error } = await supabaseAdmin
      .from('mini_app_role_access')
      .insert({ mini_app_id: req.params.id, role_id: body.role_id })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        res.status(409).json({ success: false, error: 'Role already has access' });
        return;
      }
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    // Fetch role details
    const { data: role } = await supabaseAdmin
      .from('roles')
      .select('id, name, color')
      .eq('id', body.role_id)
      .single();

    res.json({ success: true, data: { ...data, role } });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Add role access error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /admin/mini-apps/:id/roles/:roleId — remove role access
router.delete('/:id/roles/:roleId', async (req: Request, res: Response) => {
  try {
    const { error } = await supabaseAdmin
      .from('mini_app_role_access')
      .delete()
      .eq('mini_app_id', req.params.id)
      .eq('role_id', req.params.roleId);

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.json({ success: true, message: 'Role access removed' });
  } catch (err) {
    console.error('Remove role access error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============================================================
// User Access Management
// ============================================================

// POST /admin/mini-apps/:id/users — add user access
const addUserSchema = z.object({
  user_id: z.string().uuid(),
});

router.post('/:id/users', async (req: Request, res: Response) => {
  try {
    const body = addUserSchema.parse(req.body);

    const { data, error } = await supabaseAdmin
      .from('mini_app_user_access')
      .insert({ mini_app_id: req.params.id, user_id: body.user_id })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        res.status(409).json({ success: false, error: 'User already has access' });
        return;
      }
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    // Fetch user details
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('id, display_name, email')
      .eq('id', body.user_id)
      .single();

    res.json({ success: true, data: { ...data, user } });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Add user access error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /admin/mini-apps/:id/users/:userId — remove user access
router.delete('/:id/users/:userId', async (req: Request, res: Response) => {
  try {
    const { error } = await supabaseAdmin
      .from('mini_app_user_access')
      .delete()
      .eq('mini_app_id', req.params.id)
      .eq('user_id', req.params.userId);

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.json({ success: true, message: 'User access removed' });
  } catch (err) {
    console.error('Remove user access error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
