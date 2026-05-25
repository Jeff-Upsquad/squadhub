import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Notification } from '@squadhub/shared';
import api from '../services/api';
import { connectSocket } from '../services/socket';
import {
  isDesktopNotificationsReady,
  showBrowserNotification,
  syncBrowserNotificationPreference,
} from '../services/browserNotifications';

const POLL_MS = 12_000;

/** Socket + polling inbox refresh + native OS notifications. */
export function useBrowserNotifications(workspaceId: string | undefined) {
  const queryClient = useQueryClient();
  const seenIdsRef = useRef<Set<string>>(new Set());
  const pollInitializedRef = useRef(false);

  useEffect(() => {
    syncBrowserNotificationPreference();
  }, []);

  useEffect(() => {
    if (!workspaceId) return;
    const socket = connectSocket();

    const handle = (notification: Notification) => {
      queryClient.invalidateQueries({ queryKey: ['notifications', 'list'] });
      queryClient.invalidateQueries({ queryKey: ['notifications', 'unread-count'] });
      seenIdsRef.current.add(notification.id);
      showBrowserNotification(notification);
    };

    socket.on('new_notification', handle);
    return () => {
      socket.off('new_notification', handle);
    };
  }, [queryClient, workspaceId]);

  // Reliable delivery: diff the inbox list on a timer (socket + 60s unread poll often miss OS banners).
  useEffect(() => {
    if (!workspaceId) return;

    let cancelled = false;

    const poll = async () => {
      if (!isDesktopNotificationsReady() || cancelled) return;
      try {
        const res = await api.get('/notifications', { params: { limit: 30 } });
        if (cancelled) return;
        const items: Notification[] = res.data.data || [];

        if (!pollInitializedRef.current) {
          for (const n of items) seenIdsRef.current.add(n.id);
          pollInitializedRef.current = true;
          return;
        }

        for (const n of items) {
          if (seenIdsRef.current.has(n.id)) continue;
          seenIdsRef.current.add(n.id);
          if (!n.is_read) showBrowserNotification(n);
        }
      } catch {
        // non-fatal
      }
    };

    poll();
    const timer = window.setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [workspaceId]);
}
