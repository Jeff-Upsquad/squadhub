import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Notification } from '@squadhub/shared';
import api from '../services/api';
import { connectSocket } from '../services/socket';
import {
  isBrowserNotificationsEnabled,
  showBrowserNotification,
  syncBrowserNotificationPreference,
} from '../services/browserNotifications';
import { useUnreadCount } from './useUnreadCount';

/** Socket-driven inbox refresh + native OS notifications. */
export function useBrowserNotifications(workspaceId: string | undefined) {
  const queryClient = useQueryClient();
  const { data: unreadCount = 0 } = useUnreadCount();
  const prevUnreadRef = useRef(unreadCount);

  useEffect(() => {
    syncBrowserNotificationPreference();
  }, []);

  useEffect(() => {
    if (!workspaceId) return;
    const socket = connectSocket();

    const handle = (notification: Notification) => {
      queryClient.invalidateQueries({ queryKey: ['notifications', 'list'] });
      queryClient.invalidateQueries({ queryKey: ['notifications', 'unread-count'] });
      showBrowserNotification(notification);
    };

    socket.on('new_notification', handle);
    return () => {
      socket.off('new_notification', handle);
    };
  }, [queryClient, workspaceId]);

  // Fallback when inbox badge updates via polling but socket event was missed.
  useEffect(() => {
    if (!workspaceId || !isBrowserNotificationsEnabled()) return;
    if (unreadCount <= prevUnreadRef.current) {
      prevUnreadRef.current = unreadCount;
      return;
    }

    prevUnreadRef.current = unreadCount;

    let cancelled = false;
    (async () => {
      try {
        const res = await api.get('/notifications', { params: { limit: 10 } });
        if (cancelled) return;
        const items: Notification[] = res.data.data || [];
        const latest = items.find((n) => !n.is_read) ?? items[0];
        if (latest) showBrowserNotification(latest);
      } catch {
        // non-fatal
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [unreadCount, workspaceId]);
}
