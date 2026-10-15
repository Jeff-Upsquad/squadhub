import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getCurrentWindow, LogicalSize, LogicalPosition, currentMonitor } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
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

// ── layout constants (match the Quick Creation Panel design) ─────────────────
const PILL_W = 460;
const PILL_H = 54;
const PANEL_W = 920;
const PANEL_H = 300;
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
  work: { label: 'Work', tag: 'WORK', color: '#22c55e', status: 'Working' },
  break: { label: 'Break', tag: 'BREAK', color: '#f59e0b', status: 'On a break' },
  no_work: { label: 'No work', tag: 'OFF', color: '#ef4444', status: 'Off task' },
};
const MODES: TimerType[] = ['work', 'break', 'no_work'];

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
/** h:mm:ss past an hour, m:ss before — mirrors RailTimer's fmtClock. */
function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
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

  const [view, setView] = useState<View>('collapsed');
  const [tab, setTab] = useState<Tab>('timer');
  const [session, setSession] = useState<TimerSession | null>(null);
  const [stats, setStats] = useState<TimerStats | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [recents, setRecents] = useState<RecentList[]>([]);

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
        const x = Math.max(0, Math.round((screenW - w) / 2));
        await win.setPosition(new LogicalPosition(x, 0));
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

  // ── resolve scope + hydrate auth ───────────────────────────────────────────
  useEffect(() => {
    useAuthStore.getState().hydrate();
    void getRecentLists().then(setRecents).catch(() => {});
  }, []);

  const resolveScope = useCallback(async (): Promise<{ workspaceId: string; context: string } | null> => {
    if (scopeRef.current) return scopeRef.current;
    try {
      const workspaces = await fetchWorkspaces();
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
    const scope = await resolveScope();
    if (!scope) return;
    try {
      const res = await fetchActiveTimer(scope.workspaceId, scope.context);
      setSession(res.session);
    } catch {
      /* keep last known state; next tick retries */
    }
  }, [resolveScope]);

  const pollStats = useCallback(async () => {
    if (!useAuthStore.getState().accessToken) return;
    const scope = await resolveScope();
    if (!scope) return;
    try {
      setStats(await fetchTimerStats(scope.workspaceId, scope.context));
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
  }, [authHydrated, isAuthenticated, pollActive, pollStats]);

  // ── derived live values ─────────────────────────────────────────────────────
  const elapsed = session ? Math.max(0, Math.floor((now - new Date(session.start_time).getTime()) / 1000)) : 0;
  const mode: TimerType | null = session?.timer_type ?? null;
  const meta = mode ? MODE_META[mode] : null;

  // ── react to timer state: menu-bar title, auto-surface, 30-min marks ────────
  useEffect(() => {
    if (!session || !meta) {
      // No running session → clear the tray clock and hide the notch.
      invoke('set_timer_title', { title: null }).catch(() => {});
      if (seenSessionRef.current !== null) {
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
  }, [session?.id, session?.timer_type, elapsed]);

  // ── react to Rust events (tray click / menu) ────────────────────────────────
  useEffect(() => {
    const unexpand = win.listen('notch:expand', () => {
      cancelAutoHide();
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
      try {
        const s = await startTimerSession(next, scope.workspaceId, scope.context);
        setSession(s);
        markRef.current = { sessionId: s.id, lastMark: 0 };
        seenSessionRef.current = s.id;
        void pollStats();
      } catch {
        /* surfaced by the unchanged UI; a later poll reconciles */
      } finally {
        setBusy(false);
      }
    },
    [busy, mode, resolveScope, pollStats],
  );

  const stopAll = useCallback(async () => {
    if (busy || !session) return;
    const scope = await resolveScope();
    if (!scope) return;
    setBusy(true);
    try {
      await stopTimerSession(session.id, scope.workspaceId, scope.context);
      setSession(null);
      void pollStats();
    } catch {
      /* a later poll reconciles */
    } finally {
      setBusy(false);
    }
  }, [busy, session, resolveScope, pollStats]);

  const openQuickAdd = useCallback(() => {
    invoke('quick_add_show').catch(() => {});
    dismiss();
  }, [dismiss]);

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
              <span className="notch-state notch-muted">No timer</span>
            )}
          </span>
          <span className="notch-wing notch-wing-right">
            <span className="notch-clock">{meta ? formatClock(elapsed) : '—'}</span>
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
          <div className="notch-tabs">
            <button type="button" className={`notch-tab${tab === 'timer' ? ' active' : ''}`} onClick={() => setTab('timer')}>
              <span className="notch-tab-ico" aria-hidden>⏱</span> Timer
            </button>
            <button type="button" className={`notch-tab${tab === 'add' ? ' active' : ''}`} onClick={() => setTab('add')}>
              <span className="notch-tab-ico" aria-hidden>＋</span> Add task
            </button>
            <button type="button" className={`notch-tab${tab === 'tray' ? ' active' : ''}`} onClick={() => setTab('tray')}>
              <span className="notch-tab-ico" aria-hidden>▦</span> Tray
            </button>
          </div>
          <button
            type="button"
            className="notch-collapse"
            onClick={() => surface('collapsed')}
            title="Collapse"
            aria-label="Collapse"
          >
            ⌃
          </button>
        </div>

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

            {/* Middle: task timer (companion-started tasks surface here) */}
            <div className="notch-col notch-col-task">
              <div className="notch-col-label">Task timer</div>
              <div className="notch-task-empty">
                <div className="notch-task-empty-title">No task timer running</div>
                <div className="notch-sub">Start one with “timer on” from the Add-task panel.</div>
                <button type="button" className="notch-ghost-btn" onClick={openQuickAdd}>Add a task</button>
              </div>
            </div>

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
