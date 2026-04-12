import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../../services/api';
import { useState } from 'react';

interface ClientWithAccess {
  id: string;
  business_name: string;
  contact_person: string;
  email: string;
  status: string;
  cash_book: { client_id: string; is_enabled: boolean; created_at: string } | null;
}

export default function ClientAccessModule() {
  const queryClient = useQueryClient();
  const [expandedClient, setExpandedClient] = useState<string | null>(null);

  const { data: clientsRes, isLoading } = useQuery({
    queryKey: ['admin-cashbook-clients'],
    queryFn: () => api.get('/admin/cashbook/clients').then((r) => r.data),
  });

  const enableMutation = useMutation({
    mutationFn: (clientId: string) => api.post(`/admin/cashbook/clients/${clientId}/enable`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-cashbook-clients'] });
      queryClient.invalidateQueries({ queryKey: ['admin-cashbook-stats'] });
    },
  });

  const disableMutation = useMutation({
    mutationFn: (clientId: string) => api.post(`/admin/cashbook/clients/${clientId}/disable`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-cashbook-clients'] });
      queryClient.invalidateQueries({ queryKey: ['admin-cashbook-stats'] });
    },
  });

  const clients: ClientWithAccess[] = clientsRes?.data || [];

  const { data: usersRes } = useQuery({
    queryKey: ['admin-cashbook-client-users', expandedClient],
    queryFn: () => api.get(`/admin/cashbook/clients/${expandedClient}/users`).then((r) => r.data),
    enabled: !!expandedClient,
  });

  if (isLoading) {
    return <div className="flex items-center justify-center py-12 text-sm text-[#64748B]">Loading clients...</div>;
  }

  return (
    <div>
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-[#0F172B]">Client Access</h3>
        <p className="text-sm text-[#64748B]">Enable or disable cash book for your clients</p>
      </div>

      <div className="space-y-2">
        {clients.map((client) => {
          const isEnabled = client.cash_book?.is_enabled === true;
          const isExpanded = expandedClient === client.id;

          return (
            <div key={client.id} className="overflow-hidden rounded-lg border border-[#E2E8F0] bg-white">
              <div className="flex items-center justify-between px-4 py-3">
                <button
                  className="flex flex-1 items-center gap-3 text-left"
                  onClick={() => setExpandedClient(isExpanded ? null : client.id)}
                >
                  <div>
                    <p className="text-sm font-medium text-[#0F172B]">{client.business_name}</p>
                    <p className="text-xs text-[#64748B]">{client.contact_person} &middot; {client.email}</p>
                  </div>
                </button>
                <div className="flex items-center gap-3">
                  {isEnabled && (
                    <span className="rounded-full bg-[#DCFCE7] px-2 py-0.5 text-[10px] font-semibold text-[#16A34A]">
                      Active
                    </span>
                  )}
                  <button
                    onClick={() => {
                      if (isEnabled) {
                        disableMutation.mutate(client.id);
                      } else {
                        enableMutation.mutate(client.id);
                      }
                    }}
                    disabled={enableMutation.isPending || disableMutation.isPending}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                      isEnabled
                        ? 'border border-[#FCA5A5] text-[#DC2626] hover:bg-[#FEF2F2]'
                        : 'bg-[#2962FF] text-white hover:bg-[#1E50D8]'
                    }`}
                  >
                    {isEnabled ? 'Disable' : 'Enable'}
                  </button>
                </div>
              </div>

              {/* Expanded: show cash book users */}
              {isExpanded && isEnabled && (
                <div className="border-t border-[#E2E8F0] bg-[#F8FAFC] px-4 py-3">
                  <p className="mb-2 text-xs font-medium text-[#475569]">Cash Book Users</p>
                  {(usersRes?.data || []).length === 0 ? (
                    <p className="text-xs text-[#94A3B8]">No users yet. The client admin will be assigned when they register.</p>
                  ) : (
                    <div className="space-y-1">
                      {(usersRes?.data || []).map((cbUser: any) => (
                        <div key={cbUser.id} className="flex items-center justify-between rounded-md bg-white px-3 py-2">
                          <div className="flex items-center gap-2">
                            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[#EEF2FF] text-[10px] font-semibold text-[#2962FF]">
                              {(cbUser.user?.display_name || '?')[0].toUpperCase()}
                            </div>
                            <div>
                              <p className="text-xs font-medium text-[#0F172B]">{cbUser.user?.display_name || 'Unknown'}</p>
                              <p className="text-[10px] text-[#94A3B8]">{cbUser.user?.email}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                              cbUser.role === 'client_admin'
                                ? 'bg-[#EEF2FF] text-[#2962FF]'
                                : 'bg-[#F1F5F9] text-[#64748B]'
                            }`}>
                              {cbUser.role === 'client_admin' ? 'Admin' : 'Staff'}
                            </span>
                            {!cbUser.is_active && (
                              <span className="rounded-full bg-[#FEF2F2] px-2 py-0.5 text-[10px] font-semibold text-[#DC2626]">
                                Inactive
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {clients.length === 0 && (
          <div className="rounded-lg border border-dashed border-[#CBD5E1] py-12 text-center text-sm text-[#94A3B8]">
            No active clients found. Add clients first from the Clients module.
          </div>
        )}
      </div>
    </div>
  );
}
