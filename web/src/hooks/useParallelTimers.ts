import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import api from '../services/api';
import { usePMStore, MAX_PARALLEL_TIMERS } from '../stores/pmStore';
import type { PendingTimerStart, TimerShare } from '../stores/pmStore';
import {
  useActiveWorkBlockRun,
  useOpenWorkBlockTaskTime,
  useCloseWorkBlockTaskTime,
} from './useWorkBlocks';
import {
  useActiveGroupRun,
  useOpenGroupRunTaskTime,
  useCloseGroupRunTaskTime,
} from './useGroupRuns';

// Persist the shares of a closed timer segment as task time entries (one POST
// per task; the server bumps tasks.time_tracked and the daily summary). Shares
// under a second are dropped, mirroring the old single-timer save guard.
// Sequential on purpose: the server's daily_time_summaries bump is a
// read-then-write on one row per user per day, so concurrent share POSTs lose
// increments to each other.
export async function flushTimerShares(qc: QueryClient, shares: TimerShare[]): Promise<void> {
  const real = shares.filter((s) => s.seconds >= 1);
  if (!real.length) return;
  for (const s of real) {
    try {
      await api.post(`/pm/tasks/${s.taskId}/time-entries`, {
        started_at: new Date(s.startedAt).toISOString(),
        duration_seconds: s.seconds,
      });
    } catch (err) {
      console.error('Failed to save tracked time share:', err);
    }
  }
  qc.invalidateQueries({ queryKey: ['task-time-entries'] });
  qc.invalidateQueries({ queryKey: ['tasks'] });
  qc.invalidateQueries({ queryKey: ['folder-tasks'] });
  qc.invalidateQueries({ queryKey: ['space-tasks'] });
  qc.invalidateQueries({ queryKey: ['my-tasks'] });
  qc.invalidateQueries({ queryKey: ['folder-time-summary'] });
  for (const s of real) qc.invalidateQueries({ queryKey: ['task', s.taskId] });
}

export type StartTimerResult = 'started' | 'conflict' | 'noop';

// The one place per-task timers start and stop. Every surface (Home rows, task
// detail panel, time sheet, top bar, conflict dialog) goes through here so the
// segment-split accounting and the work-block/group-run overlap bracketing stay
// identical no matter where the click happened.
export function useParallelTimers() {
  const qc = useQueryClient();
  const timers = usePMStore((s) => s.timers);
  const activeWorkBlock = useActiveWorkBlockRun();
  const activeGroupRun = useActiveGroupRun();
  const openTaskTime = useOpenWorkBlockTaskTime();
  const closeTaskTime = useCloseWorkBlockTaskTime();
  const openGroupTaskTime = useOpenGroupRunTaskTime();
  const closeGroupTaskTime = useCloseGroupRunTaskTime();

  const wbRun = activeWorkBlock.data && !activeWorkBlock.data.run.ended_at ? activeWorkBlock.data : null;
  const gRun = activeGroupRun.data?.run && !activeGroupRun.data.run.ended_at ? activeGroupRun.data.run : null;

  // Start without the conflict gate — the fast path when nothing is running,
  // and the dialog's "add as secondary" confirm.
  const startTimer = async (target: PendingTimerStart): Promise<boolean> => {
    const res = usePMStore
      .getState()
      .startParallelTimer(target.taskId, target.taskTitle, target.listId, target.baseTracked);
    if (!res) return false;
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
  const requestStartTimer = async (target: PendingTimerStart): Promise<StartTimerResult> => {
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
