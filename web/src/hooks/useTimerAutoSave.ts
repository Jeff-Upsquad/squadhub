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

    return () => {
      window.clearInterval(interval);
      window.removeEventListener('online', onSyncTrigger);
      window.removeEventListener('focus', onSyncTrigger);
      document.removeEventListener('visibilitychange', onSyncTrigger);
    };
  }, [userId, qc]);
}

