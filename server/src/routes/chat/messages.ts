import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { loadChatContext } from '../../middleware/chat';
import { supabaseAdmin } from '../../supabase-chat';
import { sendChatPush } from '../../push/chat';
import type { ChatAppVariant, ChatMessage, ChatMessageType } from '@squadhub/shared';

const router = Router();
router.use(requireAuth, loadChatContext);

const MESSAGE_SELECT =
  'id, group_id, dm_conversation_id, sender_id, client_temp_id, content, type, ' +
  'file_url, file_name, file_size, file_mime, duration_ms, width, height, ' +
  'parent_message_id, mentions, edited_at, deleted_at, created_at, ' +
  'sender:users!sender_id(id, display_name, avatar_url, user_type, is_admin), ' +
  'parent:parent_message_id(id, sender_id, content, type, file_url, deleted_at, ' +
  'sender:users!sender_id(id, display_name))';

// -------------------------------------------------------------
// Access helpers
// -------------------------------------------------------------
async function canReadGroup(userId: string, groupId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('chat_group_members')
    .select('id')
    .eq('group_id', groupId)
    .eq('user_id', userId)
    .maybeSingle();
  return !!data;
}

async function canReadDm(userId: string, convId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('chat_dm_conversations')
    .select('user1_id, user2_id')
    .eq('id', convId)
    .maybeSingle();
  return !!data && (data.user1_id === userId || data.user2_id === userId);
}

// Recipients for a group message (all members minus sender).
// Returns [{ user_id, app_variant }]
async function groupRecipients(groupId: string, senderId: string): Promise<{ user_id: string; app_variant: ChatAppVariant }[]> {
  const { data: group } = await supabaseAdmin
    .from('chat_groups')
    .select('app_scope')
    .eq('id', groupId)
    .single();
  const { data } = await supabaseAdmin
    .from('chat_group_members')
    .select('user_id')
    .eq('group_id', groupId)
    .neq('user_id', senderId);
  return (data || []).map((m: any) => ({ user_id: m.user_id, app_variant: group?.app_scope as ChatAppVariant }));
}

async function dmRecipient(convId: string, senderId: string): Promise<{ user_id: string; app_variant: ChatAppVariant } | null> {
  const { data } = await supabaseAdmin
    .from('chat_dm_conversations')
    .select('user1_id, user2_id')
    .eq('id', convId)
    .single();
  if (!data) return null;
  const otherId = data.user1_id === senderId ? data.user2_id : data.user1_id;
  // DMs are team-only by schema trigger.
  return { user_id: otherId, app_variant: 'team' };
}

// Human-readable preview for push notifications.
function pushBody(msg: ChatMessage, mentionsMe: boolean): string {
  if (msg.deleted_at) return 'Message deleted';
  if (mentionsMe && msg.sender?.display_name) return `${msg.sender.display_name} mentioned you`;
  switch (msg.type) {
    case 'voice': return '🎙 Voice message';
    case 'image': return '📷 Photo';
    case 'video': return '🎥 Video';
    case 'document': return '📎 Document';
    case 'system': return msg.content || '';
    default: return (msg.content || '').slice(0, 140);
  }
}

// -------------------------------------------------------------
// GET /chat/messages?group_id=|dm_conversation_id=&cursor=&limit=
// Cursor is the `created_at` of the oldest row returned last page;
// server returns rows strictly older than cursor.
// -------------------------------------------------------------
router.get('/', async (req: Request, res: Response) => {
  const groupId = req.query.group_id as string | undefined;
  const dmId = req.query.dm_conversation_id as string | undefined;
  const cursor = req.query.cursor as string | undefined;
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);

  if (!groupId && !dmId) {
    res.status(400).json({ success: false, error: 'group_id or dm_conversation_id required' });
    return;
  }

  if (groupId && !(await canReadGroup(req.userId!, groupId)) && !req.isAdmin) {
    res.status(403).json({ success: false, error: 'Not a member of this group' });
    return;
  }
  if (dmId && !(await canReadDm(req.userId!, dmId))) {
    res.status(403).json({ success: false, error: 'Not a participant in this DM' });
    return;
  }

  let q = supabaseAdmin
    .from('chat_messages')
    .select(MESSAGE_SELECT)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (groupId) q = q.eq('group_id', groupId);
  else q = q.eq('dm_conversation_id', dmId!);
  if (cursor) q = q.lt('created_at', cursor);

  const { data, error } = await q;
  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }

  // Fetch receipts in one query for returned messages.
  const ids = (data || []).map((m: any) => m.id);
  const receiptMap = new Map<string, any[]>();
  if (ids.length > 0) {
    const { data: rcpts } = await supabaseAdmin
      .from('chat_message_receipts')
      .select('message_id, user_id, delivered_at, read_at')
      .in('message_id', ids);
    for (const r of rcpts || []) {
      const arr = receiptMap.get(r.message_id) || [];
      arr.push(r);
      receiptMap.set(r.message_id, arr);
    }
  }

  const messages = (data || []).reverse().map((m: any) => ({
    ...m,
    receipts: receiptMap.get(m.id) || [],
  }));
  const nextCursor = data && data.length > 0 ? data[data.length - 1].created_at : null;

  res.json({ success: true, data: messages, cursor: nextCursor, has_more: data?.length === limit });
});

