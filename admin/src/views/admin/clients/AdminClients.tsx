import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import api from '../../../services/api';
import NewClientsModule from './NewClientsModule';
import ClientsModule from './ClientsModule';
import OnboardingLinksModule from './OnboardingLinksModule';

type Tab = 'clients' | 'contacts' | 'invite-links';

export default function AdminClients() {
  // Deep-link query params: ?client=<id> lands on the Clients tab, ?submission=<id>
  // lands on the Contacts tab. The downstream modules handle the actual row open.
  const searchParams = useSearchParams();
  const initialTab: Tab = searchParams.get('submission') ? 'contacts' : 'clients';
  const [activeTab, setActiveTab] = useState<Tab>(initialTab);
  const [backfillMsg, setBackfillMsg] = useState<string | null>(null);

  // Phase 4: chunked identity backfill (CRM/Hire ids + orphan card links).
  const backfillMutation = useMutation({
    mutationFn: () =>
      api.post('/admin/clients/backfill-links', { limit: 200 }).then((r) => r.data),
    onSuccess: (res) => {
      const d = res?.data;
      if (!d) {
        setBackfillMsg('Backfill finished (no stats).');
        return;
      }
      setBackfillMsg(
        `Synced ${d.submissions_crm_stamped + d.clients_crm_stamped} CRM · ` +
          `${d.submissions_hire_stamped + d.clients_hire_stamped} Hire · ` +
          `${d.cards_linked + d.job_cards_linked} cards` +
          (d.conflicts_seen ? ` · ${d.conflicts_seen} conflicts` : '') +
          (d.errors?.length ? ` · ${d.errors.length} errors` : ''),
      );
    },
    onError: (err: any) => {
      setBackfillMsg(err?.response?.data?.error || err?.message || 'Backfill failed');
    },
  });

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

  const tabs: { id: Tab; label: string; count: number; highlight?: boolean }[] = [
    { id: 'clients', label: 'Clients', count: clientCount },
    { id: 'contacts', label: 'Contacts', count: pendingCount, highlight: true },
    { id: 'invite-links', label: 'Invite Links', count: 0 },
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
        <nav className="flex-1 space-y-0.5 p-2">
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
                  tab.highlight ? 'bg-blue-100 text-blue-700' : 'bg-canvas text-foreground-muted'
                }`}>
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </nav>
        <div className="border-t border-divider p-2">
          <button
            type="button"
            disabled={backfillMutation.isPending}
            onClick={() => {
              setBackfillMsg(null);
              backfillMutation.mutate();
            }}
            title="Stamp missing CRM/Hire links and attach orphan cards to contacts"
            className="w-full rounded-md border border-divider bg-surface px-3 py-2 text-left text-xs font-medium text-foreground-muted transition hover:bg-surface-alt hover:text-foreground disabled:opacity-50"
          >
            {backfillMutation.isPending ? 'Syncing connections…' : 'Sync connections'}
          </button>
          {backfillMsg && (
            <p className="mt-1.5 px-1 text-[10px] leading-snug text-foreground-dim">{backfillMsg}</p>
          )}
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-y-auto bg-canvas p-6">
        {activeTab === 'clients' && <ClientsModule />}
        {activeTab === 'contacts' && <NewClientsModule />}
        {activeTab === 'invite-links' && <OnboardingLinksModule />}
      </div>
    </div>
  );
}
