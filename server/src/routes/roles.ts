import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { supabaseAdmin } from '../supabase';

const router = Router();

// All role routes require auth + admin
router.use(requireAuth);
router.use(requireAdmin);

const permissionsSchema = z.object({
  can_manage_channels: z.boolean(),
  can_delete_messages: z.boolean(),
  can_manage_members: z.boolean(),
  can_manage_tasks: z.boolean(),
  can_manage_roles: z.boolean(),
  can_view_admin_panel: z.boolean(),
  can_manage_workspace: z.boolean(),
});

const createRoleSchema = z.object({
  name: z.string().min(1).max(30),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  permissions: permissionsSchema,
});

const updateRoleSchema = z.object({
  name: z.string().min(1).max(30).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  permissions: permissionsSchema.optional(),
});

// GET /admin/roles — list all roles with member counts
router.get('/roles', async (_req: Request, res: Response) => {
  try {
    const { data: roles, error } = await supabaseAdmin
      .from('roles')
      .select('*')
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: true });

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    // Get member counts per role
    const { data: counts } = await supabaseAdmin
      .from('workspace_members')
      .select('role_id');

    const countMap: Record<string, number> = {};
    (counts || []).forEach((m: any) => {
      if (m.role_id) {
        countMap[m.role_id] = (countMap[m.role_id] || 0) + 1;
      }
    });

    const rolesWithCounts = (roles || []).map((role: any) => ({
      ...role,
      member_count: countMap[role.id] || 0,
    }));

    res.json({ success: true, data: rolesWithCounts });
  } catch (err) {
    console.error('List roles error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /admin/roles — create a new role
router.post('/roles', async (req: Request, res: Response) => {
  try {
    const body = createRoleSchema.parse(req.body);

    const { data, error } = await supabaseAdmin
      .from('roles')
      .insert({
        name: body.name,
        color: body.color,
        permissions: body.permissions,
      })
      .select()
      .single();

    if (error) {
      console.error('Create role DB error:', error);
      const msg = error.message.includes('unique')
        ? 'A role with that name already exists'
        : error.message;
      res.status(400).json({ success: false, error: msg });
      return;
    }

    res.status(201).json({ success: true, data });
  } catch (err) {
    if (err instanceof z.ZodError) {
      console.error('Create role validation error:', err.errors);
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Create role error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PUT /admin/roles/:id — update a role
router.put('/roles/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const body = updateRoleSchema.parse(req.body);

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.name !== undefined) updates.name = body.name;
    if (body.color !== undefined) updates.color = body.color;
    if (body.permissions !== undefined) updates.permissions = body.permissions;

    const { data, error } = await supabaseAdmin
      .from('roles')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Update role DB error:', error);
      const msg = error.message.includes('unique')
        ? 'A role with that name already exists'
        : error.message;
      res.status(400).json({ success: false, error: msg });
      return;
    }

    res.json({ success: true, data });
  } catch (err) {
    if (err instanceof z.ZodError) {
      console.error('Update role validation error:', err.errors);
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Update role error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /admin/roles/:id — delete a role (not the default one)
router.delete('/roles/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id;

    // Check if it's the default role
    const { data: role } = await supabaseAdmin
      .from('roles')
      .select('is_default')
      .eq('id', id)
      .single();

    if (role?.is_default) {
      res.status(400).json({ success: false, error: 'Cannot delete the default role' });
      return;
    }

    // Reassign members with this role to the default role
    const { data: defaultRole } = await supabaseAdmin
      .from('roles')
      .select('id')
      .eq('is_default', true)
      .single();

    if (defaultRole) {
      await supabaseAdmin
        .from('workspace_members')
        .update({ role_id: defaultRole.id })
        .eq('role_id', id);
    }

    // Delete the role
    const { error } = await supabaseAdmin.from('roles').delete().eq('id', id);

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.json({ success: true, message: 'Role deleted' });
  } catch (err) {
    console.error('Delete role error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
