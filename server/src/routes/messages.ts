import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { checkResourceAccess, meetsAccessLevel, requirePermission } from '../middleware/permissions';
import { supabaseAdmin } from '../supabase';
import { findFirstUrl, unfurl } from '../services/unfurl';
import { deleteR2Object } from '../r2';
import { config } from '../config';

const router = Router();

const sendMessageSchema = z.object({
  channel_id: z.string().uuid().optional(),
  dm_conversation_id: z.string().uuid().optional(),
  // Nullable: clients send content: null for caption-less attachments (voice
  // notes always, files when no text typed). Insert/unfurl below already
  // handle null; rejecting it broke every no-caption send with
  // "Expected string, received null".
  content: z.string().max(4000).nullable().optional(),
  type: z.enum(['text', 'image', 'audio', 'video', 'file']).default('text'),
  file_url: z.string().url().optional(),
  file_name: z.string().max(255).optional(),
  file_size: z.number().int().positive().optional(),
  file_mime: z.string().max(255).optional(),
  duration_ms: z.number().int().nonnegative().optional(),
  parent_message_id: z.string().uuid().optional(), // for threads
  mentions: z.array(z.string().uuid()).max(100).optional(),
}).refine(
  (data) => data.channel_id || data.dm_conversation_id,
  { message: 'Either channel_id or dm_conversation_id is required' },
).refine(
  (data) => data.content || data.file_url,
  { message: 'Either content or file_url is required' },
);

