import { useEffect, useMemo, useRef, useState } from 'react';
import {
  useActiveGroupRun,
  useStartGroupRun,
  useStopGroupRun,
  useGroupRunHistory,
  type GroupRun,
} from '../../../hooks/useGroupRuns';
import { formatClock, formatDuration, formatRunDate, mergeActivity, ActivityRowItem } from './groupRunActivity';

interface Props {
  groupKey: string;
  groupLabel: string;
  listId: string | null;
}

export default function GroupRunControls({ groupKey, groupLabel, listId }: Props) {
  const { data: active } = useActiveGroupRun();
  const start = useStartGroupRun();
  const stop = useStopGroupRun();
  const [open, setOpen] = useState(false);
  const popRef = useRef<HTMLDivElement | null>(null);

  const isRunningHere = !!active?.run && active.run.group_key === groupKey && !active.run.ended_at;
  const runHere: GroupRun | null = isRunningHere ? active!.run : null;

  // Live elapsed for the active run on this group.
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!runHere) { setElapsed(0); return undefined; }
    const startMs = new Date(runHere.started_at).getTime();
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - startMs) / 1000)));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [runHere]);

  // History (only fetched when the popover is open).
  const history = useGroupRunHistory(groupKey, open);
  const pastRuns = (history.data?.runs || []).filter((r) => r.ended_at);
  const liveRun = (history.data?.runs || []).find((r) => !r.ended_at) || runHere;

  // Tick once/sec for the live activity inside the popover.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!open || !isRunningHere) return undefined;
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [open, isRunningHere]);
  const liveRows = useMemo(() => (liveRun ? mergeActivity(liveRun, nowMs) : []), [liveRun, nowMs]);

  // Close popover on outside click.
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const toggleRun = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isRunningHere && runHere) {
      stop.mutate({ run_id: runHere.id, group_key: groupKey });
    } else {
      start.mutate({ group_key: groupKey, group_label: groupLabel, list_id: listId });
    }
  };

  const busy = start.isPending || stop.isPending;

  return (
    <div className="gh-run" ref={popRef} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        className={`gh-run-btn${isRunningHere ? ' is-running' : ''}`}
        onClick={toggleRun}
        disabled={busy}
        title={isRunningHere ? 'Stop group session' : 'Start a focus session on this group'}
        aria-label={isRunningHere ? 'Stop group session' : 'Start group session'}
      >
        {isRunningHere ? (
          <>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
            <span className="gh-run-clock tabular-nums">{formatClock(elapsed)}</span>
          </>
        ) : (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
        )}
      </button>
      <button
        type="button"
        className="gh-run-more"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        title="Session activity & history"
        aria-label="Session activity and history"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
        </svg>
      </button>

      {open && (
        <div className="gh-run-pop" onClick={(e) => e.stopPropagation()}>
          <div className="gh-run-pop-head">
            <span className="gh-run-pop-title">{groupLabel || 'Group session'}</span>
            {isRunningHere && <span className="gh-run-live"><span className="dot" /> Live · {formatClock(elapsed)}</span>}
          </div>

          {isRunningHere && (
            <section className="gh-run-sec">
              <h5>Activity this session</h5>
              {liveRows.length === 0 ? (
                <p className="gh-run-empty">Nothing yet — start a task timer or mark a task done while this session runs.</p>
              ) : (
                <ul>{liveRows.map((r) => <li key={r.taskId}><ActivityRowItem row={r} /></li>)}</ul>
              )}
            </section>
          )}

          <section className="gh-run-sec">
            <h5>Past sessions</h5>
            {history.isLoading ? (
              <p className="gh-run-empty">Loading…</p>
            ) : pastRuns.length === 0 ? (
              <p className="gh-run-empty">No sessions logged yet.</p>
            ) : (
              <ul className="gh-run-hist">
                {pastRuns.slice(0, 10).map((r) => {
                  const rows = mergeActivity(r);
                  return (
                    <li key={r.id} className="gh-run-hist-item">
                      <div className="gh-run-hist-meta">
                        <span className="font-medium">{formatRunDate(r.started_at)}</span>
                        <span className="opacity-50">·</span>
                        <span>{formatDuration(r.duration_seconds)}</span>
                        <span className="opacity-50">·</span>
                        <span>{rows.length} task{rows.length === 1 ? '' : 's'}</span>
                      </div>
                      {rows.length > 0 && (
                        <ul>{rows.map((row) => <li key={row.taskId}><ActivityRowItem row={row} /></li>)}</ul>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
