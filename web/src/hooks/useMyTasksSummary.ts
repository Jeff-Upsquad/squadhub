import { useQuery } from '@tanstack/react-query';
import api from '../services/api';
import type { Task } from '@squadhub/shared';
import { usePMStore } from '../stores/pmStore';

export type MyTasksBuckets = {
  overdue: Task[];
  today: Task[];
  tomorrow: Task[];
  upcoming: Task[];
  later: Task[];
  focused: Task[];
};

export function useMyTasksSummary(enabled = true) {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  // Focus stars are persistent (no overnight reset), so always use them.
  const focusedIds = usePMStore((s) => s.focusedTodayIds);
  const focusedKey = focusedIds.join(',');
  return useQuery<MyTasksBuckets>({
    queryKey: ['my-tasks-summary', tz, focusedKey],
    queryFn: async () => {
      const params = new URLSearchParams({ tz, include_done: 'false' });
      if (focusedKey) params.set('focused_ids', focusedKey);
      const res = await api.get(`/pm/tasks/my?${params.toString()}`);
      return res.data.data;
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
    enabled,
  });
}
