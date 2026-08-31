import { io, Socket } from 'socket.io-client';
import type { ServerToClientEvents, ClientToServerEvents } from '@squadhub/shared';
import { useAuthStore } from '../stores/authStore';
import { usePresenceStore } from '../stores/presenceStore';

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: TypedSocket | null = null;
const channelRoomRefs = new Map<string, number>();

export function getSocket(): TypedSocket | null {
  return socket;
}

export function connectSocket(): TypedSocket {
  // Reuse the same manager while it is reconnecting. Creating a replacement
  // socket here would leave the old manager retrying in the background and
  // produce duplicate events once both connect.
  if (socket) {
    if (!socket.connected) socket.connect();
    return socket;
  }

  // Polling-first (socket.io's default): websocket-first hangs forever in dev
  // because Next's rewrite proxy never completes WS upgrades — the client sits
  // in CONNECTING and never falls back. Polling connects everywhere, then
  // upgrades to websocket where the proxy supports it (prod nginx does).
  //
  // `auth` uses the FUNCTION form on purpose: socket.io calls it on every
  // connection attempt (initial + each reconnect). An object literal would
  // snapshot the access token once — Supabase rotates tokens hourly, so every
  // later reconnect would fail auth and the tab would silently go deaf to all
  // live events (messages, notifications, presence) until a manual reload.
  socket = io('/', {
    auth: (cb) => cb({ token: useAuthStore.getState().accessToken }),
    transports: ['polling', 'websocket'],
  }) as TypedSocket;

  socket.on('connect', () => {
    console.log('Socket connected');
    // Socket.IO rooms are server-side connection state and disappear whenever
    // the transport reconnects. Restore every conversation currently mounted
    // so live messages and typing resume without a page refresh.
    channelRoomRefs.forEach((_count, channelId) => socket?.emit('join_channel', channelId));
  });

  socket.on('disconnect', (reason) => {
    console.log('Socket disconnected:', reason);
    usePresenceStore.getState().clear();
  });

  // Presence: seed on connect, then apply deltas.
  socket.on('online_users', ({ user_ids }) => usePresenceStore.getState().seed(user_ids));
  socket.on('user_online', ({ user_id }) => usePresenceStore.getState().setOnline(user_id));
  socket.on('user_offline', ({ user_id }) => usePresenceStore.getState().setOffline(user_id));

  return socket;
}

/**
 * Keep a conversation room joined for as long as at least one chat surface is
 * mounted. The ref count matters because the main chat and a side panel can
 * display the same room; closing either one must not unsubscribe the other.
 */
export function subscribeToChannelRoom(channelId: string): () => void {
  const liveSocket = connectSocket();
  const previous = channelRoomRefs.get(channelId) || 0;
  channelRoomRefs.set(channelId, previous + 1);
  if (previous === 0 && liveSocket.connected) liveSocket.emit('join_channel', channelId);

  let subscribed = true;
  return () => {
    if (!subscribed) return;
    subscribed = false;
    const next = (channelRoomRefs.get(channelId) || 1) - 1;
    if (next <= 0) {
      channelRoomRefs.delete(channelId);
      if (liveSocket.connected) liveSocket.emit('leave_channel', channelId);
    } else {
      channelRoomRefs.set(channelId, next);
    }
  };
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  channelRoomRefs.clear();
}
