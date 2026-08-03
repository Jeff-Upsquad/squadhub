import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requirePermission, isWorkspaceAdmin, checkResourceAccess, meetsAccessLevel, getUserPermissions } from '../middleware/permissions';
import { supabaseAdmin } from '../supabase';

const router = Router();

type ContainerType = 'space' | 'folder' | 'list';
type CrmEntityType = 'crm_deal' | 'crm_contact' | 'crm_lead';
const CRM_ENTITY_TYPES: CrmEntityType[] = ['crm_deal', 'crm_contact', 'crm_lead'];
function isCrmEntityType(t: string): t is CrmEntityType {
  return (CRM_ENTITY_TYPES as string[]).includes(t);
}

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

// --- CRM entity chats ------------------------------------------------------

const crmEnsureSchema = z.object({
  workspace_id: z.string().uuid(),
  entity_type: z.enum(['crm_deal', 'crm_contact', 'crm_lead']),
  entity_id: z.string().uuid(),
  label: z.string().min(1).max(200),
  subtitle: z.string().max(200).optional().nullable(),
});

async function assertWorkspaceMember(userId: string, workspaceId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('workspace_members')
    .select('user_id')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .maybeSingle();
  return !!data;
}

/** Grant membership to specific users only (CRM chats: opener/assignee/@mention). */
async function grantChannelMembers(channelId: string, userIds: string[]): Promise<void> {
  const unique = [...new Set(userIds.filter(Boolean))];
  if (!unique.length) return;
  const { data: existing } = await supabaseAdmin
    .from('resource_memberships')
    .select('user_id')
    .eq('resource_type', 'channel')
    .eq('resource_id', channelId)
    .in('user_id', unique);
  const have = new Set((existing || []).map((r) => r.user_id as string));
  const rows = unique
    .filter((id) => !have.has(id))
    .map((user_id) => ({
      resource_type: 'channel',
      resource_id: channelId,
      user_id,
      access_level: 'member',
    }));
  if (rows.length) await supabaseAdmin.from('resource_memberships').insert(rows);
}

