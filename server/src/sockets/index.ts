import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import { config } from '../config';
import { supabaseAdmin, supabaseAuth } from '../supabase';
import { sendPartnerPush } from '../push/partnerPush';
import { sendWebPush } from '../push/webPush';
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
    // Next.js dev rewrites strip the trailing slash from /socket.io/ — without
    // this, engine.io's prefix check misses and Express 404s every poll.
    addTrailingSlash: false,
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

    // Seed the connecting client with everyone currently online — the
    // user_online/user_offline deltas only cover changes after this point.
    socket.emit('online_users', { user_ids: Array.from(onlineUsers.keys()) });

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
    // Meeting poll cards + the mini-app detail view subscribe to live vote /
    // suggestion / status updates. The route handlers emit meeting_event_updated
    // to this room after any mutation.
    socket.on('join_meeting', (meetingEventId: string) => {
      if (meetingEventId) socket.join(`meeting:${meetingEventId}`);
    });
    socket.on('leave_meeting', (meetingEventId: string) => {
      if (meetingEventId) socket.leave(`meeting:${meetingEventId}`);
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

  // Bridge: notifications table → Socket.IO.
  // Notifications are created by PostgreSQL triggers (not app code), so the
  // server can't emit at creation time — it polls for new rows and fans them
  // out. Supabase Realtime (postgres_changes) would be the instant option, but
  // this project's service key is the new sb_secret_* format, which the pinned
  // supabase-js can't use as a realtime access token — the subscription just
  // times out. So we poll, but fast: 2s keeps the banner near-instant while
  // staying cheap thanks to the index on notifications(created_at) that the
  // `created_at > watermark` scan rides.
  const deliver = (notification: { id?: string; user_id?: string; title?: string } | null) => {
    if (!notification?.id || !notification.user_id) return;
    const room = `chat_user:${notification.user_id}`;
    const sockets = io.sockets.adapter.rooms.get(room);
    const online = (sockets?.size ?? 0) > 0;
    console.log(`[socket] deliver -> ${room} (${sockets?.size || 0} clients): ${notification.title}`);
    io.to(room).emit('new_notification', notification as any);
    // Mirror to the native partner app via FCM (fire-and-forget; no-ops if FCM
    // is unconfigured or the user has no registered partner tokens).
    sendPartnerPush(notification as any).catch((e) => console.error('[socket] partner push error:', e));
    // Browser Web Push for the installable PWA — ONLY when the user has no live
    // socket. While a tab/PWA is open it's connected, and its in-app browser
    // notification already fires, so gating on offline avoids a double toast.
    // Mirrors the online-gating used for chat push. No-op without VAPID keys or
    // any registered subscriptions.
    if (!online) {
      sendWebPush(notification as any).catch((e) => console.error('[socket] web push error:', e));
    }
  };

  const POLL_INTERVAL_MS = 2_000;
  const MAX_BACKOFF_MS = 30_000;
  let lastPollTime = new Date().toISOString();
  let pollCount = 0;
  // When Supabase goes unreachable a poll doesn't fail — it stalls for the full
  // 10s connect timeout. At a 2s tick that means five more polls launch behind
  // the stuck one and keep launching, so a brief network dropout turns into a
  // self-sustaining pile of hung requests competing with real traffic (sign-in
  // among it). Skip a tick while one is still in flight, and back off while the
  // failures persist. lastPollTime is untouched by a failure, so a backed-off
  // poll still picks up everything it missed once the network returns.
  let polling = false;
  let consecutiveFailures = 0;
  let nextAttemptAt = 0;

  const onPollFailure = (detail: unknown) => {
    consecutiveFailures++;
    nextAttemptAt =
      Date.now() + Math.min(MAX_BACKOFF_MS, POLL_INTERVAL_MS * 2 ** consecutiveFailures);
    // One line per outage, not one per tick — this used to emit ~30/min for the
    // whole dropout and bury everything else in the log.
    if (consecutiveFailures === 1 || consecutiveFailures % 20 === 0) {
      console.error(
        `[socket] notification poll error (${consecutiveFailures}x):`,
        detail instanceof Error ? detail.message : detail,
      );
    }
  };

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
    if (polling || Date.now() < nextAttemptAt) return;
    polling = true;
    pollCount++;
    try {
      const { data: newNotifications, error } = await supabaseAdmin
        .from('notifications')
        .select('*')
        .gt('created_at', lastPollTime)
        .order('created_at', { ascending: true })
        .limit(50);

      if (error) {
        onPollFailure(error.message);
        return;
      }

      if (consecutiveFailures > 0) {
        console.log(`[socket] notification poll recovered after ${consecutiveFailures} failure(s)`);
        consecutiveFailures = 0;
        nextAttemptAt = 0;
      }

      // Heartbeat roughly once a minute (every 30th poll at 2s) to confirm it's alive.
      if (pollCount % 30 === 0) {
        console.log(`[socket] poll #${pollCount} — watching from ${lastPollTime}, found ${newNotifications?.length || 0}`);
      }

      if (newNotifications && newNotifications.length > 0) {
        lastPollTime = newNotifications[newNotifications.length - 1].created_at;
        for (const notification of newNotifications) deliver(notification);
      }
    } catch (e) {
      onPollFailure(e);
    } finally {
      polling = false;
    }
  }, POLL_INTERVAL_MS);

  console.log(`[socket] Notification bridge active (${POLL_INTERVAL_MS / 1000}s poll)`);

  return io;
}
