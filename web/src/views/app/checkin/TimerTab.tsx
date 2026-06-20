import type { TimerType } from '@squadhub/shared';
import { useActiveTimer, useTimeStats, useStartTimer, useStopTimer } from '../../../hooks/useTimer';
import { useWorkspaceStore } from '../../../stores/workspaceStore';
import TimerDisplay from './TimerDisplay';
import TodayTimeSummary from './TodayTimeSummary';
import TodaySessionsList from './TodaySessionsList';

function formatOfficeHours(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

// Converts a "HH:MM" 24-hour time string to a 12-hour "h:MM AM/PM" string.
function formatTime12h(time: string): string {
  const [hStr, mStr = '00'] = time.split(':');
  const hour24 = parseInt(hStr, 10);
  if (Number.isNaN(hour24)) return time;
  const ampm = hour24 >= 12 ? 'PM' : 'AM';
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:${mStr} ${ampm}`;
}

const TIMER_CONFIG: { type: TimerType; label: string; icon: string; color: string; activeColor: string; activeBg: string }[] = [
  {
    type: 'work',
    label: 'Work Time',
    icon: 'M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z',
    color: 'border-blue-200 text-blue-700 hover:bg-blue-50 dark:border-blue-500/40 dark:text-blue-300 dark:hover:bg-blue-500/10',
    activeColor: 'text-white',
    activeBg: 'bg-blue-600 border-blue-600',
  },
  {
    type: 'break',
    label: 'Break',
    icon: 'M15.75 10.5V6a3.75 3.75 0 10-7.5 0v4.5m11.356-1.993l1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 01-1.12-1.243l1.264-12A1.125 1.125 0 015.513 7.5h12.974c.576 0 1.059.435 1.119 1.007zM8.625 10.5a.375.375 0 11-.75 0 .375.375 0 01.75 0zm7.5 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z',
    color: 'border-amber-200 text-amber-700 hover:bg-amber-50 dark:border-amber-500/40 dark:text-amber-300 dark:hover:bg-amber-500/10',
    activeColor: 'text-white',
    activeBg: 'bg-amber-500 border-amber-500',
  },
  {
    type: 'no_work',
    label: 'No Work',
    icon: 'M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636',
    color: 'border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-white/5',
    activeColor: 'text-white',
    activeBg: 'bg-gray-600 border-gray-600',
  },
];

export default function TimerTab({ context = 'default' }: { context?: string }) {
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspace?.id);
  const scope = { workspaceId, context };
  const { data: activeRes } = useActiveTimer(scope);
  const { data: statsRes } = useTimeStats(scope);
  const startTimer = useStartTimer(scope);
  const stopTimer = useStopTimer(scope);

  const activeSession = activeRes?.data?.session;
  const activeType = activeSession?.timer_type as TimerType | undefined;
  const stats = statsRes?.data;
  const todaySummary = stats?.today;
  const officeTiming = stats?.office_timing;

  // Weekly chart data
  const weekSummaries = stats?.week_summaries || [];
  const weekMaxSeconds = officeTiming?.office_hours_total_seconds ?? 10 * 3600;

  const officeHoursLabel = officeTiming
    ? formatOfficeHours(officeTiming.office_hours_total_seconds)
    : null;

  const handleTimerClick = (type: TimerType) => {
    if (activeType === type) {
      // Stop
      stopTimer.mutate(activeSession?.id);
    } else {
      // Start (auto-stops current)
      startTimer.mutate(type);
    }
  };

  const isPending = startTimer.isPending || stopTimer.isPending;

  return (
    <div className="space-y-5 p-5">
      {officeTiming && (
        <div className="rounded-xl border border-divider bg-surface px-4 py-3">
          <div className="flex items-center gap-2">
            <svg className="h-4 w-4 text-foreground-muted" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div className="text-sm font-medium text-foreground">{officeTiming.label}</div>
          </div>
          <div className="mt-0.5 text-xs text-foreground-muted">
            {formatTime12h(officeTiming.from_time)} – {formatTime12h(officeTiming.to_time)}
            {officeHoursLabel && <> · <span className="text-foreground">{officeHoursLabel}</span></>}
          </div>
        </div>
      )}

      {/* Timer buttons */}
      <div className="flex items-stretch gap-2">
        {TIMER_CONFIG.map((cfg) => {
          const isActive = activeType === cfg.type;
          return (
            <button
              key={cfg.type}
              onClick={() => handleTimerClick(cfg.type)}
              disabled={isPending}
              className={`relative flex flex-1 flex-col items-center justify-center gap-1.5 rounded-xl border-2 px-2 py-3 text-center transition disabled:opacity-50 ${
                isActive ? `${cfg.activeBg} ${cfg.activeColor}` : cfg.color
              }`}
            >
              {isActive && (
                <span className="absolute right-2 top-2 flex h-2.5 w-2.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-white" />
                </span>
              )}
              <svg className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={cfg.icon} />
              </svg>
              <span className="text-xs font-medium leading-tight">
                {isActive ? `Stop ${cfg.label}` : `Start ${cfg.label}`}
              </span>
              {isActive && activeSession && (
                <TimerDisplay startTime={activeSession.start_time} className="text-xs" />
              )}
            </button>
          );
        })}
      </div>

      {/* Today's summary */}
      <TodayTimeSummary
        workSeconds={todaySummary?.total_work_seconds || 0}
        breakSeconds={todaySummary?.total_break_seconds || 0}
        noWorkSeconds={todaySummary?.total_no_work_seconds || 0}
        officeHoursTotalSeconds={officeTiming?.office_hours_total_seconds}
        maxBreakMinutes={officeTiming?.max_break_minutes}
      />

      {/* Today's sessions (editable per role) */}
      <TodaySessionsList
        sessions={stats?.today_sessions || []}
        canEdit={stats?.time_log_edit?.can_edit === true}
        windowHours={stats?.time_log_edit?.window_hours ?? 0}
        workspaceId={workspaceId}
        context={context}
      />

      {/* Weekly mini chart */}
      {weekSummaries.length > 0 && (
        <div className="rounded-xl border border-divider bg-surface-alt p-4">
          <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-foreground-dim">This Week</h4>
          <div className="flex items-end gap-1.5" style={{ height: 80 }}>
            {weekSummaries.map((day: any) => {
              const total = day.total_work_seconds + day.total_break_seconds + day.total_no_work_seconds;
              const maxHours = weekMaxSeconds; // office-hours if configured, else 10h fallback
              const heightPct = Math.min((total / maxHours) * 100, 100);
              const date = new Date(day.date + 'T00:00:00Z');
              const dayName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getUTCDay()];
              return (
                <div key={day.date} className="flex flex-1 flex-col items-center gap-1">
                  <div className="flex w-full flex-col items-center" style={{ height: 60 }}>
                    <div className="mt-auto w-full max-w-[20px]">
                      <div
                        className="w-full rounded-t bg-blue-500"
                        style={{ height: `${(day.total_work_seconds / maxHours) * 60}px` }}
                      />
                      <div
                        className="w-full bg-amber-400"
                        style={{ height: `${(day.total_break_seconds / maxHours) * 60}px` }}
                      />
                      <div
                        className="w-full rounded-b bg-gray-400"
                        style={{ height: `${(day.total_no_work_seconds / maxHours) * 60}px` }}
                      />
                    </div>
                  </div>
                  <span className="text-[9px] text-foreground-dim">{dayName}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
