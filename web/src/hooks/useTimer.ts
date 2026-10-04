import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';
import { useParallelTimers } from './useParallelTimers';
import { usePMStore } from '../stores/pmStore';
import { askTimerPrompt } from '../stores/timerPromptStore';
import type { TimerType } from '@squadhub/shared';

interface TimerScope {
  workspaceId: string | undefined;
  context: string;
}

export function useActiveTimer({ workspaceId, context }: TimerScope) {
  return useQuery({
    queryKey: ['timer-active', workspaceId, context],
    queryFn: () => api.get('/timer/active', { params: { workspace_id: workspaceId, context } }).then((r) => r.data),
    refetchInterval: 30000,
    enabled: !!workspaceId,
  });
}

export function useTimeStats({ workspaceId, context }: TimerScope) {
  return useQuery({
    queryKey: ['timer-stats', workspaceId, context],
    queryFn: () => api.get('/timer/stats', { params: { workspace_id: workspaceId, context } }).then((r) => r.data),
    refetchInterval: 60000,
    enabled: !!workspaceId,
  });
}

export function useStartTimer({ workspaceId, context }: TimerScope) {
  const qc = useQueryClient();
  const { stopTimer } = useParallelTimers();
  return useMutation({
    mutationFn: async (timer_type: TimerType) => {
      if (timer_type !== 'work' && usePMStore.getState().timers.length > 0) {
        const accepted = await askTimerPrompt({
          title: 'Stop running task timers?',
          message: `Task timers are running. Stop them and save their tracked time before starting ${timer_type === 'break' ? 'a break' : 'no work'}?`,
          confirmLabel: 'Stop tasks and switch',
          cancelLabel: 'Keep task timers',
        });
        if (!accepted) return null;
        // Stop sequentially so split-time shares and daily totals stay correct.
        for (const timer of [...usePMStore.getState().timers]) {
          await stopTimer(timer.taskId);
        }
      }
      return api.post('/timer/start', { timer_type, workspace_id: workspaceId, context }).then((r) => r.data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['timer-active', workspaceId, context] });
      qc.invalidateQueries({ queryKey: ['timer-stats', workspaceId, context] });
      qc.invalidateQueries({ queryKey: ['timer-sessions', workspaceId, context] });
    },
  });
}

export function useStopTimer({ workspaceId, context }: TimerScope) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (session_id?: string) =>
      api.post('/timer/stop', { session_id, workspace_id: workspaceId, context }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['timer-active', workspaceId, context] });
      qc.invalidateQueries({ queryKey: ['timer-stats', workspaceId, context] });
      qc.invalidateQueries({ queryKey: ['timer-sessions', workspaceId, context] });
    },
  });
}

interface UpdateTimerSessionArgs {
  session_id: string;
  start_time?: string;
  end_time?: string;
  timer_type?: TimerType;
}

export function useUpdateTimerSession({ workspaceId, context }: TimerScope) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ session_id, ...body }: UpdateTimerSessionArgs) =>
      api.patch(`/timer/sessions/${session_id}`, body).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['timer-active', workspaceId, context] });
      qc.invalidateQueries({ queryKey: ['timer-stats', workspaceId, context] });
      qc.invalidateQueries({ queryKey: ['timer-sessions', workspaceId, context] });
    },
  });
}

export function useDeleteTimerSession({ workspaceId, context }: TimerScope) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (session_id: string) =>
      api.delete(`/timer/sessions/${session_id}`).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['timer-active', workspaceId, context] });
      qc.invalidateQueries({ queryKey: ['timer-stats', workspaceId, context] });
      qc.invalidateQueries({ queryKey: ['timer-sessions', workspaceId, context] });
    },
  });
}
