import { useQuery } from '@tanstack/react-query';
import api from '../services/api';
import { isDesktopNotificationsReady } from '../services/browserNotifications';

export function useUnreadCount(enabled = true) {
  const pollFaster = typeof window !== 'undefined' && isDesktopNotificationsReady();
  return useQuery<number>({
    queryKey: ['notifications', 'unread-count'],
    queryFn: async () => {
      const res = await api.get('/notifications/unread-count');
      return res.data.data.count as number;
    },
    staleTime: pollFaster ? 10_000 : 30_000,
    refetchInterval: pollFaster ? 15_000 : 60_000,
    enabled,
  });
}
