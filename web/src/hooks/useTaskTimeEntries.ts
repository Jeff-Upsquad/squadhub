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

/** Every logged session on one task (all users), newest first. */
export function useTaskTimeEntries(taskId: string | null, enabled: boolean = true) {
  return useQuery<TaskTimeEntry[]>({
    queryKey: ['task-time-entries', 'task', taskId],
    queryFn: async () => (await api.get(`/pm/tasks/${taskId}/time-entries`)).data.data,
    staleTime: 15_000,
    enabled: enabled && !!taskId,
  });
}

// Everything a logged entry touches: the per-task history, the task itself
// (its `time_tracked` aggregate) and every list view that renders the task.
function invalidateTimeQueries(qc: ReturnType<typeof useQueryClient>, taskId: string) {
  qc.invalidateQueries({ queryKey: ['task-time-entries'] });
  qc.invalidateQueries({ queryKey: ['task', taskId] });
  qc.invalidateQueries({ queryKey: ['tasks'] });
  qc.invalidateQueries({ queryKey: ['folder-tasks'] });
  qc.invalidateQueries({ queryKey: ['space-tasks'] });
  qc.invalidateQueries({ queryKey: ['my-tasks'] });
  qc.invalidateQueries({ queryKey: ['folder-time-summary'] });
}

export function useCreateTaskTimeEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ taskId, startedAt, durationSeconds, note, source }: {
      taskId: string;
      startedAt: string;
      /** Negative subtracts over-logged time (server gates that on role). */
      durationSeconds: number;
      note?: string | null;
      source?: 'timer' | 'manual';
    }) => {
      const res = await api.post(`/pm/tasks/${taskId}/time-entries`, {
        started_at: startedAt,
        duration_seconds: durationSeconds,
        note: note ?? null,
        source,
      });
      return res.data.data as TaskTimeEntry;
    },
    onSuccess: (_data, vars) => invalidateTimeQueries(qc, vars.taskId),
  });
}

export function useDeleteTaskTimeEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ taskId, entryId }: { taskId: string; entryId: string }) => {
      await api.delete(`/pm/tasks/${taskId}/time-entries/${entryId}`);
      return entryId;
    },
    onSuccess: (_data, vars) => invalidateTimeQueries(qc, vars.taskId),
  });
}
