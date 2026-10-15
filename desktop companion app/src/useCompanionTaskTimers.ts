import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type { CompanionTimerCommand, CompanionTimerReply, CompanionTimerSnapshot } from '@squadhub/shared';
import { useAuthStore } from './stores/authStore';
import { refreshTokens } from './services/auth';

export function useCompanionTaskTimers() {
  const authenticated = useAuthStore(s => s.isAuthenticated);
  const userId = useAuthStore(s => s.userId);
  const socketRef = useRef<Socket | null>(null);
  const [snapshot, setSnapshot] = useState<CompanionTimerSnapshot>({ available: false, timers: [] });
  useEffect(() => {
    if (!authenticated) { setSnapshot({ available: false, timers: [] }); return; }
    // A separate connection in the notch webview listens only for task state;
    // attaching notification handlers here would display each notification twice.
    const socket = io('https://api.squadhub.in', {
      auth: cb => cb({ token: useAuthStore.getState().accessToken }),
      transports: ['websocket', 'polling'], reconnectionDelayMax: 30_000,
    });
    socketRef.current = socket;
    socket.on('connect', () => socket.emit('companion_timer_watch'));
    socket.on('companion_timer_state', setSnapshot);
    socket.on('disconnect', () => setSnapshot({ available: false, timers: [] }));
    socket.on('connect_error', async error => {
      if (error.message !== 'Invalid token') return;
      const auth = useAuthStore.getState();
      if (!auth.refreshToken) return;
      const result = await refreshTokens(auth.refreshToken).catch(() => null);
      if (socketRef.current !== socket || auth.userId !== useAuthStore.getState().userId) return;
      if (result?.success && result.data) {
        await auth.updateTokens(result.data.access_token, result.data.refresh_token);
        if (socketRef.current === socket) socket.connect();
      }
    });
    // macOS can still suspend this webview while the notch is hidden, which
    // lets the ping time out and leaves socket.io sleeping in its backoff.
    // Reconnect the moment the panel is shown instead of waiting it out.
    const wake = () => { if (!socket.connected) { socket.disconnect(); socket.connect(); } };
    const win = getCurrentWindow();
    const unlisten = [win.listen('notch:show', wake), win.listen('notch:expand', wake)];
    document.addEventListener('visibilitychange', wake);
    return () => {
      socketRef.current = null;
      document.removeEventListener('visibilitychange', wake);
      unlisten.forEach(p => void p.then(f => f()));
      socket.disconnect();
    };
  }, [authenticated, userId]);
  const control = useCallback((action: CompanionTimerCommand['action'], taskId?: string) =>
    new Promise<void>((resolve, reject) => {
      const socket = socketRef.current;
      if (!socket?.connected) { reject(new Error('Task timers are disconnected. Open SquadHub and try again.')); return; }
      socket.timeout(15_000).emit('companion_timer_control', { requestId: crypto.randomUUID(), action, taskId },
        (error: Error | null, reply: CompanionTimerReply) => {
          if (error || !reply?.success) reject(new Error(reply?.error || 'The browser did not respond. Check SquadHub before retrying.'));
          else resolve();
        });
    }), []);
  return { ...snapshot, control };
}
