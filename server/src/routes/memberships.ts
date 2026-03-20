import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { checkResourceAccess, meetsAccessLevel, isWorkspaceAdmin } from '../middleware/permissions';
import { supabaseAdmin } from '../supabase';

const router = Router();
router.use(requireAuth);

const addMemberSchema = z.object({
  resource_type: z.enum(['channel', 'space', 'folder', 'list']),
  resource_id: z.string().uuid(),
  user_id: z.string().uuid(),
  access_level: z.enum(['viewer', 'commenter', 'member', 'manager']).default('viewer'),
});

const updateMemberSchema = z.object({
  access_level: z.enum(['viewer', 'commenter', 'member', 'manager']),
});

// GET /memberships?resource_type=X&resource_id=Y — list members of a resource
router.get('/', async (req: Request, res: Response) => {
  try {
    const resourceType = req.query.resource_type as string;
    const resourceId = req.query.resource_id as string;

    if (!resourceType || !resourceId) {
      res.status(400).json({ success: false, error: 'resource_type and resource_id are required' });
      return;
    }

    // Must be manager or admin to list members
    const userLevel = await checkResourceAccess(req.userId!, resourceType, resourceId);
    if (!userLevel || !meetsAccessLevel(userLevel, 'manager')) {
      const admin = await isWorkspaceAdmin(req.userId!);
      if (!admin) {
        res.status(403).json({ success: false, error: 'Manager access required to view members' });
        return;
      }
    }

    const { data, error } = await supabaseAdmin
      .from('resource_memberships')
      .select('*, users(id, display_name, email, avatar_url)')
      .eq('resource_type', resourceType)
      .eq('resource_id', resourceId)
      .order('created_at');

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    const members = (data || []).map((m: any) => ({
      ...m,
      user: m.users,
      users: undefined,
    }));

    res.json({ success: true, data: members });
  } catch (err) {
    console.error('Get memberships error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /memberships — invite a user to a resource
router.post('/', async (req: Request, res: Response) => {
  try {
    const body = addMemberSchema.parse(req.body);

    // Must be manager or admin to add members
    const userLevel = await checkResourceAccess(req.userId!, body.resource_type, body.resource_id);
    if (!userLevel || !meetsAccessLevel(userLevel, 'manager')) {
      const admin = await isWorkspaceAdmin(req.userId!);
      if (!admin) {
        res.status(403).json({ success: false, error: 'Manager access required to invite members' });
        return;
      }
    }

    const { data, error } = await supabaseAdmin
      .from('resource_memberships')
      .insert({
        resource_type: body.resource_type,
        resource_id: body.resource_id,
        user_id: body.user_id,
        access_level: body.access_level,
        invited_by: req.userId,
      })
      .select('*, users(id, display_name, email, avatar_url)')
      .single();

    if (error) {
      if (error.message.includes('unique') || error.code === '23505') {
        res.status(409).json({ success: false, error: 'User is already a member of this resource' });
        return;
      }
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.status(201).json({
      success: true,
      data: { ...data, user: (data as any).users, users: undefined },
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Add membership error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PUT /memberships/:id — update access level
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const body = updateMemberSchema.parse(req.body);

    // Get the membership to check resource
    const { data: existing } = await supabaseAdmin
      .from('resource_memberships')
      .select('resource_type, resource_id')
      .eq('id', id)
      .single();

    if (!existing) {
      res.status(404).json({ success: false, error: 'Membership not found' });
      return;
    }

    // Must be manager or admin
    const userLevel = await checkResourceAccess(req.userId!, existing.resource_type, existing.resource_id);
    if (!userLevel || !meetsAccessLevel(userLevel, 'manager')) {
      const admin = await isWorkspaceAdmin(req.userId!);
      if (!admin) {
        res.status(403).json({ success: false, error: 'Manager access required to change access levels' });
        return;
      }
    }

    const { data, error } = await supabaseAdmin
      .from('resource_memberships')
      .update({ access_level: body.access_level })
      .eq('id', id)
      .select('*, users(id, display_name, email, avatar_url)')
      .single();

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.json({
      success: true,
      data: { ...data, user: (data as any).users, users: undefined },
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Update membership error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /memberships/:id — remove a member
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id;

    // Get the membership
    const { data: existing } = await supabaseAdmin
      .from('resource_memberships')
      .select('resource_type, resource_id, user_id, access_level')
      .eq('id', id)
      .single();

    if (!existing) {
      res.status(404).json({ success: false, error: 'Membership not found' });
      return;
    }

    // Must be manager or admin
    const userLevel = await checkResourceAccess(req.userId!, existing.resource_type, existing.resource_id);
    if (!userLevel || !meetsAccessLevel(userLevel, 'manager')) {
      const admin = await isWorkspaceAdmin(req.userId!);
      if (!admin) {
        res.status(403).json({ success: false, error: 'Manager access required to remove members' });
        return;
      }
    }

    // Cannot remove the last manager
    if (existing.access_level === 'manager') {
      const { count } = await supabaseAdmin
        .from('resource_memberships')
        .select('*', { count: 'exact', head: true })
        .eq('resource_type', existing.resource_type)
        .eq('resource_id', existing.resource_id)
        .eq('access_level', 'manager');

      if ((count || 0) <= 1) {
        res.status(400).json({ success: false, error: 'Cannot remove the last manager of a resource' });
        return;
      }
    }

    const { error } = await supabaseAdmin.from('resource_memberships').delete().eq('id', id);

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.json({ success: true, message: 'Membership removed' });
  } catch (err) {
    console.error('Delete membership error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /memberships/my-permissions — get current user's workspace permissions
router.get('/my-permissions', async (req: Request, res: Response) => {
  try {
    const { data: membership } = await supabaseAdmin
      .from('workspace_members')
      .select('role, role_id, roles(permissions)')
      .eq('user_id', req.userId!)
      .single();

    if (!membership) {
      res.json({ success: true, data: { permissions: {}, workspaceRole: 'guest' } });
      return;
    }

    const workspaceRole = membership.role as string;

    // Admins get all permissions
    if (workspaceRole === 'admin' || workspaceRole === 'super_admin') {
      const allTrue: Record<string, boolean> = {};
      const keys = [
        'can_create_channels', 'can_create_lists', 'can_create_folders', 'can_create_spaces',
        'can_archive_lists', 'can_archive_spaces', 'can_archive_folders',
        'can_delete_messages', 'can_edit_messages', 'can_send_dms',
        'can_manage_channels', 'can_manage_members', 'can_manage_tasks', 'can_manage_roles',
        'can_view_admin_panel', 'can_manage_workspace',
      ];
      keys.forEach((k) => { allTrue[k] = true; });
      res.json({ success: true, data: { permissions: allTrue, workspaceRole } });
      return;
    }

    // Explicit-allow: start with all-false, overlay custom role permissions
    const customPerms = (membership as any).roles?.permissions as Record<string, boolean> | undefined;
    const effective: Record<string, boolean> = {};
    const keys = [
      'can_create_channels', 'can_create_lists', 'can_create_folders', 'can_create_spaces',
      'can_archive_lists', 'can_archive_spaces', 'can_archive_folders',
      'can_delete_messages', 'can_edit_messages', 'can_send_dms',
      'can_manage_channels', 'can_manage_members', 'can_manage_tasks', 'can_manage_roles',
      'can_view_admin_panel', 'can_manage_workspace',
    ];
    keys.forEach((k) => {
      effective[k] = customPerms?.[k] === true;
    });

    res.json({ success: true, data: { permissions: effective, workspaceRole } });
  } catch (err) {
    console.error('Get permissions error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