// -------------------------------------------------------------
// GET /chat/messages/:id
// -------------------------------------------------------------
router.get('/:id', async (req: Request, res: Response) => {
  const { data, error } = await supabaseAdmin
    .from('chat_messages')
    .select(MESSAGE_SELECT)
    .eq('id', req.params.id)
    .maybeSingle();
  if (error || !data) {
    res.status(404).json({ success: false, error: 'Message not found' });
    return;
  }
  // Access via the parent conversation.
  const m: any = data;
  const ok = m.group_id
    ? await canReadGroup(req.userId!, m.group_id)
    : await canReadDm(req.userId!, m.dm_conversation_id);
  if (!ok && !req.isAdmin) {
    res.status(403).json({ success: false, error: 'Access denied' });
    return;
  }
  res.json({ success: true, data });
});

// -------------------------------------------------------------
// POST /chat/messages — send a new message
// -------------------------------------------------------------
const sendSchema = z
  .object({
    group_id: z.string().uuid().optional(),
    dm_conversation_id: z.string().uuid().optional(),
    client_temp_id: z.string().min(1).max(80),
    content: z.string().max(4000).optional(),
    type: z.enum(['text', 'voice', 'image', 'video', 'document']).default('text'),
    file_url: z.string().url().optional(),
    file_name: z.string().max(255).optional(),
    file_size: z.number().int().nonnegative().optional(),
    file_mime: z.string().max(100).optional(),
    duration_ms: z.number().int().nonnegative().optional(),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    parent_message_id: z.string().uuid().optional(),
    mentions: z.array(z.string().uuid()).max(100).optional(),
  })
  .refine((v) => !!v.group_id !== !!v.dm_conversation_id, {
    message: 'Exactly one of group_id or dm_conversation_id is required',
  })
  .refine((v) => (v.content && v.content.length > 0) || !!v.file_url, {
    message: 'content or file_url is required',
  });

