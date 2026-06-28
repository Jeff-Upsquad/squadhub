import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requirePermission, isWorkspaceAdmin, checkResourceAccess, meetsAccessLevel, getUserPermissions } from '../middleware/permissions';
import { supabaseAdmin } from '../supabase';

const router = Router();

type ContainerType = 'space' | 'folder' | 'list';

// Resolve the workspace a container belongs to (for channel creation).
async function getContainerWorkspaceId(type: ContainerType, id: string): Promise<string | null> {
  if (type === 'space') {
    const { data } = await supabaseAdmin.from('spaces').select('workspace_id').eq('id', id).single();
    return data?.workspace_id ?? null;
  }
  const table = type === 'folder' ? 'folders' : 'lists';
  const { data: row } = await supabaseAdmin.from(table).select('space_id').eq('id', id).single();
  if (!row?.space_id) return null;
  const { data: space } = await supabaseAdmin.from('spaces').select('workspace_id').eq('id', row.space_id).single();
  return space?.workspace_id ?? null;
}

// The (resource_type, resource_id) pairs whose members should gain channel
// access — the container itself plus its ancestors, since access inherits
// list → folder → space.
async function containerMembershipScope(type: ContainerType, id: string): Promise<Array<{ t: string; id: string }>> {
  const pairs: Array<{ t: string; id: string }> = [{ t: type, id }];
  if (type === 'folder') {
    const { data } = await supabaseAdmin.from('folders').select('space_id').eq('id', id).single();
    if (data?.space_id) pairs.push({ t: 'space', id: data.space_id });
  } else if (type === 'list') {
    const { data } = await supabaseAdmin.from('lists').select('space_id, folder_id').eq('id', id).single();
    if (data?.folder_id) pairs.push({ t: 'folder', id: data.folder_id });
    if (data?.space_id) pairs.push({ t: 'space', id: data.space_id });
  }
  return pairs;
}

// Grant everyone with access to the container (and its ancestors) access to the
// linked channel, so the whole squad can chat immediately. Existing channel
// memberships are left untouched (no downgrade).
async function grantChannelAccessFromContainer(channelId: string, type: ContainerType, id: string): Promise<void> {
  const pairs = await containerMembershipScope(type, id);
  const userIds = new Set<string>();
  for (const p of pairs) {
    const { data } = await supabaseAdmin
      .from('resource_memberships')
      .select('user_id')
      .eq('resource_type', p.t)
      .eq('resource_id', p.id);
    for (const r of data || []) userIds.add(r.user_id as string);
  }
  if (userIds.size === 0) return;

  // Skip users who already have a channel membership (don't downgrade managers).
  const { data: existing } = await supabaseAdmin
    .from('resource_memberships')
    .select('user_id')
    .eq('resource_type', 'channel')
    .eq('resource_id', channelId);
  for (const r of existing || []) userIds.delete(r.user_id as string);
  if (userIds.size === 0) return;

  const rows = [...userIds].map((user_id) => ({
    resource_type: 'channel',
    resource_id: channelId,
    user_id,
    access_level: 'member',
  }));
  await supabaseAdmin.from('resource_memberships').insert(rows);
}

const createChannelSchema = z.object({
  workspace_id: z.string().uuid(),
  name: z.string().min(1).max(80).regex(/^[a-z0-9-]+$/, 'Channel name must be lowercase letters, numbers, and hyphens only'),
  description: z.string().max(250).optional(),
  is_private: z.boolean().optional().default(true),
});

