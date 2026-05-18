import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import { config } from '../config';
import { supabaseAdmin, supabaseAuth } from '../supabase';
import type {
  ServerToClientEvents,
  ClientToServerEvents,
  ChatServerToClientEvents,
  ChatClientToServerEvents,
} from '@squadhub/shared';

// Socket.io type intersections so one connection handles workspace + chat events.
type AllServerToClient = ServerToClientEvents & ChatServerToClientEvents;
type AllClientToServer = ClientToServerEvents & ChatClientToServerEvents;

// Track online users: userId -> Set of socket IDs
const onlineUsers = new Map<string, Set<string>>();

export function setupSocketIO(httpServer: HttpServer) {
  const io = new Server<AllClientToServer, AllServerToClient>(httpServer, {
    cors: {
      origin: config.nodeEnv === 'production'
        ? [config.clientUrl, config.adminUrl, config.desktopUrl].filter(Boolean)
        : [config.clientUrl, config.adminUrl, config.desktopUrl],
      methods: ['GET', 'POST'],
      credentials: true,
    },
  });

  // Auth middleware — verify via Supabase (matches HTTP requireAuth). Supabase
  // now issues ES256 access tokens, so a local jwt.verify with the legacy HMAC
  // JWT_SECRET rejects every handshake. Delegating verification to Supabase's
  // own /auth/v1/user endpoint sidesteps the algorithm mismatch.
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) {
      return next(new Error('Authentication required'));
    }
    try {
      const { data, error } = await supabaseAuth.auth.getUser(token);
      if (error || !data.user) {
        console.warn('[socket] auth rejected:', error?.message || 'no user');
        return next(new Error('Invalid token'));
      }
      (socket as any).userId = data.user.id;
      next();
    } catch (e) {
      console.error('[socket] auth threw:', e);
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', async (socket: Socket) => {
    const userId = (socket as any).userId as string;
    console.log(`Socket connected: ${userId} (${socket.id})`);

    // Track online status
    if (!onlineUsers.has(userId)) {
      onlineUsers.set(userId, new Set());
      io.emit('user_online', { user_id: userId });
    }
    onlineUsers.get(userId)!.add(socket.id);

    // Always join a user-scoped room for cross-device fanout.
    socket.join(`chat_user:${userId}`);

    // Auto-join every chat group the user is a member of.
    try {
      const { data: groups } = await supabaseAdmin
        .from('chat_group_members')
        .select('group_id')
        .eq('user_id', userId);
      for (const m of groups || []) socket.join(`chat_group:${m.group_id}`);
    } catch (e) {
      console.error('[socket] auto-join groups failed:', e);
    }

    // Auto-join every DM conversation the user is in.
    try {
      const { data: convs } = await supabaseAdmin
        .from('chat_dm_conversations')
        .select('id')
        .or(`user1_id.eq.${userId},user2_id.eq.${userId}`);
      for (const c of convs || []) socket.join(`chat_dm:${c.id}`);
    } catch (e) {
      console.error('[socket] auto-join dms failed:', e);
    }

    // ---- Existing workspace events ----
    socket.on('join_workspace', (workspaceId: string) => {
      socket.join(`workspace:${workspaceId}`);
    });
    socket.on('join_channel', (channelId: string) => {
      socket.join(channelId);
    });
    socket.on('leave_channel', (channelId: string) => {
      socket.leave(channelId);
    });
    socket.on('typing', (data) => {
      const room = data.channel_id || data.dm_conversation_id;
      if (room) {
        socket.to(room).emit('user_typing', {
          user_id: userId,
          channel_id: data.channel_id,
          dm_conversation_id: data.dm_conversation_id,
        });
      }
    });
    socket.on('stop_typing', (data) => {
      const room = data.channel_id || data.dm_conversation_id;
      if (room) {
        socket.to(room).emit('user_stop_typing', {
          user_id: userId,
          channel_id: data.channel_id,
          dm_conversation_id: data.dm_conversation_id,
        });
      }
    });

    // ---- Squad Chat events ----
    socket.on('chat_typing', (data) => {
      const room = data.conversation_type === 'group'
        ? `chat_group:${data.conversation_id}`
        : `chat_dm:${data.conversation_id}`;
      socket.to(room).emit('chat_typing_start', {
        user_id: userId,
        conversation_type: data.conversation_type,
        conversation_id: data.conversation_id,
      });
    });
    socket.on('chat_stop_typing', (data) => {
      const room = data.conversation_type === 'group'
        ? `chat_group:${data.conversation_id}`
        : `chat_dm:${data.conversation_id}`;
      socket.to(room).emit('chat_typing_stop', {
        user_id: userId,
        conversation_type: data.conversation_type,
        conversation_id: data.conversation_id,
      });
    });

    // chat_mark_read mirrors POST /chat/receipts/read but avoids a round-trip.
    socket.on('chat_mark_read', async (data) => {
      try {
        const { data: cutoff } = await supabaseAdmin
          .from('chat_messages')
          .select('created_at')
          .eq('id', data.up_to_message_id)
          .maybeSingle();
        if (!cutoff) return;

        let q = supabaseAdmin
          .from('chat_messages')
          .select('id, sender_id')
          .lte('created_at', cutoff.created_at);
        if (data.conversation_type === 'group') q = q.eq('group_id', data.conversation_id);
        else q = q.eq('dm_conversation_id', data.conversation_id);
        const { data: candidates } = await q;
        if (!candidates || candidates.length === 0) return;

        const now = new Date().toISOString();
        const { data: updated } = await supabaseAdmin
          .from('chat_message_receipts')
          .update({ delivered_at: now, read_at: now })
          .in('message_id', candidates.map((c) => c.id))
          .eq('user_id', userId)
          .is('read_at', null)
          .select('message_id, user_id, delivered_at, read_at');

        if (data.conversation_type === 'group') {
          await supabaseAdmin
            .from('chat_group_members')
            .update({ last_read_at: now })
            .eq('group_id', data.conversation_id)
            .eq('user_id', userId);
        }

        const senderByMsg = new Map(candidates.map((c) => [c.id, c.sender_id]));
        for (const row of updated || []) {
          const senderId = senderByMsg.get(row.message_id);
          if (senderId) io.to(`chat_user:${senderId}`).emit('chat_receipt_update', row);
        }
      } catch (e) {
        console.error('[socket chat_mark_read] failed:', e);
      }
    });

    // ---- Disconnect ----
    socket.on('disconnect', () => {
      console.log(`Socket disconnected: ${userId} (${socket.id})`);
      const userSockets = onlineUsers.get(userId);
      if (userSockets) {
        userSockets.delete(socket.id);
        if (userSockets.size === 0) {
          onlineUsers.delete(userId);
          io.emit('user_offline', { user_id: userId });
        }
      }
    });
  });

  // Bridge: Poll notifications table → Socket.IO.
  // Notifications are created by PostgreSQL triggers (not app code), so we
  // poll for new rows and fan out via Socket.IO. Interval is 10s to keep
  // DB request volume manageable on the nano Supabase instance; trade-off is
  // up to ~10s of notification latency.
  const POLL_INTERVAL_MS = 10_000;
  let lastPollTime = new Date().toISOString();
  let pollCount = 0;

  // One-time startup test: check if we can query notifications at all
  (async () => {
    const { data, error } = await supabaseAdmin
      .from('notifications')
      .select('id, created_at')
      .order('created_at', { ascending: false })
      .limit(1);
    console.log('[socket] poll startup test:', error ? `ERROR: ${error.message}` : `latest notification: ${JSON.stringify(data?.[0] || 'none')}`);
    console.log('[socket] poll starting from:', lastPollTime);
  })();

  setInterval(async () => {
    pollCount++;
    try {
      const { data: newNotifications, error } = await supabaseAdmin
        .from('notifications')
        .select('*')
        .gt('created_at', lastPollTime)
        .order('created_at', { ascending: true })
        .limit(50);

      if (error) {
        console.error('[socket] notification poll error:', error.message);
        return;
      }

      // Log every 6th poll (once per minute at 10s interval) to confirm it's running
      if (pollCount % 6 === 0) {
        console.log(`[socket] poll #${pollCount} — watching from ${lastPollTime}, found ${newNotifications?.length || 0}`);
      }

      if (newNotifications && newNotifications.length > 0) {
        console.log(`[socket] poll found ${newNotifications.length} new notification(s)`);
        lastPollTime = newNotifications[newNotifications.length - 1].created_at;
        for (const notification of newNotifications) {
          const room = `chat_user:${notification.user_id}`;
          const sockets = io.sockets.adapter.rooms.get(room);
          console.log(`[socket] emitting to ${room} (${sockets?.size || 0} clients): ${notification.title}`);
          io.to(room).emit('new_notification', notification);
        }
      }
    } catch (e) {
      console.error('[socket] notification poll error:', e);
    }
  }, POLL_INTERVAL_MS);

  console.log(`[socket] Notification polling bridge active (${POLL_INTERVAL_MS / 1000}s interval)`);

  return io;
}