// POST /channels/crm/ensure — get-or-create the team-chat channel for a CRM entity.
// Called by CRM (same JWT) or SquadHub. Any workspace member may open a chat.
router.post('/crm/ensure', requireAuth, async (req: Request, res: Response) => {
  try {
    const body = crmEnsureSchema.parse(req.body);
    if (!(await assertWorkspaceMember(req.userId!, body.workspace_id))) {
      res.status(403).json({ success: false, error: 'Not a member of this workspace' });
      return;
    }

    const { data: existing } = await supabaseAdmin
      .from('channels')
      .select('*')
      .eq('linked_resource_type', body.entity_type)
      .eq('linked_resource_id', body.entity_id)
      .is('deleted_at', null)
      .maybeSingle();

    if (existing) {
      // Refresh label/subtitle and make sure caller has membership.
      await supabaseAdmin
        .from('channels')
        .update({
          linked_label: body.label,
          linked_subtitle: body.subtitle ?? null,
        })
        .eq('id', existing.id);
      // Opener only here; CRM ensure adds assignee. Mentions add others.
      await grantChannelMembers(existing.id, [req.userId!]);
      // Opening a chat clears this user's closed state.
      await supabaseAdmin
        .from('crm_chat_user_state')
        .delete()
        .eq('channel_id', existing.id)
        .eq('user_id', req.userId!);
      const { data: refreshed } = await supabaseAdmin.from('channels').select('*').eq('id', existing.id).single();
      res.json({ success: true, data: refreshed });
      return;
    }

    const base = slugifyChannelName(body.label);
    // Keep channel names unique within the workspace (append entity id fragment).
    const name = (`${base}-${body.entity_id.slice(0, 8)}`).slice(0, 80) || 'crm-chat';
    const { data: created, error } = await supabaseAdmin
      .from('channels')
      .insert({
        workspace_id: body.workspace_id,
        name,
        description: body.subtitle || `CRM team chat: ${body.label}`,
        is_private: true,
        created_by: req.userId,
        linked_resource_type: body.entity_type,
        linked_resource_id: body.entity_id,
        linked_label: body.label,
        linked_subtitle: body.subtitle ?? null,
      })
      .select()
      .single();

    if (error) {
      // Race: another request linked the same entity — re-fetch.
      if (error.code === '23505') {
        const { data: raced } = await supabaseAdmin
          .from('channels')
          .select('*')
          .eq('linked_resource_type', body.entity_type)
          .eq('linked_resource_id', body.entity_id)
          .is('deleted_at', null)
          .maybeSingle();
        if (raced) {
          await grantChannelMembers(raced.id, [req.userId!]);
          res.json({ success: true, data: raced });
          return;
        }
      }
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    await grantChannelMembers(created.id, [req.userId!]);
    res.status(201).json({ success: true, data: created });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('CRM ensure channel error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /channels/crm?workspace_id= — open CRM chats for the current user.
// "Open" = CRM-linked channel the user can access AND has not closed (or has
// a message newer than their closed_at — handled by deleting state on send).
router.get('/crm', requireAuth, async (req: Request, res: Response) => {
  try {
    const workspaceId = req.query.workspace_id as string;
    if (!workspaceId) {
      res.status(400).json({ success: false, error: 'workspace_id is required' });
      return;
    }
    if (!(await assertWorkspaceMember(req.userId!, workspaceId))) {
      res.status(403).json({ success: false, error: 'Not a member of this workspace' });
      return;
    }

    const { data: channels, error } = await supabaseAdmin
      .from('channels')
      .select('id, name, linked_resource_type, linked_resource_id, linked_label, linked_subtitle, created_at')
      .eq('workspace_id', workspaceId)
      .in('linked_resource_type', CRM_ENTITY_TYPES)
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    if (!channels?.length) {
      res.json({ success: true, data: [] });
      return;
    }

    const channelIds = channels.map((c) => c.id);

    // Only show CRM chats this user is a member of (opener, assignee, or @mentioned).
    const { data: memberships } = await supabaseAdmin
      .from('resource_memberships')
      .select('resource_id')
      .eq('resource_type', 'channel')
      .eq('user_id', req.userId!)
      .in('resource_id', channelIds);
    const memberSet = new Set((memberships || []).map((m) => m.resource_id as string));

    const { data: closedRows } = await supabaseAdmin
      .from('crm_chat_user_state')
      .select('channel_id, closed_at')
      .eq('user_id', req.userId!)
      .in('channel_id', channelIds);
    const closedMap = new Map((closedRows || []).map((r) => [r.channel_id as string, r.closed_at as string]));

    // Latest message per channel (preview + last_message_at).
    const { data: latestMsgs } = await supabaseAdmin
      .from('messages')
      .select('channel_id, content, created_at, is_deleted')
      .in('channel_id', channelIds)
      .eq('is_deleted', false)
      .order('created_at', { ascending: false });

    const lastByChannel = new Map<string, { content: string | null; created_at: string }>();
    for (const m of latestMsgs || []) {
      const cid = m.channel_id as string;
      if (!lastByChannel.has(cid)) {
        lastByChannel.set(cid, { content: m.content as string | null, created_at: m.created_at as string });
      }
    }

    const items = channels
      .filter((c) => memberSet.has(c.id) && !closedMap.has(c.id))
      .map((c) => {
        const last = lastByChannel.get(c.id);
        return {
          channel_id: c.id,
          channel_name: c.name,
          entity_type: c.linked_resource_type as CrmEntityType,
          entity_id: c.linked_resource_id as string,
          label: (c.linked_label as string) || c.name,
          subtitle: (c.linked_subtitle as string) || null,
          closed: false,
          unread_count: 0,
          last_message_at: last?.created_at ?? null,
          last_message_preview: last?.content ?? null,
        };
      })
      // Most recently active first.
      .sort((a, b) => {
        const ta = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
        const tb = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
        return tb - ta;
      });

    res.json({ success: true, data: items });
  } catch (err) {
    console.error('List CRM chats error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /channels/crm/:channelId/close — hide from this user's CRM Chats list.
router.post('/crm/:channelId/close', requireAuth, async (req: Request, res: Response) => {
  try {
    const channelId = Array.isArray(req.params.channelId) ? req.params.channelId[0] : req.params.channelId;
    const { data: channel } = await supabaseAdmin
      .from('channels')
      .select('id, linked_resource_type')
      .eq('id', channelId)
      .is('deleted_at', null)
      .maybeSingle();
    if (!channel || !isCrmEntityType(channel.linked_resource_type || '')) {
      res.status(404).json({ success: false, error: 'CRM chat not found' });
      return;
    }
    const level = await checkResourceAccess(req.userId!, 'channel', channelId);
    if (!level) {
      res.status(403).json({ success: false, error: 'No access to this chat' });
      return;
    }
    await supabaseAdmin.from('crm_chat_user_state').upsert(
      { user_id: req.userId!, channel_id: channelId, closed_at: new Date().toISOString() },
      { onConflict: 'user_id,channel_id' },
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Close CRM chat error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /channels/crm/:channelId/reopen — clear this user's close state.
router.post('/crm/:channelId/reopen', requireAuth, async (req: Request, res: Response) => {
  try {
    const channelId = Array.isArray(req.params.channelId) ? req.params.channelId[0] : req.params.channelId;
    await supabaseAdmin
      .from('crm_chat_user_state')
      .delete()
      .eq('channel_id', channelId)
      .eq('user_id', req.userId!);
    res.json({ success: true });
  } catch (err) {
    console.error('Reopen CRM chat error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /channels/crm/linked?entity_type=&entity_id= — lookup without creating.
router.get('/crm/linked', requireAuth, async (req: Request, res: Response) => {
  try {
    const entityType = req.query.entity_type as string;
    const entityId = req.query.entity_id as string;
    if (!entityType || !entityId || !isCrmEntityType(entityType)) {
      res.status(400).json({ success: false, error: 'entity_type and entity_id required' });
      return;
    }
    const { data } = await supabaseAdmin
      .from('channels')
      .select('*')
      .eq('linked_resource_type', entityType)
      .eq('linked_resource_id', entityId)
      .is('deleted_at', null)
      .maybeSingle();
    if (data) {
      const level = await checkResourceAccess(req.userId!, 'channel', data.id);
      if (!level) {
        res.json({ success: true, data: null });
        return;
      }
    }
    res.json({ success: true, data: data || null });
  } catch (err) {
    console.error('Get CRM linked channel error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
