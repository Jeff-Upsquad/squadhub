import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { checkResourceAccess, meetsAccessLevel, requirePermission, isWorkspaceAdmin } from '../middleware/permissions';
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

// Resolve each message's `mentions` (user ids) → `mentioned_users` (id +
// display_name), so the mobile renderer can highlight the full "@First Last"
// span (the body text alone can't tell where a multi-word name ends).
async function attachMentionedUsers(messages: any[]): Promise<void> {
  const ids = Array.from(new Set(messages.flatMap((m) => (m?.mentions as string[]) || [])));
  if (ids.length === 0) return;
  const { data: users } = await supabaseAdmin
    .from('users')
    .select('id, display_name, avatar_url')
    .in('id', ids);
  const byId = new Map((users || []).map((u: any) => [u.id, u]));
  for (const m of messages) {
    m.mentioned_users = ((m.mentions as string[]) || []).map((id) => byId.get(id)).filter(Boolean);
  }
}

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

    // `data` comes back newest-first (created_at desc). Derive the pagination
    // cursor from the OLDEST row in this batch — i.e. its last element — BEFORE
    // reversing, because reverse() mutates in place and would otherwise flip
    // which end is the oldest (which made scroll-back re-fetch the newest page).
    const rows = data || [];
    const has_more = rows.length === limit;
    const nextCursor = rows.length ? rows[rows.length - 1].created_at : null;
    // Reverse so messages are oldest-first for display
    const messages = rows.reverse();

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

    await attachMentionedUsers(messages);

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

