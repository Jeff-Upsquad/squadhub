import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getCurrentWindow, LogicalSize, LogicalPosition, currentMonitor } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-shell';
import { useCompanionTaskTimers } from './useCompanionTaskTimers';
import { useAuthStore } from './stores/authStore';
import {
  fetchWorkspaces,
  fetchActiveTimer,
  fetchTimerStats,
  startTimerSession,
  stopTimerSession,
  timerContextForUserType,
  type TimerType,
  type TimerSession,
  type TimerStats,
} from './services/api';
import { getRecentLists, type RecentList } from './services/recents';
import { formatDuration } from './timeDuration';
import { PanelIcon } from './PanelIcon';

// ── layout constants (match the Quick Creation Panel design) ─────────────────
const PILL_W = 460;
const PILL_H = 54;
const PANEL_W = 896;
const PANEL_H = 344;
const WEB_URL = 'https://squadhub.in';

// Poll cadence mirrors the web app (active every 20s, stats every 60s) so the
// notch reflects whatever work/break/no-work session the user is running in
// SquadHub, with a 1s local tick for the live clock between polls.
const ACTIVE_POLL_MS = 20_000;
const STATS_POLL_MS = 60_000;
const MARK_SECONDS = 1800; // surface the notch at each 30-minute mark
const AUTO_HIDE_MS = 8_000;

type View = 'collapsed' | 'expanded';
type Tab = 'timer' | 'add' | 'tray';

const MODE_META: Record<TimerType, { label: string; tag: string; color: string; status: string }> = {
  work: { label: 'Work', tag: 'WORK', color: '#39c66b', status: 'Working' },
  break: { label: 'Break', tag: 'BREAK', color: '#ffb340', status: 'On a break' },
  no_work: { label: 'No work', tag: 'OFF', color: '#ff453a', status: 'Off task' },
};
const MODES: TimerType[] = ['work', 'break', 'no_work'];

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
/** The open panel shows h:mm:ss; the collapsed task wing uses m:ss below an hour. */
function formatClock(totalSeconds: number, compact = false): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return compact && h === 0 ? `${pad(m)}:${pad(sec)}` : `${h}:${pad(m)}:${pad(sec)}`;
}
function startClockLabel(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  } catch {
    return '';
  }
}

