import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePMStore, MAX_PARALLEL_TIMERS } from '../stores/pmStore';
import { useParallelTimers } from '../hooks/useParallelTimers';
import { formatClock } from '../lib/formatDuration';

// Global "another timer is already running" gate. Any surface that starts a
// per-task timer while others run parks the request in pendingTimerStart; this
// dialog (mounted once in MainLayout) lists the running timers with live
// clocks + per-timer Stop, and offers to add the new task as a secondary.
// Portaled to <body>: the task detail panel is fixed at z-[90], so an in-flow
// overlay renders underneath it.
export default function TimerConflictDialog() {
  const pending = usePMStore((s) => s.pendingTimerStart);
  const setPending = usePMStore((s) => s.setPendingTimerStart);
  const { timers, startTimer, stopTimer } = useParallelTimers();
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!pending) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [pending]);

  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPending(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pending, setPending]);

  if (!pending) return null;

  const atMax = timers.length >= MAX_PARALLEL_TIMERS;
  const noneLeft = timers.length === 0;

  const confirm = async () => {
    if (busy || atMax) return;
    setBusy(true);
    try {
      await startTimer(pending);
    } finally {
      setBusy(false);
      setPending(null);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.45)' }}
      onClick={() => setPending(null)}
    >
      <div
        className="w-[min(460px,92vw)] rounded-2xl border shadow-2xl"
        style={{ borderColor: 'var(--sh-hair)', background: 'var(--surface)' }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="px-5 pt-5 pb-1">
          <div className="mb-2 flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5" aria-hidden>
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
            </span>
            <h2 className="text-[15px] font-semibold text-[color:var(--sh-ink)]">
              {noneLeft ? 'All timers stopped' : timers.length > 1 ? 'Timers already running' : 'Another timer is already running'}
            </h2>
          </div>

          {timers.length > 0 && (
            <div className="mb-3 overflow-hidden rounded-xl border" style={{ borderColor: 'var(--sh-hair)' }}>
              {timers.map((t, i) => (
                <div
                  key={t.taskId}
                  className="flex items-center gap-2 px-3 py-2"
                  style={i > 0 ? { borderTop: '1px solid var(--sh-hair)' } : undefined}
                >
                  <span
                    className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                    style={
                      i === 0
                        ? { background: 'color-mix(in oklch, #10b981 16%, transparent)', color: '#047857' }
                        : { background: 'color-mix(in oklch, #f59e0b 16%, transparent)', color: '#b45309' }
                    }
                  >
                    {i === 0 ? 'Primary' : 'Secondary'}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[color:var(--sh-ink)]">
                    {t.taskTitle}
                  </span>
                  <span className="shrink-0 font-mono text-[12px] font-semibold tabular-nums text-emerald-700">
                    {formatClock(Math.max(0, Math.floor((now - t.startedAt) / 1000)))}
                  </span>
                  <button
                    type="button"
                    onClick={() => stopTimer(t.taskId)}
                    className="flex shrink-0 items-center gap-1 rounded-md bg-red-500 px-2 py-0.5 text-[11px] font-medium text-white transition hover:bg-red-600"
                    title="Stop this timer"
                  >
                    <svg className="h-2.5 w-2.5" fill="currentColor" viewBox="0 0 24 24">
                      <rect x="6" y="6" width="12" height="12" rx="1" />
                    </svg>
                    Stop
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* The task being started: lead-in word, then the task as its own
              card (long titles clamp instead of flooding the sentence), then
              the split-time note. */}
          <p className="text-[13px] font-medium text-[color:var(--sh-ink)]">
            {noneLeft ? 'Start a timer on' : 'Add'}
          </p>
          <div
            className="my-1.5 flex items-center gap-2 rounded-xl border px-3 py-2"
            style={{ borderColor: 'var(--sh-hair)', background: 'color-mix(in oklch, #2962FF 6%, transparent)' }}
          >
            <svg
              className="h-3.5 w-3.5 shrink-0"
              style={{ color: '#2962FF' }}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              viewBox="0 0 24 24"
              aria-hidden
            >
              <line x1="9.5" y1="2.5" x2="14.5" y2="2.5" />
              <line x1="12" y1="2.5" x2="12" y2="5" />
              <circle cx="12" cy="14" r="7.5" />
              <line x1="12" y1="14" x2="14.5" y2="11.5" />
            </svg>
            <span
              className="min-w-0 flex-1 text-[13px] font-medium leading-snug text-[color:var(--sh-ink)]"
              style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
            >
              {pending.taskTitle}
            </span>
          </div>
          <p className="text-[13px] leading-relaxed text-[color:var(--sh-ink-2)]">
            {noneLeft ? (
              <>It becomes the primary timer.</>
            ) : atMax ? (
              <>Maximum of 3 secondary timers reached — stop one of the running timers first.</>
            ) : (
              <>as a secondary timer? While timers run in parallel, tracked time is split evenly between them.</>
            )}
          </p>
        </div>

        <div className="flex justify-end gap-2 px-5 pb-5 pt-4">
          <button
            type="button"
            onClick={() => setPending(null)}
            className="rounded-lg border px-3 py-1.5 text-[13px] transition hover:bg-[color:var(--sh-hair-3)]"
            style={{ borderColor: 'var(--sh-hair)', color: 'var(--sh-ink)' }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={atMax || busy}
            className="rounded-lg px-3 py-1.5 text-[13px] font-medium text-white transition disabled:cursor-not-allowed disabled:opacity-50"
            style={{ background: '#2962FF' }}
          >
            {noneLeft ? 'Start timer' : 'Add secondary timer'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
