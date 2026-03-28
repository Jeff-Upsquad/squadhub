import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';
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
  return useMutation({
    mutationFn: (timer_type: TimerType) =>
      api.post('/timer/start', { timer_type, workspace_id: workspaceId, context }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['timer-active', workspaceId, context] });
      qc.invalidateQueries({ queryKey: ['timer-stats', workspaceId, context] });
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
    },
  });
}
