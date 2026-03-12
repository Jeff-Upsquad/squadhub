import { io, Socket } from 'socket.io-client';
import type { ServerToClientEvents, ClientToServerEvents } from '@squadhub/shared';
import { useAuthStore } from '../stores/authStore';

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: TypedSocket | null = null;

export function getSocket(): TypedSocket | null {
  return socket;
}

export function connectSocket(): TypedSocket {
  if (socket?.connected) return socket;

  const token = useAuthStore.getState().accessToken;

  socket = io('/', {
    auth: { token },
    transports: ['websocket', 'polling'],
  }) as TypedSocket;

  socket.on('connect', () => {
    console.log('Socket connected');
  });

  socket.on('disconnect', (reason) => {
    console.log('Socket disconnected:', reason);
  });

  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
