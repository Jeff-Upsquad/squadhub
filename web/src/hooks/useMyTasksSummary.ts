import { useQuery } from '@tanstack/react-query';
import api from '../services/api';
import type { Task } from '@squadhub/shared';

export type MyTasksBuckets = {
  overdue: Task[];
  today: Task[];
  tomorrow: Task[];
  upcoming: Task[];
  later: Task[];
};

export function useMyTasksSummary(enabled = true) {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  return useQuery<MyTasksBuckets>({
    queryKey: ['my-tasks-summary', tz],
    queryFn: async () => {
      const res = await api.get(`/pm/tasks/my?tz=${encodeURIComponent(tz)}&include_done=false`);
      return res.data.data;
    },
    staleTime: 30_000,
    enabled,
  });
}
