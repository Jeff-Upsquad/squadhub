import { io, Socket } from 'socket.io-client';
import type { ServerToClientEvents, ClientToServerEvents } from '@squadhub/shared';
import { useAuthStore } from '../stores/authStore';
import { usePresenceStore } from '../stores/presenceStore';

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: TypedSocket | null = null;

export function getSocket(): TypedSocket | null {
  return socket;
}

export function connectSocket(): TypedSocket {
  if (socket?.connected) return socket;

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

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
