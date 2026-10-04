import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import api from '../services/api';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { useIsPartner } from './useUserType';
import { useTimerPromptStore } from '../stores/timerPromptStore';
import { offerWorkTimer } from '../services/timerMode';
import { usePMStore, MAX_PARALLEL_TIMERS } from '../stores/pmStore';
import type { PendingTimerStart, TimerShare } from '../stores/pmStore';
import {
  useActiveWorkBlockRun,
  useStartWorkBlockRun,
  useOpenWorkBlockTaskTime,
  useCloseWorkBlockTaskTime,
} from './useWorkBlocks';
import {
  useActiveGroupRun,
  useOpenGroupRunTaskTime,
  useCloseGroupRunTaskTime,
} from './useGroupRuns';

let _isSyncing = false;

/**
 * Flush all offline/pending timer shares to the server sequentially.
 * If offline or a network error occurs, items remain in the queue until the next
 * reconnect or retry tick. If an item permanently errors (404/403/400), it is discarded
 * to prevent deadlocking the queue.
 */
export async function flushPendingTimeSync(qc?: QueryClient): Promise<void> {
  if (_isSyncing) return;
  const store = usePMStore.getState();
  const items = store.pendingTimeSync || [];
  if (!items.length) return;

  _isSyncing = true;
  const successfulTaskIds = new Set<string>();

  try {
    for (const item of [...items]) {
      try {
        await api.post(`/pm/tasks/${item.taskId}/time-entries`, {
          started_at: new Date(item.startedAt).toISOString(),
          duration_seconds: item.seconds,
        });
        usePMStore.getState().removePendingTimeSyncItem(item.id);
        successfulTaskIds.add(item.taskId);
      } catch (err: any) {
        const status = err?.response?.status;
        if (status === 404 || status === 403 || status === 400) {
          console.warn(`[Timer Sync] Dropping unexecutable pending time entry for task ${item.taskId} (status ${status})`);
          usePMStore.getState().removePendingTimeSyncItem(item.id);
        } else {
          // Network offline, 5xx, or request aborted — keep in queue and stop this sync cycle
          console.warn('[Timer Sync] Network or server error; pending time entry will retry when online:', err?.message || err);
          break;
        }
      }
    }
  } finally {
    _isSyncing = false;
  }

  if (successfulTaskIds.size > 0 && qc) {
    qc.invalidateQueries({ queryKey: ['task-time-entries'] });
    qc.invalidateQueries({ queryKey: ['tasks'] });
    qc.invalidateQueries({ queryKey: ['folder-tasks'] });
    qc.invalidateQueries({ queryKey: ['space-tasks'] });
    qc.invalidateQueries({ queryKey: ['my-tasks'] });
    qc.invalidateQueries({ queryKey: ['folder-time-summary'] });
    for (const taskId of successfulTaskIds) {
      qc.invalidateQueries({ queryKey: ['task', taskId] });
      qc.invalidateQueries({ queryKey: ['task-activity', taskId] });
    }
  }
}

// Persist the shares of a closed timer segment as task time entries (one POST
// per task; the server bumps tasks.time_tracked and the daily summary). Shares
// under a second are dropped, mirroring the old single-timer save guard.
// Sequential on purpose: the server's daily_time_summaries bump is a
// read-then-write on one row per user per day, so concurrent share POSTs lose
// increments to each other.
// Always enqueues into persistent storage first so no time is lost if power/network fails.
export async function flushTimerShares(qc: QueryClient, shares: TimerShare[]): Promise<void> {
  const real = shares.filter((s) => s.seconds >= 1);
  if (!real.length) return;
  for (const s of real) {
    usePMStore.getState().setFocusBucket(s.taskId, null);
  }
  usePMStore.getState().enqueueTimeShares(real);
  await flushPendingTimeSync(qc);
}

export type StartTimerResult = 'started' | 'conflict' | 'noop';

