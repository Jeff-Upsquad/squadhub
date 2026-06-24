import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { supabaseAdmin } from '../supabase';
import { getAdminWorkspaceId, getDefaultGroupId } from '../utils/labels';

const router = Router();
router.use(requireAuth);
router.use(requireAdmin);

const LABEL_COLUMNS = 'id, workspace_id, group_id, name, color';

// Resolve (and cache on req) the workspace this admin manages labels for.
async function workspaceFor(req: Request, res: Response): Promise<string | null> {
  const wsId = await getAdminWorkspaceId(req.userId!);
  if (!wsId) {
    res.status(400).json({ success: false, error: 'No workspace found for this admin' });
    return null;
  }
  return wsId;
}

// Enrich a label group with its visibility access rows + labels.
async function enrichGroup(group: any) {
  const { data: roleAccess } = await supabaseAdmin
    .from('label_group_role_access')
    .select('id, group_id, role_id, created_at')
    .eq('group_id', group.id);
  const roleIds = (roleAccess || []).map((r: any) => r.role_id);
  const rolesMap: Record<string, any> = {};
  if (roleIds.length) {
    const { data: roles } = await supabaseAdmin
      .from('roles')
      .select('id, name, color')
      .in('id', roleIds);
    (roles || []).forEach((r: any) => { rolesMap[r.id] = r; });
  }

  const { data: userAccess } = await supabaseAdmin
    .from('label_group_user_access')
    .select('id, group_id, user_id, created_at')
    .eq('group_id', group.id);
  const userIds = (userAccess || []).map((u: any) => u.user_id);
  const usersMap: Record<string, any> = {};
  if (userIds.length) {
    const { data: users } = await supabaseAdmin
      .from('users')
      .select('id, display_name, email')
      .in('id', userIds);
    (users || []).forEach((u: any) => { usersMap[u.id] = u; });
  }

  const { data: labels } = await supabaseAdmin
    .from('task_tags')
    .select(LABEL_COLUMNS)
    .eq('group_id', group.id)
    .order('name', { ascending: true });

  return {
    ...group,
    role_access: (roleAccess || []).map((r: any) => ({ ...r, role: rolesMap[r.role_id] || null })),
    user_access: (userAccess || []).map((u: any) => ({ ...u, user: usersMap[u.user_id] || null })),
    labels: labels || [],
  };
}

// ============================================================
// Groups
// ============================================================

