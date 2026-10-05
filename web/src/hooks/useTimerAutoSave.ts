import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { usePMStore } from '../stores/pmStore';
import { flushPendingTimeSync } from './useParallelTimers';

/**
 * Ensures offline-stopped timer shares are safely flushed to the server:
 * 1. Initial flush of any pending offline shares on startup.
 * 2. Periodic retry flush every 30 seconds when pending items exist in the queue.
 * 3. Network & visibility listeners: flush immediately when internet reconnects or tab is focused.
 *
 * Running timers are kept in persisted client state (localStorage) with their original
 * started_at, and are only logged to task_time_entries as a single entry when explicitly stopped.
 * They are NOT checkpoint-sliced into 2-minute fragments while actively running.
 */
export function useTimerAutoSave(userId?: string) {
  const qc = useQueryClient();

  useEffect(() => {
    if (!userId) return;

    // 1. Initial flush of any pending offline shares on startup
    void flushPendingTimeSync(qc);

    // 2. Periodic retry flush every 30 seconds if anything is pending
    const interval = window.setInterval(() => {
      if ((usePMStore.getState().pendingTimeSync || []).length > 0) {
        void flushPendingTimeSync(qc);
      }
    }, 30_000);

    // 3. Network & visibility listeners: flush immediately when internet reconnects or tab is focused
    const onSyncTrigger = () => {
      if (navigator.onLine && (usePMStore.getState().pendingTimeSync || []).length > 0) {
        void flushPendingTimeSync(qc);
      }
    };

    window.addEventListener('online', onSyncTrigger);
    window.addEventListener('focus', onSyncTrigger);
    document.addEventListener('visibilitychange', onSyncTrigger);

    // 4. Cross-tab timer state synchronization (BroadcastChannel + localStorage storage event)
    const applyRemoteTimers = (remoteTimers: any[], remoteSegmentStart: number | null) => {
      if (!Array.isArray(remoteTimers)) return;
      const currentTimers = usePMStore.getState().timers;
      const currentSegment = usePMStore.getState().timerSegmentStart;
      const changed =
        currentTimers.length !== remoteTimers.length ||
        currentSegment !== remoteSegmentStart ||
        currentTimers.some(
          (t, i) => t.taskId !== remoteTimers[i]?.taskId || t.startedAt !== remoteTimers[i]?.startedAt,
        );

      if (changed) {
        usePMStore.setState({
          timers: remoteTimers,
          timerSegmentStart: remoteSegmentStart,
        });
        qc.invalidateQueries({ queryKey: ['task-time-entries'] });
        qc.invalidateQueries({ queryKey: ['tasks'] });
        qc.invalidateQueries({ queryKey: ['my-tasks'] });
      }
    };

    let channel: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        channel = new BroadcastChannel('squadhub_timer_sync');
        channel.onmessage = (event) => {
          if (event.data?.type === 'SYNC_TIMERS') {
            applyRemoteTimers(event.data.timers, event.data.timerSegmentStart ?? null);
          }
        };
      } catch {}
    }

    const onStorage = (event: StorageEvent) => {
      if (event.key !== 'squadhub-pm' || !event.newValue) return;
      try {
        const parsed = JSON.parse(event.newValue);
        if (parsed?.state && Array.isArray(parsed.state.timers)) {
          applyRemoteTimers(parsed.state.timers, parsed.state.timerSegmentStart ?? null);
        }
      } catch {}
    };
    window.addEventListener('storage', onStorage);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener('online', onSyncTrigger);
      window.removeEventListener('focus', onSyncTrigger);
      document.removeEventListener('visibilitychange', onSyncTrigger);
      window.removeEventListener('storage', onStorage);
      if (channel) {
        channel.close();
      }
    };
  }, [userId, qc]);
}

