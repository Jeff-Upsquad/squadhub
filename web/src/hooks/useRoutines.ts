import { useQuery, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import api from '../services/api';
import type { Task } from '@squadhub/shared';

// A routine = a task row with a non-null recurrence rule, hydrated by
// GET /pm/routines with spawn stats and the next firing date.
export type Routine = Task & {
  instance_count: number;
  last_instance_date: string | null;
  next_occurrence: string | null;
};

// Routine mutations can materialise new task instances, so task-list views
// need refreshing alongside the routines list itself.
function invalidateRoutineViews(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: ['routines'] });
  qc.invalidateQueries({ queryKey: ['tasks'] });
  qc.invalidateQueries({ queryKey: ['folder-tasks'] });
  qc.invalidateQueries({ queryKey: ['space-tasks'] });
  qc.invalidateQueries({ queryKey: ['my-tasks'] });
  qc.invalidateQueries({ queryKey: ['day-planner'] });
}

export function useRoutines() {
  return useQuery<Routine[]>({
    queryKey: ['routines'],
    queryFn: async () => {
      const res = await api.get('/pm/routines');
      return res.data.data;
    },
    staleTime: 30_000,
  });
}

export function useSetRoutinePaused() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, paused }: { id: string; paused: boolean }) => {
      const res = await api.patch(`/pm/routines/${id}`, { paused });
      return res.data.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['routines'] }),
  });
}

export function useRunRoutineNow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await api.post(`/pm/routines/${id}/run`);
      return res.data.data as { date: string; outcome: 'created' | 'exists' };
    },
    onSuccess: () => invalidateRoutineViews(qc),
  });
}

export function useDeleteRoutine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/pm/tasks/${id}`);
      return id;
    },
    onSuccess: () => invalidateRoutineViews(qc),
  });
}
