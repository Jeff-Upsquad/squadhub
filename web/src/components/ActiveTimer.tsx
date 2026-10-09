import { useState, useEffect, useRef } from 'react';
import { usePMStore } from '../stores/pmStore';
import { useParallelTimers } from '../hooks/useParallelTimers';
import { useActiveWorkBlockRun, useStopWorkBlockRun } from '../hooks/useWorkBlocks';
import { formatClock } from '../lib/formatDuration';

export type TimerTone = 'tracking' | 'secondary' | 'block' | 'parallel-1' | 'parallel-2' | 'parallel-3';

type Tile = {
  key: string;
  label: string;
  tone: TimerTone;
  taskId: string;
  title: string;
  clock: string;
  stopTitle: string;
  onStop: () => void;
};

/**
 * Every running timer (task timers + an active time-block run) as display
 * tiles, ordered primary, secondary, time block, then parallels. One ticking
 * clock drives them all so they share a wall-clock cadence.
 */
function useTimerTiles(): Tile[] {
  const { timers, stopTimer } = useParallelTimers();
  const { data: activeWB } = useActiveWorkBlockRun();
  const stopWorkBlockRun = useStopWorkBlockRun();

  const [now, setNow] = useState(() => Date.now());
  const wbRun = activeWB && !activeWB.run.ended_at ? activeWB : null;
  const hasAny = timers.length > 0 || !!wbRun;
  useEffect(() => {
    if (!hasAny) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [hasAny]);

  if (!hasAny) return [];

  const clockFrom = (startedAt: number) => formatClock(Math.max(0, Math.floor((now - startedAt) / 1000)));
  const parallelTones = ['parallel-1', 'parallel-2', 'parallel-3'] as const;
  const timerTile = (t: (typeof timers)[number], i: number): Tile => ({
    key: t.taskId,
    label: i === 0 ? 'Primary' : i === 1 ? 'Secondary' : 'Parallel',
    tone: i === 0 ? 'tracking' : i === 1 ? 'secondary' : parallelTones[(i - 2) % parallelTones.length],
    taskId: t.taskId,
    title: t.taskTitle,
    clock: clockFrom(t.startedAt),
    stopTitle: 'Stop task timer',
    onStop: () => stopTimer(t.taskId),
  });

  const tiles: Tile[] = timers.slice(0, 2).map(timerTile);
  if (wbRun) {
    tiles.push({
      key: `wb-${wbRun.run.id}`,
      label: 'Time block',
      tone: 'block',
      taskId: wbRun.task.id,
      title: wbRun.task.title,
      clock: clockFrom(new Date(wbRun.run.started_at).getTime()),
      stopTitle: 'Stop time-block run',
      onStop: () => {
        stopWorkBlockRun
          .mutateAsync({ run_id: wbRun.run.id, task_id: wbRun.task.id })
          .catch((err) => console.error('Failed to stop work-block run:', err));
      },
    });
  }
  timers.slice(2).forEach((t, j) => tiles.push(timerTile(t, j + 2)));
  // A lone timer isn't "primary" of anything.
  if (tiles.length === 1) tiles[0].label = 'Tracking';
  return tiles;
}

export function LiveDot({ tone }: { tone: TimerTone | 'emergency' }) {
  return <span className="tbn-dot" data-tone={tone} aria-hidden />;
}

function StopButton({ tile }: { tile: Tile }) {
  return (
    <button type="button" className="tbn-stop" onClick={tile.onStop} title={tile.stopTitle} aria-label={tile.stopTitle}>
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden><rect x="5" y="5" width="14" height="14" rx="2" /></svg>
    </button>
  );
}

/** Home view: one tile per running timer, rendered inside the top-banner strip. */
export default function ActiveTimerTiles() {
  const setActiveTask = usePMStore((s) => s.setActiveTask);
  const tiles = useTimerTiles();
  return (
    <>
      {tiles.map((t) => (
        <div key={t.key} className="tbn-tile" data-kind="timer">
          <LiveDot tone={t.tone} />
          <div className="tbn-text">
            <span className="tbn-label">{t.label}</span>
            <button type="button" className="tbn-title" onClick={() => setActiveTask(t.taskId)} title={t.title}>
              {t.title}
            </button>
          </div>
          <span className="tbn-clock">{t.clock}</span>
          <StopButton tile={t} />
        </div>
      ))}
    </>
  );
}

/**
 * Outside Home: the primary timer sits at the right end of the tab bar; the
 * rest of the running timers live behind a "+N" dropdown.
 */
export function TabBarTimer() {
  const setActiveTask = usePMStore((s) => s.setActiveTask);
  const tiles = useTimerTiles();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const rest = tiles.slice(1);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (tiles.length === 0) return null;
  const [primary] = tiles;

  return (
    <div ref={ref} className="tbt" role="region" aria-label="Running timers">
      <div className="tbt-primary">
        <LiveDot tone={primary.tone} />
        <button type="button" className="tbn-title" onClick={() => setActiveTask(primary.taskId)} title={primary.title}>
          {primary.title}
        </button>
        <span className="tbn-clock">{primary.clock}</span>
        <StopButton tile={primary} />
      </div>
      {rest.length > 0 && (
        <button
          type="button"
          className="tbt-more"
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={open}
          title={`${rest.length} more running`}
        >
          +{rest.length}
          <svg fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden>
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
      )}
      {open && rest.length > 0 && (
        <div className="tbt-menu" role="menu">
          <span className="tbt-menu-head">Also running · {rest.length}</span>
          {rest.map((t) => (
            <div key={t.key} className="tbt-row" role="menuitem">
              <LiveDot tone={t.tone} />
              <div className="tbt-row-text">
                <span className="tbn-label">{t.label}</span>
                <button type="button" className="tbn-title" onClick={() => { setActiveTask(t.taskId); setOpen(false); }} title={t.title}>
                  {t.title}
                </button>
              </div>
              <span className="tbn-clock">{t.clock}</span>
              <StopButton tile={t} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
