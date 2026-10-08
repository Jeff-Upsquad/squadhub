import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { TaskTimeEntry, EditLoggedTimeLevel } from '@squadhub/shared';
import {
  useTaskTimeEntries,
  useCreateTaskTimeEntry,
  useDeleteTaskTimeEntry,
  useUpdateTaskTimeEntry,
} from '../../hooks/useTaskTimeEntries';
import { useEditLoggedTimeLevel } from '../../hooks/useMySkills';
import { useIsAdmin } from '../../hooks/usePermissions';
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
 * telling the same story. Changing time that is already logged needs the
 * edit_logged_time skill (admin → Skills): 'reduce' can only lower time,
 * 'full' can change it either way — except admins editing someone else's
 * entry, who are capped to reduce-only. Negative entries are disabled; reduce
 * by editing an entry down. The server enforces the same rules on every call.
 */
export default function LogTimePopover({
  anchorRect,
  taskId,
  totalSeconds,
  estimateMinutes,
  canLog,
  currentUserId,
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
  /** Member access on the task. Below that, the popover is a read-only view. */
  canLog: boolean;
  currentUserId: string | null;
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
  const [startDateValue, setStartDateValue] = useState(() => toDateInputValue(new Date()));
  const [startTimeValue, setStartTimeValue] = useState(() => toTimeInputValue(new Date()));
  const [endDateValue, setEndDateValue] = useState(() => toDateInputValue(new Date()));
  const [endTimeValue, setEndTimeValue] = useState(() => toTimeInputValue(new Date()));
  const [lastAnchor, setLastAnchor] = useState<'start' | 'end'>('end');
  const [whenTouched, setWhenTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justLogged, setJustLogged] = useState<number | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const editLevel = useEditLoggedTimeLevel();
  const isAdmin = useIsAdmin();

  const entriesQuery = useTaskTimeEntries(taskId);
  const createEntry = useCreateTaskTimeEntry();
  const deleteEntry = useDeleteTaskTimeEntry();

  const minutes = useMemo(() => {
    const trimmed = duration.trim();
    if (!trimmed) return null;
    return parseDuration(trimmed);
  }, [duration]);
  const invalid = duration.trim().length > 0 && (minutes == null || minutes <= 0);

  useEffect(() => {
    if (!canLog) return undefined;
    const t = setTimeout(() => durationRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [canLog]);

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

  const startAt = fromDateTimeInputs(startDateValue, startTimeValue);
  const endAt = fromDateTimeInputs(endDateValue, endTimeValue);

  const handleStartTimeChange = (val: string) => {
    setStartTimeValue(val);
    setWhenTouched(true);
    setError(null);
    setLastAnchor('start');
    const start = fromDateTimeInputs(startDateValue, val);
    const end = fromDateTimeInputs(endDateValue, endTimeValue);
    if (start && end) {
      const diffMins = Math.round((end.getTime() - start.getTime()) / 60_000);
      setDuration(diffMins !== 0 ? formatHoursMinutes(diffMins) : '0m');
    }
  };

  const handleStartDateChange = (val: string) => {
    setStartDateValue(val);
    setWhenTouched(true);
    setError(null);
    setLastAnchor('start');
    let targetEndDate = endDateValue;
    if (startDateValue === endDateValue) {
      setEndDateValue(val);
      targetEndDate = val;
    }
    const start = fromDateTimeInputs(val, startTimeValue);
    const end = fromDateTimeInputs(targetEndDate, endTimeValue);
    if (start && end) {
      const diffMins = Math.round((end.getTime() - start.getTime()) / 60_000);
      setDuration(diffMins !== 0 ? formatHoursMinutes(diffMins) : '0m');
    }
  };

  const handleEndTimeChange = (val: string) => {
    setEndTimeValue(val);
    setWhenTouched(true);
    setError(null);
    setLastAnchor('start');
    const start = fromDateTimeInputs(startDateValue, startTimeValue);
    const end = fromDateTimeInputs(endDateValue, val);
    if (start && end) {
      const diffMins = Math.round((end.getTime() - start.getTime()) / 60_000);
      setDuration(diffMins !== 0 ? formatHoursMinutes(diffMins) : '0m');
    }
  };

  const handleEndDateChange = (val: string) => {
    setEndDateValue(val);
    setWhenTouched(true);
    setError(null);
    setLastAnchor('start');
    const start = fromDateTimeInputs(startDateValue, startTimeValue);
    const end = fromDateTimeInputs(val, endTimeValue);
    if (start && end) {
      const diffMins = Math.round((end.getTime() - start.getTime()) / 60_000);
      setDuration(diffMins !== 0 ? formatHoursMinutes(diffMins) : '0m');
    }
  };

  const handleDurationChange = (val: string) => {
    setDuration(val);
    setError(null);
    const parsed = parseDuration(val);
    if (parsed != null && parsed !== 0) {
      if (lastAnchor === 'start') {
        const start = fromDateTimeInputs(startDateValue, startTimeValue);
        if (start) {
          const nextEnd = new Date(start.getTime() + parsed * 60_000);
          setEndDateValue(toDateInputValue(nextEnd));
          setEndTimeValue(toTimeInputValue(nextEnd));
        }
      } else {
        const end = fromDateTimeInputs(endDateValue, endTimeValue);
        if (end) {
          const nextStart = new Date(end.getTime() - parsed * 60_000);
          setStartDateValue(toDateInputValue(nextStart));
          setStartTimeValue(toTimeInputValue(nextStart));
        }
      }
    }
  };

  const bumpDuration = (delta: number) => {
    const base = minutes ?? 0;
    const next = base + delta;
    setDuration(next !== 0 ? formatHoursMinutes(next) : '');
    setError(null);
    if (next !== 0) {
      if (lastAnchor === 'start') {
        const start = fromDateTimeInputs(startDateValue, startTimeValue);
        if (start) {
          const nextEnd = new Date(start.getTime() + next * 60_000);
          setEndDateValue(toDateInputValue(nextEnd));
          setEndTimeValue(toTimeInputValue(nextEnd));
        }
      } else {
        const end = fromDateTimeInputs(endDateValue, endTimeValue);
        if (end) {
          const nextStart = new Date(end.getTime() - next * 60_000);
          setStartDateValue(toDateInputValue(nextStart));
          setStartTimeValue(toTimeInputValue(nextStart));
        }
      }
    }
  };

  const submit = async () => {
    if (createEntry.isPending) return;
    if (minutes == null || minutes <= 0) { setError(minutes != null && minutes < 0 ? 'Negative time entries are disabled' : 'Enter a duration, e.g. 1h 30m'); return; }
    if (!startAt || !endAt) { setError('Pick a valid date and time'); return; }
    if (endAt.getTime() > Date.now() + 60_000) { setError("That's in the future"); return; }
    if (startAt.getTime() > endAt.getTime() && minutes > 0) { setError("End time cannot be before start time"); return; }

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
      setLastAnchor('end');
      const resetNow = new Date();
      setStartDateValue(toDateInputValue(resetNow));
      setStartTimeValue(toTimeInputValue(resetNow));
      setEndDateValue(toDateInputValue(resetNow));
      setEndTimeValue(toTimeInputValue(resetNow));
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
      {canLog && onStartTimer && (
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

      {!canLog ? (
        <div className="tp-body tp-readonly">
          You can see the time on this task, but logging it needs edit access.
        </div>
      ) : tab === 'log' || !onStartTimer ? (
        <div className="tp-body">
          <div className="tp-row">
            <label className="tp-label" htmlFor="tp-duration">How long</label>
            <div className="tp-row-main">
              <input
                id="tp-duration"
                ref={durationRef}
                value={duration}
                onChange={(e) => handleDurationChange(e.target.value)}
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
            <label className="tp-label" htmlFor="tp-start-time">Started</label>
            <div className="tp-row-main">
              <input
                id="tp-start-time"
                type="time"
                value={startTimeValue}
                onChange={(e) => handleStartTimeChange(e.target.value)}
                className="tp-input tp-input-time"
              />
              <input
                id="tp-start-date"
                type="date"
                value={startDateValue}
                max={toDateInputValue(new Date())}
                onChange={(e) => handleStartDateChange(e.target.value)}
                className="tp-input tp-input-date"
              />
            </div>
          </div>

          <div className="tp-row">
            <label className="tp-label" htmlFor="tp-end-time">Ended</label>
            <div className="tp-row-main">
              <input
                id="tp-end-time"
                type="time"
                value={endTimeValue}
                onChange={(e) => handleEndTimeChange(e.target.value)}
                className="tp-input tp-input-time"
              />
              <input
                id="tp-end-date"
                type="date"
                value={endDateValue}
                max={toDateInputValue(new Date())}
                onChange={(e) => handleEndDateChange(e.target.value)}
                className="tp-input tp-input-date"
              />
            </div>
          </div>

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
                  ? `Added ${formatDuration(justLogged)} ✓`
                  : 'Enter to save'}
            </span>
            <button
              type="button"
              className="tp-btn"
              disabled={invalid || minutes == null || createEntry.isPending}
              onClick={() => void submit()}
            >
              {createEntry.isPending
                ? 'Saving…'
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
        <div className="tp-recent-head">
          Recent
          {canLog && editLevel === 'reduce' && (
            <span className="tp-recent-lvl" title="Your “Edit logged time” skill level"> · you can reduce entries</span>
          )}
          {canLog && isAdmin && editLevel === 'full' && (
            <span className="tp-recent-lvl" title="Admins can reduce other users' entries"> · admin: reduce others</span>
          )}
          {deleteError && <span className="tp-recent-err"> · {deleteError}</span>}
        </div>
        {entriesQuery.isLoading ? (
          <div className="tp-recent-empty">Loading…</div>
        ) : entries.length === 0 ? (
          <div className="tp-recent-empty">No time logged yet.</div>
        ) : (
          <ul className="tp-recent-list">
            {entries.slice(0, 12).map((entry) => {
              const isMineRow = entry.user_id === currentUserId;
              // Admins editing someone else's entry are capped to reduce-only.
              const rowLevel: EditLoggedTimeLevel | null = !isMineRow && isAdmin && editLevel === 'full' ? 'reduce' : editLevel;
              const rowCanAdjust = rowLevel != null;
              return editingId === entry.id && rowLevel ? (
              <EditEntryRow
                key={entry.id}
                taskId={taskId}
                entry={entry}
                level={rowLevel}
                isMine={isMineRow}
                adminCapped={!isMineRow && isAdmin && editLevel === 'full'}
                isWorkBlock={entry.source === 'work_block'}
                onDone={() => setEditingId(null)}
              />
            ) : (
              <RecentRow
                key={entry.id}
                entry={entry}
                // Removing an entry changes the logged total, so it carries the
                // same skill gate the server applies — for your own rows too.
                canDelete={canLog && rowCanAdjust
                  && (rowLevel === 'full' || entry.duration_seconds > 0)}
                canEdit={canLog && rowCanAdjust}
                onEdit={() => { setDeleteError(null); setEditingId(entry.id); }}
                onDelete={() => {
                  setDeleteError(null);
                  deleteEntry.mutate({ taskId, entryId: entry.id }, {
                    onError: (err: unknown) => {
                      const msg = (err as { response?: { data?: { error?: string } } })
                        ?.response?.data?.error;
                      setDeleteError(msg || 'Could not remove that entry');
                    },
                  });
                }}
                isMine={isMineRow}
              />
            );})}
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
  canEdit,
  onEdit,
  onDelete,
}: {
  entry: TaskTimeEntry;
  isMine: boolean;
  canDelete: boolean;
  canEdit: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const started = new Date(entry.started_at);
  const today = new Date();
  const sameDay = started.toDateString() === today.toDateString();
  const when = sameDay
    ? `Today ${formatClockTime(started)}`
    : started.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ` ${formatClockTime(started)}`;
  const who = isMine ? 'you' : (entry.user?.display_name || entry.user?.email || 'someone');
  const editedBy = entry.edited_by_user?.display_name || entry.edited_by_user?.email || null;
  const negative = entry.duration_seconds < 0;
  const sourceLabel = entry.source === 'work_block' ? 'time block' : entry.source === 'manual' ? 'manual' : 'timer';

  return (
    <li className="tp-recent-row">
      <span className={`tp-recent-dur${negative ? ' is-neg' : ''}`}>
        {/* Sub-minute entries round to nothing — keep the sign so a small
            correction doesn't read as a small amount of logged work. */}
        {formatHoursMinutes(Math.round(entry.duration_seconds / 60))
          || `${negative ? '-' : ''}<1m`}
      </span>
      <span className="tp-recent-meta">
        <span className="tp-recent-who">logged by {who}</span>
        <span className="tp-recent-when">{when}</span>
        <span className="tp-recent-tag tp-recent-tag-lower" title={sourceLabel === 'timer' ? 'Logged by the timer' : sourceLabel === 'manual' ? 'Logged manually' : 'Logged by a time block · reduce only'}>
          {sourceLabel}
        </span>
        {negative && (
          <span
            className="tp-recent-tag tp-recent-tag-lower"
            title="Time taken back off the total, not work logged"
          >
            adjustment
          </span>
        )}
        {entry.edited_at && (
          <span
            className="tp-recent-tag tp-recent-tag-lower"
            title={editedBy ? `Edited by ${editedBy} · ${new Date(entry.edited_at).toLocaleString()}` : `Changed ${new Date(entry.edited_at).toLocaleString()}`}
          >
            edited{editedBy ? ` by ${editedBy}` : ''}
          </span>
        )}
        {entry.note && <span className="tp-recent-note">{entry.note}</span>}
      </span>
      {canEdit && (
        <button type="button" className="tp-recent-del tp-recent-edit" onClick={onEdit} aria-label="Edit this entry" title="Edit">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
          </svg>
        </button>
      )}
      {canDelete && (
        <button type="button" className="tp-recent-del" onClick={onDelete} aria-label="Remove this entry" title="Remove">
          ×
        </button>
      )}
    </li>
  );
}

/**
 * One entry opened for editing, in place of its row: duration, when it was
 * logged from, and the note. With the 'reduce' level the duration may only go
 * down — the form says so up front and blocks a raise before the server does.
 * Work-block rows are always reduce-only, whatever the level.
 */
function EditEntryRow({
  taskId,
  entry,
  level,
  isMine,
  adminCapped = false,
  isWorkBlock = false,
  onDone,
}: {
  taskId: string;
  entry: TaskTimeEntry;
  level: EditLoggedTimeLevel;
  isMine: boolean;
  adminCapped?: boolean;
  isWorkBlock?: boolean;
  onDone: () => void;
}) {
  const update = useUpdateTaskTimeEntry();
  const oldSeconds = entry.duration_seconds;
  const startAnchor = new Date(entry.started_at);
  const endAnchor = new Date(entry.stopped_at);

  const [duration, setDuration] = useState(
    () => formatHoursMinutes(Math.round(oldSeconds / 60)) || (oldSeconds < 0 ? '-1m' : '1m'),
  );
  const [durationTouched, setDurationTouched] = useState(false);
  const [startDateValue, setStartDateValue] = useState(() => toDateInputValue(startAnchor));
  const [startTimeValue, setStartTimeValue] = useState(() => toTimeInputValue(startAnchor));
  const [endDateValue, setEndDateValue] = useState(() => toDateInputValue(endAnchor));
  const [endTimeValue, setEndTimeValue] = useState(() => toTimeInputValue(endAnchor));
  const [whenTouched, setWhenTouched] = useState(false);
  const [lastAnchor, setLastAnchor] = useState<'start' | 'end'>('start');
  const [note, setNote] = useState(entry.note || '');
  const [error, setError] = useState<string | null>(null);
  const durationRef = useRef<HTMLInputElement>(null);
  const rowRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    durationRef.current?.focus();
    durationRef.current?.select();
    rowRef.current?.scrollIntoView({ block: 'nearest' });
  }, []);

  const minutes = duration.trim() ? parseDuration(duration) : null;
  const invalid = minutes == null || minutes <= 0;
  // Untouched, the typed value is a minute-rounded view of the real seconds —
  // don't let that rounding count as a change.
  const newSeconds = durationTouched && minutes != null ? Math.round(minutes * 60) : oldSeconds;
  const isNegative = durationTouched && newSeconds <= 0;
  const raising = newSeconds > oldSeconds;
  const reduceOnly = level === 'reduce' || isWorkBlock;
  const blocked = (reduceOnly && raising) || isNegative;
  const blockedMsg = isWorkBlock
    ? 'Time-block time can only be reduced, not increased'
    : adminCapped
      ? 'Admins can only reduce logged time, not increase it'
      : 'You can only reduce this entry';

  const handleStartTimeChange = (val: string) => {
    setStartTimeValue(val);
    setWhenTouched(true);
    setDurationTouched(true);
    setError(null);
    setLastAnchor('start');
    const start = fromDateTimeInputs(startDateValue, val);
    const end = fromDateTimeInputs(endDateValue, endTimeValue);
    if (start && end) {
      const diffMins = Math.round((end.getTime() - start.getTime()) / 60_000);
      setDuration(diffMins !== 0 ? formatHoursMinutes(diffMins) : '0m');
    }
  };

  const handleStartDateChange = (val: string) => {
    setStartDateValue(val);
    setWhenTouched(true);
    setDurationTouched(true);
    setError(null);
    setLastAnchor('start');
    let targetEndDate = endDateValue;
    if (startDateValue === endDateValue) {
      setEndDateValue(val);
      targetEndDate = val;
    }
    const start = fromDateTimeInputs(val, startTimeValue);
    const end = fromDateTimeInputs(targetEndDate, endTimeValue);
    if (start && end) {
      const diffMins = Math.round((end.getTime() - start.getTime()) / 60_000);
      setDuration(diffMins !== 0 ? formatHoursMinutes(diffMins) : '0m');
    }
  };

  const handleEndTimeChange = (val: string) => {
    setEndTimeValue(val);
    setWhenTouched(true);
    setDurationTouched(true);
    setError(null);
    setLastAnchor('start');
    const start = fromDateTimeInputs(startDateValue, startTimeValue);
    const end = fromDateTimeInputs(endDateValue, val);
    if (start && end) {
      const diffMins = Math.round((end.getTime() - start.getTime()) / 60_000);
      setDuration(diffMins !== 0 ? formatHoursMinutes(diffMins) : '0m');
    }
  };

  const handleEndDateChange = (val: string) => {
    setEndDateValue(val);
    setWhenTouched(true);
    setDurationTouched(true);
    setError(null);
    setLastAnchor('start');
    const start = fromDateTimeInputs(startDateValue, startTimeValue);
    const end = fromDateTimeInputs(val, endTimeValue);
    if (start && end) {
      const diffMins = Math.round((end.getTime() - start.getTime()) / 60_000);
      setDuration(diffMins !== 0 ? formatHoursMinutes(diffMins) : '0m');
    }
  };

  const handleDurationChange = (val: string) => {
    setDuration(val);
    setDurationTouched(true);
    setError(null);
    const parsed = parseDuration(val);
    if (parsed != null && parsed !== 0) {
      setWhenTouched(true);
      if (lastAnchor === 'start') {
        const start = fromDateTimeInputs(startDateValue, startTimeValue);
        if (start) {
          const nextEnd = new Date(start.getTime() + parsed * 60_000);
          setEndDateValue(toDateInputValue(nextEnd));
          setEndTimeValue(toTimeInputValue(nextEnd));
        }
      } else {
        const end = fromDateTimeInputs(endDateValue, endTimeValue);
        if (end) {
          const nextStart = new Date(end.getTime() - parsed * 60_000);
          setStartDateValue(toDateInputValue(nextStart));
          setStartTimeValue(toTimeInputValue(nextStart));
        }
      }
    }
  };

  const save = async () => {
    if (update.isPending) return;
    if (durationTouched && invalid) { setError(minutes != null && minutes < 0 ? 'Negative time entries are disabled' : 'Enter a duration, e.g. 1h 30m'); return; }
    if (isNegative) { setError('Negative time entries are disabled'); return; }
    if (blocked) { setError(blockedMsg); return; }
    const start = whenTouched ? fromDateTimeInputs(startDateValue, startTimeValue) : null;
    const end = whenTouched ? fromDateTimeInputs(endDateValue, endTimeValue) : null;
    if (whenTouched && (!start || !end)) { setError('Pick a valid date and time'); return; }
    if (end && end.getTime() > Date.now() + 60_000) { setError("That entry would end in the future"); return; }
    if (start && end && start.getTime() > end.getTime() && newSeconds > 0) {
      setError("End time cannot be before start time");
      return;
    }

    const noteValue = note.trim() || null;
    const changed = (durationTouched && newSeconds !== oldSeconds) || whenTouched || noteValue !== (entry.note || null);
    if (!changed) { onDone(); return; }

    try {
      await update.mutateAsync({
        taskId,
        entryId: entry.id,
        durationSeconds: newSeconds !== oldSeconds ? newSeconds : undefined,
        startedAt: start ? start.toISOString() : undefined,
        note: noteValue,
      });
      onDone();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg || 'Could not save that change');
    }
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); void save(); }
    // Escape closes the edit, not the whole popover.
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); e.nativeEvent.stopImmediatePropagation(); onDone(); }
  };

  const who = isMine ? 'your' : `${entry.user?.display_name || entry.user?.email || 'their'}’s`;
  const hint = error
    ? error
    : isNegative
      ? 'Negative time entries are disabled'
      : reduceOnly
      ? isWorkBlock
        ? `Block time · reduce only · up to ${formatHoursMinutes(Math.round(oldSeconds / 60)) || '<1m'}`
        : adminCapped
          ? `Admin reduce only · up to ${formatHoursMinutes(Math.round(oldSeconds / 60)) || '<1m'}`
          : `Reduce only · up to ${formatHoursMinutes(Math.round(oldSeconds / 60)) || '<1m'}`
      : durationTouched && newSeconds !== oldSeconds
        ? `${raising ? '+' : '−'}${formatHoursMinutes(Math.abs(Math.round((newSeconds - oldSeconds) / 60))) || '<1m'} on ${who} entry`
        : 'Enter to save';

  return (
    <li ref={rowRef} className="tp-edit" onKeyDown={onKey}>
      <div className="tp-row">
        <label className="tp-label" htmlFor={`tp-edit-dur-${entry.id}`}>Time</label>
        <div className="tp-row-main">
          <input
            id={`tp-edit-dur-${entry.id}`}
            ref={durationRef}
            value={duration}
            onChange={(e) => handleDurationChange(e.target.value)}
            className="tp-input tp-input-sm"
            aria-invalid={(durationTouched && invalid) || blocked}
            placeholder="1h 30m"
          />
        </div>
      </div>
      <div className="tp-row">
        <label className="tp-label" htmlFor={`tp-edit-start-time-${entry.id}`}>Started</label>
        <div className="tp-row-main">
          <input
            id={`tp-edit-start-time-${entry.id}`}
            type="time"
            value={startTimeValue}
            onChange={(e) => handleStartTimeChange(e.target.value)}
            className="tp-input tp-input-time"
          />
          <input
            id={`tp-edit-start-date-${entry.id}`}
            type="date"
            value={startDateValue}
            max={toDateInputValue(new Date())}
            onChange={(e) => handleStartDateChange(e.target.value)}
            className="tp-input tp-input-date"
          />
        </div>
      </div>
      <div className="tp-row">
        <label className="tp-label" htmlFor={`tp-edit-end-time-${entry.id}`}>Ended</label>
        <div className="tp-row-main">
          <input
            id={`tp-edit-end-time-${entry.id}`}
            type="time"
            value={endTimeValue}
            onChange={(e) => handleEndTimeChange(e.target.value)}
            className="tp-input tp-input-time"
          />
          <input
            id={`tp-edit-end-date-${entry.id}`}
            type="date"
            value={endDateValue}
            max={toDateInputValue(new Date())}
            onChange={(e) => handleEndDateChange(e.target.value)}
            className="tp-input tp-input-date"
          />
        </div>
      </div>
      <div className="tp-row">
        <label className="tp-label" htmlFor={`tp-edit-note-${entry.id}`}>Note</label>
        <div className="tp-row-main">
          <input
            id={`tp-edit-note-${entry.id}`}
            value={note}
            maxLength={500}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional"
            className="tp-input tp-input-sm"
          />
        </div>
      </div>
      <div className="tp-edit-foot">
        <span className={`tp-foot-hint${error || blocked ? ' is-bad' : ''}`}>
          {blocked && !error ? blockedMsg : hint}
        </span>
        <button type="button" className="tp-btn-ghost" onClick={onDone}>Cancel</button>
        <button
          type="button"
          className="tp-btn"
          disabled={(durationTouched && invalid) || blocked || update.isPending}
          onClick={() => void save()}
        >
          {update.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </li>
  );
}
