import { useQuery } from '@tanstack/react-query';
import api from '../services/api';
import type { TaskType } from '@squadhub/shared';

export function useTaskTypes() {
  return useQuery<TaskType[]>({
    queryKey: ['task-types'],
    queryFn: async () => {
      const res = await api.get('/pm/task-types');
      return res.data.data;
    },
    staleTime: 5 * 60 * 1000,
  });
}
