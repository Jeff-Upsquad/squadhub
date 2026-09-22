import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { TaskTimeEntry } from '@squadhub/shared';
import { useTaskTimeEntries, useCreateTaskTimeEntry, useDeleteTaskTimeEntry } from '../../hooks/useTaskTimeEntries';
import {
  parseDuration,
  formatDuration,
  formatHoursMinutes,
  formatClockTime,
  toDateInputValue,
  toTimeInputValue,
  fromDateTimeInputs,
} from '../../lib/timeDuration';

const QUICK_ADDS = [15, 30, 60];

type Tab = 'log' | 'timer';

/**
 * The task's time panel: what's on the clock so far, a form to log a block of
 * time after the fact, the live timer, and the recent entries that make up the
 * total (so a mis-logged block is one click from being removed).
 *
 * Logging is entry-based rather than "overwrite the total" — that keeps the
 * per-session history, the daily timesheet and the task's own aggregate
 * telling the same story. Subtracting is a negative entry, which the server
 * gates on the can_edit_time_logs role.
 */
export default function LogTimePopover({
  anchorRect,
  taskId,
  totalSeconds,
  estimateMinutes,
  currentUserId,
  canAdjust,
  isRunning,
  runningSeconds,
  onStartTimer,
  onStopTimer,
  onClose,
}: {
  anchorRect: DOMRect | null;
  taskId: string;
  /** tasks.time_tracked — every user's logged time on this task, in seconds. */
  totalSeconds: number;
  estimateMinutes: number | null;
  currentUserId: string | null;
  /** can_edit_time_logs — required to subtract time or remove someone else's. */
  canAdjust: boolean;
  isRunning: boolean;
  /** Live seconds for the running timer, already split across parallel timers. */
  runningSeconds: number;
  /** Omitted for work-block tasks, whose time is driven by the run itself. */
  onStartTimer?: () => void;
  onStopTimer?: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const durationRef = useRef<HTMLInputElement>(null);

  const [tab, setTab] = useState<Tab>('log');
  const [duration, setDuration] = useState('');
  const [note, setNote] = useState('');
  const [dateValue, setDateValue] = useState(() => toDateInputValue(new Date()));
  const [timeValue, setTimeValue] = useState(() => toTimeInputValue(new Date()));
  // Until the user edits "when" themselves, the start time trails the duration
  // so a freshly typed "1h 30m" means "the 90 minutes that just ended".
  const [whenTouched, setWhenTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justLogged, setJustLogged] = useState<number | null>(null);

  const entriesQuery = useTaskTimeEntries(taskId);
  const createEntry = useCreateTaskTimeEntry();
  const deleteEntry = useDeleteTaskTimeEntry();

  const minutes = useMemo(() => {
    const trimmed = duration.trim();
    if (!trimmed) return null;
    return parseDuration(trimmed);
  }, [duration]);
  const invalid = duration.trim().length > 0 && minutes == null;
  const subtracting = (minutes ?? 0) < 0;

  useEffect(() => {
    const t = setTimeout(() => durationRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (whenTouched || minutes == null || minutes <= 0) return;
    const start = new Date(Date.now() - minutes * 60_000);
    setDateValue(toDateInputValue(start));
    setTimeValue(toTimeInputValue(start));
  }, [minutes, whenTouched]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const id = setTimeout(() => document.addEventListener('mousedown', onDown), 0);
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(id);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const liveTotalSeconds = totalSeconds + (isRunning ? runningSeconds : 0);
  const estimateSeconds = estimateMinutes ? estimateMinutes * 60 : 0;
  const pct = estimateSeconds > 0
    ? Math.min(100, Math.round((liveTotalSeconds / estimateSeconds) * 100))
    : 0;
  const overBy = estimateSeconds > 0 && liveTotalSeconds > estimateSeconds
    ? liveTotalSeconds - estimateSeconds
    : 0;

  const startAt = fromDateTimeInputs(dateValue, timeValue);
  const endAt = startAt && minutes ? new Date(startAt.getTime() + Math.abs(minutes) * 60_000) : null;

  const bumpDuration = (delta: number) => {
    const base = minutes ?? 0;
    const next = base + delta;
    setDuration(next > 0 ? formatDuration(next) : '');
    setError(null);
  };

  const submit = async () => {
    if (createEntry.isPending) return;
    if (minutes == null || minutes === 0) { setError('Enter a duration, e.g. 1h 30m'); return; }
    if (minutes < 0 && !canAdjust) { setError('Your role cannot subtract logged time'); return; }
    if (!startAt) { setError('Pick a valid date and time'); return; }
    if (startAt.getTime() > Date.now() + 60_000) { setError("That's in the future"); return; }

    try {
      await createEntry.mutateAsync({
        taskId,
        startedAt: startAt.toISOString(),
        durationSeconds: Math.round(minutes * 60),
        note: note.trim() || null,
        source: 'manual',
      });
      setJustLogged(minutes);
      setDuration('');
      setNote('');
      setWhenTouched(false);
      setError(null);
      setTimeout(() => setJustLogged(null), 2200);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg || 'Could not log that time');
    }
  };

  const style = useMemo<React.CSSProperties>(() => {
    if (!anchorRect) return { top: 0, left: 0 };
    const width = 328;
    const vw = window.innerWidth;
    let left = anchorRect.left;
    if (left + width > vw - 8) left = vw - width - 8;
    if (left < 8) left = 8;
    return { top: anchorRect.bottom + 6, left, width };
  }, [anchorRect]);

  // The card's height depends on its content (recent entries, the estimate
  // meter, which tab is open), so place it against the real measurement rather
  // than a guess — otherwise the last entry can sit under the viewport edge
  // where it can't be clicked.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !anchorRect) return;
    const margin = 8;
    const vh = window.innerHeight;
    const height = Math.min(el.offsetHeight, vh - margin * 2);
    let top = anchorRect.bottom + 6;
    if (top + height > vh - margin) {
      // Prefer flipping above the row; fall back to pinning inside the viewport.
      const above = anchorRect.top - height - 6;
      top = above >= margin ? above : Math.max(margin, vh - height - margin);
    }
    el.style.top = `${top}px`;
  });

  if (!anchorRect || typeof document === 'undefined') return null;

  const entries = entriesQuery.data || [];

  return createPortal(
    <div ref={ref} className="tp-pop tp-pop-wide" style={style} role="dialog" aria-label="Time">
      {/* Totals — the task's whole clock, plus how it sits against the estimate */}
      <div className="tp-total">
        <div className="tp-total-row">
          <span className="tp-total-label">Logged on this task</span>
          <span className={`tp-total-value${isRunning ? ' is-live' : ''}`}>
            {formatHoursMinutes(Math.round(liveTotalSeconds / 60)) || '0m'}
          </span>
        </div>
        {estimateSeconds > 0 && (
          <>
            <div className="tp-meter" role="presentation">
              <div
                className={`tp-meter-fill${overBy ? ' is-over' : ''}`}
                style={{ width: `${Math.max(2, pct)}%` }}
              />
            </div>
            <div className="tp-total-sub">
              {overBy
                ? `${formatHoursMinutes(Math.round(overBy / 60))} over the ${formatDuration(estimateMinutes)} estimate`
                : `${pct}% of the ${formatDuration(estimateMinutes)} estimate`}
            </div>
          </>
        )}
      </div>

      {/* Tabs — only when a timer is actually available for this task */}
      {onStartTimer && (
        <div className="tp-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'log'}
            className={`tp-tab${tab === 'log' ? ' is-on' : ''}`}
            onClick={() => setTab('log')}
          >
            Add time
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'timer'}
            className={`tp-tab${tab === 'timer' ? ' is-on' : ''}`}
            onClick={() => setTab('timer')}
          >
            {isRunning ? 'Timer · running' : 'Timer'}
          </button>
        </div>
      )}

      {tab === 'log' || !onStartTimer ? (
        <div className="tp-body">
          <div className="tp-row">
            <label className="tp-label" htmlFor="tp-duration">How long</label>
            <div className="tp-row-main">
              <input
                id="tp-duration"
                ref={durationRef}
                value={duration}
                onChange={(e) => { setDuration(e.target.value); setError(null); }}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void submit(); } }}
                placeholder="1h 30m"
                className="tp-input tp-input-sm"
                aria-invalid={invalid}
              />
              <div className="tp-quick">
                {QUICK_ADDS.map((m) => (
                  <button key={m} type="button" className="tp-quick-btn" onClick={() => bumpDuration(m)}>
                    +{formatDuration(m)}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="tp-row">
            <label className="tp-label" htmlFor="tp-date">Started</label>
            <div className="tp-row-main">
              <input
                id="tp-date"
                type="date"
                value={dateValue}
                max={toDateInputValue(new Date())}
                onChange={(e) => { setDateValue(e.target.value); setWhenTouched(true); setError(null); }}
                className="tp-input tp-input-date"
              />
              <input
                type="time"
                value={timeValue}
                onChange={(e) => { setTimeValue(e.target.value); setWhenTouched(true); setError(null); }}
                className="tp-input tp-input-time"
              />
            </div>
          </div>

          {endAt && !subtracting && (
            <div className="tp-span">
              {formatClockTime(startAt!)} → {formatClockTime(endAt)}
              {!whenTouched && <span className="tp-span-hint"> · ends now</span>}
            </div>
          )}

          <div className="tp-row">
            <label className="tp-label" htmlFor="tp-note">Note</label>
            <div className="tp-row-main">
              <input
                id="tp-note"
                value={note}
                maxLength={500}
                onChange={(e) => setNote(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void submit(); } }}
                placeholder="What was this time on? (optional)"
                className="tp-input tp-input-sm"
              />
            </div>
          </div>

          <div className="tp-foot">
            <span className={`tp-foot-hint${error ? ' is-bad' : ''}`}>
              {error
                ? error
                : justLogged != null
                  ? (justLogged < 0
                      ? `Removed ${formatDuration(Math.abs(justLogged))} ✓`
                      : `Added ${formatDuration(justLogged)} ✓`)
                  : canAdjust ? 'Tip: “-30m” takes time off' : 'Enter to save'}
            </span>
            <button
              type="button"
              className="tp-btn"
              disabled={invalid || minutes == null || createEntry.isPending}
              onClick={() => void submit()}
            >
              {createEntry.isPending
                ? 'Saving…'
                : subtracting
                  ? `Remove ${formatDuration(Math.abs(minutes!))}`
                  : minutes ? `Log ${formatDuration(minutes)}` : 'Log time'}
            </button>
          </div>
        </div>
      ) : (
        <div className="tp-body tp-timer">
          <div className="tp-timer-clock">
            {isRunning ? formatHoursMinutes(Math.round(runningSeconds / 60)) || 'Under a minute' : 'Not running'}
          </div>
          <div className="tp-timer-sub">
            {isRunning
              ? 'Counting into this task now. Stopping saves the session.'
              : 'Start the clock and this task collects time as you work.'}
          </div>
          <button
            type="button"
            className={`tp-timer-btn${isRunning ? ' is-stop' : ''}`}
            onClick={() => { if (isRunning) onStopTimer?.(); else onStartTimer?.(); }}
          >
            {isRunning ? 'Stop timer' : 'Start timer'}
          </button>
        </div>
      )}

      {/* Recent entries — the audit trail behind the total, and the undo path */}
      <div className="tp-recent">
        <div className="tp-recent-head">Recent</div>
        {entriesQuery.isLoading ? (
          <div className="tp-recent-empty">Loading…</div>
        ) : entries.length === 0 ? (
          <div className="tp-recent-empty">No time logged yet.</div>
        ) : (
          <ul className="tp-recent-list">
            {entries.slice(0, 12).map((entry) => (
              <RecentRow
                key={entry.id}
                entry={entry}
                canDelete={
                  entry.source !== 'work_block' &&
                  (entry.user_id === currentUserId || canAdjust)
                }
                onDelete={() => deleteEntry.mutate({ taskId, entryId: entry.id })}
                isMine={entry.user_id === currentUserId}
              />
            ))}
          </ul>
        )}
      </div>
    </div>,
    document.body,
  );
}

