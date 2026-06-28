import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';

// ---------- shapes ----------
// A "group run" is a Start->Stop session on the virtual parent row of a
// grouped task list. It mirrors a work-block run but is keyed by a client-
// computed group_key instead of a task id.

export interface GroupRun {
  id: string;
  user_id: string;
  group_key: string;
  group_label: string;
  workspace_id: string | null;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  created_at: string;
  completions?: GroupRunCompletion[];
  task_times?: GroupRunTaskTime[];
}

export interface GroupRunCompletion {
  run_id: string;
  completed_task_id: string;
  completed_at: string;
  task?: { id: string; title: string; priority: string; status: string | null; list_id: string } | null;
}

export interface GroupRunTaskTime {
  id: string;
  run_id: string;
  task_id: string;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  task?: { id: string; title: string; priority: string; status: string | null; list_id: string } | null;
}

export interface ActiveGroupRun {
  run: GroupRun;
}

// ---------- queries ----------

export function useActiveGroupRun() {
  return useQuery<ActiveGroupRun | null>({
    queryKey: ['group-run', 'active'],
    queryFn: async () => {
      const res = await api.get('/pm/group-runs/active');
      return (res.data?.data ?? null) as ActiveGroupRun | null;
    },
    staleTime: 5_000,
    refetchOnWindowFocus: true,
  });
}

export function useGroupRunHistory(groupKey: string | null | undefined, enabled = true) {
  return useQuery<{ runs: GroupRun[] }>({
    queryKey: ['group-run', 'history', groupKey],
    queryFn: async () => {
      const res = await api.get('/pm/group-runs/history', { params: { key: groupKey } });
      return (res.data?.data ?? { runs: [] }) as { runs: GroupRun[] };
    },
    enabled: !!groupKey && enabled,
    staleTime: 10_000,
  });
}

// ---------- mutations ----------

export function useStartGroupRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { group_key: string; group_label?: string; list_id?: string | null }) => {
      const res = await api.post('/pm/group-runs/runs', vars);
      return res.data?.data as GroupRun;
    },
    onSettled: (_d, _e, vars) => {
      qc.invalidateQueries({ queryKey: ['group-run', 'active'] });
      qc.invalidateQueries({ queryKey: ['group-run', 'history', vars.group_key] });
    },
  });
}

export function useStopGroupRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { run_id: string; group_key: string }) => {
      const res = await api.patch(`/pm/group-runs/runs/${vars.run_id}`);
      return res.data?.data as GroupRun;
    },
    onSettled: (_d, _e, vars) => {
      qc.invalidateQueries({ queryKey: ['group-run', 'active'] });
      qc.invalidateQueries({ queryKey: ['group-run', 'history', vars.group_key] });
      qc.invalidateQueries({ queryKey: ['task-time-entries'] });
      qc.invalidateQueries({ queryKey: ['folder-time-summary'] });
    },
  });
}

export function useRecordGroupRunCompletion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { run_id: string; completed_task_id: string }) => {
      const res = await api.post(`/pm/group-runs/runs/${vars.run_id}/completions`, {
        completed_task_id: vars.completed_task_id,
      });
      return res.data?.data as GroupRunCompletion;
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['group-run'] });
    },
  });
}

export function useOpenGroupRunTaskTime() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { run_id: string; task_id: string }) => {
      const res = await api.post(`/pm/group-runs/runs/${vars.run_id}/task-times`, {
        task_id: vars.task_id,
      });
      return res.data?.data as GroupRunTaskTime;
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['group-run'] });
    },
  });
}

export function useCloseGroupRunTaskTime() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { run_id: string; task_id: string }) => {
      const res = await api.post(`/pm/group-runs/runs/${vars.run_id}/task-times/close`, {
        task_id: vars.task_id,
      });
      return (res.data?.data ?? null) as GroupRunTaskTime | null;
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['group-run'] });
    },
  });
}
