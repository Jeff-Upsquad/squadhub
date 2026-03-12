import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { supabaseAdmin } from '../supabase';

const router = Router();

const sendMessageSchema = z.object({
  channel_id: z.string().uuid().optional(),
  dm_conversation_id: z.string().uuid().optional(),
  content: z.string().max(4000).optional(),
  type: z.enum(['text', 'image', 'audio', 'video', 'file']).default('text'),
  file_url: z.string().url().optional(),
  parent_message_id: z.string().uuid().optional(), // for threads
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

    let query = supabaseAdmin
      .from('messages')
      .select('*, sender:users!sender_id(id, display_name, avatar_url), reactions(*)')
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

// POST /messages — send a new message
router.post('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const body = sendMessageSchema.parse(req.body);

    const { data: message, error } = await supabaseAdmin
      .from('messages')
      .insert({
        channel_id: body.channel_id || null,
        dm_conversation_id: body.dm_conversation_id || null,
        sender_id: req.userId,
        content: body.content || null,
        type: body.type,
        file_url: body.file_url || null,
      })
      .select('*, sender:users!sender_id(id, display_name, avatar_url)')
      .single();

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    // If this is a thread reply, insert into message_threads
    if (body.parent_message_id) {
      await supabaseAdmin.from('message_threads').insert({
        parent_message_id: body.parent_message_id,
        reply_message_id: message.id,
      });
    }

    // Emit via Socket.io (the socket handler will be attached to the app)
    const io = req.app.get('io');
    if (io) {
      const room = body.channel_id || body.dm_conversation_id;
      io.to(room).emit('new_message', message);
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

// POST /messages/:id/reactions — add a reaction
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

export default router;
