import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../../../services/api';
import { useTimeStats } from '../../../hooks/useTimer';
import { useWorkspaceStore } from '../../../stores/workspaceStore';

type ViewType = 'week' | 'month' | '3months' | 'year';

const VIEW_LABELS: Record<ViewType, string> = {
  week: 'Week',
  month: 'Month',
  '3months': '3 Months',
  year: 'Year',
};

const STATUS_COLORS: Record<string, string> = {
  on_time: 'bg-emerald-400',
  late: 'bg-yellow-400',
  no_checkin: 'bg-red-400',
  holiday: 'bg-gray-200',
  future: 'bg-surface border border-dashed border-divider',
};

const STATUS_LABELS: Record<string, string> = {
  on_time: 'On Time',
  late: 'Late',
  no_checkin: 'Missed',
  holiday: 'Holiday',
};

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function formatDuration(seconds: number): string {
  if (seconds === 0) return '0m';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export default function DashboardTab({ context = 'default' }: { context?: string }) {
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspace?.id);
  const [view, setView] = useState<ViewType>('week');

  const { data: dashRes, isLoading } = useQuery({
    queryKey: ['checkin-dashboard', view],
    queryFn: () => api.get(`/checkin/dashboard?view=${view}`).then((r) => r.data),
  });

  const { data: statsRes } = useTimeStats({ workspaceId, context });

  const data = dashRes?.data;
  const summary = data?.summary;
  const days = data?.days || [];
  const weekSummaries = statsRes?.data?.week_summaries || [];

  return (
    <div className="flex-1 overflow-y-auto p-5">
      {/* Attendance summary card */}
      {summary && (
        <div className="mb-5 rounded-xl border border-divider bg-surface-alt p-4">
          <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-foreground-dim">Attendance</h4>
          <div className="grid grid-cols-5 gap-3 text-center">
            <div>
              <p className="text-xl font-bold text-foreground">{summary.total_working_days}</p>
              <p className="text-[9px] uppercase tracking-wider text-foreground-dim">Days</p>
            </div>
            <div>
              <p className="text-xl font-bold text-emerald-600">{summary.on_time}</p>
              <p className="text-[9px] uppercase tracking-wider text-foreground-dim">On Time</p>
            </div>
            <div>
              <p className="text-xl font-bold text-yellow-600">{summary.late}</p>
              <p className="text-[9px] uppercase tracking-wider text-foreground-dim">Late</p>
            </div>
            <div>
              <p className="text-xl font-bold text-red-600">{summary.missed}</p>
              <p className="text-[9px] uppercase tracking-wider text-foreground-dim">Missed</p>
            </div>
            <div>
              <p className="text-xl font-bold text-foreground">{summary.attendance_rate}%</p>
              <p className="text-[9px] uppercase tracking-wider text-foreground-dim">Rate</p>
            </div>
          </div>
        </div>
      )}

      {/* Time tracking weekly summary */}
      {weekSummaries.length > 0 && (
        <div className="mb-5 rounded-xl border border-divider bg-surface-alt p-4">
          <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-foreground-dim">Weekly Hours</h4>
          <div className="space-y-2">
            {weekSummaries.map((day: any) => {
              const total = day.total_work_seconds + day.total_break_seconds + day.total_no_work_seconds;
              const date = new Date(day.date + 'T00:00:00Z');
              const dayName = DAY_NAMES[date.getUTCDay()];
              const dateNum = date.getUTCDate();
              return (
                <div key={day.date} className="flex items-center gap-3">
                  <span className="w-10 text-xs text-foreground-dim">{dayName} {dateNum}</span>
                  <div className="flex h-4 flex-1 overflow-hidden rounded-full bg-divider">
                    {day.total_work_seconds > 0 && (
                      <div className="bg-blue-500" style={{ width: `${(day.total_work_seconds / (10 * 3600)) * 100}%` }} />
                    )}
                    {day.total_break_seconds > 0 && (
                      <div className="bg-amber-400" style={{ width: `${(day.total_break_seconds / (10 * 3600)) * 100}%` }} />
                    )}
                    {day.total_no_work_seconds > 0 && (
                      <div className="bg-gray-400" style={{ width: `${(day.total_no_work_seconds / (10 * 3600)) * 100}%` }} />
                    )}
                  </div>
                  <span className="w-14 text-right text-xs font-medium text-foreground">{formatDuration(total)}</span>
                </div>
              );
            })}
          </div>
          {/* Legend */}
          <div className="mt-3 flex items-center justify-center gap-4">
            <div className="flex items-center gap-1.5"><div className="h-2.5 w-2.5 rounded-sm bg-blue-500" /><span className="text-[9px] text-foreground-dim">Work</span></div>
            <div className="flex items-center gap-1.5"><div className="h-2.5 w-2.5 rounded-sm bg-amber-400" /><span className="text-[9px] text-foreground-dim">Break</span></div>
            <div className="flex items-center gap-1.5"><div className="h-2.5 w-2.5 rounded-sm bg-gray-400" /><span className="text-[9px] text-foreground-dim">No Work</span></div>
          </div>
        </div>
      )}

      {/* View selector */}
      <div className="mb-4 flex gap-1 rounded-lg bg-surface-alt p-1">
        {(Object.entries(VIEW_LABELS) as [ViewType, string][]).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setView(key)}
            className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition ${
              view === key
                ? 'bg-surface text-foreground shadow-sm'
                : 'text-foreground-muted hover:text-foreground'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Calendar view */}
      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <p className="text-sm text-foreground-dim">Loading...</p>
        </div>
      ) : view === 'week' ? (
        <div className="grid grid-cols-7 gap-2">
          {days.map((day: any) => {
            const date = new Date(day.date + 'T00:00:00Z');
            const dayName = DAY_NAMES[date.getUTCDay()];
            const dayNum = date.getUTCDate();
            return (
              <div key={day.date} className="flex flex-col items-center gap-1.5 rounded-lg border border-divider p-2">
                <span className="text-[9px] uppercase tracking-wider text-foreground-dim">{dayName}</span>
                <span className="text-xs font-medium text-foreground">{dayNum}</span>
                <div className={`h-2.5 w-2.5 rounded-full ${STATUS_COLORS[day.status] || STATUS_COLORS.future}`} />
              </div>
            );
          })}
        </div>
      ) : (
        <div>
          <div className="mb-2 grid grid-cols-7 gap-1 text-center">
            {DAY_NAMES.map((d) => (
              <span key={d} className="py-1 text-[9px] uppercase tracking-wider text-foreground-dim">{d}</span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {(() => {
              if (days.length === 0) return null;
              const firstDate = new Date(days[0].date + 'T00:00:00Z');
              const startPadding = firstDate.getUTCDay();
              const paddedDays = [...Array.from({ length: startPadding }, () => null), ...days];
              return paddedDays.map((day, i) =>
                day === null ? (
                  <div key={`pad-${i}`} className="h-8" />
                ) : (
                  <div
                    key={day.date}
                    className={`flex h-8 items-center justify-center rounded text-[10px] font-medium ${
                      day.status === 'on_time' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300'
                      : day.status === 'late' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-300'
                      : day.status === 'no_checkin' ? 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300'
                      : day.status === 'holiday' ? 'bg-gray-100 text-gray-400 dark:bg-white/10 dark:text-gray-400'
                      : 'text-gray-300'
                    }`}
                    title={`${day.date}: ${STATUS_LABELS[day.status] || 'Future'}`}
                  >
                    {new Date(day.date + 'T00:00:00Z').getUTCDate()}
                  </div>
                )
              );
            })()}
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="mt-4 flex items-center justify-center gap-3">
        {Object.entries(STATUS_LABELS).map(([key, label]) => (
          <div key={key} className="flex items-center gap-1.5">
            <div className={`h-2.5 w-2.5 rounded-sm ${STATUS_COLORS[key]}`} />
            <span className="text-[9px] text-foreground-dim">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
