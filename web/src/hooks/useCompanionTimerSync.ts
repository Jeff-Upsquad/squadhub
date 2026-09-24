import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import api from '../services/api';
import { usePMStore, MAX_PARALLEL_TIMERS } from '../stores/pmStore';
import { flushTimerShares } from './useParallelTimers';

interface PendingCompanionTimer {
  id: string;
  title: string;
  list_id: string;
  time_tracked: number;
  started_at: string;
}

/** Pick up timers started while the web app was closed, preserving their start time. */
export function useCompanionTimerSync(userId: string | undefined) {
  const qc = useQueryClient();

  useEffect(() => {
    if (!userId) return;
    let active = true;
    let busy = false;

    const sync = async () => {
      if (!active || busy || document.visibilityState === 'hidden') return;
      busy = true;
      try {
        const { data: envelope } = await api.get<{ data: PendingCompanionTimer[] }>('/pm/companion-timers');
        for (const pending of envelope.data || []) {
          if (!active) return;
          const state = usePMStore.getState();
          if (state.timers.length >= MAX_PARALLEL_TIMERS) break;
          if (state.timers.some((t) => t.taskId === pending.id)) continue;
          try {
            const { data: claimed } = await api.post<{ data: PendingCompanionTimer }>(
              `/pm/tasks/${pending.id}/companion-timer/claim`,
            );
            const startedAt = Date.parse(claimed.data.started_at);
            if (!Number.isFinite(startedAt)) continue;
            const result = usePMStore.getState().adoptCompanionTimer(
              claimed.data.id,
              claimed.data.title,
              claimed.data.list_id,
              claimed.data.time_tracked,
              startedAt,
            );
            if (result) {
              await flushTimerShares(qc, result.shares);
              qc.invalidateQueries({ queryKey: ['my-tasks'] });
              qc.invalidateQueries({ queryKey: ['tasks'] });
              qc.invalidateQueries({ queryKey: ['new-tasks'] });
            }
          } catch (err) {
            // One inaccessible or already-claimed task must not hold up the rest.
            console.error('Could not pick up companion timer:', err);
          }
        }
      } catch (err) {
        // A later focus/interval retries the handoff if the network is down.
        console.error('Could not pick up companion timer:', err);
      } finally {
        busy = false;
      }
    };

    void sync();
    const onVisible = () => { if (document.visibilityState === 'visible') void sync(); };
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    const interval = window.setInterval(() => void sync(), 30_000);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [userId, qc]);
}
