import { useEffect, useMemo, useState } from 'react';
import { usePMStore } from '../../../stores/pmStore';
import {
  useActiveGroupRun,
  useStartGroupRun,
  useStopGroupRun,
  useGroupRunHistory,
} from '../../../hooks/useGroupRuns';
import { useUpdateTask } from '../../../hooks/useTasks';
import DatePicker from './DatePicker';
import { formatClock, formatDuration, formatRunDate, mergeActivity, ActivityRowItem } from './groupRunActivity';

// Short, human work-date label for the panel's "Work date" row.
function formatWorkDate(value: string | null): string {
  if (!value) return 'Set date';
  const d = new Date(value);
  if (isNaN(d.getTime())) return 'Set date';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// The work-block-style detail view for a "Grouped tasks under …" row, opened by
// clicking the grouped row's name. A group is virtual (no task row), so this is
// a self-contained slide-over rather than the task TaskDetailPanel — but it
// reuses the same panel chrome (.td-* classes) and mirrors the work-block
// sections: a Start/Stop focus session with a live timer, live activity, the
// tasks in the group, and run history.
export default function GroupRunDetailPanel() {
  const target = usePMStore((s) => s.groupRunPanel);
  const setGroupRunPanel = usePMStore((s) => s.setGroupRunPanel);
  const setPeekTask = usePMStore((s) => s.setPeekTask);

  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    if (!target) { setMounted(false); return undefined; }
    const id = window.setTimeout(() => setMounted(true), 10);
    return () => window.clearTimeout(id);
  }, [target]);

  const close = () => { setMounted(false); window.setTimeout(() => setGroupRunPanel(null), 280); };

  useEffect(() => {
    if (!target) return undefined;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  const { data: active } = useActiveGroupRun();
  const start = useStartGroupRun();
  const stop = useStopGroupRun();
  const history = useGroupRunHistory(target?.key, !!target);

  // "Work date for all tasks" — opens the shared DatePicker anchored to the
  // row's button and writes the chosen date onto every task in the group.
  const updateTask = useUpdateTask(null);
  const [dateAnchor, setDateAnchor] = useState<DOMRect | null>(null);
  const [appliedDate, setAppliedDate] = useState<string | null>(null);

  const isRunningHere = !!active?.run && active.run.group_key === target?.key && !active.run.ended_at;
  const runHere = isRunningHere ? active!.run : null;

  // Live elapsed for the active session.
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!runHere) { setElapsed(0); return undefined; }
    const startMs = new Date(runHere.started_at).getTime();
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - startMs) / 1000)));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [runHere]);

  // Tick for live activity merge.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!isRunningHere) return undefined;
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [isRunningHere]);

  const runs = history.data?.runs || [];
  const liveRun = runs.find((r) => !r.ended_at) || runHere;
  const pastRuns = runs.filter((r) => r.ended_at);
  const liveRows = useMemo(() => (liveRun ? mergeActivity(liveRun, nowMs) : []), [liveRun, nowMs]);

  const totalLogged = useMemo(
    () => pastRuns.reduce((sum, r) => sum + (r.duration_seconds || 0), 0),
    [pastRuns],
  );

  if (!target) return null;

  const toggleRun = () => {
    if (isRunningHere && runHere) stop.mutate({ run_id: runHere.id, group_key: target.key });
    else start.mutate({ group_key: target.key, group_label: target.label, list_id: target.listId });
  };
  const busy = start.isPending || stop.isPending;

  const applyWorkDate = (next: string | null) => {
    setAppliedDate(next);
    for (const t of target.tasks) {
      updateTask.mutate({ id: t.id, work_date: next } as any);
    }
  };

  return (
    <div className="fixed inset-0 z-[90]">
      <div
        className="absolute inset-0 transition-opacity duration-300"
        style={{ opacity: mounted ? 1 : 0, background: 'rgba(10,10,10,0.18)' }}
        onClick={close}
      />
      <aside
        onClick={(e) => e.stopPropagation()}
        className="td-panel td-panel-luma apple td-shell absolute flex flex-col"
        style={{
          background: 'var(--surface)',
          transform: mounted ? 'translateX(0)' : 'translateX(calc(100% + 24px))',
          transition: 'transform .42s cubic-bezier(0.23, 1, 0.32, 1), opacity .3s ease',
          opacity: mounted ? 1 : 0,
        }}
      >
        {/* Top bar */}
        <div className="td-head td-head-luma flex items-center gap-2 shrink-0">
          <button type="button" onClick={close} className="td-nav-btn" title="Close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M13 17l5-5-5-5M6 17l5-5-5-5" />
            </svg>
          </button>
          <span className="td-bcrumb">
            <span className="td-bcrumb-part" style={{ cursor: 'default' }}>
              <span className="emblem" style={{ background: '#8b5cf6' }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m12 2 9 4.5-9 4.5-9-4.5L12 2Z" /><path d="m3 12 9 4.5 9-4.5" /><path d="m3 17 9 4.5 9-4.5" />
                </svg>
              </span>
              <span className="name">Grouped task</span>
            </span>
          </span>
        </div>

        {/* Body */}
        <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-5 py-4">
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide" style={{ background: 'color-mix(in oklch, #8b5cf6 14%, transparent)', color: '#5b21b6' }}>
              Group focus session
            </span>
            <h2 className="mt-2 text-[19px] font-semibold leading-snug text-[color:var(--sh-ink)]">{target.label}</h2>
          </div>

          {/* Run pill */}
          <div className="flex items-center gap-3 rounded-xl border border-[color:var(--sh-hair-3)] bg-[color:var(--surface-alt)] px-4 py-3">
            <button
              type="button"
              onClick={toggleRun}
              disabled={busy}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full text-white transition disabled:opacity-50"
              style={{ background: isRunningHere ? '#ef4444' : '#8b5cf6' }}
              title={isRunningHere ? 'Stop session' : 'Start session'}
            >
              {isRunningHere
                ? <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
                : <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>}
            </button>
            <div className="flex flex-col">
              <span className="text-[20px] font-semibold tabular-nums text-[color:var(--sh-ink)]">{formatClock(elapsed)}</span>
              <span className="text-[11px] text-[color:var(--sh-ink-3)]">
                {isRunningHere ? 'Session running' : 'Start a focus session on this group'}
              </span>
            </div>
            {totalLogged > 0 && (
              <span className="ml-auto text-right text-[11px] text-[color:var(--sh-ink-3)]">
                <span className="block text-[15px] font-semibold text-[color:var(--sh-ink)]">{formatDuration(totalLogged)}</span>
                logged total
              </span>
            )}
          </div>

          {/* Work date — applies to every task in the group */}
          <div className="flex items-center gap-3 rounded-xl border border-[color:var(--sh-hair-3)] bg-[color:var(--surface-alt)] px-4 py-3">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-full" style={{ background: 'color-mix(in oklch, #8b5cf6 12%, transparent)', color: '#8b5cf6' }}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
              </svg>
            </span>
            <div className="flex flex-col">
              <span className="text-[13px] font-semibold text-[color:var(--sh-ink)]">Work date</span>
              <span className="text-[11px] text-[color:var(--sh-ink-3)]">Sets the work date for all {target.tasks.length} tasks</span>
            </div>
            <button
              type="button"
              onClick={(e) => setDateAnchor(e.currentTarget.getBoundingClientRect())}
              className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-[color:var(--sh-hair-2)] px-3 py-1.5 text-[12px] font-medium text-[color:var(--sh-ink)] transition hover:bg-[color:var(--sh-hair-3)]"
              title="Set work date for all tasks in this group"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
              </svg>
              {formatWorkDate(appliedDate)}
            </button>
          </div>

          {/* Live activity */}
          {isRunningHere && (
            <section>
              <h4 className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide opacity-70">
                <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
                Activity this session
              </h4>
              {liveRows.length === 0 ? (
                <p className="text-[12px] opacity-60">Nothing yet — start a task timer or mark a task done while this session runs.</p>
              ) : (
                <ul className="flex flex-col gap-1">{liveRows.map((r) => <li key={r.taskId}><ActivityRowItem row={r} /></li>)}</ul>
              )}
            </section>
          )}

          {/* Tasks in this group */}
          <section>
            <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide opacity-60">
              Tasks in this group · {target.tasks.length}
            </h4>
            {target.tasks.length === 0 ? (
              <p className="text-[12px] opacity-60">No tasks.</p>
            ) : (
              <ul className="flex flex-col gap-0.5">
                {target.tasks.map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => setPeekTask(t.id)}
                      className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-[12px] hover:bg-[color:var(--sh-hair-3)]"
                    >
                      <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-[color:var(--sh-ink-4)]" />
                      <span className="flex-1 truncate">{t.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Run history */}
          <section>
            <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide opacity-60">Run history</h4>
            {history.isLoading ? (
              <p className="text-[12px] opacity-60">Loading…</p>
            ) : pastRuns.length === 0 ? (
              <p className="text-[12px] opacity-60">No sessions logged yet.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {pastRuns.slice(0, 10).map((r) => {
                  const rows = mergeActivity(r);
                  return (
                    <li key={r.id} className="rounded border border-[color:var(--sh-hair-3)] bg-[color:var(--surface-alt)] px-3 py-2 text-[12px]">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{formatRunDate(r.started_at)}</span>
                        <span className="opacity-50">·</span>
                        <span className="opacity-80">{formatDuration(r.duration_seconds)}</span>
                        <span className="opacity-50">·</span>
                        <span className="opacity-80">{rows.length} task{rows.length === 1 ? '' : 's'}</span>
                      </div>
                      {rows.length > 0 && (
                        <ul className="mt-1.5 flex flex-col gap-0.5">{rows.map((row) => <li key={row.taskId}><ActivityRowItem row={row} /></li>)}</ul>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      </aside>
      {dateAnchor && (
        <DatePicker
          anchorRect={dateAnchor}
          value={appliedDate}
          mode="datetime"
          onChange={applyWorkDate}
          onClose={() => setDateAnchor(null)}
        />
      )}
    </div>
  );
}
