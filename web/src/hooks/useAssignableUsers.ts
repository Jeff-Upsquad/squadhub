import { useQuery } from '@tanstack/react-query';
import api from '../services/api';
import type { User } from '@squadhub/shared';

export function useAssignableUsers(taskId: string | null) {
  return useQuery<User[]>({
    queryKey: ['assignable-users', taskId],
    queryFn: async () => {
      const res = await api.get(`/pm/tasks/${taskId}/assignable-users`);
      return res.data.data;
    },
    enabled: !!taskId,
  });
}
