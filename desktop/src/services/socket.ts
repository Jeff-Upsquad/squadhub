import { io, type Socket } from 'socket.io-client';
import { useAuthStore } from '../stores/authStore';
import { refreshTokens } from './auth';
import { showNotification } from './notifications';

const SERVER_URL = 'https://api.squadhub.in';

let socket: Socket | null = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_DELAY = 30_000;

export function connectSocket(): Socket {
  const { accessToken } = useAuthStore.getState();
  if (!accessToken) throw new Error('No access token');

  if (socket?.connected) return socket;

  socket?.disconnect();

  socket = io(SERVER_URL, {
    auth: { token: accessToken },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: MAX_RECONNECT_DELAY,
    reconnectionAttempts: Infinity,
  });

  socket.on('connect', () => {
    console.log('[socket] connected');
    reconnectAttempts = 0;
    window.dispatchEvent(new CustomEvent('socket-status', { detail: 'connected' }));
  });

  socket.on('disconnect', (reason) => {
    console.log('[socket] disconnected:', reason);
    window.dispatchEvent(new CustomEvent('socket-status', { detail: 'disconnected' }));
  });

  socket.on('connect_error', async (err) => {
    console.warn('[socket] connect error:', err.message);
    reconnectAttempts++;

    if (err.message === 'Invalid token' || err.message === 'Authentication required') {
      const { refreshToken, updateTokens, logout } = useAuthStore.getState();
      if (!refreshToken) {
        logout();
        return;
      }

      try {
        const res = await refreshTokens(refreshToken);
        if (res.success && res.data) {
          await updateTokens(res.data.access_token, res.data.refresh_token);
          socket!.auth = { token: res.data.access_token };
          socket!.connect();
        } else {
          logout();
        }
      } catch {
        if (reconnectAttempts > 3) logout();
      }
    }
  });

  socket.on('new_notification', (notification) => {
    showNotification(notification);
  });

  return socket;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
  window.dispatchEvent(new CustomEvent('socket-status', { detail: 'disconnected' }));
}

export function getSocket(): Socket | null {
  return socket;
}
