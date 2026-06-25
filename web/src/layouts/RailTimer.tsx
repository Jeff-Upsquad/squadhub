import { useEffect, useState } from 'react';
import type { TimerType } from '@squadhub/shared';
import { useActiveTimer, useTimeStats } from '../hooks/useTimer';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { useIsPartner } from '../hooks/useUserType';

/**
 * Live timer chip pinned to the far-left rail. Mirrors the My-Home hero clock
 * (same per-user timer context — 'partners'/'teammates'), so whatever the user
 * started there shows here and keeps ticking everywhere they navigate. It only
 * renders while a timer is actually running; clicking it jumps to My Home where
 * the full Work / Break / No-work controls live.
 */

const STATUS_TEXT: Record<TimerType, string> = {
  work: 'Working',
  break: 'On a break',
  no_work: 'Off task',
};

const STATUS_TAG: Record<TimerType, string> = {
  work: 'WORK',
  break: 'BREAK',
  no_work: 'OFF',
};

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Live session clock — h:mm:ss past an hour, mm:ss before. */
function fmtClock(total: number): string {
  const s = Math.max(0, total);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

/** Compact "4h 32m" — daily totals (tooltip only). */
function fmtDur(total: number): string {
  if (total <= 0) return '0m';
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

export default function RailTimer({ onOpen }: { onOpen: () => void }) {
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspace?.id);
  const isPartner = useIsPartner();
  const scope = { workspaceId, context: isPartner ? 'partners' : 'teammates' };
  const { data: activeRes } = useActiveTimer(scope);
  const { data: statsRes } = useTimeStats(scope);

  const activeSession = activeRes?.data?.session as
    | { id: string; timer_type: TimerType; start_time: string }
    | null
    | undefined;

  // Tick once a second only while a timer is live, so the clock + ring advance
  // in real time without polling the server.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!activeSession) return;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [activeSession?.id]);

  if (!workspaceId || !activeSession) return null;

  const type = activeSession.timer_type;
  const elapsed = Math.max(
    0,
    Math.floor((Date.now() - new Date(activeSession.start_time).getTime()) / 1000),
  );

  // Ring fill: progress toward the day's committed hours when known, else the
  // share of the current hour elapsed (so the ring always advances visibly).
  const stats = statsRes?.data;
  const commitment =
    typeof stats?.office_timing?.office_hours_total_seconds === 'number'
      ? stats.office_timing.office_hours_total_seconds
      : 0;
  const workToday = (stats?.today?.total_work_seconds || 0) + (type === 'work' ? elapsed : 0);
  const pct =
    commitment > 0
      ? Math.min(100, Math.round((workToday / commitment) * 100))
      : Math.round(((elapsed % 3600) / 3600) * 100);

  const tip =
    `${STATUS_TEXT[type]} · ${fmtClock(elapsed)}` +
    (commitment > 0 ? ` · ${fmtDur(workToday)} of ${fmtDur(commitment)}` : '') +
    ' — open timer';

  return (
    <button
      type="button"
      className="sh-rail-timer"
      data-state={type}
      style={{ '--rt-pct': pct } as React.CSSProperties}
      onClick={onOpen}
      title={tip}
      data-tip-anchor="rail.timer"
    >
      <span className="rt-ring">
        <span className="rt-core" />
      </span>
      <span className="rt-time">{fmtClock(elapsed)}</span>
      <span className="rt-tag">{STATUS_TAG[type]}</span>
    </button>
  );
}
