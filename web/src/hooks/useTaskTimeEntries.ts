import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { TaskTimeEntry } from '@squadhub/shared';
import api from '../services/api';

export function useMyTimeEntries(enabled: boolean = true) {
  return useQuery<TaskTimeEntry[]>({
    queryKey: ['task-time-entries', 'my'],
    queryFn: async () => (await api.get('/pm/tasks/my-time-entries')).data.data,
    staleTime: 30_000,
    enabled,
  });
}

export function useCreateTaskTimeEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ taskId, startedAt, durationSeconds }: {
      taskId: string;
      startedAt: string;
      durationSeconds: number;
    }) => {
      const res = await api.post(`/pm/tasks/${taskId}/time-entries`, {
        started_at: startedAt,
        duration_seconds: durationSeconds,
      });
      return res.data.data as TaskTimeEntry;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['task-time-entries'] });
      qc.invalidateQueries({ queryKey: ['task', vars.taskId] });
      qc.invalidateQueries({ queryKey: ['tasks'] });
      qc.invalidateQueries({ queryKey: ['folder-tasks'] });
      qc.invalidateQueries({ queryKey: ['space-tasks'] });
      qc.invalidateQueries({ queryKey: ['my-tasks'] });
      qc.invalidateQueries({ queryKey: ['folder-time-summary'] });
      qc.invalidateQueries({ queryKey: ['folder-subscription-card'] });
    },
  });
}
