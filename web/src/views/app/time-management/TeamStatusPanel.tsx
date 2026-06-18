import { useState } from 'react';
import type { TeamTimerStatus } from '@squadhub/shared';
import TimerDisplay from '../checkin/TimerDisplay';
import { useAuthStore } from '../../../stores/authStore';
import DmSidePanel, { type DmTarget } from '../check-ins/DmSidePanel';

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
  const meId = useAuthStore((s) => s.user?.id);
  const [dmUser, setDmUser] = useState<DmTarget | null>(null);

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
                <div
                  key={user.user_id}
                  className="group flex w-full items-center gap-3 rounded-lg border border-[#E2E8F0] p-3 transition hover:bg-[#F8FAFC]"
                >
                  <button
                    onClick={() => onSelectUser(user.user_id)}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  >
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#F1F5F9] text-xs font-medium text-[#62748E]">
                      {user.display_name?.charAt(0)?.toUpperCase() || '?'}
                    </div>
                    <div className="min-w-0 flex-1">
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
                  </button>
                  {user.user_id !== meId && (
                    <MessageButton
                      name={user.display_name}
                      onClick={() =>
                        setDmUser({ id: user.user_id, display_name: user.display_name, avatar_url: user.avatar_url })
                      }
                    />
                  )}
                  <span className="relative flex h-2 w-2 shrink-0">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
                  </span>
                </div>
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
                <div
                  key={user.user_id}
                  className="group flex w-full items-center gap-3 rounded-lg border border-[#E2E8F0] p-3 transition hover:bg-[#F8FAFC]"
                >
                  <button
                    onClick={() => onSelectUser(user.user_id)}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  >
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#F1F5F9] text-xs font-medium text-[#62748E]">
                      {user.display_name?.charAt(0)?.toUpperCase() || '?'}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-[#0F172B]">{user.display_name}</p>
                      <p className="text-[10px] text-[#90A1B9]">
                        {totalToday > 0 ? `Today: ${formatDuration(totalToday)}` : 'No activity today'}
                      </p>
                    </div>
                  </button>
                  {user.user_id !== meId && (
                    <MessageButton
                      name={user.display_name}
                      onClick={() =>
                        setDmUser({ id: user.user_id, display_name: user.display_name, avatar_url: user.avatar_url })
                      }
                    />
                  )}
                  <div className="h-2 w-2 shrink-0 rounded-full bg-gray-300" />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {teamStatus.length === 0 && (
        <p className="py-8 text-center text-sm text-[#90A1B9]">No team members found</p>
      )}

      {dmUser && <DmSidePanel key={dmUser.id} user={dmUser} onClose={() => setDmUser(null)} />}
    </div>
  );
}

function MessageButton({ name, onClick }: { name: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={`Message ${name}`}
      aria-label={`Message ${name}`}
      className="shrink-0 rounded-md p-1 text-[#90A1B9] opacity-0 transition hover:bg-[#F1F5F9] hover:text-[#0F172B] focus:opacity-100 group-hover:opacity-100"
    >
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.6-.8L3 21l1.8-5.9a8.5 8.5 0 0 1-.8-3.6A8.38 8.38 0 0 1 12.5 3 8.38 8.38 0 0 1 21 11.5z" />
      </svg>
    </button>
  );
}
