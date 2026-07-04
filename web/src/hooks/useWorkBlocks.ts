import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';
import { usePMStore } from '../stores/pmStore';
import type { Recurrence } from '../utils/workBlockRecurrence';

// ---------- shapes ----------

export interface WorkBlockConfig {
  task_id: string;
  start_minute: number;
  end_minute: number;
  recurrence: Recurrence;
  notify_before_min: number;
  notify_on_start: boolean;
  notify_on_end: boolean;
  created_at: string;
  updated_at: string;
}

export interface WorkBlockRun {
  id: string;
  task_id: string;
  user_id: string;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  created_at: string;
  completions?: WorkBlockCompletion[];
  task_times?: WorkBlockTaskTime[];
}

export interface WorkBlockCompletion {
  run_id: string;
  completed_task_id: string;
  completed_at: string;
  task?: { id: string; title: string; priority: string; status: string | null; list_id: string } | null;
}

// Per-task timer overlap inside a run. ended_at===null means the per-task
// timer is still running.
export interface WorkBlockTaskTime {
  id: string;
  run_id: string;
  task_id: string;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  task?: { id: string; title: string; priority: string; status: string | null; list_id: string } | null;
}

export interface WorkBlockLink {
  work_block_task_id: string;
  linked_task_id: string;
  linked_by: string;
  position: number;
  created_at: string;
  task?: { id: string; title: string; priority: string; status: string | null; list_id: string } | null;
}

export interface WorkBlockBundle {
  config: WorkBlockConfig | null;
  runs: WorkBlockRun[];
  links: WorkBlockLink[];
}

// ---------- queries ----------

export function useWorkBlock(taskId: string | null | undefined) {
  return useQuery<WorkBlockBundle>({
    queryKey: ['work-block', taskId],
    queryFn: async () => {
      const res = await api.get(`/pm/work-blocks/${taskId}`);
      return res.data?.data as WorkBlockBundle;
    },
    enabled: !!taskId,
    staleTime: 15_000,
  });
}

export interface ActiveWorkBlock {
  run: WorkBlockRun;
  task: { id: string; title: string; list_id: string; task_type_id: string | null };
}

export function useActiveWorkBlockRun() {
  return useQuery<ActiveWorkBlock | null>({
    queryKey: ['work-block', 'active'],
    queryFn: async () => {
      const res = await api.get('/pm/work-blocks/active');
      return (res.data?.data ?? null) as ActiveWorkBlock | null;
    },
    staleTime: 5_000,
    refetchOnWindowFocus: true,
  });
}

// ---------- mutations ----------

export function useUpsertWorkBlockConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { task_id: string; config: Partial<WorkBlockConfig> }) => {
      const res = await api.post(`/pm/work-blocks/${vars.task_id}`, vars.config);
      return res.data?.data as WorkBlockConfig;
    },
    onSettled: (_d, _e, vars) => {
      qc.invalidateQueries({ queryKey: ['work-block', vars.task_id] });
      qc.invalidateQueries({ queryKey: ['day-plans'] });
    },
  });
}

export function usePatchWorkBlockConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { task_id: string; patch: Partial<WorkBlockConfig> }) => {
      const res = await api.patch(`/pm/work-blocks/${vars.task_id}`, vars.patch);
      return res.data?.data as WorkBlockConfig;
    },
    onSettled: (_d, _e, vars) => {
      qc.invalidateQueries({ queryKey: ['work-block', vars.task_id] });
      qc.invalidateQueries({ queryKey: ['day-plans'] });
    },
  });
}

export function useStartWorkBlockRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { task_id: string }) => {
      const res = await api.post(`/pm/work-blocks/${vars.task_id}/runs`);
      return res.data?.data as WorkBlockRun;
    },
    onSettled: (_d, _e, vars) => {
      qc.invalidateQueries({ queryKey: ['work-block', vars.task_id] });
      qc.invalidateQueries({ queryKey: ['work-block', 'active'] });
    },
  });
}

