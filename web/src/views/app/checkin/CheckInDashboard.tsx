import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../../../services/api';

type ViewType = 'week' | 'month' | '3months' | 'year';

const VIEW_LABELS: Record<ViewType, string> = {
  week: 'This Week',
  month: 'Previous Month',
  '3months': 'Last 3 Months',
  year: 'This Year',
};

const STATUS_COLORS: Record<string, string> = {
  on_time: 'bg-emerald-400',
  late: 'bg-yellow-400',
  no_checkin: 'bg-red-400',
  holiday: 'bg-gray-200',
  future: 'bg-white border border-dashed border-gray-200',
};

const STATUS_LABELS: Record<string, string> = {
  on_time: 'On Time',
  late: 'Late',
  no_checkin: 'Missed',
  holiday: 'Holiday',
};

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface Props {
  onBack: () => void;
}

export default function CheckInDashboard({ onBack }: Props) {
  const [view, setView] = useState<ViewType>('week');

  const { data: dashRes, isLoading } = useQuery({
    queryKey: ['checkin-dashboard', view],
    queryFn: () => api.get(`/checkin/dashboard?view=${view}`).then((r) => r.data),
  });

  const data = dashRes?.data;
  const summary = data?.summary;
  const days = data?.days || [];

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-[#E2E8F0] px-5 py-3">
        <button
          onClick={onBack}
          className="rounded p-1 text-[#90A1B9] transition hover:bg-[#F1F5F9] hover:text-[#0F172B]"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h2 className="font-[family-name:var(--font-display)] text-sm font-semibold text-[#0F172B]">
          Check-In Dashboard
        </h2>
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        {/* Summary card */}
        {summary && (
          <div className="mb-6 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-5">
            <div className="grid grid-cols-5 gap-4 text-center">
              <div>
                <p className="text-2xl font-bold text-[#0F172B]">{summary.total_working_days}</p>
                <p className="mt-0.5 text-[10px] uppercase tracking-wider text-[#90A1B9]">Working Days</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-emerald-600">{summary.on_time}</p>
                <p className="mt-0.5 text-[10px] uppercase tracking-wider text-[#90A1B9]">On Time</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-yellow-600">{summary.late}</p>
                <p className="mt-0.5 text-[10px] uppercase tracking-wider text-[#90A1B9]">Late</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-red-600">{summary.missed}</p>
                <p className="mt-0.5 text-[10px] uppercase tracking-wider text-[#90A1B9]">Missed</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-[#0F172B]">{summary.attendance_rate}%</p>
                <p className="mt-0.5 text-[10px] uppercase tracking-wider text-[#90A1B9]">Attendance</p>
              </div>
            </div>
          </div>
        )}

        {/* View selector */}
        <div className="mb-4 flex gap-1 rounded-lg bg-[#F1F5F9] p-1">
          {(Object.entries(VIEW_LABELS) as [ViewType, string][]).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setView(key)}
              className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition ${
                view === key
                  ? 'bg-white text-[#0F172B] shadow-sm'
                  : 'text-[#62748E] hover:text-[#0F172B]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Calendar/history view */}
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <p className="text-sm text-[#90A1B9]">Loading...</p>
          </div>
        ) : view === 'week' ? (
          <WeekView days={days} />
        ) : view === '3months' ? (
          <ThreeMonthView days={days} />
        ) : (
          <CalendarView days={days} />
        )}

        {/* Legend */}
        <div className="mt-6 flex items-center justify-center gap-4">
          {Object.entries(STATUS_LABELS).map(([key, label]) => (
            <div key={key} className="flex items-center gap-1.5">
              <div className={`h-3 w-3 rounded-sm ${STATUS_COLORS[key]}`} />
              <span className="text-[10px] text-[#90A1B9]">{label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function WeekView({ days }: { days: any[] }) {
  return (
    <div className="grid grid-cols-7 gap-2">
      {days.map((day: any) => {
        const date = new Date(day.date + 'T00:00:00Z');
        const dayName = DAY_NAMES[date.getUTCDay()];
        const dayNum = date.getUTCDate();
        return (
          <div key={day.date} className="flex flex-col items-center gap-2 rounded-lg border border-[#E2E8F0] p-3">
            <span className="text-[10px] uppercase tracking-wider text-[#90A1B9]">{dayName}</span>
            <span className="text-sm font-medium text-[#0F172B]">{dayNum}</span>
            <div className={`h-3 w-3 rounded-full ${STATUS_COLORS[day.status] || STATUS_COLORS.future}`} />
            <span className="text-[9px] text-[#90A1B9]">
              {STATUS_LABELS[day.status] || ''}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function CalendarView({ days }: { days: any[] }) {
  if (days.length === 0) return null;

  // Group by weeks for calendar grid
  const firstDate = new Date(days[0].date + 'T00:00:00Z');
  const startPadding = firstDate.getUTCDay(); // 0=Sun

  const paddedDays = [
    ...Array.from({ length: startPadding }, () => null),
    ...days,
  ];

  return (
    <div>
      <div className="mb-2 grid grid-cols-7 gap-1 text-center">
        {DAY_NAMES.map((d) => (
          <span key={d} className="text-[10px] uppercase tracking-wider text-[#90A1B9] py-1">{d}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {paddedDays.map((day, i) =>
          day === null ? (
            <div key={`pad-${i}`} className="h-10" />
          ) : (
            <div
              key={day.date}
              className={`flex h-10 items-center justify-center rounded-md text-xs font-medium ${
                day.status === 'on_time'
                  ? 'bg-emerald-100 text-emerald-700'
                  : day.status === 'late'
                  ? 'bg-yellow-100 text-yellow-700'
                  : day.status === 'no_checkin'
                  ? 'bg-red-100 text-red-700'
                  : day.status === 'holiday'
                  ? 'bg-gray-100 text-gray-400'
                  : 'text-gray-300'
              }`}
              title={`${day.date}: ${STATUS_LABELS[day.status] || 'Future'}`}
            >
              {new Date(day.date + 'T00:00:00Z').getUTCDate()}
            </div>
          )
        )}
      </div>
    </div>
  );
}

function ThreeMonthView({ days }: { days: any[] }) {
  // Group by month
  const months: Record<string, any[]> = {};
  days.forEach((day: any) => {
    const monthKey = day.date.substring(0, 7); // YYYY-MM
    if (!months[monthKey]) months[monthKey] = [];
    months[monthKey].push(day);
  });

  return (
    <div className="space-y-4">
      {Object.entries(months).map(([monthKey, monthDays]) => {
        const onTime = monthDays.filter((d: any) => d.status === 'on_time').length;
        const late = monthDays.filter((d: any) => d.status === 'late').length;
        const missed = monthDays.filter((d: any) => d.status === 'no_checkin').length;
        const holidays = monthDays.filter((d: any) => d.status === 'holiday').length;
        const date = new Date(monthKey + '-01T00:00:00Z');
        const monthName = date.toLocaleString('en', { month: 'long', year: 'numeric', timeZone: 'UTC' });

        return (
          <div key={monthKey} className="rounded-lg border border-[#E2E8F0] p-4">
            <h4 className="mb-3 text-sm font-semibold text-[#0F172B]">{monthName}</h4>
            <div className="grid grid-cols-4 gap-3 text-center">
              <div>
                <p className="text-lg font-bold text-emerald-600">{onTime}</p>
                <p className="text-[10px] text-[#90A1B9]">On Time</p>
              </div>
              <div>
                <p className="text-lg font-bold text-yellow-600">{late}</p>
                <p className="text-[10px] text-[#90A1B9]">Late</p>
              </div>
              <div>
                <p className="text-lg font-bold text-red-600">{missed}</p>
                <p className="text-[10px] text-[#90A1B9]">Missed</p>
              </div>
              <div>
                <p className="text-lg font-bold text-gray-400">{holidays}</p>
                <p className="text-[10px] text-[#90A1B9]">Holidays</p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
