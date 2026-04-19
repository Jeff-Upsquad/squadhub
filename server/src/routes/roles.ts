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

const homeViewSchema = z.enum(['member', 'user', 'guest']);

const createRoleSchema = z.object({
  name: z.string().min(1).max(30),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  permissions: permissionsSchema,
  home_view: homeViewSchema.optional(),
});

const updateRoleSchema = z.object({
  name: z.string().min(1).max(30).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  permissions: permissionsSchema.optional(),
  home_view: homeViewSchema.optional(),
});

// GET /admin/roles — list all roles with member counts
router.get('/roles', async (_req: Request, res: Response) => {
  try {
    // Select with home_view; fall back to bare select if migration 023 isn't applied yet.
    let { data: roles, error } = await supabaseAdmin
      .from('roles')
      .select('id, name, color, permissions, is_default, is_system, system_key, home_view, created_at, updated_at')
      .order('created_at', { ascending: true });

    if (error && /home_view/.test(error.message || '')) {
      const fallback = await supabaseAdmin
        .from('roles')
        .select('id, name, color, permissions, is_default, is_system, system_key, created_at, updated_at')
        .order('created_at', { ascending: true });
      roles = fallback.data as typeof roles;
      error = fallback.error;
    }

    if (error) {
      console.error('List roles DB error:', error);
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

    // Sort: default roles first, then by created_at
    rolesWithCounts.sort((a: any, b: any) => {
      if (a.is_default && !b.is_default) return -1;
      if (!a.is_default && b.is_default) return 1;
      return 0;
    });

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

    // Try insert with home_view; fall back if column not yet present.
    let insertResult = await supabaseAdmin
      .from('roles')
      .insert({
        name: body.name,
        color: body.color,
        permissions: body.permissions,
        home_view: body.home_view ?? 'user',
      })
      .select()
      .single();

    if (insertResult.error && /home_view/.test(insertResult.error.message || '')) {
      insertResult = await supabaseAdmin
        .from('roles')
        .insert({
          name: body.name,
          color: body.color,
          permissions: body.permissions,
        })
        .select()
        .single();
    }

    const { data, error } = insertResult;

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

    // System roles may have their color and permissions edited,
    // but not their name (the name is what the app and other seeded
    // rows reference for display).
    if (body.name !== undefined) {
      const { data: existing } = await supabaseAdmin
        .from('roles')
        .select('is_system, name')
        .eq('id', id)
        .single();

      if (existing?.is_system && body.name !== existing.name) {
        res.status(400).json({
          success: false,
          error: `"${existing.name}" is a system role and cannot be renamed`,
        });
        return;
      }
    }

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.name !== undefined) updates.name = body.name;
    if (body.color !== undefined) updates.color = body.color;
    if (body.permissions !== undefined) updates.permissions = body.permissions;
    if (body.home_view !== undefined) updates.home_view = body.home_view;

    let updateResult = await supabaseAdmin
      .from('roles')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (updateResult.error && /home_view/.test(updateResult.error.message || '')) {
      const { home_view: _ignored, ...rest } = updates;
      updateResult = await supabaseAdmin
        .from('roles')
        .update(rest)
        .eq('id', id)
        .select()
        .single();
    }

    const { data, error } = updateResult;

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

    // Check if it's the default or a seeded system role
    const { data: role } = await supabaseAdmin
      .from('roles')
      .select('is_default, is_system, name')
      .eq('id', id)
      .single();

    if (role?.is_default) {
      res.status(400).json({ success: false, error: 'Cannot delete the default role' });
      return;
    }
    if (role?.is_system) {
      res.status(400).json({
        success: false,
        error: `"${role.name}" is a system role and cannot be deleted`,
      });
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
