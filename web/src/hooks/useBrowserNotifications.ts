import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Notification } from '@squadhub/shared';
import { connectSocket } from '../services/socket';
import { maybeShowBrowserNotification } from '../services/browserNotifications';

/** Socket-driven inbox refresh + OS notifications when the tab is in the background. */
export function useBrowserNotifications(workspaceId: string | undefined) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!workspaceId) return;
    const socket = connectSocket();

    const handle = (notification: Notification) => {
      queryClient.invalidateQueries({ queryKey: ['notifications', 'list'] });
      queryClient.invalidateQueries({ queryKey: ['notifications', 'unread-count'] });
      maybeShowBrowserNotification(notification);
    };

    socket.on('new_notification', handle);
    return () => {
      socket.off('new_notification', handle);
    };
  }, [queryClient, workspaceId]);
}
