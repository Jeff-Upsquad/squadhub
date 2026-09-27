import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { usePMStore } from '../stores/pmStore';
import { useAuthStore } from '../stores/authStore';
import { flushPendingTimeSync } from './useParallelTimers';

/**
 * Ensures timer data is never lost due to power cuts, internet dropouts, or closing tabs:
 * 1. Periodically checkpoints running timers every 2 minutes (auto-save).
 * 2. Persists unsaved shares into an offline queue and auto-flushes when back online.
 * 3. Catches window beforeunload to checkpoint any running timer so closing the tab or laptop doesn't lose seconds.
 */
export function useTimerAutoSave(userId?: string) {
  const qc = useQueryClient();

  useEffect(() => {
    if (!userId) return;

    // 1. Initial flush of any pending offline shares on startup
    void flushPendingTimeSync(qc);

    // 2. Periodic checkpointing and retry flush every 30 seconds
    const interval = window.setInterval(() => {
      // Checkpoint any running timers if at least 2 minutes (120s) elapsed in current segment
      const shares = usePMStore.getState().checkpointRunningTimers(120);
      if (shares.length > 0) {
        usePMStore.getState().enqueueTimeShares(shares);
      }
      // Flush queue if anything is pending
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

    // 4. Beforeunload listener: checkpoint active segment before tab closes
    const onBeforeUnload = () => {
      // Checkpoint any running timer with 1+ seconds
      const shares = usePMStore.getState().checkpointRunningTimers(1);
      if (shares.length > 0) {
        usePMStore.getState().enqueueTimeShares(shares);
      }

      // Best-effort keepalive fetch for pending items
      const token = useAuthStore.getState().accessToken;
      const pending = usePMStore.getState().pendingTimeSync || [];
      if (token && pending.length > 0) {
        for (const item of pending) {
          try {
            fetch(`/pm/tasks/${item.taskId}/time-entries`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({
                started_at: new Date(item.startedAt).toISOString(),
                duration_seconds: item.seconds,
              }),
              keepalive: true,
            }).catch(() => {});
          } catch {}
        }
      }
    };

    window.addEventListener('beforeunload', onBeforeUnload);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener('online', onSyncTrigger);
      window.removeEventListener('focus', onSyncTrigger);
      document.removeEventListener('visibilitychange', onSyncTrigger);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [userId, qc]);
}