// GET /messages/unread-summary — per-channel + per-DM unread counts for the
// current user, used by the native app to badge the Chat tab and conversation
// rows. Declared BEFORE GET /:id so the literal path wins over the :id param.
router.get('/unread-summary', requireAuth, async (req: Request, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin.rpc('chat_unread_summary', {
      p_user_id: req.userId!,
    });
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    const channels: Record<string, number> = {};
    const dms: Record<string, number> = {};
    let total = 0;
    for (const row of (data || []) as Array<{ scope_type: string; scope_id: string; unread_count: number }>) {
      const count = Number(row.unread_count) || 0;
      if (count <= 0) continue;
      if (row.scope_type === 'channel') channels[row.scope_id] = count;
      else if (row.scope_type === 'dm') dms[row.scope_id] = count;
      total += count;
    }

    res.json({ success: true, data: { channels, dms, total } });
  } catch (err) {
    console.error('Unread summary error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /messages/mark-read — mark a channel or DM read up to now for the current
// user, clearing its unread badge. Body: { channel_id } or { dm_conversation_id }.
router.post('/mark-read', requireAuth, async (req: Request, res: Response) => {
  try {
    const channelId = typeof req.body?.channel_id === 'string' ? req.body.channel_id : null;
    const dmConversationId =
      typeof req.body?.dm_conversation_id === 'string' ? req.body.dm_conversation_id : null;
    if (!channelId && !dmConversationId) {
      res.status(400).json({ success: false, error: 'channel_id or dm_conversation_id required' });
      return;
    }

    const scopeType = channelId ? 'channel' : 'dm';
    const scopeId = channelId || dmConversationId;
    const now = new Date().toISOString();

    const { error } = await supabaseAdmin.from('message_reads').upsert(
      { user_id: req.userId!, scope_type: scopeType, scope_id: scopeId, last_read_at: now, updated_at: now },
      { onConflict: 'user_id,scope_type,scope_id' },
    );
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Mark chat read error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Resolve the channel IDs the user may read in a workspace, mirroring the
// access rules in routes/channels.ts (admins: all; others: memberships +
// channels they created). Returns null for "all channels in workspace" (admin).
async function accessibleChannelIds(userId: string, workspaceId: string): Promise<string[]> {
  const admin = await isWorkspaceAdmin(userId);
  if (admin) {
    const { data } = await supabaseAdmin
      .from('channels')
      .select('id')
      .eq('workspace_id', workspaceId)
      .is('deleted_at', null);
    return (data || []).map((c: any) => c.id);
  }
  const { data: memberships } = await supabaseAdmin
    .from('resource_memberships')
    .select('resource_id')
    .eq('resource_type', 'channel')
    .eq('user_id', userId);
  const { data: created } = await supabaseAdmin
    .from('channels')
    .select('id')
    .eq('workspace_id', workspaceId)
    .is('deleted_at', null)
    .eq('created_by', userId);
  const memberIds = (memberships || []).map((m: any) => m.resource_id);
  const createdIds = (created || []).map((c: any) => c.id);
  const all = [...new Set([...memberIds, ...createdIds])];
  if (all.length === 0) return [];
  // Filter membership IDs (which can span workspaces) down to this workspace.
  const { data: scoped } = await supabaseAdmin
    .from('channels')
    .select('id')
    .eq('workspace_id', workspaceId)
    .is('deleted_at', null)
    .in('id', all);
  return (scoped || []).map((c: any) => c.id);
}

// The DM conversation IDs the user participates in, scoped to a workspace.
async function accessibleDmIds(userId: string, workspaceId: string): Promise<string[]> {
  const { data: parts } = await supabaseAdmin
    .from('dm_participants')
    .select('conversation_id')
    .eq('user_id', userId);
  const ids = [...new Set((parts || []).map((p: any) => p.conversation_id))];
  if (ids.length === 0) return [];
  const { data: convs } = await supabaseAdmin
    .from('dm_conversations')
    .select('id')
    .eq('workspace_id', workspaceId)
    .in('id', ids);
  return (convs || []).map((c: any) => c.id);
}

// GET /messages/search?q=...&channel_id=|dm_conversation_id=|workspace_id=&limit=
// Full-text-ish (ILIKE) search over message content.
//  - channel_id / dm_conversation_id given → search that one conversation.
//  - workspace_id given (no conversation) → search every channel the user can
//    read + every DM they're in, across that workspace ("normal" global search).
// Returns matches newest-first, each enriched with its sender + a conversation
// label so the client can render "in #channel" / "in DM with …".
router.get('/search', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const rawQuery = (req.query.q as string) || '';
    const q = rawQuery.trim();
    const channelId = (req.query.channel_id as string) || undefined;
    const dmConversationId = (req.query.dm_conversation_id as string) || undefined;
    const workspaceId = (req.query.workspace_id as string) || undefined;
    const limit = Math.min(parseInt((req.query.limit as string) || '20', 10) || 20, 50);

    if (q.length < 1) {
      res.json({ success: true, data: { messages: [] } });
      return;
    }

    // Resolve which channels / DMs to search over, enforcing access.
    let channelIds: string[] = [];
    let dmIds: string[] = [];

    if (channelId) {
      const level = await checkResourceAccess(userId, 'channel', channelId);
      if (!level) {
        res.status(403).json({ success: false, error: 'You do not have access to this channel' });
        return;
      }
      channelIds = [channelId];
    } else if (dmConversationId) {
      const { data: part } = await supabaseAdmin
        .from('dm_participants')
        .select('user_id')
        .eq('conversation_id', dmConversationId)
        .eq('user_id', userId)
        .maybeSingle();
      if (!part) {
        res.status(403).json({ success: false, error: 'You are not a participant in this conversation' });
        return;
      }
      dmIds = [dmConversationId];
    } else if (workspaceId) {
      [channelIds, dmIds] = await Promise.all([
        accessibleChannelIds(userId, workspaceId),
        accessibleDmIds(userId, workspaceId),
      ]);
    } else {
      res.status(400).json({ success: false, error: 'channel_id, dm_conversation_id or workspace_id is required' });
      return;
    }

    if (channelIds.length === 0 && dmIds.length === 0) {
      res.json({ success: true, data: { messages: [] } });
      return;
    }

    // Escape ILIKE wildcards in user input so "50%" searches literally.
    const safeQ = q.replace(/[\\%_]/g, (m) => `\\${m}`);
    const SELECT =
      'id, channel_id, dm_conversation_id, sender_id, content, type, created_at, parent_message_id, ' +
      'sender:users!sender_id(id, display_name, avatar_url)';

    // Two scoped queries (channels, DMs) merged — simpler and safer than a
    // combined PostgREST .or() over two IN-lists (empty lists break that syntax).
    // Supabase builders are thenables (PromiseLike), not Promises.
    const queries: PromiseLike<{ data: any[] | null; error: { message: string } | null }>[] = [];
    if (channelIds.length > 0) {
      queries.push(
        supabaseAdmin
          .from('messages')
          .select(SELECT)
          .in('channel_id', channelIds)
          .eq('is_deleted', false)
          .not('content', 'is', null)
          .ilike('content', `%${safeQ}%`)
          .order('created_at', { ascending: false })
          .limit(limit),
      );
    }
    if (dmIds.length > 0) {
      queries.push(
        supabaseAdmin
          .from('messages')
          .select(SELECT)
          .in('dm_conversation_id', dmIds)
          .eq('is_deleted', false)
          .not('content', 'is', null)
          .ilike('content', `%${safeQ}%`)
          .order('created_at', { ascending: false })
          .limit(limit),
      );
    }

    const results = await Promise.all(queries);
    for (const r of results) {
      if (r.error) {
        res.status(500).json({ success: false, error: r.error.message });
        return;
      }
    }
    const rows = results.flatMap((r) => r.data || []);
    // Re-sort the merged set newest-first and cap to `limit`.
    rows.sort((a: any, b: any) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
    const top = rows.slice(0, limit);

    // Labels: channel names + DM co-participants for the "in …" hint.
    const matchedChannelIds = [...new Set(top.map((m: any) => m.channel_id).filter(Boolean))];
    const channelNameById: Record<string, string> = {};
    if (matchedChannelIds.length > 0) {
      const { data: chs } = await supabaseAdmin
        .from('channels')
        .select('id, name')
        .in('id', matchedChannelIds);
      for (const c of (chs || []) as any[]) channelNameById[c.id] = c.name;
    }

    const matchedDmIds = [...new Set(top.map((m: any) => m.dm_conversation_id).filter(Boolean))];
    const dmLabelById: Record<string, string> = {};
    if (matchedDmIds.length > 0) {
      const { data: parts } = await supabaseAdmin
        .from('dm_participants')
        .select('conversation_id, user:users(id, display_name)')
        .in('conversation_id', matchedDmIds);
      const byConv = new Map<string, string[]>();
      for (const p of (parts || []) as any[]) {
        // Label a DM by its OTHER participants (exclude the searcher).
        if (p.user?.id === userId) continue;
        const arr = byConv.get(p.conversation_id) || [];
        if (p.user?.display_name) arr.push(p.user.display_name);
        byConv.set(p.conversation_id, arr);
      }
      for (const id of matchedDmIds) {
        const names = byConv.get(id) || [];
        dmLabelById[id] =
          names.length === 0 ? 'You' : names.length <= 2 ? names.join(', ') : `${names[0]} +${names.length - 1}`;
      }
    }

    const messages = top.map((m: any) => ({
      id: m.id,
      channel_id: m.channel_id,
      dm_conversation_id: m.dm_conversation_id,
      parent_message_id: m.parent_message_id,
      content: m.content,
      type: m.type,
      created_at: m.created_at,
      sender: m.sender || null,
      kind: m.channel_id ? 'channel' : 'dm',
      conversation_label: m.channel_id
        ? channelNameById[m.channel_id] || 'channel'
        : dmLabelById[m.dm_conversation_id] || 'Direct message',
    }));

    res.json({ success: true, data: { messages } });
  } catch (err) {
    console.error('GET /messages/search error:', err);
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

    await attachMentionedUsers([root, ...(replies || [])].filter(Boolean) as any[]);

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

// GET /messages/:id/history — admin: view an edited message's prior versions
// (newest first). Edits overwrite content in place; a DB trigger snapshots the
// old text into message_edits, so this is the recovery view.
router.get('/:id/history', requireAuth, requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const { data: msg } = await supabaseAdmin
      .from('messages')
      .select('id, content, edited_at, sender_id')
      .eq('id', id)
      .maybeSingle();
    if (!msg) {
      res.status(404).json({ success: false, error: 'Message not found' });
      return;
    }
    const { data: history, error } = await (supabaseAdmin as any)
      .from('message_edits')
      .select('id, previous_content, replaced_at, editor_id, editor:users!editor_id(id, display_name, avatar_url)')
      .eq('message_id', id)
      .order('replaced_at', { ascending: false });
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true, data: { current: msg, history: history || [] } });
  } catch (err) {
    console.error('Message history error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /messages/:id/restore — admin: restore a prior version.
// Body: { history_id?: number } — defaults to the most recent prior version.
// The restore overwrites current content, which the trigger captures into
// history, so a restore is reversible too.
router.post('/:id/restore', requireAuth, requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const historyId = typeof req.body?.history_id === 'number' ? req.body.history_id : undefined;

    const { data: msg } = await supabaseAdmin
      .from('messages')
      .select('id, channel_id, dm_conversation_id, is_deleted')
      .eq('id', id)
      .maybeSingle();
    if (!msg || (msg as any).is_deleted) {
      res.status(404).json({ success: false, error: 'Message not found' });
      return;
    }

    let q = (supabaseAdmin as any)
      .from('message_edits')
      .select('id, previous_content')
      .eq('message_id', id);
    q = historyId
      ? q.eq('id', historyId)
      : q.order('replaced_at', { ascending: false }).limit(1);
    const { data: rows } = await q;
    const entry = rows?.[0];
    if (!entry) {
      res.status(404).json({ success: false, error: 'No edit history to restore' });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('messages')
      .update({ content: entry.previous_content, edited_at: new Date().toISOString() })
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
    console.error('Restore message error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
