import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { usePMStore } from '../stores/pmStore';
import { useParallelTimers } from '../hooks/useParallelTimers';
import { useActiveWorkBlockRun, useStopWorkBlockRun } from '../hooks/useWorkBlocks';
import { formatClock } from '../lib/formatDuration';

type Tile = {
  key: string;
  label: string;
  tone: 'tracking' | 'secondary' | 'block' | 'parallel-1' | 'parallel-2' | 'parallel-3';
  taskId: string;
  title: string;
  startedAt: number;
  stopTitle: string;
  onStop: () => void;
};

/**
 * Every running timer as an equal-width tile in one dock. `floating` pins it to
 * the bottom of the content area (desktop) and reserves room under the panes via
 * `--timer-dock-space` on the parent so nothing scrolls out of reach beneath it;
 * without it the dock renders in-flow (mobile shell banner slot).
 */
export default function ActiveTimer({ floating = false }: { floating?: boolean }) {
  const setActiveTask = usePMStore((s) => s.setActiveTask);
  const { timers, stopTimer } = useParallelTimers();
  const { data: activeWB } = useActiveWorkBlockRun();
  const stopWorkBlockRun = useStopWorkBlockRun();
  const dockRef = useRef<HTMLDivElement>(null);

  // One ticking clock drives every tile — they share a wall-clock cadence even
  // though their start times differ. Recomputes elapsed against each start.
  const [now, setNow] = useState(() => Date.now());
  const wbRun = activeWB && !activeWB.run.ended_at ? activeWB : null;
  const hasAny = timers.length > 0 || !!wbRun;
  useEffect(() => {
    if (!hasAny) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [hasAny]);

  useLayoutEffect(() => {
    if (!floating) return;
    const dock = dockRef.current;
    const host = dock?.parentElement;
    if (!dock || !host) return;
    const sync = () => host.style.setProperty('--timer-dock-space', `${dock.offsetHeight + 20}px`);
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(dock);
    return () => {
      ro.disconnect();
      host.style.removeProperty('--timer-dock-space');
    };
  }, [floating, hasAny]);

  if (!hasAny) return null;

  const handleStopWorkBlock = async () => {
    if (!wbRun) return;
    try {
      await stopWorkBlockRun.mutateAsync({ run_id: wbRun.run.id, task_id: wbRun.task.id });
    } catch (err) {
      console.error('Failed to stop work-block run:', err);
    }
  };

  const timerTile = (t: (typeof timers)[number], i: number): Tile => {
    const parallelTones = ['parallel-1', 'parallel-2', 'parallel-3'] as const;
    return {
      key: t.taskId,
      label: i === 0 ? 'Tracking' : i === 1 ? 'Secondary' : 'Parallel',
      tone: i === 0 ? 'tracking' : i === 1 ? 'secondary' : parallelTones[(i - 2) % parallelTones.length],
      taskId: t.taskId,
      title: t.taskTitle,
      startedAt: t.startedAt,
      stopTitle: 'Stop task timer',
      onStop: () => stopTimer(t.taskId),
    };
  };

  // Order matches the design: tracking, secondary, time block, then parallels.
  const tiles: Tile[] = timers.slice(0, 2).map(timerTile);
  if (wbRun) {
    tiles.push({
      key: `wb-${wbRun.run.id}`,
      label: 'Time block',
      tone: 'block',
      taskId: wbRun.task.id,
      title: wbRun.task.title,
      startedAt: new Date(wbRun.run.started_at).getTime(),
      stopTitle: 'Stop time-block run',
      onStop: handleStopWorkBlock,
    });
  }
  timers.slice(2).forEach((t, j) => tiles.push(timerTile(t, j + 2)));

  return (
    <div ref={dockRef} className="tdock" data-floating={floating || undefined} role="region" aria-label="Running timers">
      {tiles.map((t) => (
        <div key={t.key} className="tdock-tile" data-tone={t.tone}>
          <span className="tdock-dot" aria-hidden />
          <div className="tdock-text">
            <span className="tdock-label">{t.label}</span>
            <button type="button" className="tdock-title" onClick={() => setActiveTask(t.taskId)} title={t.title}>
              {t.title}
            </button>
          </div>
          <span className="tdock-clock">{formatClock(Math.max(0, Math.floor((now - t.startedAt) / 1000)))}</span>
          <button type="button" className="tdock-stop" onClick={t.onStop} title={t.stopTitle} aria-label={t.stopTitle}>
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
          </button>
        </div>
      ))}
    </div>
  );
}
