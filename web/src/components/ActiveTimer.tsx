import { useState, useEffect } from 'react';
import { usePMStore } from '../stores/pmStore';
import { useParallelTimers } from '../hooks/useParallelTimers';
import { useActiveWorkBlockRun, useStopWorkBlockRun } from '../hooks/useWorkBlocks';
import { formatClock } from '../lib/formatDuration';

export default function ActiveTimer() {
  const setActiveTask = usePMStore((s) => s.setActiveTask);
  const { timers, stopTimer } = useParallelTimers();
  const { data: activeWB } = useActiveWorkBlockRun();
  const stopWorkBlockRun = useStopWorkBlockRun();

  // One ticking clock drives every pill — they share a wall-clock cadence even
  // though their start times differ. Recomputes elapsed against each start.
  const [now, setNow] = useState(() => Date.now());
  const hasAny = timers.length > 0 || (!!activeWB && !activeWB.run.ended_at);
  useEffect(() => {
    if (!hasAny) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [hasAny]);

  if (!hasAny) return null;

  const wbRun = activeWB && !activeWB.run.ended_at ? activeWB : null;
  const wbElapsed = wbRun ? Math.max(0, Math.floor((now - new Date(wbRun.run.started_at).getTime()) / 1000)) : 0;

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
      {timers.map((t, i) => (
        <div key={t.taskId} className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span
              className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75"
              style={{ background: i === 0 ? '#34d399' : '#fbbf24' }}
            />
            <span
              className="relative inline-flex h-2 w-2 rounded-full"
              style={{ background: i === 0 ? '#10b981' : '#f59e0b' }}
            />
          </span>
          <span className="text-xs font-medium" style={{ color: i === 0 ? '#047857' : '#b45309' }}>
            {timers.length > 1 ? (i === 0 ? 'Primary' : 'Secondary') : 'Tracking'}
          </span>
          <button
            onClick={() => setActiveTask(t.taskId)}
            className="max-w-[200px] truncate text-xs font-medium text-[#0F172B] hover:text-[#2962FF]"
          >
            {t.taskTitle}
          </button>
          <span
            className="rounded px-2 py-0.5 font-mono text-xs font-semibold tabular-nums"
            style={
              i === 0
                ? { background: '#d1fae5', color: '#065f46' }
                : { background: '#fef3c7', color: '#92400e' }
            }
          >
            {formatClock(Math.max(0, Math.floor((now - t.startedAt) / 1000)))}
          </span>
          <button
            onClick={() => stopTimer(t.taskId)}
            className="flex items-center gap-1 rounded bg-red-500 px-2 py-0.5 text-xs font-medium text-white transition hover:bg-red-600"
            title="Stop task timer"
          >
            <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="1" /></svg>
            Stop
          </button>
        </div>
      ))}

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
