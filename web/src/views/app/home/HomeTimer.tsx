import { useEffect, useState } from 'react';
import type { TimerType } from '@squadhub/shared';
import { useActiveTimer, useTimeStats, useStartTimer, useStopTimer } from '../../../hooks/useTimer';
import { useWorkspaceStore } from '../../../stores/workspaceStore';
import { useIsPartner } from '../../../hooks/useUserType';

/**
 * Hero work-clock for My Home. Surfaces the SAME Work / Break / No-work timers
 * as the user's Daily Check-In → Time Tracking tab: it uses the same per-user
 * timer context the check-in section does ('partners' for partner users,
 * 'teammates' for internal staff — see MainLayout), so a timer started here is
 * the one running there and vice-versa. The day meter fills toward the user's
 * office-hours commitment and ticks live while a timer runs.
 */

const TIMERS: { type: TimerType; label: string }[] = [
  { type: 'work', label: 'Work' },
  { type: 'break', label: 'Break' },
  { type: 'no_work', label: 'No work' },
];

const STATUS_TEXT: Record<TimerType, string> = {
  work: 'Working',
  break: 'On a break',
  no_work: 'Off task',
};

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Live session clock — h:mm:ss past an hour, mm:ss before, so it stays
 *  compact enough to sit inside an equal-width control button. */
function fmtClock(total: number): string {
  const s = Math.max(0, total);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

/** Compact "4h 32m" — daily totals. */
function fmtDur(total: number): string {
  if (total <= 0) return '0m';
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

function CtrlIcon({ running }: { running: boolean }) {
  return running ? (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <rect x="6.5" y="6.5" width="11" height="11" rx="2.5" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M8 5.4v13.2a1 1 0 0 0 1.52.85l10.5-6.6a1 1 0 0 0 0-1.7L9.52 4.55A1 1 0 0 0 8 5.4z" />
    </svg>
  );
}

export default function HomeTimer() {
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspace?.id);
  // Match the context the user's own Daily Check-In uses (MainLayout passes
  // 'partners'/'teammates'), so the home clock and the Check-In Time-Tracking
  // tab read and write the same timer.
  const isPartner = useIsPartner();
  const scope = { workspaceId, context: isPartner ? 'partners' : 'teammates' };
  const { data: activeRes } = useActiveTimer(scope);
  const { data: statsRes } = useTimeStats(scope);
  const startTimer = useStartTimer(scope);
  const stopTimer = useStopTimer(scope);

  const activeSession = activeRes?.data?.session as
    | { id: string; timer_type: TimerType; start_time: string }
    | null
    | undefined;
  const activeType = activeSession?.timer_type;
  const stats = statsRes?.data;
  const today = stats?.today;
  const office = stats?.office_timing;

  // Tick once a second only while a timer is live, so the clock + meter grow
  // in real time without polling the server.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!activeSession) return;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [activeSession?.id]);

  if (!workspaceId) return null;

  const elapsed = activeSession
    ? Math.max(0, Math.floor((Date.now() - new Date(activeSession.start_time).getTime()) / 1000))
    : 0;

  // Live totals = today's committed seconds + the running session's elapsed.
  const work = (today?.total_work_seconds || 0) + (activeType === 'work' ? elapsed : 0);
  const brk = (today?.total_break_seconds || 0) + (activeType === 'break' ? elapsed : 0);
  const noWork = (today?.total_no_work_seconds || 0) + (activeType === 'no_work' ? elapsed : 0);

  const commitment =
    typeof office?.office_hours_total_seconds === 'number' && office.office_hours_total_seconds > 0
      ? office.office_hours_total_seconds
      : 0;
  const hasCommitment = commitment > 0;
  const tracked = work + brk + noWork;
  const denom = hasCommitment ? commitment : Math.max(tracked, 1);

  // Segments are clamped so the three never overflow 100% of the track.
  const workPct = Math.min((work / denom) * 100, 100);
  const breakPct = Math.min((brk / denom) * 100, 100 - workPct);
  const noWorkPct = Math.min((noWork / denom) * 100, 100 - workPct - breakPct);
  const workOfCommit = hasCommitment ? Math.round((work / commitment) * 100) : null;

  const busy = startTimer.isPending || stopTimer.isPending;
  const handleClick = (type: TimerType) => {
    if (busy) return;
    if (activeType === type) stopTimer.mutate(activeSession?.id);
    else startTimer.mutate(type);
  };

  return (
    <div className="hm-timer" data-state={activeType || 'idle'}>
      {/* Readout row — worked total · live progress bar · commitment + status */}
      <div className="hm-timer-meter">
        <span className="worked">
          {fmtDur(work)}
          <em>worked</em>
        </span>
        <div className="hm-timer-bar" data-running={!!activeSession}>
          <div className="seg work" data-live={activeType === 'work'} style={{ width: `${workPct}%` }} />
          <div className="seg break" data-live={activeType === 'break'} style={{ width: `${breakPct}%` }} />
          <div className="seg nowork" data-live={activeType === 'no_work'} style={{ width: `${noWorkPct}%` }} />
        </div>
        <div className="hm-timer-readout">
          {hasCommitment && (
            <span className="commit">
              of {fmtDur(commitment)}
              {workOfCommit !== null && ` · ${workOfCommit}%`}
            </span>
          )}
          <span className="hm-timer-status" data-running={!!activeSession}>
            <span className="hm-timer-dot" />
            {activeSession ? STATUS_TEXT[activeType as TimerType] : 'Not tracking'}
          </span>
        </div>
      </div>

      <div className="hm-timer-ctrls">
        {TIMERS.map((cfg) => {
          const on = activeType === cfg.type;
          return (
            <button
              key={cfg.type}
              type="button"
              className="hm-timer-btn"
              data-type={cfg.type}
              data-on={on}
              disabled={busy}
              onClick={() => handleClick(cfg.type)}
              title={on ? `Stop ${cfg.label.toLowerCase()}` : `Start ${cfg.label.toLowerCase()}`}
            >
              <span className="ic">
                <CtrlIcon running={on} />
              </span>
              <span className="lb">{on ? fmtClock(elapsed) : cfg.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
