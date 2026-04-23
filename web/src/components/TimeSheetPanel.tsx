import { useEffect, useMemo, useRef, useState } from 'react';
import type { TaskTimeEntry } from '@squadhub/shared';
import { usePMStore } from '../stores/pmStore';
import { useMyTimeEntries, useCreateTaskTimeEntry } from '../hooks/useTaskTimeEntries';
import {
  formatTracked,
  formatClock,
  formatTimeRange,
  formatDateHeader,
  toLocalDateKey,
} from '../lib/formatDuration';

type Props = {
  anchorRect: DOMRect | null;
  onClose: () => void;
};

export default function TimeSheetPanel({ anchorRect, onClose }: Props) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const { data: entries, isLoading } = useMyTimeEntries(true);
  const timer = usePMStore((s) => s.timer);
  const setActiveTask = usePMStore((s) => s.setActiveTask);
  const startTimer = usePMStore((s) => s.startTimer);
  const stopTimer = usePMStore((s) => s.stopTimer);
  const createEntry = useCreateTaskTimeEntry();
  const [elapsed, setElapsed] = useState(0);

  // Tick the running timer's live elapsed seconds
  useEffect(() => {
    if (!timer) { setElapsed(0); return; }
    const tick = () => setElapsed(Math.floor((Date.now() - timer.startedAt) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [timer]);

  // Close on Escape or outside click
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onDown = (e: MouseEvent) => {
      if (!panelRef.current) return;
      if (!panelRef.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener('keydown', onKey);
    // Delay so the click that opened the panel doesn't immediately close it
    const id = setTimeout(() => window.addEventListener('mousedown', onDown), 0);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
      clearTimeout(id);
    };
  }, [onClose]);

  const groups = useMemo(() => {
    if (!entries) return [];
    const byDate = new Map<string, TaskTimeEntry[]>();
    for (const e of entries) {
      const key = toLocalDateKey(e.started_at);
      const arr = byDate.get(key) || [];
      arr.push(e);
      byDate.set(key, arr);
    }
    return Array.from(byDate.entries()).map(([dateKey, items]) => ({ dateKey, items }));
  }, [entries]);

  // Position panel next to the rail button, constrained to viewport
  const { top, left } = useMemo(() => {
    const railRight = 64; // rail width
    const margin = 8;
    const width = 380;
    const height = Math.min(window.innerHeight - 2 * margin, 640);
    if (!anchorRect) {
      return { top: margin, left: railRight + margin };
    }
    // Anchor vertically to the button's top, but keep fully on-screen
    let t = anchorRect.top;
    if (t + height > window.innerHeight - margin) t = window.innerHeight - height - margin;
    if (t < margin) t = margin;
    const l = Math.min(window.innerWidth - width - margin, railRight + margin);
    return { top: t, left: l };
  }, [anchorRect]);

  const persistTimer = async (priorTimer: ReturnType<typeof startTimer>) => {
    if (!priorTimer) return;
    const elapsedSecs = Math.floor((Date.now() - priorTimer.startedAt) / 1000);
    if (elapsedSecs < 1) return;
    try {
      await createEntry.mutateAsync({
        taskId: priorTimer.taskId,
        startedAt: new Date(priorTimer.startedAt).toISOString(),
        durationSeconds: elapsedSecs,
      });
    } catch (err) {
      console.error('Failed to persist timer entry:', err);
    }
  };

  const handlePlay = async (entry: TaskTimeEntry) => {
    const task = entry.task;
    if (!task) return;
    const prior = startTimer(task.id, task.title, task.list_id, task.time_tracked || 0);
    await persistTimer(prior);
  };

  const handleStopRunning = async () => {
    const stopped = stopTimer();
    await persistTimer(stopped);
  };

  const handleOpenTask = (taskId: string) => {
    setActiveTask(taskId);
    onClose();
  };

  return (
    <div
      ref={panelRef}
      className="fixed z-[20] w-[380px] overflow-hidden rounded-[14px] border border-[var(--sh-hair)] bg-[var(--sidebar)] text-[var(--sh-ink)]"
      style={{
        top,
        left,
        maxHeight: 'calc(100vh - 16px)',
        boxShadow: 'var(--sh-shadow-sm), 0 24px 60px -12px rgba(0,0,0,0.18)',
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[var(--sh-hair)] px-4 py-3">
        <div className="flex items-center gap-2">
          <svg className="h-4 w-4 text-[var(--sh-ink-3)]" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" />
          </svg>
          <span className="text-[13px] font-semibold">Time sheet</span>
        </div>
        <button
          onClick={onClose}
          className="grid h-6 w-6 place-items-center rounded-[6px] text-[var(--sh-ink-3)] hover:bg-[var(--sh-hair-3)] hover:text-[var(--sh-ink)]"
          title="Close"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      {/* Body (scrollable) */}
      <div className="overflow-y-auto" style={{ maxHeight: 'calc(100vh - 76px)' }}>
        {/* Running-timer row (sticky at top of body) */}
        {timer && (
          <div className="sticky top-0 z-[1] border-b border-[var(--sh-hair)] bg-emerald-50 px-4 py-3">
            <div className="flex items-start gap-2">
              <span className="relative mt-1.5 flex h-2 w-2 shrink-0">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
              <div className="flex-1 min-w-0">
                <button
                  onClick={() => handleOpenTask(timer.taskId)}
                  className="block w-full truncate text-left text-[13px] font-semibold text-[var(--sh-ink)] hover:text-emerald-700"
                >
                  {timer.taskTitle}
                </button>
                <div className="mt-0.5 font-mono text-[12px] font-semibold tabular-nums text-emerald-800">
                  {formatClock(elapsed)}
                </div>
              </div>
              <button
                onClick={handleStopRunning}
                className="flex shrink-0 items-center gap-1 rounded-[6px] bg-red-500 px-2 py-1 text-[11px] font-medium text-white hover:bg-red-600"
                title="Stop timer"
              >
                <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 24 24">
                  <rect x="6" y="6" width="12" height="12" rx="1" />
                </svg>
                Stop
              </button>
            </div>
          </div>
        )}

        {isLoading && (
          <div className="px-4 py-8 text-center text-[12px] text-[var(--sh-ink-3)]">Loading…</div>
        )}

        {!isLoading && (!entries || entries.length === 0) && !timer && (
          <div className="px-4 py-10 text-center">
            <div className="mx-auto mb-2 grid h-10 w-10 place-items-center rounded-full bg-[var(--sh-hair-3)] text-[var(--sh-ink-3)]">
              <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7v5l3 2" />
              </svg>
            </div>
            <div className="text-[13px] font-medium text-[var(--sh-ink)]">No time logged yet</div>
            <div className="mt-1 text-[11.5px] text-[var(--sh-ink-3)]">
              Start a timer on a task and entries will appear here.
            </div>
          </div>
        )}

        {groups.map((group) => (
          <div key={group.dateKey}>
            <div className="sticky top-0 z-[0] bg-[var(--sidebar)]/95 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--sh-ink-3)] backdrop-blur">
              {formatDateHeader(group.dateKey)}
            </div>
            {group.items.map((entry) => (
              <EntryRow
                key={entry.id}
                entry={entry}
                onOpen={handleOpenTask}
                onPlay={handlePlay}
                isRunningTask={timer?.taskId === entry.task?.id}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function EntryRow({
  entry,
  onOpen,
  onPlay,
  isRunningTask,
}: {
  entry: TaskTimeEntry;
  onOpen: (taskId: string) => void;
  onPlay: (entry: TaskTimeEntry) => void;
  isRunningTask: boolean;
}) {
  const task = entry.task;
  if (!task) return null;

  const crumbs = [task.space?.name, task.folder?.name, task.list?.name].filter(Boolean).join(' · ');

  return (
    <div
      className="flex cursor-pointer items-start gap-2 border-b border-[var(--sh-hair)] px-4 py-2.5 transition hover:bg-[var(--sh-hair-3)]"
      onClick={() => onOpen(task.id)}
    >
      <div className="flex-1 min-w-0">
        <div className="truncate text-[13px] font-medium text-[var(--sh-ink)]">{task.title}</div>
        {crumbs && (
          <div className="mt-0.5 truncate text-[11px] text-[var(--sh-ink-3)]">{crumbs}</div>
        )}
        {task.parent_task && (
          <div className="mt-0.5 truncate text-[11px] text-[var(--sh-ink-3)]">
            ↳ Parent: {task.parent_task.title}
          </div>
        )}
        <div className="mt-1 flex items-center gap-1.5 text-[11px] text-[var(--sh-ink-3)]">
          {entry.source === 'manual' ? (
            <span className="rounded-[4px] bg-[var(--sh-hair-3)] px-1.5 py-[1px] font-medium text-[var(--sh-ink-3)]">
              Manual
            </span>
          ) : (
            <span>{formatTimeRange(entry.started_at, entry.stopped_at)}</span>
          )}
          <span>·</span>
          <span className={entry.duration_seconds < 0 ? 'text-red-500' : undefined}>
            {formatTracked(entry.duration_seconds) || '—'}
          </span>
        </div>
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); onPlay(entry); }}
        disabled={isRunningTask}
        className={`grid h-7 w-7 shrink-0 place-items-center rounded-[6px] transition ${
          isRunningTask
            ? 'cursor-not-allowed text-[var(--sh-ink-3)] opacity-50'
            : 'text-[var(--sh-ink-3)] hover:bg-[var(--sh-hair)] hover:text-emerald-600'
        }`}
        title={isRunningTask ? 'Timer already running on this task' : 'Restart timer'}
      >
        <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24">
          <path d="M8 5v14l11-7z" />
        </svg>
      </button>
    </div>
  );
}
