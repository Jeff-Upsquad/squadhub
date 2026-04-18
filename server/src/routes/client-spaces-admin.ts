import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { supabaseAdmin } from '../supabase';

const router = Router();

router.use(requireAuth);
router.use(requireAdmin);

async function enrichTemplate(t: any) {
  const { data: roleAccess } = await supabaseAdmin
    .from('client_space_template_role_access')
    .select('id, template_id, role_id, created_at')
    .eq('template_id', t.id);
  const roleIds = (roleAccess || []).map((ra: any) => ra.role_id);
  const rolesMap: Record<string, any> = {};
  if (roleIds.length > 0) {
    const { data: roles } = await supabaseAdmin
      .from('roles')
      .select('id, name, color')
      .in('id', roleIds);
    (roles || []).forEach((r: any) => { rolesMap[r.id] = r; });
  }

  const { data: userAccess } = await supabaseAdmin
    .from('client_space_template_user_access')
    .select('id, template_id, user_id, created_at')
    .eq('template_id', t.id);
  const userIds = (userAccess || []).map((ua: any) => ua.user_id);
  const usersMap: Record<string, any> = {};
  if (userIds.length > 0) {
    const { data: users } = await supabaseAdmin
      .from('users')
      .select('id, display_name, email, avatar_url')
      .in('id', userIds);
    (users || []).forEach((u: any) => { usersMap[u.id] = u; });
  }

  const { count: instanceCount } = await supabaseAdmin
    .from('folders')
    .select('*', { count: 'exact', head: true })
    .eq('client_space_template_id', t.id)
    .is('deleted_at', null);

  return {
    ...t,
    role_access: (roleAccess || []).map((ra: any) => ({ ...ra, role: rolesMap[ra.role_id] || null })),
    user_access: (userAccess || []).map((ua: any) => ({ ...ua, user: usersMap[ua.user_id] || null })),
    instance_count: instanceCount || 0,
  };
}

// GET /admin/client-spaces
router.get('/', async (_req: Request, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('client_space_templates')
      .select('*')
      .order('name');

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    const enriched = await Promise.all((data || []).map(enrichTemplate));
    res.json({ success: true, data: enriched });
  } catch (err) {
    console.error('List client-space templates error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /admin/client-spaces/:id
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('client_space_templates')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (error || !data) {
      res.status(404).json({ success: false, error: 'Template not found' });
      return;
    }
    const enriched = await enrichTemplate(data);
    res.json({ success: true, data: enriched });
  } catch (err) {
    console.error('Get client-space template error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /admin/client-spaces — create a new template
const createSchema = z.object({
  slug: z.string().min(1).max(60).regex(/^[a-z0-9-]+$/, 'slug must be lowercase-dashed'),
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  icon: z.string().max(50).optional(),
  category: z.string().max(50).optional(),
  template: z
    .object({
      lists: z
        .array(
          z.object({
            name: z.string().min(1),
            position: z.number().int().min(0),
            default_view: z.enum(['list', 'board']).optional(),
          }),
        )
        .default([]),
    })
    .default({ lists: [] }),
});

router.post('/', async (req: Request, res: Response) => {
  try {
    const body = createSchema.parse(req.body);

    const insert = {
      slug: body.slug,
      name: body.name,
      description: body.description || '',
      icon: body.icon || 'folder',
      category: body.category || 'general',
      template: body.template,
    };

    const { data, error } = await supabaseAdmin
      .from('client_space_templates')
      .insert(insert)
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        res.status(409).json({ success: false, error: 'A template with this slug already exists' });
        return;
      }
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.status(201).json({ success: true, data: await enrichTemplate(data) });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Create template error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PUT /admin/client-spaces/:id
const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  icon: z.string().max(50).optional(),
  category: z.string().max(50).optional(),
  is_enabled: z.boolean().optional(),
  template: z
    .object({
      lists: z
        .array(
          z.object({
            name: z.string().min(1),
            position: z.number().int().min(0),
            default_view: z.enum(['list', 'board']).optional(),
          }),
        )
        .default([]),
    })
    .optional(),
});

router.put('/:id', async (req: Request, res: Response) => {
  try {
    const body = updateSchema.parse(req.body);
    const update: Record<string, unknown> = { ...body };

    // Bump version if template changed
    if (body.template) {
      const { data: current } = await supabaseAdmin
        .from('client_space_templates')
        .select('version')
        .eq('id', req.params.id)
        .single();
      update.version = (current?.version || 1) + 1;
    }

    const { data, error } = await supabaseAdmin
      .from('client_space_templates')
      .update(update)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true, data: await enrichTemplate(data) });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Update template error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /admin/client-spaces/:id
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { count } = await supabaseAdmin
      .from('folders')
      .select('*', { count: 'exact', head: true })
      .eq('client_space_template_id', req.params.id)
      .is('deleted_at', null);

    if ((count || 0) > 0) {
      res.status(400).json({
        success: false,
        error: `Cannot delete: ${count} folder(s) are using this template. Disable it instead.`,
      });
      return;
    }

    const { error } = await supabaseAdmin
      .from('client_space_templates')
      .delete()
      .eq('id', req.params.id);

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true, message: 'Template deleted' });
  } catch (err) {
    console.error('Delete template error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// --- Role access ---
const addRoleSchema = z.object({ role_id: z.string().uuid() });

router.post('/:id/roles', async (req: Request, res: Response) => {
  try {
    const body = addRoleSchema.parse(req.body);
    const { data, error } = await supabaseAdmin
      .from('client_space_template_role_access')
      .insert({ template_id: req.params.id, role_id: body.role_id })
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

router.delete('/:id/roles/:roleId', async (req: Request, res: Response) => {
  try {
    const { error } = await supabaseAdmin
      .from('client_space_template_role_access')
      .delete()
      .eq('template_id', req.params.id)
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

// --- User access ---
const addUserSchema = z.object({ user_id: z.string().uuid() });

router.post('/:id/users', async (req: Request, res: Response) => {
  try {
    const body = addUserSchema.parse(req.body);
    const { data, error } = await supabaseAdmin
      .from('client_space_template_user_access')
      .insert({ template_id: req.params.id, user_id: body.user_id })
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

    const { data: user } = await supabaseAdmin
      .from('users')
      .select('id, display_name, email, avatar_url')
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

router.delete('/:id/users/:userId', async (req: Request, res: Response) => {
  try {
    const { error } = await supabaseAdmin
      .from('client_space_template_user_access')
      .delete()
      .eq('template_id', req.params.id)
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
