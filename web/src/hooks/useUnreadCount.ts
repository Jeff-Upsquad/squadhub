import { useQuery } from '@tanstack/react-query';
import api from '../services/api';

export function useUnreadCount(enabled = true) {
  return useQuery<number>({
    queryKey: ['notifications', 'unread-count'],
    queryFn: async () => {
      const res = await api.get('/notifications/unread-count');
      return res.data.data.count as number;
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
    enabled,
  });
}
