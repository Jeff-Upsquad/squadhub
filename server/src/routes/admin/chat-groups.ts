import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { requireAdmin } from '../../middleware/admin';
import { supabaseAdmin } from '../../supabase-chat';
import type { ChatAppVariant } from '@squadhub/shared';

const router = Router();
router.use(requireAuth, requireAdmin);

const createSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(500).nullable().optional(),
  avatar_url: z.string().url().nullable().optional(),
  app_scope: z.enum(['clients', 'team']),
  member_ids: z.array(z.string().uuid()).default([]),
  group_admin_ids: z.array(z.string().uuid()).default([]),
});

// GET /admin/chat/groups — list all groups (both variants)
router.get('/', async (_req: Request, res: Response) => {
  const { data, error } = await supabaseAdmin
    .from('chat_groups')
    .select('id, name, description, avatar_url, app_scope, created_by, archived_at, created_at, updated_at')
    .order('created_at', { ascending: false });
  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }

  // Annotate with member count.
  const ids = (data || []).map((g: any) => g.id);
  const counts = new Map<string, number>();
  if (ids.length > 0) {
    const { data: members } = await supabaseAdmin
      .from('chat_group_members')
      .select('group_id')
      .in('group_id', ids);
    for (const m of members || []) counts.set(m.group_id, (counts.get(m.group_id) || 0) + 1);
  }
  res.json({ success: true, data: (data || []).map((g: any) => ({ ...g, member_count: counts.get(g.id) || 0 })) });
});

// POST /admin/chat/groups — create a group and seed members
router.post('/', async (req: Request, res: Response) => {
  try {
    const body = createSchema.parse(req.body);

    // Filter out members whose user_type doesn't match app_scope.
    const memberIds = body.member_ids;
    const { data: users } = await supabaseAdmin
      .from('users')
      .select('id, user_type, is_admin')
      .in('id', memberIds.length > 0 ? memberIds : ['00000000-0000-0000-0000-000000000000']);
    const scopeOk = (u: { user_type: string; is_admin: boolean | null }) =>
      body.app_scope === 'clients'
        ? u.user_type === 'client' || u.user_type === 'client_staff' || u.user_type === 'internal' || u.is_admin
        : u.user_type === 'partner' || u.user_type === 'internal' || u.is_admin;
    const allowedIds = new Set((users || []).filter(scopeOk).map((u: any) => u.id));

    const { data: group, error } = await supabaseAdmin
      .from('chat_groups')
      .insert({
        name: body.name,
        description: body.description ?? null,
        avatar_url: body.avatar_url ?? null,
        app_scope: body.app_scope as ChatAppVariant,
        created_by: req.userId,
      })
      .select()
      .single();

    if (error || !group) {
      res.status(500).json({ success: false, error: error?.message || 'Failed to create group' });
      return;
    }

    const rows = Array.from(allowedIds).map((user_id: any) => ({
      group_id: group.id,
      user_id,
      is_group_admin: body.group_admin_ids.includes(user_id),
    }));
    if (rows.length > 0) {
      await supabaseAdmin.from('chat_group_members').insert(rows);
    }

    res.status(201).json({ success: true, data: { ...group, member_count: rows.length } });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Admin create chat group error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

const updateSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  description: z.string().max(500).nullable().optional(),
  avatar_url: z.string().url().nullable().optional(),
  archived_at: z.string().datetime().nullable().optional(),
});

// PATCH /admin/chat/groups/:id
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const body = updateSchema.parse(req.body);
    const { data, error } = await supabaseAdmin
      .from('chat_groups')
      .update({ ...body, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    const io = req.app.get('io');
    if (io) io.to(`chat_group:${req.params.id}`).emit('chat_group_updated', data);
    res.json({ success: true, data });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /admin/chat/groups/:id — hard delete (cascades to members + messages)
router.delete('/:id', async (req: Request, res: Response) => {
  const { error } = await supabaseAdmin.from('chat_groups').delete().eq('id', req.params.id);
  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }
  res.json({ success: true });
});

// GET /admin/chat/groups/:id/members — list with full user info
router.get('/:id/members', async (req: Request, res: Response) => {
  const { data, error } = await supabaseAdmin
    .from('chat_group_members')
    .select(
      'id, group_id, user_id, is_group_admin, joined_at, ' +
        'user:users!user_id(id, email, display_name, avatar_url, user_type, is_admin)',
    )
    .eq('group_id', req.params.id)
    .order('joined_at');
  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }
  res.json({ success: true, data });
});

// POST /admin/chat/groups/:id/members — bulk-add
const addMembersSchema = z.object({ user_ids: z.array(z.string().uuid()).min(1) });
router.post('/:id/members', async (req: Request, res: Response) => {
  try {
    const body = addMembersSchema.parse(req.body);
    const { data: g } = await supabaseAdmin
      .from('chat_groups')
      .select('app_scope')
      .eq('id', req.params.id)
      .single();
    if (!g) {
      res.status(404).json({ success: false, error: 'Group not found' });
      return;
    }
    const { data: users } = await supabaseAdmin
      .from('users')
      .select('id, user_type, is_admin')
      .in('id', body.user_ids);
    const ok = (u: { user_type: string; is_admin: boolean | null }) =>
      g.app_scope === 'clients'
        ? u.user_type === 'client' || u.user_type === 'client_staff' || u.user_type === 'internal' || u.is_admin
        : u.user_type === 'partner' || u.user_type === 'internal' || u.is_admin;
    const allowed = (users || []).filter(ok).map((u: any) => u.id);
    if (allowed.length === 0) {
      res.status(400).json({ success: false, error: 'No users match this group\'s app scope' });
      return;
    }
    const rows = allowed.map((user_id: any) => ({ group_id: req.params.id, user_id }));
    const { data, error } = await supabaseAdmin
      .from('chat_group_members')
      .upsert(rows, { onConflict: 'group_id,user_id', ignoreDuplicates: true })
      .select();
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
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /admin/chat/groups/:id/members/:userId
router.delete('/:id/members/:userId', async (req: Request, res: Response) => {
  const { error } = await supabaseAdmin
    .from('chat_group_members')
    .delete()
    .eq('group_id', req.params.id)
    .eq('user_id', req.params.userId);
  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }
  res.json({ success: true });
});

// PATCH /admin/chat/groups/:id/members/:userId — promote/demote group admin
const patchMemberSchema = z.object({ is_group_admin: z.boolean() });
router.patch('/:id/members/:userId', async (req: Request, res: Response) => {
  try {
    const body = patchMemberSchema.parse(req.body);
    const { data, error } = await supabaseAdmin
      .from('chat_group_members')
      .update({ is_group_admin: body.is_group_admin })
      .eq('group_id', req.params.id)
      .eq('user_id', req.params.userId)
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
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