// GET /admin/labels/groups — all groups (enriched) for the admin workspace.
router.get('/groups', async (req: Request, res: Response) => {
  try {
    const workspaceId = await workspaceFor(req, res);
    if (!workspaceId) return;
    const { data: groups, error } = await supabaseAdmin
      .from('label_groups')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('is_default', { ascending: false })
      .order('position', { ascending: true })
      .order('name', { ascending: true });
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    const enriched = await Promise.all((groups || []).map(enrichGroup));
    res.json({ success: true, data: enriched });
  } catch (err) {
    console.error('List label groups error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /admin/labels/groups/:id — single group enriched.
router.get('/groups/:id', async (req: Request, res: Response) => {
  try {
    const workspaceId = await workspaceFor(req, res);
    if (!workspaceId) return;
    const { data: group, error } = await supabaseAdmin
      .from('label_groups')
      .select('*')
      .eq('id', req.params.id)
      .eq('workspace_id', workspaceId)
      .maybeSingle();
    if (error || !group) {
      res.status(404).json({ success: false, error: 'Group not found' });
      return;
    }
    res.json({ success: true, data: await enrichGroup(group) });
  } catch (err) {
    console.error('Get label group error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

const groupCreateSchema = z.object({ name: z.string().trim().min(1).max(60) });

// POST /admin/labels/groups — create a (non-default) group.
router.post('/groups', async (req: Request, res: Response) => {
  try {
    const workspaceId = await workspaceFor(req, res);
    if (!workspaceId) return;
    const body = groupCreateSchema.parse(req.body);

    const { count } = await supabaseAdmin
      .from('label_groups')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId);

    const { data, error } = await supabaseAdmin
      .from('label_groups')
      .insert({
        workspace_id: workspaceId,
        name: body.name,
        is_default: false,
        position: count || 0,
        created_by: req.userId!,
      })
      .select('*')
      .single();
    if (error) {
      if (error.code === '23505') {
        res.status(409).json({ success: false, error: 'A group with that name already exists' });
        return;
      }
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true, data: await enrichGroup(data) });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Create label group error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

const groupUpdateSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  position: z.number().int().min(0).optional(),
});

// PUT /admin/labels/groups/:id — rename / reorder (default group can be renamed too).
router.put('/groups/:id', async (req: Request, res: Response) => {
  try {
    const workspaceId = await workspaceFor(req, res);
    if (!workspaceId) return;
    const body = groupUpdateSchema.parse(req.body);
    const { data, error } = await supabaseAdmin
      .from('label_groups')
      .update({ ...body, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('workspace_id', workspaceId)
      .select('*')
      .single();
    if (error) {
      if (error.code === '23505') {
        res.status(409).json({ success: false, error: 'A group with that name already exists' });
        return;
      }
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true, data: await enrichGroup(data) });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Update label group error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /admin/labels/groups/:id — reassign labels to General, then delete.
router.delete('/groups/:id', async (req: Request, res: Response) => {
  try {
    const workspaceId = await workspaceFor(req, res);
    if (!workspaceId) return;
    const { data: group } = await supabaseAdmin
      .from('label_groups')
      .select('id, is_default')
      .eq('id', req.params.id)
      .eq('workspace_id', workspaceId)
      .maybeSingle();
    if (!group) {
      res.status(404).json({ success: false, error: 'Group not found' });
      return;
    }
    if ((group as any).is_default) {
      res.status(400).json({ success: false, error: 'The default group cannot be deleted' });
      return;
    }
    const generalId = await getDefaultGroupId(workspaceId);
    if (generalId) {
      await supabaseAdmin
        .from('task_tags')
        .update({ group_id: generalId })
        .eq('group_id', req.params.id);
    }
    const { error } = await supabaseAdmin
      .from('label_groups')
      .delete()
      .eq('id', req.params.id)
      .eq('workspace_id', workspaceId);
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true, message: 'Group deleted; its labels moved to General' });
  } catch (err) {
    console.error('Delete label group error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============================================================
// Group visibility access (roles / users)
// ============================================================

const addRoleSchema = z.object({ role_id: z.string().uuid() });
const addUserSchema = z.object({ user_id: z.string().uuid() });

router.post('/groups/:id/roles', async (req: Request, res: Response) => {
  try {
    const body = addRoleSchema.parse(req.body);
    const { data, error } = await supabaseAdmin
      .from('label_group_role_access')
      .insert({ group_id: req.params.id, role_id: body.role_id })
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
      .from('roles').select('id, name, color').eq('id', body.role_id).single();
    res.json({ success: true, data: { ...data, role } });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Add group role access error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.delete('/groups/:id/roles/:roleId', async (req: Request, res: Response) => {
  try {
    const { error } = await supabaseAdmin
      .from('label_group_role_access')
      .delete()
      .eq('group_id', req.params.id)
      .eq('role_id', req.params.roleId);
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true, message: 'Role access removed' });
  } catch (err) {
    console.error('Remove group role access error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.post('/groups/:id/users', async (req: Request, res: Response) => {
  try {
    const body = addUserSchema.parse(req.body);
    const { data, error } = await supabaseAdmin
      .from('label_group_user_access')
      .insert({ group_id: req.params.id, user_id: body.user_id })
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
      .from('users').select('id, display_name, email').eq('id', body.user_id).single();
    res.json({ success: true, data: { ...data, user } });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Add group user access error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.delete('/groups/:id/users/:userId', async (req: Request, res: Response) => {
  try {
    const { error } = await supabaseAdmin
      .from('label_group_user_access')
      .delete()
      .eq('group_id', req.params.id)
      .eq('user_id', req.params.userId);
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true, message: 'User access removed' });
  } catch (err) {
    console.error('Remove group user access error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============================================================
// Labels
// ============================================================

const labelCreateSchema = z.object({
  name: z.string().trim().min(1).max(60),
  group_id: z.string().uuid(),
  color: z.string().max(20).optional(),
});

router.post('/', async (req: Request, res: Response) => {
  try {
    const workspaceId = await workspaceFor(req, res);
    if (!workspaceId) return;
    const body = labelCreateSchema.parse(req.body);

    // group must belong to this workspace
    const { data: group } = await supabaseAdmin
      .from('label_groups').select('id').eq('id', body.group_id).eq('workspace_id', workspaceId).maybeSingle();
    if (!group) {
      res.status(400).json({ success: false, error: 'Group not found in workspace' });
      return;
    }

    const insert: Record<string, unknown> = {
      workspace_id: workspaceId,
      group_id: body.group_id,
      name: body.name,
    };
    if (body.color) insert.color = body.color;

    const { data, error } = await supabaseAdmin
      .from('task_tags').insert(insert).select(LABEL_COLUMNS).single();
    if (error) {
      if (error.code === '23505') {
        res.status(409).json({ success: false, error: 'A label with that name already exists' });
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
    console.error('Create label error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

const labelUpdateSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  color: z.string().max(20).optional(),
  group_id: z.string().uuid().optional(),
});

router.put('/:id', async (req: Request, res: Response) => {
  try {
    const workspaceId = await workspaceFor(req, res);
    if (!workspaceId) return;
    const body = labelUpdateSchema.parse(req.body);

    if (body.group_id) {
      const { data: group } = await supabaseAdmin
        .from('label_groups').select('id').eq('id', body.group_id).eq('workspace_id', workspaceId).maybeSingle();
      if (!group) {
        res.status(400).json({ success: false, error: 'Group not found in workspace' });
        return;
      }
    }

    const { data, error } = await supabaseAdmin
      .from('task_tags')
      .update(body)
      .eq('id', req.params.id)
      .eq('workspace_id', workspaceId)
      .select(LABEL_COLUMNS)
      .single();
    if (error) {
      if (error.code === '23505') {
        res.status(409).json({ success: false, error: 'A label with that name already exists' });
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
    console.error('Update label error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const workspaceId = await workspaceFor(req, res);
    if (!workspaceId) return;
    const { error } = await supabaseAdmin
      .from('task_tags')
      .delete()
      .eq('id', req.params.id)
      .eq('workspace_id', workspaceId);
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true, message: 'Label deleted' });
  } catch (err) {
    console.error('Delete label error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============================================================
// Create-label permission grants
// ============================================================

router.get('/create-access', async (req: Request, res: Response) => {
  try {
    const workspaceId = await workspaceFor(req, res);
    if (!workspaceId) return;

    const { data: roleRows } = await supabaseAdmin
      .from('label_create_role_access')
      .select('id, role_id')
      .eq('workspace_id', workspaceId);
    const roleIds = (roleRows || []).map((r: any) => r.role_id);
    const rolesMap: Record<string, any> = {};
    if (roleIds.length) {
      const { data: roles } = await supabaseAdmin.from('roles').select('id, name, color').in('id', roleIds);
      (roles || []).forEach((r: any) => { rolesMap[r.id] = r; });
    }

    const { data: userRows } = await supabaseAdmin
      .from('label_create_user_access')
      .select('id, user_id')
      .eq('workspace_id', workspaceId);
    const userIds = (userRows || []).map((u: any) => u.user_id);
    const usersMap: Record<string, any> = {};
    if (userIds.length) {
      const { data: users } = await supabaseAdmin.from('users').select('id, display_name, email').in('id', userIds);
      (users || []).forEach((u: any) => { usersMap[u.id] = u; });
    }

    res.json({
      success: true,
      data: {
        roles: (roleRows || []).map((r: any) => ({ ...r, role: rolesMap[r.role_id] || null })),
        users: (userRows || []).map((u: any) => ({ ...u, user: usersMap[u.user_id] || null })),
      },
    });
  } catch (err) {
    console.error('Get create-access error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.post('/create-access/roles', async (req: Request, res: Response) => {
  try {
    const workspaceId = await workspaceFor(req, res);
    if (!workspaceId) return;
    const body = addRoleSchema.parse(req.body);
    const { data, error } = await supabaseAdmin
      .from('label_create_role_access')
      .insert({ workspace_id: workspaceId, role_id: body.role_id })
      .select()
      .single();
    if (error) {
      if (error.code === '23505') {
        res.status(409).json({ success: false, error: 'Role already has permission' });
        return;
      }
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    const { data: role } = await supabaseAdmin.from('roles').select('id, name, color').eq('id', body.role_id).single();
    res.json({ success: true, data: { ...data, role } });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Add create-access role error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.delete('/create-access/roles/:roleId', async (req: Request, res: Response) => {
  try {
    const workspaceId = await workspaceFor(req, res);
    if (!workspaceId) return;
    const { error } = await supabaseAdmin
      .from('label_create_role_access')
      .delete()
      .eq('workspace_id', workspaceId)
      .eq('role_id', req.params.roleId);
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true, message: 'Permission removed' });
  } catch (err) {
    console.error('Remove create-access role error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.post('/create-access/users', async (req: Request, res: Response) => {
  try {
    const workspaceId = await workspaceFor(req, res);
    if (!workspaceId) return;
    const body = addUserSchema.parse(req.body);
    const { data, error } = await supabaseAdmin
      .from('label_create_user_access')
      .insert({ workspace_id: workspaceId, user_id: body.user_id })
      .select()
      .single();
    if (error) {
      if (error.code === '23505') {
        res.status(409).json({ success: false, error: 'User already has permission' });
        return;
      }
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    const { data: user } = await supabaseAdmin.from('users').select('id, display_name, email').eq('id', body.user_id).single();
    res.json({ success: true, data: { ...data, user } });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Add create-access user error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.delete('/create-access/users/:userId', async (req: Request, res: Response) => {
  try {
    const workspaceId = await workspaceFor(req, res);
    if (!workspaceId) return;
    const { error } = await supabaseAdmin
      .from('label_create_user_access')
      .delete()
      .eq('workspace_id', workspaceId)
      .eq('user_id', req.params.userId);
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true, message: 'Permission removed' });
  } catch (err) {
    console.error('Remove create-access user error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============================================================
// Label requests inbox
// ============================================================

router.get('/requests', async (req: Request, res: Response) => {
  try {
    const workspaceId = await workspaceFor(req, res);
    if (!workspaceId) return;
    const status = req.query.status as string | undefined;

    let q = supabaseAdmin
      .from('label_requests')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false });
    if (status) q = q.eq('status', status);

    const { data: requests, error } = await q;
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    const userIds = Array.from(new Set((requests || []).map((r: any) => r.requested_by).filter(Boolean)));
    const usersMap: Record<string, any> = {};
    if (userIds.length) {
      const { data: users } = await supabaseAdmin.from('users').select('id, display_name, email').in('id', userIds);
      (users || []).forEach((u: any) => { usersMap[u.id] = u; });
    }
    const groupIds = Array.from(new Set((requests || []).map((r: any) => r.suggested_group_id).filter(Boolean)));
    const groupsMap: Record<string, any> = {};
    if (groupIds.length) {
      const { data: groups } = await supabaseAdmin.from('label_groups').select('id, name').in('id', groupIds);
      (groups || []).forEach((g: any) => { groupsMap[g.id] = g; });
    }

    res.json({
      success: true,
      data: (requests || []).map((r: any) => ({
        ...r,
        requester: r.requested_by ? usersMap[r.requested_by] || null : null,
        suggested_group: r.suggested_group_id ? groupsMap[r.suggested_group_id] || null : null,
      })),
    });
  } catch (err) {
    console.error('List label requests error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

const approveSchema = z.object({
  group_id: z.string().uuid().optional(),
  color: z.string().max(20).optional(),
});

// POST /admin/labels/requests/:id/approve — create the label, resolve request.
router.post('/requests/:id/approve', async (req: Request, res: Response) => {
  try {
    const workspaceId = await workspaceFor(req, res);
    if (!workspaceId) return;
    const body = approveSchema.parse(req.body);

    const { data: request } = await supabaseAdmin
      .from('label_requests')
      .select('*')
      .eq('id', req.params.id)
      .eq('workspace_id', workspaceId)
      .maybeSingle();
    if (!request) {
      res.status(404).json({ success: false, error: 'Request not found' });
      return;
    }
    if ((request as any).status !== 'pending') {
      res.status(400).json({ success: false, error: 'Request already resolved' });
      return;
    }

    const generalId = await getDefaultGroupId(workspaceId);
    const targetGroupId = body.group_id || (request as any).suggested_group_id || generalId;
    if (!targetGroupId) {
      res.status(400).json({ success: false, error: 'No target group available' });
      return;
    }
    // validate target group is in workspace
    const { data: group } = await supabaseAdmin
      .from('label_groups').select('id').eq('id', targetGroupId).eq('workspace_id', workspaceId).maybeSingle();
    if (!group) {
      res.status(400).json({ success: false, error: 'Group not found in workspace' });
      return;
    }

    // Create label (idempotent on duplicate name).
    const insert: Record<string, unknown> = {
      workspace_id: workspaceId,
      group_id: targetGroupId,
      name: (request as any).name,
    };
    if (body.color) insert.color = body.color;

    let label: any = null;
    const { data: created, error: createErr } = await supabaseAdmin
      .from('task_tags').insert(insert).select(LABEL_COLUMNS).single();
    if (createErr) {
      if (createErr.code === '23505') {
        const { data: existing } = await supabaseAdmin
          .from('task_tags').select(LABEL_COLUMNS)
          .eq('workspace_id', workspaceId).ilike('name', (request as any).name).maybeSingle();
        label = existing;
      } else {
        res.status(500).json({ success: false, error: createErr.message });
        return;
      }
    } else {
      label = created;
    }

    const { data: updated, error: updErr } = await supabaseAdmin
      .from('label_requests')
      .update({
        status: 'approved',
        resolved_by: req.userId!,
        resolved_label_id: label?.id ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', req.params.id)
      .select('*')
      .single();
    if (updErr) {
      res.status(500).json({ success: false, error: updErr.message });
      return;
    }

    res.json({ success: true, data: { request: updated, label } });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Approve label request error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.post('/requests/:id/reject', async (req: Request, res: Response) => {
  try {
    const workspaceId = await workspaceFor(req, res);
    if (!workspaceId) return;
    const { data: updated, error } = await supabaseAdmin
      .from('label_requests')
      .update({
        status: 'rejected',
        resolved_by: req.userId!,
        updated_at: new Date().toISOString(),
      })
      .eq('id', req.params.id)
      .eq('workspace_id', workspaceId)
      .eq('status', 'pending')
      .select('*')
      .maybeSingle();
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    if (!updated) {
      res.status(404).json({ success: false, error: 'Pending request not found' });
      return;
    }
    res.json({ success: true, data: updated });
  } catch (err) {
    console.error('Reject label request error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
