import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../../../services/api';
import CheckInSlider from './CheckInSlider';
import TimerTab from './TimerTab';
import DashboardTab from './DashboardTab';
import OffDaysTab from './OffDaysTab';
import DailyTimesheetTab from './DailyTimesheetTab';

type Tab = 'timers' | 'checkin' | 'timesheet' | 'offdays';

const TABS: { id: Tab; label: string }[] = [
  { id: 'timers', label: 'Time Tracking' },
  { id: 'checkin', label: 'Check-In' },
  { id: 'timesheet', label: 'Daily Timesheet' },
  { id: 'offdays', label: 'Off Days' },
];

export default function CheckInWidget({ title = 'Daily Check-In', context = 'default' }: { title?: string; context?: string }) {
  const [activeTab, setActiveTab] = useState<Tab>('timers');
  const [showSlider, setShowSlider] = useState(false);

  const { data: todayRes, refetch } = useQuery({
    queryKey: ['checkin-today'],
    queryFn: () => api.get('/checkin/today').then((r) => r.data),
    refetchInterval: 60000,
  });

  const todayData = todayRes?.data;
  const alreadyCheckedIn = todayData?.already_checked_in;
  const isHoliday = todayData?.is_holiday;
  const checkin = todayData?.checkin;

  const statusLabel =
    isHoliday ? 'Holiday' :
    !alreadyCheckedIn ? 'Pending' :
    checkin?.status === 'on_time' ? 'On Time' :
    checkin?.status === 'late' ? 'Late' : 'Pending';

  const statusColor =
    isHoliday ? 'bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-gray-300' :
    !alreadyCheckedIn ? 'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300' :
    checkin?.status === 'on_time' ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300' :
    checkin?.status === 'late' ? 'bg-yellow-50 text-yellow-600 dark:bg-yellow-500/15 dark:text-yellow-300' :
    'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300';

  return (
    <div className="flex flex-1 flex-col">
      {/* Header */}
      <div className="border-b border-divider px-5 py-3">
        <div className="flex items-center justify-between">
          <h2 className="font-[family-name:var(--font-display)] text-sm font-semibold text-foreground">
            {title}
          </h2>
          <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-medium ${statusColor}`}>
            {statusLabel}
          </span>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-divider px-5 py-2">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition ${
              activeTab === tab.id
                ? 'bg-sh-ink text-surface'
                : 'bg-surface-alt text-foreground-muted hover:bg-divider hover:text-foreground'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'timers' ? (
        <div className="flex-1 overflow-y-auto">
          <TimerTab context={context} />
        </div>
      ) : activeTab === 'offdays' ? (
        <div className="flex-1 overflow-y-auto">
          <OffDaysTab />
        </div>
      ) : activeTab === 'timesheet' ? (
        <div className="flex-1 overflow-y-auto">
          <DailyTimesheetTab />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          {/* Check-in status + action */}
          <div className="flex flex-col items-center p-6 border-b border-divider">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-surface-alt">
              <svg className="h-8 w-8 text-foreground-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>

            {isHoliday ? (
              <div className="text-center">
                <h3 className="font-[family-name:var(--font-display)] text-base font-medium text-foreground-muted">
                  Today is a Holiday
                </h3>
                <p className="mt-1 text-xs text-foreground-dim">No check-in required today.</p>
              </div>
            ) : alreadyCheckedIn ? (
              <div className="text-center">
                <h3 className="font-[family-name:var(--font-display)] text-base font-medium text-foreground">
                  You're checked in!
                </h3>
                <p className="mt-1 text-xs text-foreground-dim">
                  {checkin?.status === 'on_time' ? 'Submitted on time' : 'Submitted late'} at{' '}
                  {checkin?.submitted_at ? new Date(checkin.submitted_at).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' }) : ''}
                </p>
              </div>
            ) : (
              <div className="text-center">
                <h3 className="font-[family-name:var(--font-display)] text-base font-medium text-foreground">
                  Ready to check in?
                </h3>
                <p className="mt-1 text-xs text-foreground-dim">
                  Deadline: {todayData?.deadline_time || '10:00'} IST
                  {todayData?.role && <span className="ml-1">({todayData.role.name})</span>}
                </p>
                <button
                  onClick={() => setShowSlider(true)}
                  className="mt-3 rounded-lg bg-sh-ink px-5 py-2 text-sm font-medium text-surface transition hover:opacity-90"
                >
                  Check In
                </button>
              </div>
            )}
          </div>

          {/* Dashboard inline */}
          <DashboardTab context={context} />
        </div>
      )}

      {/* Check-in slider */}
      {showSlider && (
        <CheckInSlider
          checklistItems={todayData?.checklist_items || []}
          onClose={() => setShowSlider(false)}
          onSuccess={() => {
            setShowSlider(false);
            refetch();
          }}
        />
      )}
    </div>
  );
}
