import { useState } from 'react';
import type { TimerSession } from '@squadhub/shared';
import EditSessionModal from './EditSessionModal';

interface Props {
  sessions: TimerSession[];
  canEdit: boolean;
  windowHours: number; // 0 = unlimited
  workspaceId: string | undefined;
  context: string;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDuration(seconds: number): string {
  if (seconds <= 0) return '0m';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

const TYPE_META: Record<string, { label: string; chipClass: string }> = {
  work: { label: 'Work', chipClass: 'bg-blue-100 text-blue-700' },
  break: { label: 'Break', chipClass: 'bg-amber-100 text-amber-700' },
  no_work: { label: 'No Work', chipClass: 'bg-gray-200 text-gray-700' },
};

function isWithinWindow(session: TimerSession, windowHours: number): boolean {
  if (windowHours <= 0) return true; // 0 = unlimited
  if (!session.end_time) return false;
  const age = Date.now() - new Date(session.end_time).getTime();
  return age <= windowHours * 3600 * 1000;
}

export default function TodaySessionsList({ sessions, canEdit, windowHours, workspaceId, context }: Props) {
  const [editing, setEditing] = useState<TimerSession | null>(null);

  const completed = sessions.filter((s) => !!s.end_time);
  if (completed.length === 0) return null;

  return (
    <div className="rounded-xl border border-[#E2E8F0] bg-white p-4">
      <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-[#90A1B9]">Today's Sessions</h4>
      <div className="divide-y divide-[#E2E8F0]">
        {completed.map((s) => {
          const meta = TYPE_META[s.timer_type] || TYPE_META.no_work;
          const withinWindow = isWithinWindow(s, windowHours);
          const showEdit = canEdit;
          return (
            <div key={s.id} className="flex items-center gap-3 py-2 text-sm">
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${meta.chipClass}`}>{meta.label}</span>
              <div className="flex-1 text-[#0F172B]">
                <span className="tabular-nums">{formatTime(s.start_time)}</span>
                <span className="mx-1 text-[#90A1B9]">→</span>
                <span className="tabular-nums">{s.end_time ? formatTime(s.end_time) : '…'}</span>
              </div>
              <span className="w-16 text-right tabular-nums text-[#62748E]">{formatDuration(s.duration_seconds || 0)}</span>
              {showEdit && (
                <button
                  type="button"
                  onClick={() => withinWindow && setEditing(s)}
                  disabled={!withinWindow}
                  title={withinWindow ? 'Edit session' : 'Edit window expired'}
                  className="rounded-md p-1 text-[#62748E] hover:bg-[#F1F5F9] hover:text-[#2962FF] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-[#62748E]"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125" />
                  </svg>
                </button>
              )}
            </div>
          );
        })}
      </div>
      {editing && (
        <EditSessionModal
          session={editing}
          onClose={() => setEditing(null)}
          workspaceId={workspaceId}
          context={context}
        />
      )}
    </div>
  );
}
