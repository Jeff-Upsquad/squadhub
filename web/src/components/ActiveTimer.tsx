import { useState, useEffect } from 'react';
import { usePMStore } from '../stores/pmStore';
import { useCreateTaskTimeEntry } from '../hooks/useTaskTimeEntries';
import { formatClock } from '../lib/formatDuration';

export default function ActiveTimer() {
  const timer = usePMStore((s) => s.timer);
  const stopTimer = usePMStore((s) => s.stopTimer);
  const setActiveTask = usePMStore((s) => s.setActiveTask);
  const createEntry = useCreateTaskTimeEntry();
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!timer) { setElapsed(0); return; }
    const tick = () => setElapsed(Math.floor((Date.now() - timer.startedAt) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [timer]);

  if (!timer) return null;

  const handleStop = async () => {
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

  return (
    <div className="flex items-center gap-2 border-b border-[#E2E8F0] bg-[#F0FDF4] px-4 py-1.5">
      {/* Pulsing dot */}
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
      </span>

      {/* Timer info */}
      <span className="text-xs font-medium text-emerald-700">Tracking</span>
      <button
        onClick={() => setActiveTask(timer.taskId)}
        className="max-w-[200px] truncate text-xs font-medium text-[#0F172B] hover:text-[#2962FF]"
      >
        {timer.taskTitle}
      </button>

      {/* Elapsed time */}
      <span className="rounded bg-emerald-100 px-2 py-0.5 font-mono text-xs font-semibold text-emerald-800 tabular-nums">
        {formatClock(elapsed)}
      </span>

      {/* Stop button */}
      <button
        onClick={handleStop}
        className="flex items-center gap-1 rounded bg-red-500 px-2 py-0.5 text-xs font-medium text-white transition hover:bg-red-600"
      >
        <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 24 24">
          <rect x="6" y="6" width="12" height="12" rx="1" />
        </svg>
        Stop
      </button>
    </div>
  );
}
