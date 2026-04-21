import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { loadChatContext } from '../../middleware/chat';
import { supabaseAdmin } from '../../supabase-chat';
import type { ChatGroup } from '@squadhub/shared';

const router = Router();

// All endpoints require auth + chat context (for app_variant scoping).
router.use(requireAuth, loadChatContext);

// -------------------------------------------------------------
// GET /chat/groups — groups the user is in, scoped to their app.
// -------------------------------------------------------------
router.get('/', async (req: Request, res: Response) => {
  try {
    const { data: groups, error } = await supabaseAdmin
      .from('chat_groups')
      .select(
        'id, name, description, avatar_url, app_scope, created_by, archived_at, created_at, updated_at, ' +
          'chat_group_members!inner(user_id, is_group_admin, last_read_at)',
      )
      .eq('app_scope', req.appVariant)
      .eq('chat_group_members.user_id', req.userId)
      .is('archived_at', null)
      .order('updated_at', { ascending: false });

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    // Hydrate with unread count + last message per group (small N; OK to loop).
    const hydrated: ChatGroup[] = [];
    for (const g of groups || []) {
      const myMembership = (g as any).chat_group_members?.[0] as
        | { is_group_admin: boolean; last_read_at: string | null }
        | undefined;

      const { data: lastMsg } = await supabaseAdmin
        .from('chat_messages')
        .select('id, sender_id, content, type, file_url, created_at, deleted_at, ' +
          'sender:users!sender_id(id, display_name, avatar_url, user_type, is_admin)')
        .eq('group_id', g.id)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const { count: unreadCount } = await supabaseAdmin
        .from('chat_message_receipts')
        .select('message_id', { head: true, count: 'exact' })
        .is('read_at', null)
        .eq('user_id', req.userId!)
        .in(
          'message_id',
          (
            await supabaseAdmin
              .from('chat_messages')
              .select('id')
              .eq('group_id', g.id)
              .is('deleted_at', null)
          ).data?.map((m: any) => m.id) || [],
        );

      hydrated.push({
        id: g.id,
        name: g.name,
        description: g.description,
        avatar_url: g.avatar_url,
        app_scope: g.app_scope,
        created_by: g.created_by,
        archived_at: g.archived_at,
        created_at: g.created_at,
        updated_at: g.updated_at,
        unread_count: unreadCount || 0,
        last_message: (lastMsg as any) || null,
        my_is_group_admin: myMembership?.is_group_admin || false,
        my_last_read_at: myMembership?.last_read_at || null,
      });
    }

    res.json({ success: true, data: hydrated });
  } catch (err) {
    console.error('Chat groups list error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// -------------------------------------------------------------
// GET /chat/groups/:id — single group details
// -------------------------------------------------------------
router.get('/:id', async (req: Request, res: Response) => {
  const { data: group, error } = await supabaseAdmin
    .from('chat_groups')
    .select('*')
    .eq('id', req.params.id)
    .maybeSingle();

  if (error || !group) {
    res.status(404).json({ success: false, error: 'Group not found' });
    return;
  }

  // Access check — must be member unless admin.
  const { data: membership } = await supabaseAdmin
    .from('chat_group_members')
    .select('is_group_admin')
    .eq('group_id', group.id)
    .eq('user_id', req.userId!)
    .maybeSingle();

  if (!membership && !req.isAdmin) {
    res.status(403).json({ success: false, error: 'Not a member of this group' });
    return;
  }

  res.json({
    success: true,
    data: { ...group, my_is_group_admin: membership?.is_group_admin || false },
  });
});

// -------------------------------------------------------------
// GET /chat/groups/:id/members — members list with user info
// -------------------------------------------------------------
router.get('/:id/members', async (req: Request, res: Response) => {
  // Access check.
  const { data: me } = await supabaseAdmin
    .from('chat_group_members')
    .select('id')
    .eq('group_id', req.params.id)
    .eq('user_id', req.userId!)
    .maybeSingle();
  if (!me && !req.isAdmin) {
    res.status(403).json({ success: false, error: 'Not a member of this group' });
    return;
  }

  const { data, error } = await supabaseAdmin
    .from('chat_group_members')
    .select(
      'id, group_id, user_id, is_group_admin, joined_at, last_read_at, muted_until, ' +
        'user:users!user_id(id, display_name, avatar_url, user_type, is_admin)',
    )
    .eq('group_id', req.params.id)
    .order('joined_at');

  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }
  res.json({ success: true, data });
});

// -------------------------------------------------------------
// Group-admin helpers
// -------------------------------------------------------------
async function requireGroupAdmin(req: Request, res: Response): Promise<boolean> {
  if (req.isAdmin) return true;
  const { data } = await supabaseAdmin
    .from('chat_group_members')
    .select('is_group_admin')
    .eq('group_id', req.params.id)
    .eq('user_id', req.userId!)
    .maybeSingle();
  if (!data?.is_group_admin) {
    res.status(403).json({ success: false, error: 'Group admin access required' });
    return false;
  }
  return true;
}

const addMembersSchema = z.object({
  user_ids: z.array(z.string().uuid()).min(1).max(100),
});

// POST /chat/groups/:id/members — add members
router.post('/:id/members', async (req: Request, res: Response) => {
  if (!(await requireGroupAdmin(req, res))) return;
  try {
    const body = addMembersSchema.parse(req.body);

    // Enforce app_scope <-> user_type compatibility.
    const { data: group } = await supabaseAdmin
      .from('chat_groups')
      .select('app_scope')
      .eq('id', req.params.id)
      .single();
    if (!group) {
      res.status(404).json({ success: false, error: 'Group not found' });
      return;
    }

    const { data: users } = await supabaseAdmin
      .from('users')
      .select('id, user_type, is_admin')
      .in('id', body.user_ids);

    const allowed: string[] = [];
    for (const u of users || []) {
      const ok =
        group.app_scope === 'clients'
          ? u.user_type === 'client' || u.user_type === 'client_staff'
          : u.user_type === 'partner' || u.user_type === 'internal' || u.is_admin;
      if (ok) allowed.push(u.id);
    }

    if (allowed.length === 0) {
      res.status(400).json({ success: false, error: 'No users match this group\'s app scope' });
      return;
    }

    const rows = allowed.map((user_id: any) => ({ group_id: req.params.id, user_id }));
    const { data: inserted, error } = await supabaseAdmin
      .from('chat_group_members')
      .upsert(rows, { onConflict: 'group_id,user_id', ignoreDuplicates: true })
      .select(
        'id, group_id, user_id, is_group_admin, joined_at, last_read_at, muted_until, ' +
          'user:users!user_id(id, display_name, avatar_url, user_type, is_admin)',
      );

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    const io = req.app.get('io');
    if (io) {
      for (const m of inserted || []) {
        io.to(`chat_user:${m.user_id}`).emit('chat_group_member_added', {
          group_id: req.params.id,
          member: m,
        });
        io.to(`chat_group:${req.params.id}`).emit('chat_group_member_added', {
          group_id: req.params.id,
          member: m,
        });
      }
    }

    res.status(201).json({ success: true, data: inserted });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Add members error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /chat/groups/:id/members/:userId — remove a member
router.delete('/:id/members/:userId', async (req: Request, res: Response) => {
  if (!(await requireGroupAdmin(req, res))) return;

  // Prevent removing the last group admin.
  const { data: admins } = await supabaseAdmin
    .from('chat_group_members')
    .select('user_id')
    .eq('group_id', req.params.id)
    .eq('is_group_admin', true);
  const isTargetAdmin = admins?.some((a: any) => a.user_id === req.params.userId);
  if (isTargetAdmin && (admins?.length || 0) <= 1) {
    res.status(400).json({
      success: false,
      error: 'Cannot remove the last group admin. Promote another member first.',
    });
    return;
  }

  const { error } = await supabaseAdmin
    .from('chat_group_members')
    .delete()
    .eq('group_id', req.params.id)
    .eq('user_id', req.params.userId);

  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }

  const io = req.app.get('io');
  if (io) {
    io.to(`chat_group:${req.params.id}`).emit('chat_group_member_removed', {
      group_id: req.params.id,
      user_id: req.params.userId,
    });
    io.to(`chat_user:${req.params.userId}`).emit('chat_group_member_removed', {
      group_id: req.params.id,
      user_id: req.params.userId,
    });
  }

  res.json({ success: true });
});

const patchMemberSchema = z.object({
  is_group_admin: z.boolean().optional(),
  muted_until: z.string().datetime().nullable().optional(),
});

// PATCH /chat/groups/:id/members/:userId
router.patch('/:id/members/:userId', async (req: Request, res: Response) => {
  if (!(await requireGroupAdmin(req, res))) return;
  try {
    const body = patchMemberSchema.parse(req.body);
    const { data, error } = await supabaseAdmin
      .from('chat_group_members')
      .update(body)
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

const patchGroupSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  description: z.string().max(500).nullable().optional(),
  avatar_url: z.string().url().nullable().optional(),
});

// PATCH /chat/groups/:id — edit group (admin or group admin)
router.patch('/:id', async (req: Request, res: Response) => {
  if (!(await requireGroupAdmin(req, res))) return;
  try {
    const body = patchGroupSchema.parse(req.body);
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

export default router;
