import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import api from '../../../services/api';
import NewClientsModule from './NewClientsModule';
import ClientsModule from './ClientsModule';
import ClientAccessModule from './ClientAccessModule';
import ClientSubscriptionsModule from './ClientSubscriptionsModule';
import OnboardingLinksModule from './OnboardingLinksModule';

type Tab = 'new-clients' | 'clients' | 'invite-links' | 'client-subscriptions' | 'client-access';

export default function AdminClients() {
  // Deep-link query params: ?client=<id> lands on the Clients tab, ?submission=<id>
  // lands on the New Leads tab. The downstream modules handle the actual row open.
  const searchParams = useSearchParams();
  const initialTab: Tab = searchParams.get('client') ? 'clients' : 'new-clients';
  const [activeTab, setActiveTab] = useState<Tab>(initialTab);

  // Counts for badges
  const { data: subCountRes } = useQuery({
    queryKey: ['admin-submissions-count'],
    queryFn: () => api.get('/admin/clients/submissions/count').then((r) => r.data),
    refetchInterval: 30000,
  });
  const { data: clientCountRes } = useQuery({
    queryKey: ['admin-clients-count'],
    queryFn: () => api.get('/admin/clients/count').then((r) => r.data),
    refetchInterval: 30000,
  });

  const pendingCount = subCountRes?.data?.count || 0;
  const clientCount = clientCountRes?.data?.count || 0;

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: 'new-clients', label: 'New Leads', count: pendingCount },
    { id: 'clients', label: 'Clients', count: clientCount },
    { id: 'invite-links', label: 'Invite Links', count: 0 },
    { id: 'client-subscriptions', label: 'Client Subscriptions', count: 0 },
    { id: 'client-access', label: 'Client Access', count: 0 },
  ];

  return (
    <div className="-m-6 flex h-[calc(100vh)] overflow-hidden">
      {/* Mini-app sidebar */}
      <div className="flex w-56 shrink-0 flex-col border-r border-divider bg-surface">
        <div className="border-b border-divider px-4 py-3">
          <div className="flex items-center gap-2">
            <svg className="h-5 w-5 text-accent" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
            <h2 className="font-[family-name:var(--font-display)] text-sm font-bold text-foreground">Clients</h2>
          </div>
        </div>
        <nav className="flex-1 p-2 space-y-0.5">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-sm transition ${
                activeTab === tab.id
                  ? 'bg-surface-alt text-foreground font-medium'
                  : 'text-foreground-muted hover:bg-surface-alt hover:text-foreground'
              }`}
            >
              <span>{tab.label}</span>
              {tab.count > 0 && (
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                  tab.id === 'new-clients' && tab.count > 0
                    ? 'bg-blue-100 text-blue-700'
                    : 'bg-canvas text-foreground-muted'
                }`}>
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </nav>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-y-auto bg-canvas p-6">
        {activeTab === 'new-clients' && <NewClientsModule />}
        {activeTab === 'clients' && <ClientsModule />}
        {activeTab === 'invite-links' && <OnboardingLinksModule />}
        {activeTab === 'client-subscriptions' && <ClientSubscriptionsModule />}
        {activeTab === 'client-access' && <ClientAccessModule />}
      </div>
    </div>
  );
}
