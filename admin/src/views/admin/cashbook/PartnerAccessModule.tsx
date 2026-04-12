import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../../services/api';

interface PartnerUser {
  id: string;
  display_name: string;
  email: string;
}

interface PartnerAccessRecord {
  id: string;
  user_id: string;
  client_id: string;
  is_enabled: boolean;
  created_at: string;
  user: { id: string; display_name: string; email: string } | null;
  client: { id: string; business_name: string } | null;
}

export default function PartnerAccessModule() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [selectedPartnerId, setSelectedPartnerId] = useState('');
  const [selectedClientIds, setSelectedClientIds] = useState<string[]>([]);

  // Fetch existing partner access records
  const { data: accessRes, isLoading } = useQuery({
    queryKey: ['admin-cashbook-partner-access'],
    queryFn: () => api.get('/admin/cashbook/partner-access').then((r) => r.data),
  });

  // Fetch partner users for dropdown
  const { data: partnersRes } = useQuery({
    queryKey: ['admin-cashbook-partner-users'],
    queryFn: () => api.get('/admin/cashbook/partner-access/partners').then((r) => r.data),
    enabled: showForm,
  });

  // Fetch clients for multi-select
  const { data: clientsRes } = useQuery({
    queryKey: ['admin-cashbook-clients'],
    queryFn: () => api.get('/admin/cashbook/clients').then((r) => r.data),
    enabled: showForm,
  });

  const grantMutation = useMutation({
    mutationFn: (body: { user_id: string; client_ids: string[] }) =>
      api.post('/admin/cashbook/partner-access', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-cashbook-partner-access'] });
      setShowForm(false);
      setSelectedPartnerId('');
      setSelectedClientIds([]);
    },
  });

  const toggleMutation = useMutation({
    mutationFn: (id: string) => api.put(`/admin/cashbook/partner-access/${id}/toggle`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-cashbook-partner-access'] });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/cashbook/partner-access/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-cashbook-partner-access'] });
    },
  });

  const accessRecords: PartnerAccessRecord[] = accessRes?.data || [];
  const partners: PartnerUser[] = partnersRes?.data || [];
  const clients: { id: string; business_name: string }[] = (clientsRes?.data || []).map((c: any) => ({
    id: c.id,
    business_name: c.business_name,
  }));

  // Group access records by partner
  const partnerGroups = new Map<string, PartnerAccessRecord[]>();
  for (const record of accessRecords) {
    const key = record.user_id;
    if (!partnerGroups.has(key)) partnerGroups.set(key, []);
    partnerGroups.get(key)!.push(record);
  }

  const handleToggleClient = (clientId: string) => {
    setSelectedClientIds((prev) =>
      prev.includes(clientId) ? prev.filter((id) => id !== clientId) : [...prev, clientId],
    );
  };

  const handleGrant = () => {
    if (!selectedPartnerId || selectedClientIds.length === 0) return;
    grantMutation.mutate({ user_id: selectedPartnerId, client_ids: selectedClientIds });
  };

  if (isLoading) {
    return <div className="flex items-center justify-center py-12 text-sm text-[#64748B]">Loading partner access...</div>;
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-[#0F172B]">Partner Access</h3>
          <p className="text-sm text-[#64748B]">Manage which partners can view client Cash Book data</p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="rounded-md bg-[#2962FF] px-4 py-2 text-xs font-medium text-white hover:bg-[#1E50D8] transition-colors"
        >
          {showForm ? 'Cancel' : 'Add Partner Access'}
        </button>
      </div>

      {/* Add form */}
      {showForm && (
        <div className="mb-6 rounded-lg border border-[#E2E8F0] bg-white p-4">
          <div className="mb-4">
            <label className="mb-1 block text-xs font-medium text-[#475569]">Select Partner</label>
            <select
              value={selectedPartnerId}
              onChange={(e) => setSelectedPartnerId(e.target.value)}
              className="w-full rounded-md border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-2 text-sm text-[#0F172B] focus:border-[#2962FF] focus:outline-none focus:ring-1 focus:ring-[#2962FF]"
            >
              <option value="">Choose a partner...</option>
              {partners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.display_name} ({p.email})
                </option>
              ))}
            </select>
          </div>

          <div className="mb-4">
            <label className="mb-1 block text-xs font-medium text-[#475569]">
              Select Clients ({selectedClientIds.length} selected)
            </label>
            <div className="max-h-48 overflow-y-auto rounded-md border border-[#E2E8F0] bg-[#F8FAFC]">
              {clients.length === 0 ? (
                <p className="p-3 text-xs text-[#94A3B8]">No clients available</p>
              ) : (
                clients.map((client) => (
                  <label
                    key={client.id}
                    className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-[#EEF2FF] transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={selectedClientIds.includes(client.id)}
                      onChange={() => handleToggleClient(client.id)}
                      className="h-3.5 w-3.5 rounded border-[#CBD5E1] text-[#2962FF] focus:ring-[#2962FF]"
                    />
                    <span className="text-[#0F172B]">{client.business_name}</span>
                  </label>
                ))
              )}
            </div>
          </div>

          <button
            onClick={handleGrant}
            disabled={!selectedPartnerId || selectedClientIds.length === 0 || grantMutation.isPending}
            className="rounded-md bg-[#2962FF] px-4 py-2 text-xs font-medium text-white hover:bg-[#1E50D8] transition-colors disabled:opacity-50"
          >
            {grantMutation.isPending ? 'Granting...' : 'Grant Access'}
          </button>
          {grantMutation.isError && (
            <p className="mt-2 text-xs text-[#DC2626]">Failed to grant access. Please try again.</p>
          )}
        </div>
      )}

      {/* Access records grouped by partner */}
      {partnerGroups.size === 0 ? (
        <div className="rounded-lg border border-dashed border-[#CBD5E1] py-12 text-center text-sm text-[#94A3B8]">
          No partner access configured yet. Click &quot;Add Partner Access&quot; to get started.
        </div>
      ) : (
        <div className="space-y-3">
          {[...partnerGroups.entries()].map(([partnerId, records]) => {
            const partnerName = records[0]?.user?.display_name || 'Unknown Partner';
            const partnerEmail = records[0]?.user?.email || '';

            return (
              <div key={partnerId} className="overflow-hidden rounded-lg border border-[#E2E8F0] bg-white">
                <div className="border-b border-[#E2E8F0] bg-[#F8FAFC] px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[#EDE9FE] text-xs font-semibold text-[#7C3AED]">
                      {partnerName[0]?.toUpperCase() || '?'}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-[#0F172B]">{partnerName}</p>
                      <p className="text-[10px] text-[#94A3B8]">{partnerEmail}</p>
                    </div>
                    <span className="ml-auto rounded-full bg-[#F1F5F9] px-2 py-0.5 text-[10px] font-semibold text-[#64748B]">
                      {records.length} client{records.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                </div>

                <div className="divide-y divide-[#F1F5F9]">
                  {records.map((record) => (
                    <div key={record.id} className="flex items-center justify-between px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-[#0F172B]">{record.client?.business_name || 'Unknown Client'}</span>
                        {!record.is_enabled && (
                          <span className="rounded-full bg-[#FEF2F2] px-2 py-0.5 text-[10px] font-semibold text-[#DC2626]">
                            Disabled
                          </span>
                        )}
                        {record.is_enabled && (
                          <span className="rounded-full bg-[#DCFCE7] px-2 py-0.5 text-[10px] font-semibold text-[#16A34A]">
                            Active
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => toggleMutation.mutate(record.id)}
                          disabled={toggleMutation.isPending}
                          className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
                            record.is_enabled
                              ? 'border border-[#FCA5A5] text-[#DC2626] hover:bg-[#FEF2F2]'
                              : 'border border-[#BBF7D0] text-[#16A34A] hover:bg-[#F0FDF4]'
                          }`}
                        >
                          {record.is_enabled ? 'Disable' : 'Enable'}
                        </button>
                        <button
                          onClick={() => {
                            if (confirm('Remove this access?')) revokeMutation.mutate(record.id);
                          }}
                          disabled={revokeMutation.isPending}
                          className="rounded-md p-1 text-[#94A3B8] hover:bg-[#FEF2F2] hover:text-[#DC2626] transition-colors"
                          title="Remove access"
                        >
                          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