// GET /channels?workspace_id=xxx — list channels the user has access to
router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const workspaceId = req.query.workspace_id as string;
    if (!workspaceId) {
      res.status(400).json({ success: false, error: 'workspace_id query param required' });
      return;
    }

    // Admins see all channels
    const admin = await isWorkspaceAdmin(req.userId!);
    if (admin) {
      const { data, error } = await supabaseAdmin
        .from('channels')
        .select('*')
        .eq('workspace_id', workspaceId)
        .is('deleted_at', null)
        .order('created_at', { ascending: true });

      if (error) {
        res.status(500).json({ success: false, error: error.message });
        return;
      }
      res.json({ success: true, data });
      return;
    }

    // Non-admins: only channels they have membership for, or they created
    const { data: memberships } = await supabaseAdmin
      .from('resource_memberships')
      .select('resource_id')
      .eq('resource_type', 'channel')
      .eq('user_id', req.userId!);

    const memberChannelIds = (memberships || []).map((m: any) => m.resource_id);

    // Also include channels the user created
    const { data: createdChannels } = await supabaseAdmin
      .from('channels')
      .select('id')
      .eq('workspace_id', workspaceId)
      .is('deleted_at', null)
      .eq('created_by', req.userId!);

    const createdIds = (createdChannels || []).map((c: any) => c.id);
    const allIds = [...new Set([...memberChannelIds, ...createdIds])];

    if (allIds.length === 0) {
      res.json({ success: true, data: [] });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('channels')
      .select('*')
      .eq('workspace_id', workspaceId)
      .is('deleted_at', null)
      .in('id', allIds)
      .order('created_at', { ascending: true });

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.json({ success: true, data });
  } catch (err) {
    console.error('Get channels error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /channels — create a new channel (requires can_create_channels permission)
router.post('/', requireAuth, requirePermission('can_create_channels'), async (req: Request, res: Response) => {
  try {
    const body = createChannelSchema.parse(req.body);

    const { data, error } = await supabaseAdmin
      .from('channels')
      .insert({
        workspace_id: body.workspace_id,
        name: body.name,
        description: body.description || null,
        is_private: body.is_private,
        created_by: req.userId,
      })
      .select()
      .single();

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.status(201).json({ success: true, data });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Create channel error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PUT /channels/:id — update channel settings (requires manager access)
router.put('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const userLevel = await checkResourceAccess(req.userId!, 'channel', id);
    if (!userLevel || !meetsAccessLevel(userLevel, 'manager')) {
      res.status(403).json({ success: false, error: 'Manager access required to update channels' });
      return;
    }

    const updates: Record<string, unknown> = {};
    if (req.body.name !== undefined) updates.name = req.body.name;
    if (req.body.description !== undefined) updates.description = req.body.description;

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ success: false, error: 'No fields to update' });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('channels')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.json({ success: true, data });
  } catch (err) {
    console.error('Update channel error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /channels/:id — soft-delete, requires manager access
router.delete('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const userLevel = await checkResourceAccess(req.userId!, 'channel', id);
    if (!userLevel || !meetsAccessLevel(userLevel, 'manager')) {
      res.status(403).json({ success: false, error: 'Manager access required to delete channels' });
      return;
    }

    const { error } = await supabaseAdmin
      .from('channels')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id);

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.json({ success: true, message: 'Channel moved to trash' });
  } catch (err) {
    console.error('Delete channel error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// --- Container ↔ channel linking -------------------------------------------

const linkSchema = z
  .object({
    resource_type: z.enum(['space', 'folder', 'list']),
    resource_id: z.string().uuid(),
    channel_id: z.string().uuid().optional(),
    create: z
      .object({
        name: z.string().min(1).max(80),
        description: z.string().max(250).optional(),
      })
      .optional(),
  })
  .refine((d) => d.channel_id || d.create, { message: 'channel_id or create is required' });

const unlinkSchema = z.object({
  resource_type: z.enum(['space', 'folder', 'list']),
  resource_id: z.string().uuid(),
});

function slugifyChannelName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
  return slug || 'channel';
}

// GET /channels/linked?resource_type=&resource_id= — the active linked channel
// for a container (or null). Only returned to users who can access the container.
router.get('/linked', requireAuth, async (req: Request, res: Response) => {
  try {
    const resourceType = req.query.resource_type as ContainerType;
    const resourceId = req.query.resource_id as string;
    if (!resourceType || !resourceId || !['space', 'folder', 'list'].includes(resourceType)) {
      res.status(400).json({ success: false, error: 'resource_type and resource_id are required' });
      return;
    }

    const access = await checkResourceAccess(req.userId!, resourceType, resourceId);
    if (!access) {
      res.json({ success: true, data: null });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('channels')
      .select('*')
      .eq('linked_resource_type', resourceType)
      .eq('linked_resource_id', resourceId)
      .is('deleted_at', null)
      .maybeSingle();

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true, data: data || null });
  } catch (err) {
    console.error('Get linked channel error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /channels/link — link an existing channel to a container, or create a new
// one and link it. Requires admin or 'manager' access on the container.
router.post('/link', requireAuth, async (req: Request, res: Response) => {
  try {
    const body = linkSchema.parse(req.body);

    // Gate: admin OR container manager.
    const admin = await isWorkspaceAdmin(req.userId!);
    if (!admin) {
      const level = await checkResourceAccess(req.userId!, body.resource_type, body.resource_id);
      if (!level || !meetsAccessLevel(level, 'manager')) {
        res.status(403).json({ success: false, error: 'Manager access required to link a channel' });
        return;
      }
    }

    let channelId = body.channel_id;

    if (channelId) {
      // Linking an existing channel — set its container link.
      const { error } = await supabaseAdmin
        .from('channels')
        .update({ linked_resource_type: body.resource_type, linked_resource_id: body.resource_id })
        .eq('id', channelId)
        .is('deleted_at', null);
      if (error) {
        const conflict = error.code === '23505';
        res.status(conflict ? 409 : 500).json({
          success: false,
          error: conflict ? 'This container is already linked to a channel' : error.message,
        });
        return;
      }
    } else {
      // Creating a new channel — also require the create-channels permission.
      const { permissions } = await getUserPermissions(req.userId!);
      if (!permissions.can_create_channels) {
        res.status(403).json({ success: false, error: 'Permission denied: can_create_channels is required' });
        return;
      }
      const workspaceId = await getContainerWorkspaceId(body.resource_type, body.resource_id);
      if (!workspaceId) {
        res.status(404).json({ success: false, error: 'Container not found' });
        return;
      }
      const { data, error } = await supabaseAdmin
        .from('channels')
        .insert({
          workspace_id: workspaceId,
          name: slugifyChannelName(body.create!.name),
          description: body.create!.description || null,
          is_private: true,
          created_by: req.userId,
          linked_resource_type: body.resource_type,
          linked_resource_id: body.resource_id,
        })
        .select()
        .single();
      if (error) {
        const conflict = error.code === '23505';
        res.status(conflict ? 409 : 500).json({
          success: false,
          error: conflict ? 'This container is already linked to a channel' : error.message,
        });
        return;
      }
      channelId = data.id;
    }

    // Auto-grant container members access to the channel.
    await grantChannelAccessFromContainer(channelId!, body.resource_type, body.resource_id);

    const { data: channel } = await supabaseAdmin.from('channels').select('*').eq('id', channelId).single();
    res.status(201).json({ success: true, data: channel });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Link channel error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /channels/unlink — clear a container's channel link. Requires admin or
// 'manager' access on the container. Leaves the channel and memberships intact.
router.post('/unlink', requireAuth, async (req: Request, res: Response) => {
  try {
    const body = unlinkSchema.parse(req.body);

    const admin = await isWorkspaceAdmin(req.userId!);
    if (!admin) {
      const level = await checkResourceAccess(req.userId!, body.resource_type, body.resource_id);
      if (!level || !meetsAccessLevel(level, 'manager')) {
        res.status(403).json({ success: false, error: 'Manager access required to unlink a channel' });
        return;
      }
    }

    const { error } = await supabaseAdmin
      .from('channels')
      .update({ linked_resource_type: null, linked_resource_id: null })
      .eq('linked_resource_type', body.resource_type)
      .eq('linked_resource_id', body.resource_id);
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Unlink channel error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
