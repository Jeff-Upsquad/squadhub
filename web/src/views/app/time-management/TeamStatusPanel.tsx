import type { TeamTimerStatus } from '@squadhub/shared';
import TimerDisplay from '../checkin/TimerDisplay';

const TYPE_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  work: { label: 'Working', color: 'text-blue-700', bg: 'bg-blue-100' },
  break: { label: 'On Break', color: 'text-amber-700', bg: 'bg-amber-100' },
  no_work: { label: 'No Work', color: 'text-gray-700', bg: 'bg-gray-100' },
};

function formatDuration(seconds: number): string {
  if (seconds === 0) return '0m';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

interface Props {
  teamStatus: TeamTimerStatus[];
  onSelectUser: (userId: string) => void;
}

export default function TeamStatusPanel({ teamStatus, onSelectUser }: Props) {
  const activeUsers = teamStatus.filter((u) => u.active_timer);
  const idleUsers = teamStatus.filter((u) => !u.active_timer);

  return (
    <div className="space-y-4">
      {/* Active users */}
      {activeUsers.length > 0 && (
        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#90A1B9]">
            Currently Active ({activeUsers.length})
          </h4>
          <div className="space-y-1.5">
            {activeUsers.map((user) => {
              const cfg = TYPE_LABELS[user.active_timer!.timer_type] || TYPE_LABELS.work;
              return (
                <button
                  key={user.user_id}
                  onClick={() => onSelectUser(user.user_id)}
                  className="flex w-full items-center gap-3 rounded-lg border border-[#E2E8F0] p-3 text-left transition hover:bg-[#F8FAFC]"
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#F1F5F9] text-xs font-medium text-[#62748E]">
                    {user.display_name?.charAt(0)?.toUpperCase() || '?'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-sm font-medium text-[#0F172B]">{user.display_name}</p>
                    <div className="flex items-center gap-2">
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${cfg.bg} ${cfg.color}`}>
                        {cfg.label}
                      </span>
                      <TimerDisplay
                        startTime={user.active_timer!.start_time}
                        className="text-[10px] text-[#90A1B9]"
                      />
                    </div>
                  </div>
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Idle users */}
      {idleUsers.length > 0 && (
        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#90A1B9]">
            Idle ({idleUsers.length})
          </h4>
          <div className="space-y-1.5">
            {idleUsers.map((user) => {
              const summary = user.today_summary;
              const totalToday = summary
                ? summary.total_work_seconds + summary.total_break_seconds + summary.total_no_work_seconds
                : 0;
              return (
                <button
                  key={user.user_id}
                  onClick={() => onSelectUser(user.user_id)}
                  className="flex w-full items-center gap-3 rounded-lg border border-[#E2E8F0] p-3 text-left transition hover:bg-[#F8FAFC]"
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#F1F5F9] text-xs font-medium text-[#62748E]">
                    {user.display_name?.charAt(0)?.toUpperCase() || '?'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-sm font-medium text-[#0F172B]">{user.display_name}</p>
                    <p className="text-[10px] text-[#90A1B9]">
                      {totalToday > 0 ? `Today: ${formatDuration(totalToday)}` : 'No activity today'}
                    </p>
                  </div>
                  <div className="h-2 w-2 rounded-full bg-gray-300" />
                </button>
              );
            })}
          </div>
        </div>
      )}

      {teamStatus.length === 0 && (
        <p className="py-8 text-center text-sm text-[#90A1B9]">No team members found</p>
      )}
    </div>
  );
}
