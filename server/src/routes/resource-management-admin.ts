import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { supabaseAdmin } from '../supabase';

const router = Router();

router.use(requireAuth);
router.use(requireAdmin);

const VALID_TYPES = ['space', 'folder', 'list'] as const;
type ResourceType = (typeof VALID_TYPES)[number];

function tableForType(type: ResourceType): string {
  return type === 'space' ? 'spaces' : type === 'folder' ? 'folders' : 'lists';
}

// GET /admin/resources?tab=spaces|folders|lists&search=&status=&is_locked=&page=&limit=
router.get('/', async (req: Request, res: Response) => {
  try {
    const tab = (req.query.tab as string) || 'spaces';
    const search = (req.query.search as string) || '';
    const statusFilter = req.query.status as string; // 'active' | 'inactive' | 'all'
    const lockFilter = req.query.is_locked as string; // 'true' | 'false' | 'all'
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));
    const offset = (page - 1) * limit;

    let data: any[] = [];
    let total = 0;

    if (tab === 'spaces') {
      let query = supabaseAdmin
        .from('spaces')
        .select('id, name, color, icon, workspace_id, status, is_locked, is_private, created_by', { count: 'exact' })
        .is('deleted_at', null)
        .order('name')
        .range(offset, offset + limit - 1);

      if (search) query = query.ilike('name', `%${search}%`);
      if (statusFilter && statusFilter !== 'all') query = query.eq('status', statusFilter);
      if (lockFilter && lockFilter !== 'all') query = query.eq('is_locked', lockFilter === 'true');

      const { data: spaces, count, error } = await query;
      if (error) { console.error('Spaces query error:', error); res.status(500).json({ success: false, error: error.message }); return; }

      const ids = (spaces || []).map((s: any) => s.id);
      const userIds = [...new Set((spaces || []).map((s: any) => s.created_by).filter(Boolean))];

      const [memberCounts, userMap] = await Promise.all([
        getMemberCounts('space', ids),
        getUserNameMap(userIds),
      ]);

      data = (spaces || []).map((s: any) => ({
        id: s.id,
        name: s.name,
        color: s.color,
        icon: s.icon,
        workspace_id: s.workspace_id,
        status: s.status,
        is_locked: s.is_locked,
        is_private: s.is_private,
        created_by: s.created_by,
        created_by_name: userMap.get(s.created_by) || 'Unknown',
        member_count: memberCounts[s.id] || 0,
      }));
      total = count || 0;

    } else if (tab === 'folders') {
      let query = supabaseAdmin
        .from('folders')
        .select('id, name, space_id, status, is_locked, is_private, created_by', { count: 'exact' })
        .is('deleted_at', null)
        .order('name')
        .range(offset, offset + limit - 1);

      if (search) query = query.ilike('name', `%${search}%`);
      if (statusFilter && statusFilter !== 'all') query = query.eq('status', statusFilter);
      if (lockFilter && lockFilter !== 'all') query = query.eq('is_locked', lockFilter === 'true');

      const { data: folders, count, error } = await query;
      if (error) { console.error('Folders query error:', error); res.status(500).json({ success: false, error: error.message }); return; }

      const ids = (folders || []).map((f: any) => f.id);
      const userIds = [...new Set((folders || []).map((f: any) => f.created_by).filter(Boolean))];
      const spaceIds = [...new Set((folders || []).map((f: any) => f.space_id).filter(Boolean))];

      const [memberCounts, userMap, spaceMap] = await Promise.all([
        getMemberCounts('folder', ids),
        getUserNameMap(userIds),
        getNameMap('spaces', spaceIds),
      ]);

      data = (folders || []).map((f: any) => ({
        id: f.id,
        name: f.name,
        space_id: f.space_id,
        space_name: spaceMap.get(f.space_id) || 'Unknown',
        status: f.status,
        is_locked: f.is_locked,
        is_private: f.is_private,
        created_by: f.created_by,
        created_by_name: userMap.get(f.created_by) || 'Unknown',
        member_count: memberCounts[f.id] || 0,
      }));
      total = count || 0;

    } else if (tab === 'lists') {
      let query = supabaseAdmin
        .from('lists')
        .select('id, name, space_id, folder_id, status, is_locked, is_private, created_by', { count: 'exact' })
        .is('deleted_at', null)
        .order('name')
        .range(offset, offset + limit - 1);

      if (search) query = query.ilike('name', `%${search}%`);
      if (statusFilter && statusFilter !== 'all') query = query.eq('status', statusFilter);
      if (lockFilter && lockFilter !== 'all') query = query.eq('is_locked', lockFilter === 'true');

      const { data: lists, count, error } = await query;
      if (error) { console.error('Lists query error:', error); res.status(500).json({ success: false, error: error.message }); return; }

      const ids = (lists || []).map((l: any) => l.id);
      const userIds = [...new Set((lists || []).map((l: any) => l.created_by).filter(Boolean))];
      const spaceIds = [...new Set((lists || []).map((l: any) => l.space_id).filter(Boolean))];
      const folderIds = [...new Set((lists || []).map((l: any) => l.folder_id).filter(Boolean))];

      const [memberCounts, userMap, spaceMap, folderMap] = await Promise.all([
        getMemberCounts('list', ids),
        getUserNameMap(userIds),
        getNameMap('spaces', spaceIds),
        getNameMap('folders', folderIds),
      ]);

      data = (lists || []).map((l: any) => ({
        id: l.id,
        name: l.name,
        space_id: l.space_id,
        space_name: spaceMap.get(l.space_id) || 'Unknown',
        folder_id: l.folder_id,
        folder_name: folderMap.get(l.folder_id) || null,
        status: l.status,
        is_locked: l.is_locked,
        is_private: l.is_private,
        created_by: l.created_by,
        created_by_name: userMap.get(l.created_by) || 'Unknown',
        member_count: memberCounts[l.id] || 0,
      }));
      total = count || 0;
    }

    res.json({ success: true, data, total, page, limit });
  } catch (err) {
    console.error('List resources error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PUT /admin/resources/:type/:id — update status and/or is_locked (with cascade)
const updateSchema = z.object({
  status: z.enum(['active', 'inactive']).optional(),
  is_locked: z.boolean().optional(),
});

router.put('/:type/:id', async (req: Request, res: Response) => {
  try {
    const type = req.params.type as ResourceType;
    const id = req.params.id;

    if (!VALID_TYPES.includes(type)) {
      res.status(400).json({ success: false, error: 'Invalid resource type' });
      return;
    }

    const body = updateSchema.parse(req.body);
    if (body.status === undefined && body.is_locked === undefined) {
      res.status(400).json({ success: false, error: 'Nothing to update' });
      return;
    }

    const table = tableForType(type);
    const updates: Record<string, any> = {};
    if (body.status !== undefined) updates.status = body.status;
    if (body.is_locked !== undefined) updates.is_locked = body.is_locked;

    const { data, error } = await supabaseAdmin
      .from(table)
      .update(updates)
      .eq('id', id)
      .select('*')
      .single();

    if (error) { res.status(500).json({ success: false, error: error.message }); return; }
    if (!data) { res.status(404).json({ success: false, error: 'Resource not found' }); return; }

    // Cascade to children
    if (type === 'space') {
      // Cascade to folders and lists in this space
      await supabaseAdmin.from('folders').update(updates).eq('space_id', id).is('deleted_at', null);
      await supabaseAdmin.from('lists').update(updates).eq('space_id', id).is('deleted_at', null);
    } else if (type === 'folder') {
      // Cascade to lists in this folder
      await supabaseAdmin.from('lists').update(updates).eq('folder_id', id).is('deleted_at', null);
    }

    res.json({ success: true, data });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Update resource error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /admin/resources/:type/:id/members — list members
router.get('/:type/:id/members', async (req: Request, res: Response) => {
  try {
    const type = req.params.type as ResourceType;
    const id = req.params.id;

    if (!VALID_TYPES.includes(type)) {
      res.status(400).json({ success: false, error: 'Invalid resource type' });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('resource_memberships')
      .select('*, users(id, display_name, email, avatar_url)')
      .eq('resource_type', type)
      .eq('resource_id', id)
      .order('created_at');

    if (error) { res.status(500).json({ success: false, error: error.message }); return; }

    const members = (data || []).map((m: any) => ({
      ...m,
      user: m.users,
      users: undefined,
    }));

    res.json({ success: true, data: members });
  } catch (err) {
    console.error('Get resource members error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /admin/resources/:type/:id/members — add a member
const addMemberSchema = z.object({
  user_id: z.string().uuid(),
  access_level: z.enum(['viewer', 'commenter', 'member', 'manager']).default('viewer'),
});

router.post('/:type/:id/members', async (req: Request, res: Response) => {
  try {
    const type = req.params.type as ResourceType;
    const id = req.params.id;

    if (!VALID_TYPES.includes(type)) {
      res.status(400).json({ success: false, error: 'Invalid resource type' });
      return;
    }

    const body = addMemberSchema.parse(req.body);

    const { data, error } = await supabaseAdmin
      .from('resource_memberships')
      .insert({
        resource_type: type,
        resource_id: id,
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
      res.status(500).json({ success: false, error: error.message }); return;
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
    console.error('Add resource member error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PUT /admin/resources/members/:id — update access level
const updateMemberSchema = z.object({
  access_level: z.enum(['viewer', 'commenter', 'member', 'manager']),
});

router.put('/members/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const body = updateMemberSchema.parse(req.body);

    const { data, error } = await supabaseAdmin
      .from('resource_memberships')
      .update({ access_level: body.access_level })
      .eq('id', id)
      .select('*, users(id, display_name, email, avatar_url)')
      .single();

    if (error) { res.status(500).json({ success: false, error: error.message }); return; }
    if (!data) { res.status(404).json({ success: false, error: 'Membership not found' }); return; }

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

// DELETE /admin/resources/members/:id — remove a member
router.delete('/members/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id;

    const { data: existing } = await supabaseAdmin
      .from('resource_memberships')
      .select('id')
      .eq('id', id)
      .single();

    if (!existing) {
      res.status(404).json({ success: false, error: 'Membership not found' });
      return;
    }

    const { error } = await supabaseAdmin.from('resource_memberships').delete().eq('id', id);
    if (error) { res.status(500).json({ success: false, error: error.message }); return; }

    res.json({ success: true, message: 'Membership removed' });
  } catch (err) {
    console.error('Delete membership error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Helper: get user display names by IDs
async function getUserNameMap(userIds: string[]): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map();
  const { data: users } = await supabaseAdmin
    .from('users')
    .select('id, display_name')
    .in('id', userIds);
  return new Map((users || []).map((u: any) => [u.id, u.display_name]));
}

// Helper: get names from a table (spaces, folders, lists) by IDs
async function getNameMap(table: string, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const { data } = await supabaseAdmin
    .from(table)
    .select('id, name')
    .in('id', ids);
  return new Map((data || []).map((r: any) => [r.id, r.name]));
}

// Helper: get member counts for a batch of resource IDs
async function getMemberCounts(resourceType: string, ids: string[]): Promise<Record<string, number>> {
  if (ids.length === 0) return {};

  const { data } = await supabaseAdmin
    .from('resource_memberships')
    .select('resource_id')
    .eq('resource_type', resourceType)
    .in('resource_id', ids);

  const counts: Record<string, number> = {};
  (data || []).forEach((row: any) => {
    counts[row.resource_id] = (counts[row.resource_id] || 0) + 1;
  });
  return counts;
}

export default router;
