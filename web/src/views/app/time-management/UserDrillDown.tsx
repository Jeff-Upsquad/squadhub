import { useState, useCallback, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../../../services/api';

function formatDuration(seconds: number): string {
  if (!seconds || seconds === 0) return '0m';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' });
}

const TYPE_COLORS: Record<string, string> = {
  work: 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300',
  break: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',
  no_work: 'bg-gray-100 text-gray-700 dark:bg-white/10 dark:text-gray-300',
};

const TYPE_LABELS: Record<string, string> = {
  work: 'Work',
  break: 'Break',
  no_work: 'No Work',
};

interface Props {
  userId: string;
  userName: string;
  onClose: () => void;
}

export default function UserDrillDown({ userId, userName, onClose }: Props) {
  const today = new Date().toISOString().split('T')[0];
  const [date, setDate] = useState(today);

  const { data: sessionsRes, isLoading } = useQuery({
    queryKey: ['timer-user-sessions', userId, date],
    queryFn: () => api.get(`/admin/timer/user/${userId}/sessions?date=${date}`).then((r) => r.data),
  });

  const sessions = sessionsRes?.data || [];

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} />
      <div className="fixed right-0 top-0 z-50 flex h-full w-96 flex-col bg-surface shadow-xl animate-in slide-in-from-right duration-200">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-divider px-5 py-4">
          <div>
            <h3 className="font-[family-name:var(--font-display)] text-base font-semibold text-foreground">
              {userName}
            </h3>
            <p className="text-xs text-foreground-dim">Session Details</p>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-foreground-dim transition hover:bg-surface-alt hover:text-foreground"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Date picker */}
        <div className="border-b border-divider px-5 py-3">
          <input
            type="date"
            value={date}
            max={today}
            onChange={(e) => setDate(e.target.value)}
            className="w-full rounded-lg border border-divider bg-surface px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none"
          />
        </div>

        {/* Sessions */}
        <div className="flex-1 overflow-y-auto p-5">
          {isLoading ? (
            <p className="py-8 text-center text-sm text-foreground-dim">Loading...</p>
          ) : sessions.length === 0 ? (
            <p className="py-8 text-center text-sm text-foreground-dim">No sessions on this date</p>
          ) : (
            <div className="space-y-2">
              {sessions.map((session: any) => (
                <div key={session.id} className="rounded-lg border border-divider bg-surface p-3">
                  <div className="flex items-center justify-between">
                    <span className={`rounded px-2 py-0.5 text-[10px] font-medium ${TYPE_COLORS[session.timer_type]}`}>
                      {TYPE_LABELS[session.timer_type]}
                    </span>
                    <span className="text-xs font-medium text-foreground">
                      {session.duration_seconds != null ? formatDuration(session.duration_seconds) : 'Active'}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center gap-2 text-[10px] text-foreground-dim">
                    <span>{formatTime(session.start_time)}</span>
                    <span>-</span>
                    <span>{session.end_time ? formatTime(session.end_time) : 'now'}</span>
                    {session.is_auto_stopped && (
                      <span className="rounded bg-red-50 px-1.5 py-0.5 text-[9px] text-red-500 dark:bg-red-500/15 dark:text-red-300">Auto-stopped</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