// GET /messages?channel_id=xxx&cursor=xxx&limit=50
router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const channelId = req.query.channel_id as string;
    const dmConversationId = req.query.dm_conversation_id as string;
    const cursor = req.query.cursor as string;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);

    if (!channelId && !dmConversationId) {
      res.status(400).json({ success: false, error: 'channel_id or dm_conversation_id required' });
      return;
    }

    // Check channel access if reading from a channel
    if (channelId) {
      const userLevel = await checkResourceAccess(req.userId!, 'channel', channelId);
      if (!userLevel) {
        res.status(403).json({ success: false, error: 'You do not have access to this channel' });
        return;
      }
    }

    let query = supabaseAdmin
      .from('messages')
      .select('*, sender:users!sender_id(id, display_name, avatar_url), reactions(*, user:users!user_id(id, display_name, avatar_url))')
      .eq('is_deleted', false)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (channelId) {
      query = query.eq('channel_id', channelId);
    } else {
      query = query.eq('dm_conversation_id', dmConversationId);
    }

    // Cursor-based pagination: fetch messages older than cursor
    if (cursor) {
      query = query.lt('created_at', cursor);
    }

    const { data, error } = await query;

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    // Reverse so messages are oldest-first for display
    const messages = (data || []).reverse();
    const has_more = data?.length === limit;
    const nextCursor = data?.length ? data[data.length - 1].created_at : null;

    // Enrich parent messages with thread participants + last_reply_at so the
    // client can show the Slack-style "ML JT MO · 4 replies · Last reply ..." footer.
    const parentIds = messages.filter((m: any) => (m.reply_count || 0) > 0).map((m: any) => m.id);
    if (parentIds.length > 0) {
      const { data: replies } = await supabaseAdmin
        .from('messages')
        .select('parent_message_id, sender_id, created_at, sender:users!sender_id(id, display_name, avatar_url)')
        .in('parent_message_id', parentIds)
        .eq('is_deleted', false)
        .order('created_at', { ascending: true });

      if (replies) {
        const meta = new Map<string, { participants: any[]; last_reply_at: string; seen: Set<string> }>();
        for (const r of replies as any[]) {
          const pid = r.parent_message_id;
          let bucket = meta.get(pid);
          if (!bucket) {
            bucket = { participants: [], last_reply_at: r.created_at, seen: new Set() };
            meta.set(pid, bucket);
          }
          bucket.last_reply_at = r.created_at;
          if (r.sender && !bucket.seen.has(r.sender.id) && bucket.participants.length < 5) {
            bucket.seen.add(r.sender.id);
            bucket.participants.push(r.sender);
          }
        }
        for (const m of messages as any[]) {
          const bucket = meta.get(m.id);
          if (bucket) {
            m.thread_participants = bucket.participants;
            m.last_reply_at = bucket.last_reply_at;
          }
        }
      }
    }

    res.json({
      success: true,
      data: messages,
      cursor: nextCursor,
      has_more,
    });
  } catch (err) {
    console.error('Get messages error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /messages — send a message (commenter+ on channel, or can_send_dms for DMs)
router.post('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const body = sendMessageSchema.parse(req.body);

    // Check access
    if (body.channel_id) {
      const userLevel = await checkResourceAccess(req.userId!, 'channel', body.channel_id);
      if (!userLevel || !meetsAccessLevel(userLevel, 'commenter')) {
        res.status(403).json({ success: false, error: 'Commenter access required to send messages' });
        return;
      }
    }

    // Resolve unfurl inline (with 4s cap) — best-effort, never blocks message send.
    let unfurlData: unknown = null;
    if (body.type === 'text' && body.content) {
      const firstUrl = findFirstUrl(body.content);
      if (firstUrl) {
        try {
          unfurlData = await unfurl(firstUrl);
        } catch {
          unfurlData = null;
        }
      }
    }

    // Build the insert payload, omitting optional columns whose value is null/undefined.
    // This is defensive against environments where new columns (file_*, duration_ms,
    // parent_message_id, unfurl) haven't been added yet — only columns the caller
    // actually populated get included. Required fields are always set.
    const insertRow: Record<string, unknown> = {
      channel_id: body.channel_id || null,
      dm_conversation_id: body.dm_conversation_id || null,
      sender_id: req.userId,
      content: body.content || null,
      type: body.type,
      file_url: body.file_url || null,
      mentions: body.mentions || [],
    };
    if (body.file_name) insertRow.file_name = body.file_name;
    if (body.file_size) insertRow.file_size = body.file_size;
    if (body.file_mime) insertRow.file_mime = body.file_mime;
    if (body.duration_ms) insertRow.duration_ms = body.duration_ms;
    if (body.parent_message_id) insertRow.parent_message_id = body.parent_message_id;
    if (unfurlData) insertRow.unfurl = unfurlData;

    const { data: message, error } = await supabaseAdmin
      .from('messages')
      .insert(insertRow)
      .select('*, sender:users!sender_id(id, display_name, avatar_url)')
      .single();

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    // If this is a thread reply, also insert into message_threads (legacy table).
    if (body.parent_message_id) {
      await supabaseAdmin.from('message_threads').insert({
        parent_message_id: body.parent_message_id,
        reply_message_id: message.id,
      });
    }

    // Emit via Socket.io (the socket handler will be attached to the app).
    // For thread replies, emit a thread_reply event AND also broadcast new_message
    // so the channel can update its reply_count denormalization on the parent.
    const io = req.app.get('io');
    if (io) {
      const room = body.channel_id || body.dm_conversation_id;
      io.to(room).emit('new_message', message);
      if (body.parent_message_id) {
        io.to(room).emit('thread_reply', message);
      }
    }

    res.status(201).json({ success: true, data: message });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Send message error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /messages/:id — fetch a single message with sender (used by inbox)
router.get('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const { data, error } = await supabaseAdmin
      .from('messages')
      .select('*, sender:users!sender_id(id, display_name, avatar_url)')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    if (!data) {
      res.status(404).json({ success: false, error: 'Message not found' });
      return;
    }

    if ((data as any).channel_id) {
      const access = await checkResourceAccess(req.userId!, 'channel', (data as any).channel_id);
      if (!access) {
        res.status(403).json({ success: false, error: 'You do not have access to this message' });
        return;
      }
    }

    res.json({ success: true, data });
  } catch (err) {
    console.error('Get message error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /messages/:id/thread — fetch parent (if any) + thread replies
router.get('/:id/thread', requireAuth, async (req: Request, res: Response) => {
  try {
    const id = req.params.id;

    const { data: msg } = await supabaseAdmin
      .from('messages')
      .select('id, channel_id, dm_conversation_id, parent_message_id')
      .eq('id', id)
      .maybeSingle();

    if (!msg) {
      res.status(404).json({ success: false, error: 'Message not found' });
      return;
    }

    if ((msg as any).channel_id) {
      const access = await checkResourceAccess(req.userId!, 'channel', (msg as any).channel_id);
      if (!access) {
        res.status(403).json({ success: false, error: 'You do not have access to this message' });
        return;
      }
    }

    const rootId = (msg as any).parent_message_id || id;

    const [{ data: root }, { data: replies }] = await Promise.all([
      supabaseAdmin
        .from('messages')
        .select('*, sender:users!sender_id(id, display_name, avatar_url)')
        .eq('id', rootId)
        .maybeSingle(),
      supabaseAdmin
        .from('messages')
        .select('*, sender:users!sender_id(id, display_name, avatar_url)')
        .eq('parent_message_id', rootId)
        .eq('is_deleted', false)
        .order('created_at', { ascending: true }),
    ]);

    res.json({ success: true, data: { root, replies: replies || [] } });
  } catch (err) {
    console.error('Get thread error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /messages/:id/reactions — add a reaction (commenter+ on channel)
router.post('/:id/reactions', requireAuth, async (req: Request, res: Response) => {
  try {
    const messageId = req.params.id;
    const { emoji } = req.body;

    if (!emoji || typeof emoji !== 'string') {
      res.status(400).json({ success: false, error: 'emoji is required' });
      return;
    }

    // Check if user already reacted with this emoji
    const { data: existing } = await supabaseAdmin
      .from('reactions')
      .select('id')
      .eq('message_id', messageId)
      .eq('user_id', req.userId!)
      .eq('emoji', emoji)
      .single();

    if (existing) {
      // Remove the reaction (toggle off)
      await supabaseAdmin.from('reactions').delete().eq('id', existing.id);
      res.json({ success: true, message: 'Reaction removed' });
      return;
    }

    // Add reaction
    const { data, error } = await supabaseAdmin
      .from('reactions')
      .insert({ message_id: messageId, user_id: req.userId, emoji })
      .select()
      .single();

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    // Emit via Socket.io
    const io = req.app.get('io');
    if (io) {
      // We need the channel/dm of the message to know which room to emit to
      const { data: msg } = await supabaseAdmin
        .from('messages')
        .select('channel_id, dm_conversation_id')
        .eq('id', messageId)
        .single();
      if (msg) {
        const room = msg.channel_id || msg.dm_conversation_id;
        io.to(room).emit('new_reaction', { ...data, message_id: messageId });
      }
    }

    res.status(201).json({ success: true, data });
  } catch (err) {
    console.error('Reaction error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Sender-side edits AND deletes are allowed for 10 minutes after sending.
const MESSAGE_ACTION_WINDOW_MS = 10 * 60 * 1000;

// PATCH /messages/:id — edit your own text message within the edit window
router.patch('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const content = typeof req.body?.content === 'string' ? req.body.content.trim() : '';
    if (!content) {
      res.status(400).json({ success: false, error: 'content is required' });
      return;
    }

    const { data: msg } = await supabaseAdmin
      .from('messages')
      .select('id, sender_id, type, created_at, is_deleted')
      .eq('id', id)
      .maybeSingle();

    if (!msg || (msg as any).is_deleted) {
      res.status(404).json({ success: false, error: 'Message not found' });
      return;
    }
    if ((msg as any).sender_id !== req.userId) {
      res.status(403).json({ success: false, error: 'You can only edit your own messages' });
      return;
    }
    if ((msg as any).type !== 'text') {
      res.status(400).json({ success: false, error: 'Only text messages can be edited' });
      return;
    }
    if (Date.now() - new Date((msg as any).created_at).getTime() > MESSAGE_ACTION_WINDOW_MS) {
      res.status(403).json({ success: false, error: 'Messages can only be edited within 10 minutes of sending' });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('messages')
      .update({ content, edited_at: new Date().toISOString() })
      .eq('id', id)
      .select('*, sender:users!sender_id(id, display_name, avatar_url)')
      .single();

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    const io = req.app.get('io');
    if (io) {
      const room = (data as any).channel_id || (data as any).dm_conversation_id;
      io.to(room).emit('message_updated', data);
    }

    res.json({ success: true, data });
  } catch (err) {
    console.error('Edit message error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /messages/:id — soft-delete your own message; attachment files are
// also removed from R2 (best-effort).
router.delete('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const id = req.params.id;

    const { data: msg } = await supabaseAdmin
      .from('messages')
      .select('id, sender_id, file_url, channel_id, dm_conversation_id, created_at, is_deleted')
      .eq('id', id)
      .maybeSingle();

    if (!msg || (msg as any).is_deleted) {
      res.status(404).json({ success: false, error: 'Message not found' });
      return;
    }
    if ((msg as any).sender_id !== req.userId) {
      res.status(403).json({ success: false, error: 'You can only delete your own messages' });
      return;
    }
    if (Date.now() - new Date((msg as any).created_at).getTime() > MESSAGE_ACTION_WINDOW_MS) {
      res.status(403).json({ success: false, error: 'Messages can only be deleted within 10 minutes of sending' });
      return;
    }

    const { error } = await supabaseAdmin
      .from('messages')
      .update({ is_deleted: true })
      .eq('id', id);

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    const fileUrl = (msg as any).file_url as string | null;
    if (fileUrl && config.r2PublicUrl && fileUrl.startsWith(`${config.r2PublicUrl}/`)) {
      try {
        await deleteR2Object(fileUrl.slice(config.r2PublicUrl.length + 1));
      } catch (e) {
        console.error('R2 cleanup failed for deleted message', id, e);
      }
    }

    const io = req.app.get('io');
    if (io) {
      const room = (msg as any).channel_id || (msg as any).dm_conversation_id;
      io.to(room).emit('message_deleted', {
        id,
        channel_id: (msg as any).channel_id,
        dm_conversation_id: (msg as any).dm_conversation_id,
      });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Delete message error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
