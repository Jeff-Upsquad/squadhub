import { useState, useEffect } from 'react';
import { usePMStore } from '../stores/pmStore';
import { useCreateTaskTimeEntry } from '../hooks/useTaskTimeEntries';
import { useActiveWorkBlockRun, useStopWorkBlockRun } from '../hooks/useWorkBlocks';
import { formatClock } from '../lib/formatDuration';

export default function ActiveTimer() {
  const timer = usePMStore((s) => s.timer);
  const stopTimer = usePMStore((s) => s.stopTimer);
  const setActiveTask = usePMStore((s) => s.setActiveTask);
  const createEntry = useCreateTaskTimeEntry();
  const { data: activeWB } = useActiveWorkBlockRun();
  const stopWorkBlockRun = useStopWorkBlockRun();

  // One ticking clock drives both pills — they share a wall-clock cadence even
  // though their start times differ. Recomputes elapsed against each start.
  const [now, setNow] = useState(() => Date.now());
  const hasAny = !!timer || (!!activeWB && !activeWB.run.ended_at);
  useEffect(() => {
    if (!hasAny) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [hasAny]);

  if (!hasAny) return null;

  const perTaskElapsed = timer ? Math.max(0, Math.floor((now - timer.startedAt) / 1000)) : 0;
  const wbRun = activeWB && !activeWB.run.ended_at ? activeWB : null;
  const wbElapsed = wbRun ? Math.max(0, Math.floor((now - new Date(wbRun.run.started_at).getTime()) / 1000)) : 0;

  const handleStopPerTask = async () => {
    const stopped = stopTimer();
    if (!stopped) return;
    const elapsedSecs = Math.floor((Date.now() - stopped.startedAt) / 1000);
    if (elapsedSecs < 1) return;
    try {
      await createEntry.mutateAsync({
        taskId: stopped.taskId,
        startedAt: new Date(stopped.startedAt).toISOString(),
        durationSeconds: elapsedSecs,
      });
    } catch (err) {
      console.error('Failed to save tracked time:', err);
    }
  };

  const handleStopWorkBlock = async () => {
    if (!wbRun) return;
    try {
      await stopWorkBlockRun.mutateAsync({ run_id: wbRun.run.id, task_id: wbRun.task.id });
    } catch (err) {
      console.error('Failed to stop work-block run:', err);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[#E2E8F0] bg-[#F0FDF4] px-4 py-1.5">
      {timer && (
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          <span className="text-xs font-medium text-emerald-700">Tracking</span>
          <button
            onClick={() => setActiveTask(timer.taskId)}
            className="max-w-[200px] truncate text-xs font-medium text-[#0F172B] hover:text-[#2962FF]"
          >
            {timer.taskTitle}
          </button>
          <span className="rounded bg-emerald-100 px-2 py-0.5 font-mono text-xs font-semibold text-emerald-800 tabular-nums">
            {formatClock(perTaskElapsed)}
          </span>
          <button
            onClick={handleStopPerTask}
            className="flex items-center gap-1 rounded bg-red-500 px-2 py-0.5 text-xs font-medium text-white transition hover:bg-red-600"
            title="Stop task timer"
          >
            <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="1" /></svg>
            Stop
          </button>
        </div>
      )}

      {wbRun && (
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" style={{ background: '#a78bfa' }} />
            <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: '#8b5cf6' }} />
          </span>
          <span className="text-xs font-medium" style={{ color: '#6d28d9' }}>Work block</span>
          <button
            onClick={() => setActiveTask(wbRun.task.id)}
            className="max-w-[200px] truncate text-xs font-medium text-[#0F172B] hover:text-[#2962FF]"
          >
            {wbRun.task.title}
          </button>
          <span
            className="rounded px-2 py-0.5 font-mono text-xs font-semibold tabular-nums"
            style={{ background: 'color-mix(in oklch, #8b5cf6 18%, transparent)', color: '#5b21b6' }}
          >
            {formatClock(wbElapsed)}
          </span>
          <button
            onClick={handleStopWorkBlock}
            className="flex items-center gap-1 rounded bg-red-500 px-2 py-0.5 text-xs font-medium text-white transition hover:bg-red-600"
            title="Stop work-block run"
          >
            <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="1" /></svg>
            Stop
          </button>
        </div>
      )}
    </div>
  );
}
