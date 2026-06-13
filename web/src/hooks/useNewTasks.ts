import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';
import type { Task } from '@squadhub/shared';

// A row in the My Home "New Tasks" review queue. The server annotates each task
// with the caller's per-user review state (see GET /pm/tasks/new).
export type NewTask = Task & { reviewed?: boolean };

/**
 * My Home "New Tasks" queue: open tasks the caller is assigned to, plus open tasks
 * they created that are still unassigned. Reviewed tasks are excluded by default;
 * pass includeReviewed to fetch them too (each row then carries `reviewed`).
 */
export function useNewTasks(opts?: { includeReviewed?: boolean; enabled?: boolean }) {
  const includeReviewed = !!opts?.includeReviewed;
  return useQuery<NewTask[]>({
    queryKey: ['new-tasks', includeReviewed],
    queryFn: async () => {
      const qs = includeReviewed ? '?include_reviewed=true' : '';
      const res = await api.get(`/pm/tasks/new${qs}`);
      return res.data.data as NewTask[];
    },
    staleTime: 15_000,
    refetchInterval: 60_000,
    enabled: opts?.enabled ?? true,
  });
}

/** Tick / untick the caller's per-user "reviewed" flag on a task. */
export function useReviewTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ taskId, reviewed }: { taskId: string; reviewed: boolean }) => {
      if (reviewed) await api.post(`/pm/tasks/${taskId}/review`);
      else await api.delete(`/pm/tasks/${taskId}/review`);
    },
    // The count badge and both popup modes read from these; refresh after either way.
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['new-tasks'] });
      qc.invalidateQueries({ queryKey: ['my-tasks-summary'] });
    },
  });
}
