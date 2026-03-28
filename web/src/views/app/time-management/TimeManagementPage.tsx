import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../../../services/api';
import TeamStatusPanel from './TeamStatusPanel';
import TeamStatsTable from './TeamStatsTable';
import UserDrillDown from './UserDrillDown';
import ExportButton from './ExportButton';

type TabView = 'live' | 'stats';

export default function TimeManagementPage() {
  const today = new Date().toISOString().split('T')[0];
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const [tab, setTab] = useState<TabView>('live');
  const [startDate, setStartDate] = useState(weekAgo);
  const [endDate, setEndDate] = useState(today);
  const [selectedUser, setSelectedUser] = useState<{ id: string; name: string } | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  // Live team status
  const { data: statusRes, isLoading: statusLoading, refetch: refetchStatus, dataUpdatedAt } = useQuery({
    queryKey: ['timer-team-status'],
    queryFn: () => api.get('/admin/timer/team-status').then((r) => r.data),
    refetchInterval: autoRefresh ? 30000 : false,
  });

  // Team stats for date range
  const { data: statsRes, isLoading: statsLoading } = useQuery({
    queryKey: ['timer-team-stats', startDate, endDate],
    queryFn: () => api.get(`/admin/timer/team-stats?start_date=${startDate}&end_date=${endDate}`).then((r) => r.data),
    enabled: tab === 'stats',
  });

  const teamStatus = statusRes?.data || [];
  const teamStats = statsRes?.data || [];

  const handleSelectUser = (userId: string) => {
    const user = teamStatus.find((u: any) => u.user_id === userId);
    setSelectedUser({ id: userId, name: user?.display_name || 'User' });
  };

  const lastUpdated = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : '';

  return (
    <div className="flex flex-1 flex-col">
      {/* Header */}
      <div className="border-b border-[#E2E8F0] px-5 py-3">
        <div className="flex items-center justify-between">
          <h2 className="font-[family-name:var(--font-display)] text-sm font-semibold text-[#0F172B]">
            Time Management
          </h2>
          <div className="flex items-center gap-2">
            {lastUpdated && (
              <span className="text-[10px] text-[#90A1B9]">Updated {lastUpdated}</span>
            )}
            <button
              onClick={() => refetchStatus()}
              className="rounded p-1 text-[#90A1B9] transition hover:bg-[#F1F5F9] hover:text-[#0F172B]"
              title="Refresh"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex items-center justify-between border-b border-[#E2E8F0] px-5 py-2">
        <div className="flex gap-1">
          <button
            onClick={() => setTab('live')}
            className={`rounded-full px-3 py-1 text-xs font-medium transition ${
              tab === 'live'
                ? 'bg-[#0F172B] text-white'
                : 'bg-[#F1F5F9] text-[#62748E] hover:bg-[#E2E8F0]'
            }`}
          >
            Live Status
          </button>
          <button
            onClick={() => setTab('stats')}
            className={`rounded-full px-3 py-1 text-xs font-medium transition ${
              tab === 'stats'
                ? 'bg-[#0F172B] text-white'
                : 'bg-[#F1F5F9] text-[#62748E] hover:bg-[#E2E8F0]'
            }`}
          >
            Team Stats
          </button>
        </div>
        <div className="flex items-center gap-2">
          {tab === 'live' && (
            <label className="flex items-center gap-1.5 text-[10px] text-[#90A1B9]">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
                className="h-3 w-3 rounded border-[#CBD5E1] text-[#0F172B] focus:ring-[#0F172B]"
              />
              Auto-refresh
            </label>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-5">
        {tab === 'live' ? (
          statusLoading ? (
            <p className="py-8 text-center text-sm text-[#90A1B9]">Loading team status...</p>
          ) : (
            <TeamStatusPanel teamStatus={teamStatus} onSelectUser={handleSelectUser} />
          )
        ) : (
          <div className="space-y-4">
            {/* Date range + export */}
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={startDate}
                  max={endDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="rounded-lg border border-[#E2E8F0] px-2 py-1.5 text-xs text-[#0F172B] focus:border-[#0F172B] focus:outline-none"
                />
                <span className="text-xs text-[#90A1B9]">to</span>
                <input
                  type="date"
                  value={endDate}
                  max={today}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="rounded-lg border border-[#E2E8F0] px-2 py-1.5 text-xs text-[#0F172B] focus:border-[#0F172B] focus:outline-none"
                />
              </div>
              {/* Preset buttons */}
              <div className="flex gap-1">
                {[
                  { label: 'Today', start: today, end: today },
                  { label: '7d', start: weekAgo, end: today },
                  { label: '30d', start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], end: today },
                ].map((preset) => (
                  <button
                    key={preset.label}
                    onClick={() => { setStartDate(preset.start); setEndDate(preset.end); }}
                    className="rounded px-2 py-1 text-[10px] font-medium text-[#62748E] transition hover:bg-[#F1F5F9]"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <div className="ml-auto">
                <ExportButton startDate={startDate} endDate={endDate} />
              </div>
            </div>

            {statsLoading ? (
              <p className="py-8 text-center text-sm text-[#90A1B9]">Loading stats...</p>
            ) : (
              <TeamStatsTable data={teamStats} onSelectUser={handleSelectUser} />
            )}
          </div>
        )}
      </div>

      {/* User drill-down slider */}
      {selectedUser && (
        <UserDrillDown
          userId={selectedUser.id}
          userName={selectedUser.name}
          onClose={() => setSelectedUser(null)}
        />
      )}
    </div>
  );
}
