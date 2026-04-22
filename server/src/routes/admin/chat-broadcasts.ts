import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { requireAdmin } from '../../middleware/admin';
import { supabaseAdmin } from '../../supabase-chat';
import { sendChatPush } from '../../push/chat';
import type { ChatAppVariant, ChatMessageType } from '@squadhub/shared';

const router = Router();
router.use(requireAuth, requireAdmin);

const broadcastSchema = z.object({
  group_id: z.string().uuid(),
  content: z.string().max(4000).optional(),
  type: z.enum(['text', 'image', 'video', 'document']).default('text'),
  file_url: z.string().url().optional(),
  file_name: z.string().optional(),
  file_size: z.number().int().nonnegative().optional(),
  file_mime: z.string().optional(),
});

// POST /admin/chat/broadcasts — admin sends a message to a group as themselves
// (the "Admin" role chip surfaces in the mobile UI automatically).
router.post('/', async (req: Request, res: Response) => {
  try {
    const body = broadcastSchema.parse(req.body);
    if (!body.content && !body.file_url) {
      res.status(400).json({ success: false, error: 'content or file_url is required' });
      return;
    }

    const { data: group } = await supabaseAdmin
      .from('chat_groups')
      .select('app_scope, name')
      .eq('id', body.group_id)
      .single();
    if (!group) {
      res.status(404).json({ success: false, error: 'Group not found' });
      return;
    }

    const { data: msg, error } = await supabaseAdmin
      .from('chat_messages')
      .insert({
        group_id: body.group_id,
        sender_id: req.userId,
        client_temp_id: `admin-${Date.now()}`,
        content: body.content || null,
        type: body.type as ChatMessageType,
        file_url: body.file_url || null,
        file_name: body.file_name || null,
        file_size: body.file_size ?? null,
        file_mime: body.file_mime || null,
      })
      .select(
        'id, group_id, dm_conversation_id, sender_id, content, type, file_url, file_name, file_size, ' +
          'file_mime, created_at, ' +
          'sender:users!sender_id(id, display_name, avatar_url, user_type, is_admin)',
      )
      .single();
    if (error || !msg) {
      res.status(500).json({ success: false, error: error?.message || 'Insert failed' });
      return;
    }

    // Members except sender.
    const { data: members } = await supabaseAdmin
      .from('chat_group_members')
      .select('user_id')
      .eq('group_id', body.group_id)
      .neq('user_id', req.userId!);

    if (members && members.length > 0) {
      await supabaseAdmin
        .from('chat_message_receipts')
        .insert(
          members.map((m: any) => ({
            message_id: msg.id,
            user_id: m.user_id,
            delivered_at: null,
            read_at: null,
          })),
        );
    }

    const io = req.app.get('io');
    if (io) {
      io.to(`chat_group:${body.group_id}`).emit('chat_message_new', msg);
      for (const m of members || []) {
        io.to(`chat_user:${m.user_id}`).emit('chat_message_new', msg);
      }
    }

    // Always push for broadcasts.
    for (const m of members || []) {
      sendChatPush(m.user_id, {
        appVariant: group.app_scope as ChatAppVariant,
        title: group.name,
        body:
          body.type === 'text'
            ? (body.content || '').slice(0, 140)
            : body.type === 'image'
              ? '📷 Photo'
              : body.type === 'video'
                ? '🎥 Video'
                : '📎 Document',
        data: {
          type: 'chat_message',
          app_variant: group.app_scope,
          message_id: msg.id,
          group_id: body.group_id,
        },
      }).catch((e) => console.error('[broadcast push]', e));
    }

    res.status(201).json({ success: true, data: msg });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Broadcast error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /admin/chat/broadcasts — list recent admin-sent messages (last 30 days)
router.get('/', async (_req: Request, res: Response) => {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabaseAdmin
    .from('chat_messages')
    .select(
      'id, group_id, content, type, file_url, created_at, ' +
        'sender:users!sender_id(id, display_name, is_admin), ' +
        'group:chat_groups!group_id(id, name, app_scope)',
    )
    .gte('created_at', cutoff)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }
  // Filter client-side to admin-sent only.
  const admins = (data || []).filter((m: any) => m.sender?.is_admin);
  res.json({ success: true, data: admins });
});

export default router;
