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

  const token = useAuthStore.getState().accessToken;

  // Polling-first (socket.io's default): websocket-first hangs forever in dev
  // because Next's rewrite proxy never completes WS upgrades — the client sits
  // in CONNECTING and never falls back. Polling connects everywhere, then
  // upgrades to websocket where the proxy supports it (prod nginx does).
  socket = io('/', {
    auth: { token },
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
