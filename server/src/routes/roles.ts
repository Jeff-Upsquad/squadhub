import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { supabaseAdmin } from '../supabase';

const router = Router();

// All role routes require auth + admin. Scoped to '/roles' because this router
// is mounted at '/admin' — see the note in admin.ts: a bare gate here would
// also intercept every sibling /admin/* router and 403 their mini-app users.
router.use('/roles', requireAuth);
router.use('/roles', requireAdmin);

const permissionsSchema = z
  .object({
    can_manage_channels: z.boolean().optional(),
    can_delete_messages: z.boolean().optional(),
    can_manage_members: z.boolean().optional(),
    can_manage_tasks: z.boolean().optional(),
    can_manage_roles: z.boolean().optional(),
    can_view_admin_panel: z.boolean().optional(),
    can_manage_workspace: z.boolean().optional(),
    can_edit_time_logs: z.boolean().optional(),
    time_edit_window_hours: z.number().int().min(0).max(720).optional(),
  })
  .passthrough();

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
      .select('id, name, color, permissions, is_default, is_system, system_key, created_at, updated_at')
      .order('created_at', { ascending: true });

    if (error) {
      console.error('List roles DB error:', error);
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    // Get member counts per role
    const { data: primaryMemberships } = await supabaseAdmin
      .from('workspace_members')
      .select('id, role_id');
    const { data: secondaryMemberships } = await supabaseAdmin
      .from('workspace_member_secondary_roles')
      .select('workspace_member_id, role_id');

    const memberSets: Record<string, Set<string>> = {};
    (primaryMemberships || []).forEach((m: any) => {
      if (m.role_id) (memberSets[m.role_id] ||= new Set()).add(m.id);
    });
    (secondaryMemberships || []).forEach((m: any) => {
      if (m.role_id) (memberSets[m.role_id] ||= new Set()).add(m.workspace_member_id);
    });

    const rolesWithCounts = (roles || []).map((role: any) => ({
      ...role,
      member_count: memberSets[role.id]?.size || 0,
    }));

    // Protected hierarchy first: Admin > Managers > Internal/Member.
    const systemRank: Record<string, number> = {
      admin: 0,
      manager: 1,
      member: 2,
      sales: 3,
      user: 4,
      guest: 5,
    };
    rolesWithCounts.sort((a: any, b: any) => {
      const aRank = systemRank[a.system_key] ?? 10;
      const bRank = systemRank[b.system_key] ?? 10;
      if (aRank !== bRank) return aRank - bRank;
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
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

    // System roles may have their color and permissions edited,
    // but not their name (the name is what the app and other seeded
    // rows reference for display).
    if (body.name !== undefined) {
      const { data: existing } = await supabaseAdmin
        .from('roles')
        .select('is_system, name, system_key')
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

    const { data: protectedRole } = await supabaseAdmin
      .from('roles')
      .select('system_key')
      .eq('id', id)
      .single();
    if (protectedRole?.system_key === 'admin' && body.permissions !== undefined) {
      res.status(400).json({
        success: false,
        error: 'Admin is the protected top role; its full-access permissions cannot be reduced',
      });
      return;
    }
    if (protectedRole?.system_key === 'manager' && body.permissions &&
        (body.permissions.can_manage_roles === true ||
         body.permissions.can_view_admin_panel === true ||
         body.permissions.can_manage_workspace === true)) {
      res.status(400).json({
        success: false,
        error: 'Managers must remain below Admin and cannot receive platform-administration permissions',
      });
      return;
    }

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