export function useStopWorkBlockRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { run_id: string; task_id: string }) => {
      const res = await api.patch(`/pm/work-blocks/runs/${vars.run_id}`);
      return res.data?.data as WorkBlockRun;
    },
    onSettled: (_d, _e, vars) => {
      qc.invalidateQueries({ queryKey: ['work-block', vars.task_id] });
      qc.invalidateQueries({ queryKey: ['work-block', 'active'] });
    },
  });
}

export function useOpenWorkBlockTaskTime() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { run_id: string; task_id: string }) => {
      const res = await api.post(`/pm/work-blocks/runs/${vars.run_id}/task-times`, {
        task_id: vars.task_id,
      });
      return res.data?.data as WorkBlockTaskTime;
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['work-block'] });
    },
  });
}

export function useCloseWorkBlockTaskTime() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { run_id: string; task_id: string }) => {
      const res = await api.post(`/pm/work-blocks/runs/${vars.run_id}/task-times/close`, {
        task_id: vars.task_id,
      });
      return (res.data?.data ?? null) as WorkBlockTaskTime | null;
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['work-block'] });
    },
  });
}

export function useRecordWorkBlockCompletion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { run_id: string; completed_task_id: string }) => {
      const res = await api.post(`/pm/work-blocks/runs/${vars.run_id}/completions`, {
        completed_task_id: vars.completed_task_id,
      });
      return res.data?.data as WorkBlockCompletion;
    },
    onSettled: () => {
      // Refetch the bundle for the work block — multiple may match across panels.
      qc.invalidateQueries({ queryKey: ['work-block'] });
    },
  });
}

export function useLinkTaskToWorkBlock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { work_block_task_id: string; linked_task_id: string }) => {
      const res = await api.post(`/pm/work-blocks/${vars.work_block_task_id}/links`, {
        linked_task_id: vars.linked_task_id,
      });
      return res.data?.data as WorkBlockLink;
    },
    onSettled: (_d, _e, vars) => {
      qc.invalidateQueries({ queryKey: ['work-block', vars.work_block_task_id] });
    },
  });
}

export function useUnlinkTaskFromWorkBlock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { work_block_task_id: string; linked_task_id: string }) => {
      await api.delete(`/pm/work-blocks/${vars.work_block_task_id}/links/${vars.linked_task_id}`);
    },
    onSettled: (_d, _e, vars) => {
      qc.invalidateQueries({ queryKey: ['work-block', vars.work_block_task_id] });
    },
  });
}

// ---------- side-effect hook: auto-record completions ----------

// Mount this anywhere the "task marked done" event needs to be observed and
// recorded against the caller's active work-block run. It listens to:
//   - usePMStore.timers  (the currently-running per-task timers)
//   - the active work-block run from the server
// When the consumer calls notifyCompletion(taskId), the hook decides whether
// to POST a completion: only if the timer is on a work-block task AND a run
// is active AND the completed task is not the work-block task itself.
export function useWorkBlockCompletionRecorder() {
  const activeQuery = useActiveWorkBlockRun();
  const record = useRecordWorkBlockCompletion();
  const timers = usePMStore((s) => s.timers);

  const notify = (completedTaskId: string) => {
    const active = activeQuery.data;
    if (!active) return;
    // The active server-side run gives us the source of truth; the local
    // timers are a fast-path predicate so we don't fire for users who simply
    // checked off a task without their work-block timer running.
    if (!timers.some((t) => t.taskId === active.task.id)) return;
    if (completedTaskId === active.task.id) return; // ignore self
    record.mutate({ run_id: active.run.id, completed_task_id: completedTaskId });
  };

  return { notify, activeRun: activeQuery.data || null };
}

// Lightweight global notifier — listens to a CustomEvent emitted by the task
// status handler so any "set status to done" call site can opt in without
// needing to thread the recorder through props.
export function useWorkBlockCompletionGlobal() {
  const { notify } = useWorkBlockCompletionRecorder();
  useEffect(() => {
    const onDone = (e: Event) => {
      const detail = (e as CustomEvent<{ task_id: string }>).detail;
      if (detail?.task_id) notify(detail.task_id);
    };
    window.addEventListener('squadhub:task-completed', onDone as EventListener);
    return () => window.removeEventListener('squadhub:task-completed', onDone as EventListener);
  }, [notify]);
}
