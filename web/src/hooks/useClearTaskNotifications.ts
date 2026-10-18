import { useCallback, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Notification } from '@squadhub/shared';
import api from '../services/api';
import { connectSocket } from '../services/socket';

// Every task_* notification (assigned, updated, completed, commented) and task
// mentions carry reference_type='task' plus metadata.task_id.
export function notifMatchesTask(n: Notification, taskId: string): boolean {
  return n.reference_type === 'task' && n.metadata?.task_id === taskId;
}

/**
 * Having a task's detail panel on screen counts as reading its updates, so
 * the task's inbox notifications should clear instead of leaving the bell
 * badge nagging — the task equivalent of ChatPanel's read-conversation flow.
 * Clears once per opened task and again whenever a live notification for
 * that same task arrives while it stays open. Pass null to disable (used for
 * the hover peek, which is a preview rather than a deliberate open).
 */
export function useClearTaskNotifications(taskId: string | null | undefined) {
  const queryClient = useQueryClient();

  const clear = useCallback((id: string) => {
    api
      .post('/notifications/read-conversation', { task_id: id })
      .then(async () => {
        // See ChatPanel's clearConversationNotifications: a notifications GET
        // issued before the server marked rows read can resolve *after* this
        // optimistic update and clobber the cache with unread rows, so cancel
        // the in-flight fetches first and let this clear be the authoritative
        // last writer, then reconcile from the server.
        await Promise.all([
          queryClient.cancelQueries({ queryKey: ['notifications', 'list'] }),
          queryClient.cancelQueries({ queryKey: ['notifications', 'unread-count'] }),
        ]);
        queryClient.setQueryData<Notification[]>(['notifications', 'list'], (old) =>
          (old || []).map((n) =>
            !n.is_read && notifMatchesTask(n, id) ? { ...n, is_read: true } : n,
          ),
        );
        queryClient.invalidateQueries({ queryKey: ['notifications', 'unread-count'] });
        queryClient.invalidateQueries({ queryKey: ['notifications', 'list'] });
      })
      .catch(() => {
        /* non-critical — the inbox can still be cleared manually */
      });
  }, [queryClient]);

  useEffect(() => {
    if (taskId) clear(taskId);
  }, [taskId, clear]);

  // A comment or update landing while the task is open has effectively been
  // read on this screen; clear it instead of badging what the user is looking
  // at. A hidden browser window still has the panel mounted but must not
  // silently consume the alert, so only clear while the document is visible.
  useEffect(() => {
    if (!taskId) return;
    const socket = connectSocket();
    const handleNotification = (n: Notification) => {
      if (n && notifMatchesTask(n, taskId) && document.visibilityState === 'visible') {
        clear(taskId);
      }
    };
    socket.on('new_notification', handleNotification);
    return () => {
      socket.off('new_notification', handleNotification);
    };
  }, [taskId, clear]);
}