router.post('/', async (req: Request, res: Response) => {
  try {
    const body = sendSchema.parse(req.body);

    // Access checks.
    if (body.group_id && !(await canReadGroup(req.userId!, body.group_id))) {
      res.status(403).json({ success: false, error: 'Not a member of this group' });
      return;
    }
    if (body.dm_conversation_id && !(await canReadDm(req.userId!, body.dm_conversation_id))) {
      res.status(403).json({ success: false, error: 'Not a participant in this DM' });
      return;
    }

    // Validate parent is in the same conversation (cheap sanity check).
    if (body.parent_message_id) {
      const { data: parent } = await supabaseAdmin
        .from('chat_messages')
        .select('group_id, dm_conversation_id')
        .eq('id', body.parent_message_id)
        .maybeSingle();
      if (
        !parent ||
        parent.group_id !== (body.group_id || null) ||
        parent.dm_conversation_id !== (body.dm_conversation_id || null)
      ) {
        res.status(400).json({ success: false, error: 'Parent message must be in the same conversation' });
        return;
      }
    }

    // Insert message.
    const { data: inserted, error } = await supabaseAdmin
      .from('chat_messages')
      .insert({
        group_id: body.group_id || null,
        dm_conversation_id: body.dm_conversation_id || null,
        sender_id: req.userId!,
        client_temp_id: body.client_temp_id,
        content: body.content || null,
        type: body.type as ChatMessageType,
        file_url: body.file_url || null,
        file_name: body.file_name || null,
        file_size: body.file_size ?? null,
        file_mime: body.file_mime || null,
        duration_ms: body.duration_ms ?? null,
        width: body.width ?? null,
        height: body.height ?? null,
        parent_message_id: body.parent_message_id || null,
        mentions: body.mentions || [],
      })
      .select(MESSAGE_SELECT)
      .single();

    if (error || !inserted) {
      res.status(500).json({ success: false, error: error?.message || 'Insert failed' });
      return;
    }

    // Compute recipients.
    const recipients = body.group_id
      ? await groupRecipients(body.group_id, req.userId!)
      : [await dmRecipient(body.dm_conversation_id!, req.userId!)].filter(Boolean) as {
          user_id: string;
          app_variant: ChatAppVariant;
        }[];

    // Insert receipt rows (delivered/read null).
    if (recipients.length > 0) {
      await supabaseAdmin.from('chat_message_receipts').insert(
        recipients.map((r) => ({
          message_id: inserted.id,
          user_id: r.user_id,
          delivered_at: null,
          read_at: null,
        })),
      );
    }

    // Hydrated message for emit/client.
    const msg = { ...(inserted as any), receipts: recipients.map((r) => ({
      message_id: inserted.id, user_id: r.user_id, delivered_at: null, read_at: null,
    })) } as ChatMessage;

    // Fanout: conversation room + each recipient's chat_user room.
    const io = req.app.get('io');
    const room = body.group_id ? `chat_group:${body.group_id}` : `chat_dm:${body.dm_conversation_id}`;
    if (io) {
      io.to(room).emit('chat_message_new', msg);
      for (const r of recipients) {
        io.to(`chat_user:${r.user_id}`).emit('chat_message_new', msg);
      }
    }

    // Push notifications for recipients NOT currently connected.
    if (io) {
      const senderName = (msg.sender as any)?.display_name || 'Someone';
      let title = senderName;
      if (body.group_id) {
        const { data: g } = await supabaseAdmin
          .from('chat_groups')
          .select('name')
          .eq('id', body.group_id)
          .single();
        title = g?.name || senderName;
      }
      for (const r of recipients) {
        const room = io.sockets.adapter.rooms.get(`chat_user:${r.user_id}`);
        const online = !!room && room.size > 0;
        const mentionsMe = (body.mentions || []).includes(r.user_id);
        // Rule: push if offline, OR if explicitly mentioned (even if online).
        if (!online || mentionsMe) {
          sendChatPush(r.user_id, {
            appVariant: r.app_variant,
            title,
            body: pushBody(msg, mentionsMe),
            data: {
              type: 'chat_message',
              app_variant: r.app_variant,
              message_id: inserted.id,
              group_id: body.group_id || null,
              dm_conversation_id: body.dm_conversation_id || null,
            },
          }).catch((e) => console.error('[chat push] send failed:', e));
        }
      }
    }

    res.status(201).json({ success: true, data: msg });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Send chat message error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// -------------------------------------------------------------
// PATCH /chat/messages/:id — edit content (sender only)
// -------------------------------------------------------------
const editSchema = z.object({ content: z.string().min(1).max(4000) });

router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const body = editSchema.parse(req.body);
    const { data: msg } = await supabaseAdmin
      .from('chat_messages')
      .select('sender_id, group_id, dm_conversation_id, type')
      .eq('id', req.params.id)
      .maybeSingle();
    if (!msg) {
      res.status(404).json({ success: false, error: 'Message not found' });
      return;
    }
    if (msg.sender_id !== req.userId) {
      res.status(403).json({ success: false, error: 'Only the sender can edit' });
      return;
    }
    if (msg.type !== 'text') {
      res.status(400).json({ success: false, error: 'Only text messages can be edited' });
      return;
    }

    const { data: updated, error } = await supabaseAdmin
      .from('chat_messages')
      .update({ content: body.content, edited_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .select(MESSAGE_SELECT)
      .single();
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    const io = req.app.get('io');
    if (io) {
      const room = msg.group_id ? `chat_group:${msg.group_id}` : `chat_dm:${msg.dm_conversation_id}`;
      io.to(room).emit('chat_message_edit', updated);
    }
    res.json({ success: true, data: updated });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// -------------------------------------------------------------
// DELETE /chat/messages/:id — soft delete (sender or group admin)
// -------------------------------------------------------------
router.delete('/:id', async (req: Request, res: Response) => {
  const { data: msg } = await supabaseAdmin
    .from('chat_messages')
    .select('sender_id, group_id, dm_conversation_id')
    .eq('id', req.params.id)
    .maybeSingle();
  if (!msg) {
    res.status(404).json({ success: false, error: 'Message not found' });
    return;
  }

  let allowed = msg.sender_id === req.userId || req.isAdmin;
  if (!allowed && msg.group_id) {
    const { data } = await supabaseAdmin
      .from('chat_group_members')
      .select('is_group_admin')
      .eq('group_id', msg.group_id)
      .eq('user_id', req.userId!)
      .maybeSingle();
    allowed = !!data?.is_group_admin;
  }
  if (!allowed) {
    res.status(403).json({ success: false, error: 'Not allowed to delete this message' });
    return;
  }

  const { error } = await supabaseAdmin
    .from('chat_messages')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', req.params.id);
  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }

  const io = req.app.get('io');
  if (io) {
    const room = msg.group_id ? `chat_group:${msg.group_id}` : `chat_dm:${msg.dm_conversation_id}`;
    io.to(room).emit('chat_message_delete', {
      id: req.params.id,
      group_id: msg.group_id || undefined,
      dm_conversation_id: msg.dm_conversation_id || undefined,
    });
  }
  res.json({ success: true });
});

export default router;
