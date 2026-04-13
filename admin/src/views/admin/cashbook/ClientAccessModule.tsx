import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../../services/api';
import ClientUsersSlider from './ClientUsersSlider';

interface ClientAccessRecord {
  id: string;
  client_id: string;
  is_enabled: boolean;
  created_at: string;
  client: { id: string; business_name: string; contact_person: string; email: string } | null;
}

interface AvailableClient {
  id: string;
  business_name: string;
  contact_person: string;
  email: string;
}

export default function ClientAccessModule() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [selectedClientId, setSelectedClientId] = useState('');
  const [selectedClient, setSelectedClient] = useState<{ id: string; name: string } | null>(null);

  const { data: accessRes, isLoading } = useQuery({
    queryKey: ['admin-cashbook-client-access'],
    queryFn: () => api.get('/admin/cashbook/client-access').then((r) => r.data),
  });

  const { data: availableRes } = useQuery({
    queryKey: ['admin-cashbook-available-clients'],
    queryFn: () => api.get('/admin/cashbook/client-access/available').then((r) => r.data),
    enabled: showForm,
  });

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['admin-cashbook-client-access'] });
    queryClient.invalidateQueries({ queryKey: ['admin-cashbook-available-clients'] });
    queryClient.invalidateQueries({ queryKey: ['admin-cashbook-stats'] });
  };

  const addMutation = useMutation({
    mutationFn: (clientId: string) => api.post('/admin/cashbook/client-access', { client_id: clientId }),
    onSuccess: () => {
      invalidateAll();
      setShowForm(false);
      setSelectedClientId('');
    },
  });

  const toggleMutation = useMutation({
    mutationFn: (id: string) => api.put(`/admin/cashbook/client-access/${id}/toggle`),
    onSuccess: () => invalidateAll(),
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/cashbook/client-access/${id}`),
    onSuccess: () => invalidateAll(),
  });

  const accessRecords: ClientAccessRecord[] = accessRes?.data || [];
  const availableClients: AvailableClient[] = availableRes?.data || [];

  const handleAdd = () => {
    if (!selectedClientId) return;
    addMutation.mutate(selectedClientId);
  };

  if (isLoading) {
    return <div className="flex items-center justify-center py-12 text-sm text-[#64748B]">Loading client access...</div>;
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-[#0F172B]">Client Access</h3>
          <p className="text-sm text-[#64748B]">Manage which clients have access to Cash Book</p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="rounded-md bg-[#2962FF] px-4 py-2 text-xs font-medium text-white hover:bg-[#1E50D8] transition-colors"
        >
          {showForm ? 'Cancel' : 'Add Client'}
        </button>
      </div>

      {showForm && (
        <div className="mb-6 rounded-lg border border-[#E2E8F0] bg-white p-4">
          <div className="mb-4">
            <label className="mb-1 block text-xs font-medium text-[#475569]">Select Client</label>
            <select
              value={selectedClientId}
              onChange={(e) => setSelectedClientId(e.target.value)}
              className="w-full rounded-md border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-2 text-sm text-[#0F172B] focus:border-[#2962FF] focus:outline-none focus:ring-1 focus:ring-[#2962FF]"
            >
              <option value="">Choose a client...</option>
              {availableClients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.business_name} ({c.contact_person})
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={handleAdd}
            disabled={!selectedClientId || addMutation.isPending}
            className="rounded-md bg-[#2962FF] px-4 py-2 text-xs font-medium text-white hover:bg-[#1E50D8] transition-colors disabled:opacity-50"
          >
            {addMutation.isPending ? 'Adding...' : 'Add Client'}
          </button>
          {addMutation.isError && (
            <p className="mt-2 text-xs text-[#DC2626]">Failed to add client. Please try again.</p>
          )}
        </div>
      )}

      {accessRecords.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[#CBD5E1] py-12 text-center text-sm text-[#94A3B8]">
          No clients added yet. Click &quot;Add Client&quot; to get started.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-[#E2E8F0] bg-white">
          <div className="divide-y divide-[#F1F5F9]">
            {accessRecords.map((record) => (
              <div key={record.id} className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#EEF2FF] text-xs font-semibold text-[#2962FF]">
                    {(record.client?.business_name || '?')[0].toUpperCase()}
                  </div>
                  <div>
                    <button
                      onClick={() => setSelectedClient({ id: record.client_id, name: record.client?.business_name || 'Unknown' })}
                      className="text-sm font-medium text-[#2962FF] hover:underline text-left"
                    >
                      {record.client?.business_name || 'Unknown Client'}
                    </button>
                    <p className="text-[10px] text-[#94A3B8]">{record.client?.contact_person} &middot; {record.client?.email}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {record.is_enabled ? (
                    <span className="rounded-full bg-[#DCFCE7] px-2 py-0.5 text-[10px] font-semibold text-[#16A34A]">
                      Active
                    </span>
                  ) : (
                    <span className="rounded-full bg-[#FEF2F2] px-2 py-0.5 text-[10px] font-semibold text-[#DC2626]">
                      Disabled
                    </span>
                  )}
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
                      if (confirm('Remove this client from Cash Book?')) removeMutation.mutate(record.id);
                    }}
                    disabled={removeMutation.isPending}
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
      )}

      <ClientUsersSlider
        clientId={selectedClient?.id || null}
        clientName={selectedClient?.name || ''}
        onClose={() => setSelectedClient(null)}
      />
    </div>
  );
}
