import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Notification, NotificationsReadPayload } from '@squadhub/shared';
import api from '../services/api';
import { connectSocket } from '../services/socket';
import {
  isDesktopNotificationsReady,
  showBrowserNotification,
  syncBrowserNotificationPreference,
} from '../services/browserNotifications';

const POLL_MS = 12_000;

// Fast-forward the inbox list cache to read for the broadcast ids (or everything
// on a mark-all). Idempotent: already-read rows are left untouched, so the echo
// of this device's own optimistic mutation is a no-op.
function applyReadPayload(
  queryClient: ReturnType<typeof useQueryClient>,
  workspaceId: string | undefined,
  payload: NotificationsReadPayload,
) {
  queryClient.setQueryData<Notification[]>(['notifications', 'list'], (old) =>
    (old || []).map((n) =>
      payload.kind === 'all' || payload.ids.includes(n.id) ? { ...n, is_read: true } : n,
    ),
  );
  queryClient.invalidateQueries({ queryKey: ['notifications', 'unread-count'] });
  // Support-rail badge is driven by support_ticket notifications; a read
  // broadcast may have cleared them, so refresh the overview too.
  if (workspaceId) {
    queryClient.invalidateQueries({ queryKey: ['support', 'overview', workspaceId] });
  }
}

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

    const handleRead = (payload: NotificationsReadPayload) => {
      applyReadPayload(queryClient, workspaceId, payload);
    };

    socket.on('new_notification', handle);
    socket.on('notifications_read', handleRead);
    return () => {
      socket.off('new_notification', handle);
      socket.off('notifications_read', handleRead);
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
