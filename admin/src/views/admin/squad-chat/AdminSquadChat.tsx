import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../../../services/api';
import SquadChatGroupsModule from './SquadChatGroupsModule';
import SquadChatAppVersionsModule from './SquadChatAppVersionsModule';
import SquadChatBroadcastsModule from './SquadChatBroadcastsModule';

type Tab = 'groups' | 'app-versions' | 'broadcasts';

export default function AdminSquadChat() {
  const [activeTab, setActiveTab] = useState<Tab>('groups');

  const { data: groupsRes } = useQuery({
    queryKey: ['admin-chat-groups'],
    queryFn: () => api.get('/admin/chat/groups').then((r) => r.data),
    refetchInterval: 30000,
  });
  const groupCount = groupsRes?.data?.length || 0;

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: 'groups', label: 'Groups', count: groupCount },
    { id: 'app-versions', label: 'App Versions', count: 0 },
    { id: 'broadcasts', label: 'Broadcasts', count: 0 },
  ];

  return (
    <div className="-m-6 flex h-[calc(100vh)] overflow-hidden">
      <div className="flex w-56 shrink-0 flex-col border-r border-[#E2E8F0] bg-white">
        <div className="border-b border-[#E2E8F0] px-4 py-3">
          <div className="flex items-center gap-2">
            <svg className="h-5 w-5 text-[#2962FF]" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
            </svg>
            <h2 className="font-[family-name:var(--font-display)] text-sm font-bold text-[#0F172B]">Squad Chat</h2>
          </div>
        </div>
        <nav className="flex-1 p-2 space-y-0.5">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-sm transition ${
                activeTab === tab.id
                  ? 'bg-[#F8FAFC] text-[#0F172B] font-medium'
                  : 'text-[#62748E] hover:bg-[#F8FAFC] hover:text-[#0F172B]'
              }`}
            >
              <span>{tab.label}</span>
              {tab.count > 0 && (
                <span className="rounded-full bg-[#F1F5F9] text-[#62748E] px-2 py-0.5 text-[10px] font-medium">
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </nav>
      </div>

      <div className="flex-1 overflow-y-auto bg-[#F1F5F9] p-6">
        {activeTab === 'groups' && <SquadChatGroupsModule />}
        {activeTab === 'app-versions' && <SquadChatAppVersionsModule />}
        {activeTab === 'broadcasts' && <SquadChatBroadcastsModule />}
      </div>
    </div>
  );
}