// The one place per-task timers start and stop. Every surface (Home rows, task
// detail panel, time sheet, top bar, conflict dialog) goes through here so the
// segment-split accounting and the work-block/group-run overlap bracketing stay
// identical no matter where the click happened.
export function useParallelTimers() {
  const qc = useQueryClient();
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspace?.id);
  const isPartner = useIsPartner();
  const context = isPartner ? 'partners' : 'teammates';
  const timers = usePMStore((s) => s.timers);
  const activeWorkBlock = useActiveWorkBlockRun();
  const startWorkBlockRun = useStartWorkBlockRun();
  const activeGroupRun = useActiveGroupRun();
  const openTaskTime = useOpenWorkBlockTaskTime();
  const closeTaskTime = useCloseWorkBlockTaskTime();
  const openGroupTaskTime = useOpenGroupRunTaskTime();
  const closeGroupTaskTime = useCloseGroupRunTaskTime();

  const wbRun = activeWorkBlock.data && !activeWorkBlock.data.run.ended_at ? activeWorkBlock.data : null;
  const gRun = activeGroupRun.data?.run && !activeGroupRun.data.run.ended_at ? activeGroupRun.data.run : null;

  // Work-block tasks never run per-task timers. Starting "a timer" on one
  // starts a work-block run instead (mirroring the task detail panel), so a
  // run is always active while the block is being timed — which is what the
  // server's completion auto-record (PUT/POST-done) keys off. Without this,
  // a timer-only work block leaves no run behind, and tasks completed inside
  // it (e.g. via the companion app's complete-on-add) are never logged
  // against the block.
  const startWorkBlockTarget = async (target: PendingTimerStart): Promise<boolean> => {
    if (useTimerPromptStore.getState().prompt) return false;
    if (wbRun && wbRun.task.id === target.taskId) return false;
    try {
      await offerWorkTimer(qc, { workspaceId, context });
      const run = await startWorkBlockRun.mutateAsync({ task_id: target.taskId });
      usePMStore.getState().setFocusBucket(target.taskId, null);
      for (const t of timers) {
        if (t.taskId !== target.taskId) openTaskTime.mutate({ run_id: run.id, task_id: t.taskId });
      }
      return true;
    } catch (err) {
      console.error('Failed to start work-block run:', err);
      return false;
    }
  };

  // Start without the conflict gate — the fast path when nothing is running,
  // and the dialog's "add as secondary" confirm.
  const startTimer = async (target: PendingTimerStart): Promise<boolean> => {
    if (useTimerPromptStore.getState().prompt) return false;
    if (target.isWorkBlock) return startWorkBlockTarget(target);
    if (usePMStore.getState().timers.some((t) => t.taskId === target.taskId)) return false;
    await offerWorkTimer(qc, { workspaceId, context });
    const res = usePMStore
      .getState()
      .startParallelTimer(target.taskId, target.taskTitle, target.listId, target.baseTracked);
    if (!res) return false;
    usePMStore.getState().setFocusBucket(target.taskId, null);
    if (wbRun && wbRun.task.id !== target.taskId) {
      openTaskTime.mutate({ run_id: wbRun.run.id, task_id: target.taskId });
    }
    if (gRun) {
      openGroupTaskTime.mutate({ run_id: gRun.id, task_id: target.taskId });
    }
    await flushTimerShares(qc, res.shares);
    return true;
  };

  // The user-facing gate: nothing running → start as primary; otherwise park
  // the request so the global TimerConflictDialog can ask about a secondary.
  // Work-block targets bypass the gate: runs are independent of per-task
  // timers by design (a regular task's timer can run alongside a run).
  const requestStartTimer = async (target: PendingTimerStart): Promise<StartTimerResult> => {
    if (target.isWorkBlock) {
      return (await startWorkBlockTarget(target)) ? 'started' : 'noop';
    }
    const s = usePMStore.getState();
    if (s.timers.some((t) => t.taskId === target.taskId)) return 'noop';
    if (s.timers.length === 0) {
      return (await startTimer(target)) ? 'started' : 'noop';
    }
    s.setPendingTimerStart(target);
    return 'conflict';
  };

  const stopTimer = async (taskId: string): Promise<void> => {
    const res = usePMStore.getState().stopParallelTimer(taskId);
    if (!res) return;
    if (wbRun) closeTaskTime.mutate({ run_id: wbRun.run.id, task_id: taskId });
    if (gRun) closeGroupTaskTime.mutate({ run_id: gRun.id, task_id: taskId });
    await flushTimerShares(qc, res.shares);
  };

  return {
    timers,
    startTimer,
    requestStartTimer,
    stopTimer,
    atMax: timers.length >= MAX_PARALLEL_TIMERS,
  };
}