export default function Notch() {
  const win = useMemo(() => getCurrentWindow(), []);
  const authHydrated = useAuthStore((s) => s.hydrated);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const userId = useAuthStore((s) => s.userId);

  const [view, setView] = useState<View>('collapsed');
  const [tab, setTab] = useState<Tab>('timer');
  const [session, setSession] = useState<TimerSession | null>(null);
  const [stats, setStats] = useState<TimerStats | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [recents, setRecents] = useState<RecentList[]>([]);
  const taskTimers = useCompanionTaskTimers();
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [taskPickerOpen, setTaskPickerOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const taskMarks = useRef(new Map<string, number>());
  const task = taskTimers.timers.find(t => t.taskId === selectedTaskId) || taskTimers.timers[0];
  const taskSeconds = task ? task.elapsedSeconds + (task.status === 'running'
    ? Math.max(0, Math.floor((now - task.sampledAt) / 1000)) : 0) : 0;

  // Resolved once per run: the workspace + context whose timer we mirror.
  const scopeRef = useRef<{ workspaceId: string; context: string } | null>(null);
  // Per-session 30-minute mark bookkeeping: the highest mark already surfaced,
  // seeded from the first poll so we never fire retroactively on launch.
  const markRef = useRef<{ sessionId: string | null; lastMark: number }>({ sessionId: null, lastMark: 0 });
  // The id of the last session we auto-surfaced the pill for, so a brand-new
  // session pops once (not on every poll) and the launch poll never pops.
  const seenSessionRef = useRef<string | null | undefined>(undefined);
  const autoHideRef = useRef<number | null>(null);
  const viewRef = useRef<View>('collapsed');
  viewRef.current = view;

  // ── window placement (top-center, hanging from the notch) ──────────────────
  const place = useCallback(async (w: number, h: number) => {
    try {
      await win.setSize(new LogicalSize(w, h));
      const mon = await currentMonitor();
      if (mon) {
        const sf = mon.scaleFactor || 1;
        const screenW = mon.size.width / sf;
        const x = mon.position.x / sf + Math.max(0, Math.round((screenW - w) / 2));
        await win.setPosition(new LogicalPosition(x, mon.position.y / sf));
      }
    } catch {
      /* placement is best-effort */
    }
  }, [win]);

  const cancelAutoHide = useCallback(() => {
    if (autoHideRef.current != null) {
      clearTimeout(autoHideRef.current);
      autoHideRef.current = null;
    }
  }, []);

  const dismiss = useCallback(() => {
    cancelAutoHide();
    void win.hide();
  }, [cancelAutoHide, win]);

  const surface = useCallback(
    async (nextView: View, autoHide = false) => {
      cancelAutoHide();
      setView(nextView);
      await place(nextView === 'expanded' ? PANEL_W : PILL_W, nextView === 'expanded' ? PANEL_H : PILL_H);
      try {
        await invoke('notch_show');
      } catch {
        await win.show().catch(() => {});
      }
      if (autoHide) {
        autoHideRef.current = window.setTimeout(() => {
          autoHideRef.current = null;
          // Only auto-hide if the user hasn't expanded it in the meantime.
          if (viewRef.current === 'collapsed') void win.hide();
        }, AUTO_HIDE_MS);
      }
    },
    [cancelAutoHide, place, win],
  );

  const expand = useCallback(() => {
    setTab('timer');
    void surface('expanded');
  }, [surface]);

  useEffect(() => {
    scopeRef.current = null;
    seenSessionRef.current = undefined;
    markRef.current = { sessionId: null, lastMark: 0 };
    taskMarks.current.clear();
    setSession(null);
    setStats(null);
    setActionError(null);
  }, [userId]);

  // ── resolve scope + hydrate auth ───────────────────────────────────────────
  useEffect(() => {
    useAuthStore.getState().hydrate();
    void getRecentLists().then(setRecents).catch(() => {});
  }, []);

  const resolveScope = useCallback(async (): Promise<{ workspaceId: string; context: string } | null> => {
    if (scopeRef.current) return scopeRef.current;
    try {
      const ownerId = useAuthStore.getState().userId;
      const workspaces = await fetchWorkspaces();
      if (ownerId !== useAuthStore.getState().userId) return null;
      const wid = workspaces[0]?.id;
      if (!wid) return null;
      const context = timerContextForUserType(useAuthStore.getState().userType);
      scopeRef.current = { workspaceId: wid, context };
      return scopeRef.current;
    } catch {
      return null;
    }
  }, []);

  // ── polling loops ───────────────────────────────────────────────────────────
  const pollActive = useCallback(async () => {
    if (!useAuthStore.getState().accessToken) return;
    const ownerId = useAuthStore.getState().userId;
    const scope = await resolveScope();
    if (!scope) return;
    try {
      const res = await fetchActiveTimer(scope.workspaceId, scope.context);
      if (ownerId === useAuthStore.getState().userId) setSession(res.session);
    } catch {
      /* keep last known state; next tick retries */
    }
  }, [resolveScope]);

  const pollStats = useCallback(async () => {
    if (!useAuthStore.getState().accessToken) return;
    const ownerId = useAuthStore.getState().userId;
    const scope = await resolveScope();
    if (!scope) return;
    try {
      const nextStats = await fetchTimerStats(scope.workspaceId, scope.context);
      if (ownerId === useAuthStore.getState().userId) setStats(nextStats);
    } catch {
      /* non-critical */
    }
  }, [resolveScope]);

  useEffect(() => {
    if (!authHydrated || !isAuthenticated) return;
    void pollActive();
    void pollStats();
    const a = window.setInterval(() => void pollActive(), ACTIVE_POLL_MS);
    const s = window.setInterval(() => void pollStats(), STATS_POLL_MS);
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      window.clearInterval(a);
      window.clearInterval(s);
      window.clearInterval(t);
    };
  }, [authHydrated, isAuthenticated, userId, pollActive, pollStats]);

  // ── derived live values ─────────────────────────────────────────────────────
  const elapsed = session ? Math.max(0, Math.floor((now - new Date(session.start_time).getTime()) / 1000)) : 0;
  const mode: TimerType | null = session?.timer_type ?? null;
  const meta = mode ? MODE_META[mode] : null;

  // ── react to timer state: menu-bar title, auto-surface, 30-min marks ────────
  useEffect(() => {
    if (!session || !meta) {
      // No running session → clear the tray clock and hide the notch.
      invoke('set_timer_title', { title: task?.status === 'running' ? `TASK ${formatClock(taskSeconds)}` : null }).catch(() => {});
      if (seenSessionRef.current !== null && !task) {
        seenSessionRef.current = null;
        dismiss();
      }
      markRef.current = { sessionId: null, lastMark: 0 };
      return;
    }

    // Live menu-bar clock, e.g. "WORK 1:23:45".
    invoke('set_timer_title', { title: `${meta.tag} ${formatClock(elapsed)}` }).catch(() => {});

    // Seed 30-minute marks on first sight of a session so we never fire for time
    // that elapsed before the companion was watching (e.g. right after launch).
    if (markRef.current.sessionId !== session.id) {
      markRef.current = { sessionId: session.id, lastMark: Math.floor(elapsed / MARK_SECONDS) };
    } else {
      const mark = Math.floor(elapsed / MARK_SECONDS);
      if (mark > markRef.current.lastMark) {
        markRef.current.lastMark = mark;
        const mins = mark * 30;
        invoke('send_notification', {
          title: `${meta.status} · ${formatClock(elapsed)}`,
          body: `You've been ${meta.status.toLowerCase()} for ${mins} minutes. Keep going or take a break.`,
          url: `${WEB_URL}/app`,
        }).catch(() => {});
        void surface('collapsed', true);
      }
    }

    // A newly-started session (not the launch poll) pops the pill briefly.
    if (seenSessionRef.current === undefined) {
      seenSessionRef.current = session.id; // launch: adopt silently
    } else if (seenSessionRef.current !== session.id) {
      seenSessionRef.current = session.id;
      void surface('collapsed', true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id, session?.timer_type, elapsed, task?.taskId, task?.status, taskSeconds]);

  useEffect(() => {
    for (const timer of taskTimers.timers) {
      const seconds = timer.elapsedSeconds + (timer.status === 'running'
        ? Math.max(0, Math.floor((now - timer.sampledAt) / 1000)) : 0);
      const mark = Math.floor(seconds / MARK_SECONDS);
      const previous = taskMarks.current.get(timer.sessionId);
      taskMarks.current.set(timer.sessionId, Math.max(previous ?? 0, mark));
      if (previous != null && mark > previous && timer.status === 'running') {
        invoke('send_notification', {
          title: `${timer.taskTitle} · ${formatClock(seconds)}`,
          body: `This task timer has reached ${mark * 30} minutes.`,
          url: `${WEB_URL}/app`,
        }).catch(() => {});
        void surface('collapsed', true);
      }
    }
  }, [taskTimers.timers, now, surface]);

  // ── react to Rust events (tray click / menu) ────────────────────────────────
  useEffect(() => {
    const unexpand = win.listen('notch:expand', () => {
      cancelAutoHide();
      void useAuthStore.getState().hydrate();
      setTab('timer');
      setView('expanded');
      void place(PANEL_W, PANEL_H);
    });
    return () => {
      void unexpand.then((f) => f());
    };
  }, [win, place, cancelAutoHide]);

  // Click-away dismiss (menu-bar popover behaviour). Once the notch covers the
  // tray it can't be toggled from there, so losing focus hides it — the menu-bar
  // clock stays as the always-on indicator. A short defer swallows the transient
  // blur that fires as the panel is first ordered front.
  useEffect(() => {
    let t: number | null = null;
    const un = win.onFocusChanged(({ payload: focused }) => {
      if (focused) {
        if (t != null) { clearTimeout(t); t = null; }
      } else {
        if (t != null) clearTimeout(t);
        t = window.setTimeout(() => {
          t = null;
          cancelAutoHide();
          void win.hide();
        }, 180);
      }
    });
    return () => {
      if (t != null) clearTimeout(t);
      void un.then((f) => f());
    };
  }, [win, cancelAutoHide]);

  // ── actions ─────────────────────────────────────────────────────────────────
  const switchMode = useCallback(
    async (next: TimerType) => {
      if (busy || next === mode) return;
      const scope = await resolveScope();
      if (!scope) return;
      setBusy(true);
      setActionError(null);
      try {
        if (next !== 'work' && taskTimers.timers.some(t => t.status === 'running')) {
          await taskTimers.control('pause_all');
        }
        const s = await startTimerSession(next, scope.workspaceId, scope.context);
        setSession(s);
        markRef.current = { sessionId: s.id, lastMark: 0 };
        seenSessionRef.current = s.id;
        void pollStats();
      } catch (error) {
        setActionError(error instanceof Error ? error.message : 'Could not switch timers.');
      } finally {
        setBusy(false);
      }
    },
    [busy, mode, resolveScope, pollStats, taskTimers.timers, taskTimers.control],
  );

  const stopAll = useCallback(async () => {
    if (busy || !session) return;
    const scope = await resolveScope();
    if (!scope) return;
    setBusy(true);
    setActionError(null);
    try {
      await stopTimerSession(session.id, scope.workspaceId, scope.context);
      setSession(null);
      void pollStats();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not stop the timer.');
    } finally {
      setBusy(false);
    }
  }, [busy, session, resolveScope, pollStats]);

  const openQuickAdd = useCallback(() => {
    invoke('quick_add_show').catch(() => {});
    dismiss();
  }, [dismiss]);

  const controlTask = async (action: 'pause' | 'resume' | 'stop') => {
    if (!task || busy) return;
    setBusy(true);
    setActionError(null);
    try {
      await taskTimers.control(action, task.taskId);
      await pollActive();
      await pollStats();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not update the task timer.');
    } finally { setBusy(false); }
  };

  // ── Today totals (today's logged + the live current segment) ────────────────
  const today = stats?.today;
  const liveFor = (t: TimerType) => (mode === t ? elapsed : 0);
  const workSec = (today?.total_work_seconds || 0) + liveFor('work');
  const breakSec = (today?.total_break_seconds || 0) + liveFor('break');
  const offSec = (today?.total_no_work_seconds || 0) + liveFor('no_work');
  const totalSec = Math.max(1, workSec + breakSec + offSec);

  // ── render: collapsed pill ──────────────────────────────────────────────────
  if (view === 'collapsed') {
    return (
      <div className="notch-root">
        <button
          type="button"
          className="notch-pill"
          onClick={expand}
          title="Open timer"
          aria-label="Open timer"
        >
          <span className="notch-wing notch-wing-left">
            {meta ? (
              <>
                <span className="notch-dot" style={{ background: meta.color }} />
                <span className="notch-state" style={{ color: meta.color }}>{meta.status}</span>
              </>
            ) : (
              <span className="notch-state notch-muted">{task ? task.status === 'running' ? 'Task running' : 'Task paused' : 'No timer'}</span>
            )}
          </span>
          <span className="notch-wing notch-wing-right">
            {task && <span className="notch-pill-task">{task.taskTitle}</span>}
            <span className="notch-clock">{task ? formatClock(taskSeconds, true) : meta ? formatClock(elapsed, true) : '—'}</span>
          </span>
        </button>
      </div>
    );
  }

  // ── render: expanded panel (Timer / Add task / Tray) ────────────────────────
  return (
    <div className="notch-root">
      <div className="notch-panel">
        <div className="notch-head">
          <div className="notch-tabs" role="tablist" aria-label="Companion views">
            <button type="button" role="tab" aria-selected={tab === 'timer'} className={`notch-tab${tab === 'timer' ? ' active' : ''}`} onClick={() => setTab('timer')}>
              <PanelIcon name="timer" /> Timer
            </button>
            <button type="button" role="tab" aria-selected={tab === 'add'} className={`notch-tab${tab === 'add' ? ' active' : ''}`} onClick={() => setTab('add')}>
              <PanelIcon name="add" /> Add task
            </button>
            <button type="button" role="tab" aria-selected={tab === 'tray'} className={`notch-tab${tab === 'tray' ? ' active' : ''}`} onClick={() => setTab('tray')}>
              <PanelIcon name="tray" /> Tray
            </button>
          </div>
          <button
            type="button"
            className="notch-collapse"
            onClick={() => surface('collapsed')}
            title="Collapse"
            aria-label="Collapse"
          >
            <PanelIcon name="collapse" />
          </button>
        </div>

        {actionError && <div className="notch-action-error" role="alert">{actionError}</div>}
        {tab === 'timer' && (
          <div className="notch-timer">
            {/* Left: Work / Break / No-work + the live session clock */}
            <div className="notch-col notch-col-mode">
              <div className="notch-seg">
                {MODES.map((m) => (
                  <button
                    key={m}
                    type="button"
                    className={`notch-seg-btn${mode === m ? ' active' : ''}`}
                    data-mode={m}
                    disabled={busy}
                    onClick={() => void switchMode(m)}
                  >
                    <span className="notch-seg-dot" style={{ background: MODE_META[m].color }} />
                    {MODE_META[m].label}
                  </button>
                ))}
              </div>
              {meta ? (
                <>
                  <div className="notch-state-line" style={{ color: meta.color }}>
                    <span className="notch-dot" style={{ background: meta.color }} /> {meta.status}
                  </div>
                  <div className="notch-bigclock">{formatClock(elapsed)}</div>
                  <div className="notch-sub">Since {startClockLabel(session!.start_time)} · resets when you switch</div>
                </>
              ) : (
                <>
                  <div className="notch-state-line notch-muted">No timer running</div>
                  <div className="notch-bigclock notch-muted">0:00:00</div>
                  <div className="notch-sub">Pick Work, Break or No work to start the clock.</div>
                </>
              )}
            </div>

            <div className="notch-divider" aria-hidden="true" />

            {/* Middle: task timer (companion-started tasks surface here) */}
            <div className="notch-col notch-col-task">
              <div className="notch-col-label">Task timer</div>
              {task ? (
                <>
                  <div className="notch-task-info">
                    <div className="notch-task-title" title={task.taskTitle}>{task.taskTitle}</div>
                    <div className="notch-task-meta">
                      {task.listName || 'SquadHub task'}
                      {task.estimateSeconds ? ` · est. ${formatDuration(Math.round(task.estimateSeconds / 60))}` : ''}
                    </div>
                  </div>
                  <div className="notch-task-time">
                    <span>{formatClock(taskSeconds)}</span>
                    <small className={task.status}>{task.status === 'running' ? 'Running' : 'Paused'}</small>
                  </div>
                  {task.estimateSeconds ? (
                    <div className="notch-task-progress" role="progressbar" aria-label="Time against estimate"
                      aria-valuemin={0} aria-valuemax={task.estimateSeconds} aria-valuenow={Math.min(taskSeconds, task.estimateSeconds)}>
                      <span style={{ width: `${Math.min(100, taskSeconds / task.estimateSeconds * 100)}%` }} />
                    </div>
                  ) : <div className="notch-task-progress" aria-hidden="true" />}
                  <div className="notch-task-actions">
                    <button type="button" className="notch-task-play" disabled={busy || !taskTimers.available}
                      onClick={() => void controlTask(task.status === 'running' ? 'pause' : 'resume')}
                      title={task.status === 'running' ? 'Pause' : 'Resume'} aria-label={task.status === 'running' ? 'Pause task timer' : 'Resume task timer'}>
                      <PanelIcon name={task.status === 'running' ? 'pause' : 'play'} />
                    </button>
                    <button type="button" className="notch-task-stop" disabled={busy || !taskTimers.available}
                      onClick={() => void controlTask('stop')} title="Stop and log time" aria-label="Stop task timer and log time">
                      <PanelIcon name="stop" />
                    </button>
                    <button type="button" className="notch-task-switch" disabled={busy}
                      aria-expanded={taskPickerOpen} onClick={() => setTaskPickerOpen(v => !v)}>Switch task</button>
                  </div>
                  {taskPickerOpen && <div className="notch-task-picker" aria-label="Task timers">
                    {taskTimers.timers.map(timer => <button type="button" key={timer.taskId}
                      onClick={() => { setSelectedTaskId(timer.taskId); setTaskPickerOpen(false); }}>
                      {timer.taskTitle}<small>{timer.status}</small>
                    </button>)}
                    <button type="button" onClick={() => { void open(`${WEB_URL}/app`); dismiss(); }}>Choose another task in SquadHub ↗</button>
                  </div>}
                </>
              ) : (
                <div className="notch-task-empty">
                  <div className="notch-task-empty-title">{taskTimers.available ? 'No task timer running' : 'Connect your task timers'}</div>
                  <div className="notch-sub">{taskTimers.available
                    ? 'Start one from a task in SquadHub, or use “Start timer” when adding a task.'
                    : 'Open SquadHub in your browser to see and control your task timers here.'}</div>
                  <button type="button" className="notch-ghost-btn" onClick={() => { void open(`${WEB_URL}/app`); dismiss(); }}>Open SquadHub ↗</button>
                </div>
              )}
            </div>

            <div className="notch-divider" aria-hidden="true" />

            {/* Right: Today — work / break / no-work totals */}
            <div className="notch-col notch-col-today">
              <div className="notch-col-label">Today</div>
              <div className="notch-bar" aria-hidden>
                <span className="notch-bar-seg" style={{ width: `${(workSec / totalSec) * 100}%`, background: MODE_META.work.color }} />
                <span className="notch-bar-seg" style={{ width: `${(breakSec / totalSec) * 100}%`, background: MODE_META.break.color }} />
                <span className="notch-bar-seg" style={{ width: `${(offSec / totalSec) * 100}%`, background: MODE_META.no_work.color }} />
              </div>
              <ul className="notch-today-list">
                <li><span className="notch-dot" style={{ background: MODE_META.work.color }} /> Work <b>{formatDuration(Math.round(workSec / 60))}</b></li>
                <li><span className="notch-dot" style={{ background: MODE_META.break.color }} /> Break <b>{formatDuration(Math.round(breakSec / 60))}</b></li>
                <li><span className="notch-dot" style={{ background: MODE_META.no_work.color }} /> No work <b>{formatDuration(Math.round(offSec / 60))}</b></li>
              </ul>
              <div className="notch-foot">
                {session && (
                  <button type="button" className="notch-stop-btn" disabled={busy} onClick={() => void stopAll()}>
                    <span className="notch-stop-sq" aria-hidden /> Stop
                  </button>
                )}
                <span className="notch-sync">Synced with your timesheet</span>
              </div>
            </div>
          </div>
        )}

        {tab === 'add' && (
          <div className="notch-add">
            <div className="notch-add-title">Quick add a task</div>
            <p className="notch-sub">
              Capture anything into SquadHub — with where, who, priority, dates, labels and an
              optional running timer.
            </p>
            <button type="button" className="notch-primary-btn" onClick={openQuickAdd}>Open quick add</button>
            <div className="notch-add-hint">or press ⌘⇧T anywhere</div>
          </div>
        )}

        {tab === 'tray' && (
          <div className="notch-tray">
            <div className="notch-col-label">Now</div>
            {session && meta ? (
              <div className="notch-tray-row">
                <span className="notch-dot" style={{ background: meta.color }} />
                <span className="notch-tray-main">{meta.status}</span>
                <span className="notch-clock">{formatClock(elapsed)}</span>
                <button type="button" className="notch-stop-btn" disabled={busy} onClick={() => void stopAll()}>
                  <span className="notch-stop-sq" aria-hidden /> Stop
                </button>
              </div>
            ) : (
              <div className="notch-sub">No timer running.</div>
            )}
            <div className="notch-col-label" style={{ marginTop: 14 }}>Recent lists</div>
            {recents.length ? (
              <ul className="notch-recents">
                {recents.slice(0, 5).map((r) => (
                  <li key={r.id}>{r.name}</li>
                ))}
              </ul>
            ) : (
              <div className="notch-sub">Lists you add to will show up here.</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
