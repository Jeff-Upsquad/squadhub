import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { supabaseAdmin } from '../supabase';

const router = Router();

router.use(requireAuth);
router.use(requireAdmin);

// ============================================================
// Mini App CRUD
// ============================================================

// GET /admin/mini-apps — list all mini apps with access info
router.get('/', async (_req: Request, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('mini_apps')
      .select('*, mini_app_role_access(*, roles(id, name, color)), mini_app_user_access(*, users(id, display_name, email))')
      .order('name');

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    // Reshape: flatten joined role/user into the access arrays
    const shaped = (data || []).map((app: any) => ({
      ...app,
      role_access: (app.mini_app_role_access || []).map((ra: any) => ({
        id: ra.id,
        mini_app_id: ra.mini_app_id,
        role_id: ra.role_id,
        created_at: ra.created_at,
        role: ra.roles,
      })),
      user_access: (app.mini_app_user_access || []).map((ua: any) => ({
        id: ua.id,
        mini_app_id: ua.mini_app_id,
        user_id: ua.user_id,
        created_at: ua.created_at,
        user: ua.users,
      })),
      mini_app_role_access: undefined,
      mini_app_user_access: undefined,
    }));

    res.json({ success: true, data: shaped });
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
      .select('*, mini_app_role_access(*, roles(id, name, color)), mini_app_user_access(*, users(id, display_name, email))')
      .eq('id', req.params.id)
      .single();

    if (error) {
      res.status(404).json({ success: false, error: 'Mini app not found' });
      return;
    }

    const shaped = {
      ...data,
      role_access: (data.mini_app_role_access || []).map((ra: any) => ({
        id: ra.id,
        mini_app_id: ra.mini_app_id,
        role_id: ra.role_id,
        created_at: ra.created_at,
        role: ra.roles,
      })),
      user_access: (data.mini_app_user_access || []).map((ua: any) => ({
        id: ua.id,
        mini_app_id: ua.mini_app_id,
        user_id: ua.user_id,
        created_at: ua.created_at,
        user: ua.users,
      })),
      mini_app_role_access: undefined,
      mini_app_user_access: undefined,
    };

    res.json({ success: true, data: shaped });
  } catch (err) {
    console.error('Get mini app error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /admin/mini-apps — create a new mini app
const createSchema = z.object({
  slug: z.string().min(1).max(50).regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with dashes'),
  name: z.string().min(1).max(100),
  description: z.string().max(500).default(''),
  icon: z.string().max(50).default('puzzle'),
  is_enabled: z.boolean().default(true),
});

router.post('/', async (req: Request, res: Response) => {
  try {
    const body = createSchema.parse(req.body);

    const { data, error } = await supabaseAdmin
      .from('mini_apps')
      .insert(body)
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        res.status(409).json({ success: false, error: 'A mini app with this slug already exists' });
        return;
      }
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.json({ success: true, data });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Create mini app error:', err);
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

// DELETE /admin/mini-apps/:id — delete a mini app (cascades access records)
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { error } = await supabaseAdmin
      .from('mini_apps')
      .delete()
      .eq('id', req.params.id);

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.json({ success: true, message: 'Mini app deleted' });
  } catch (err) {
    console.error('Delete mini app error:', err);
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
      .select('*, roles(id, name, color)')
      .single();

    if (error) {
      if (error.code === '23505') {
        res.status(409).json({ success: false, error: 'Role already has access' });
        return;
      }
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.json({
      success: true,
      data: {
        id: data.id,
        mini_app_id: data.mini_app_id,
        role_id: data.role_id,
        created_at: data.created_at,
        role: (data as any).roles,
      },
    });
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
      .select('*, users(id, display_name, email)')
      .single();

    if (error) {
      if (error.code === '23505') {
        res.status(409).json({ success: false, error: 'User already has access' });
        return;
      }
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.json({
      success: true,
      data: {
        id: data.id,
        mini_app_id: data.mini_app_id,
        user_id: data.user_id,
        created_at: data.created_at,
        user: (data as any).users,
      },
    });
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
