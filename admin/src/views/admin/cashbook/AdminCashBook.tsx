import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../../../services/api';
import ClientAccessModule from './ClientAccessModule';
import PartnerAccessModule from './PartnerAccessModule';
import EntriesModule from './EntriesModule';
import ChecksModule from './ChecksModule';
import ReviewQueueModule from './ReviewQueueModule';

type Tab = 'client-access' | 'partner-access' | 'entries' | 'checks' | 'review';

export default function AdminCashBook() {
  const [activeTab, setActiveTab] = useState<Tab>('client-access');

  const { data: statsRes } = useQuery({
    queryKey: ['admin-cashbook-stats'],
    queryFn: () => api.get('/admin/cashbook/stats').then((r) => r.data),
    refetchInterval: 30000,
  });

  const stats = statsRes?.data || { enabled_clients: 0, total_users: 0, unposted_entries: 0, unposted_checks: 0 };

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: 'client-access', label: 'Client Access', count: stats.enabled_clients },
    { id: 'partner-access', label: 'Partner Access', count: 0 },
    { id: 'entries', label: 'All Entries', count: 0 },
    { id: 'checks', label: 'Checks', count: 0 },
    { id: 'review', label: 'Review Queue', count: stats.unposted_entries + stats.unposted_checks },
  ];

  return (
    <div className="-m-6 flex h-[calc(100vh)] overflow-hidden">
      {/* Mini-app sidebar */}
      <div className="flex w-56 shrink-0 flex-col border-r border-[#E2E8F0] bg-white">
        <div className="border-b border-[#E2E8F0] px-4 py-3">
          <div className="flex items-center gap-2">
            <svg className="h-5 w-5 text-[#2962FF]" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />
            </svg>
            <h2 className="font-[family-name:var(--font-display)] text-sm font-bold text-[#0F172B]">Cash Book</h2>
          </div>
        </div>

        <nav className="flex flex-col gap-0.5 p-2">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center justify-between rounded-md px-3 py-2 text-left text-[13px] transition-colors ${
                activeTab === tab.id
                  ? 'bg-[#EEF2FF] font-semibold text-[#2962FF]'
                  : 'text-[#475569] hover:bg-[#F8FAFC]'
              }`}
            >
              <span>{tab.label}</span>
              {tab.count > 0 && (
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                    activeTab === tab.id
                      ? 'bg-[#2962FF] text-white'
                      : 'bg-[#F1F5F9] text-[#64748B]'
                  }`}
                >
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </nav>

        {/* Stats summary */}
        <div className="mt-auto border-t border-[#E2E8F0] p-4">
          <div className="space-y-2 text-[11px] text-[#64748B]">
            <div className="flex justify-between">
              <span>Active Clients</span>
              <span className="font-semibold text-[#0F172B]">{stats.enabled_clients}</span>
            </div>
            <div className="flex justify-between">
              <span>Total Users</span>
              <span className="font-semibold text-[#0F172B]">{stats.total_users}</span>
            </div>
            <div className="flex justify-between">
              <span>Pending Review</span>
              <span className="font-semibold text-[#F59E0B]">{stats.unposted_entries + stats.unposted_checks}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-auto bg-[#F8FAFC] p-6">
        {activeTab === 'client-access' && <ClientAccessModule />}
        {activeTab === 'partner-access' && <PartnerAccessModule />}
        {activeTab === 'entries' && <EntriesModule />}
        {activeTab === 'checks' && <ChecksModule />}
        {activeTab === 'review' && <ReviewQueueModule />}
      </div>
    </div>
  );
}
