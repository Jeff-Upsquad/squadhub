import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../../../services/api';
import CheckInSlider from './CheckInSlider';
import CheckInDashboard from './CheckInDashboard';

export default function CheckInWidget() {
  const [showSlider, setShowSlider] = useState(false);
  const [showDashboard, setShowDashboard] = useState(false);

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
    isHoliday ? 'bg-gray-100 text-gray-500' :
    !alreadyCheckedIn ? 'bg-amber-50 text-amber-600' :
    checkin?.status === 'on_time' ? 'bg-emerald-50 text-emerald-600' :
    checkin?.status === 'late' ? 'bg-yellow-50 text-yellow-600' :
    'bg-amber-50 text-amber-600';

  if (showDashboard) {
    return <CheckInDashboard onBack={() => setShowDashboard(false)} />;
  }

  return (
    <div className="flex flex-1 flex-col">
      {/* Header */}
      <div className="border-b border-[#E2E8F0] px-5 py-3">
        <div className="flex items-center justify-between">
          <h2 className="font-[family-name:var(--font-display)] text-sm font-semibold text-[#0F172B]">
            Daily Check-In
          </h2>
          <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-medium ${statusColor}`}>
            {statusLabel}
          </span>
        </div>
      </div>

      {/* Widget content */}
      <div className="flex flex-1 flex-col items-center justify-center p-8">
        <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-[#F1F5F9]">
          <svg className="h-10 w-10 text-[#62748E]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>

        {isHoliday ? (
          <div className="text-center">
            <h3 className="font-[family-name:var(--font-display)] text-lg font-medium text-[#62748E]">
              Today is a Holiday
            </h3>
            <p className="mt-1 text-sm text-[#90A1B9]">No check-in required today. Enjoy your day off!</p>
          </div>
        ) : alreadyCheckedIn ? (
          <div className="text-center">
            <h3 className="font-[family-name:var(--font-display)] text-lg font-medium text-[#0F172B]">
              You're checked in!
            </h3>
            <p className="mt-1 text-sm text-[#90A1B9]">
              {checkin?.status === 'on_time' ? 'Submitted on time' : 'Submitted late'} at{' '}
              {checkin?.submitted_at ? new Date(checkin.submitted_at).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' }) : ''}
            </p>
          </div>
        ) : (
          <div className="text-center">
            <h3 className="font-[family-name:var(--font-display)] text-lg font-medium text-[#0F172B]">
              Ready to check in?
            </h3>
            <p className="mt-1 text-sm text-[#90A1B9]">
              Deadline: {todayData?.deadline_time || '10:00'} IST
              {todayData?.role && <span className="ml-1">({todayData.role.name})</span>}
            </p>
          </div>
        )}

        <div className="mt-6 flex gap-3">
          {!isHoliday && !alreadyCheckedIn && (
            <button
              onClick={() => setShowSlider(true)}
              className="rounded-lg bg-[#0F172B] px-6 py-2.5 text-sm font-medium text-white transition hover:bg-[#1D293D]"
            >
              Check In
            </button>
          )}
          <button
            onClick={() => setShowDashboard(true)}
            className="rounded-lg border border-[#E2E8F0] px-6 py-2.5 text-sm font-medium text-[#62748E] transition hover:bg-[#F8FAFC]"
          >
            View Dashboard
          </button>
        </div>
      </div>

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