function RecentRow({
  entry,
  isMine,
  canDelete,
  onDelete,
}: {
  entry: TaskTimeEntry;
  isMine: boolean;
  canDelete: boolean;
  onDelete: () => void;
}) {
  const started = new Date(entry.started_at);
  const today = new Date();
  const sameDay = started.toDateString() === today.toDateString();
  const when = sameDay
    ? `Today ${formatClockTime(started)}`
    : started.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ` ${formatClockTime(started)}`;
  const who = isMine ? 'You' : (entry.user?.display_name || entry.user?.email || 'Someone');
  const negative = entry.duration_seconds < 0;

  return (
    <li className="tp-recent-row">
      <span className={`tp-recent-dur${negative ? ' is-neg' : ''}`}>
        {/* Sub-minute entries round to nothing — keep the sign so a small
            correction doesn't read as a small amount of logged work. */}
        {formatHoursMinutes(Math.round(entry.duration_seconds / 60))
          || `${negative ? '-' : ''}<1m`}
      </span>
      <span className="tp-recent-meta">
        <span className="tp-recent-who">{who}</span>
        <span className="tp-recent-when">{when}</span>
        {negative && (
          <span
            className="tp-recent-tag"
            title="Time taken back off the total, not work logged"
          >
            adjustment
          </span>
        )}
        {entry.note && <span className="tp-recent-note">{entry.note}</span>}
      </span>
      {entry.source === 'work_block' ? (
        <span className="tp-recent-tag" title="Logged by a work block">block</span>
      ) : canDelete ? (
        <button type="button" className="tp-recent-del" onClick={onDelete} aria-label="Remove this entry">
          ×
        </button>
      ) : null}
    </li>
  );
}
