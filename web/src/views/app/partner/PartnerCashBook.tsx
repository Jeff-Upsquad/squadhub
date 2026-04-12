import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../../../services/api';
import PartnerCashBookDetail from './PartnerCashBookDetail';

interface ClientWithStats {
  id: string;
  business_name: string;
  contact_person: string;
  stats: {
    unposted_entries: number;
    unposted_checks: number;
    total_entries: number;
  };
}

export default function PartnerCashBook() {
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [selectedClientName, setSelectedClientName] = useState('');

  const { data: clientsRes, isLoading } = useQuery({
    queryKey: ['partner-cashbook-clients'],
    queryFn: () => api.get('/partner/cashbook/clients').then((r) => r.data),
  });

  const clients: ClientWithStats[] = clientsRes?.data || [];

  if (selectedClientId) {
    return (
      <PartnerCashBookDetail
        clientId={selectedClientId}
        clientName={selectedClientName}
        onBack={() => setSelectedClientId(null)}
      />
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-y-auto p-6">
      <div className="mx-auto w-full max-w-4xl">
        {/* Header */}
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10">
            <svg className="h-5 w-5 text-blue-400" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />
            </svg>
          </div>
          <div>
            <h1 className="font-[family-name:var(--font-display)] text-xl font-bold text-foreground">Cash Book</h1>
            <p className="text-sm text-foreground-muted">View and manage client transactions</p>
          </div>
        </div>

        {/* Loading */}
        {isLoading && (
          <div className="flex items-center justify-center py-16 text-sm text-foreground-muted">Loading clients...</div>
        )}

        {/* Empty */}
        {!isLoading && clients.length === 0 && (
          <div className="rounded-lg border border-divider bg-surface-alt p-8 text-center">
            <svg className="mx-auto h-12 w-12 text-foreground-dim" fill="none" stroke="currentColor" strokeWidth={1} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />
            </svg>
            <p className="mt-3 text-sm text-foreground-muted">No clients assigned yet. An administrator will grant you access.</p>
          </div>
        )}

        {/* Client cards grid */}
        {!isLoading && clients.length > 0 && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {clients.map((client) => {
              const totalUnposted = client.stats.unposted_entries + client.stats.unposted_checks;
              return (
                <button
                  key={client.id}
                  onClick={() => {
                    setSelectedClientId(client.id);
                    setSelectedClientName(client.business_name);
                  }}
                  className="group rounded-lg border border-divider bg-surface-alt p-4 text-left transition hover:border-blue-500/40 hover:shadow-md"
                >
                  {/* Folder icon */}
                  <div className="mb-3 flex items-center justify-between">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10 transition group-hover:bg-amber-500/20">
                      <svg className="h-5 w-5 text-amber-400" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
                      </svg>
                    </div>
                    {totalUnposted > 0 && (
                      <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-400">
                        {totalUnposted} unposted
                      </span>
                    )}
                  </div>

                  <h3 className="text-sm font-medium text-foreground">{client.business_name}</h3>
                  <p className="mt-0.5 text-xs text-foreground-muted">{client.contact_person}</p>

                  <div className="mt-3 flex items-center gap-3 text-[11px] text-foreground-dim">
                    <span>{client.stats.total_entries} entries</span>
                    <span>&middot;</span>
                    <span>{client.stats.unposted_checks} pending checks</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
