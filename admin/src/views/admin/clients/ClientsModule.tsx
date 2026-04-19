import { useState, type FormEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../../services/api';
import type { Client, Subscription, ClientStatus } from '@squadhub/shared';
import SliderPanel from './SliderPanel';

const STATUS_BADGE: Record<string, string> = {
  active: 'bg-emerald-100 text-emerald-700',
  paused: 'bg-amber-100 text-amber-700',
  cancelled: 'bg-red-100 text-red-700',
};

const EMPTY_CREATE_FORM = {
  business_name: '',
  contact_person: '',
  designation: '',
  contact_number: '',
  email: '',
  business_address: '',
  gst_registered: false,
  gst_number: '',
  accounts_email: '',
};

export default function ClientsModule() {
  const queryClient = useQueryClient();
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<any>({});
  const [addSubOpen, setAddSubOpen] = useState(false);
  const [newSubIds, setNewSubIds] = useState<string[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<typeof EMPTY_CREATE_FORM>(EMPTY_CREATE_FORM);
  const [createSubIds, setCreateSubIds] = useState<string[]>([]);
  const [createError, setCreateError] = useState<string | null>(null);

  const { data: clientsRes, isLoading } = useQuery({
    queryKey: ['admin-clients'],
    queryFn: () => api.get('/admin/clients').then((r) => r.data),
  });
  const clients: Client[] = clientsRes?.data || [];

  const { data: subscriptionsRes } = useQuery({
    queryKey: ['admin-subscriptions'],
    queryFn: () => api.get('/admin/clients/subscriptions').then((r) => r.data),
  });
  const allSubscriptions: Subscription[] = subscriptionsRes?.data || [];

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['admin-clients'] });
    queryClient.invalidateQueries({ queryKey: ['admin-clients-count'] });
  };

  const updateClientMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => api.put(`/admin/clients/${id}`, data),
    onSuccess: (res) => {
      invalidateAll();
      setEditing(false);
      // Refresh selected client
      if (selectedClient) refreshClient(selectedClient.id);
    },
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: ClientStatus }) =>
      api.put(`/admin/clients/${id}/status`, { status }),
    onSuccess: (res) => {
      invalidateAll();
      if (res.data?.data) setSelectedClient(res.data.data);
    },
  });

  const addSubsMutation = useMutation({
    mutationFn: ({ clientId, subscription_ids }: { clientId: string; subscription_ids: string[] }) =>
      api.post(`/admin/clients/${clientId}/subscriptions`, { subscription_ids }),
    onSuccess: () => {
      invalidateAll();
      setAddSubOpen(false);
      setNewSubIds([]);
      if (selectedClient) refreshClient(selectedClient.id);
    },
  });

  const subStatusMutation = useMutation({
    mutationFn: ({ clientId, csId, status }: { clientId: string; csId: string; status: string }) =>
      api.put(`/admin/clients/${clientId}/subscriptions/${csId}/status`, { status }),
    onSuccess: () => {
      invalidateAll();
      if (selectedClient) refreshClient(selectedClient.id);
    },
  });

  const removeSubMutation = useMutation({
    mutationFn: ({ clientId, csId }: { clientId: string; csId: string }) =>
      api.delete(`/admin/clients/${clientId}/subscriptions/${csId}`),
    onSuccess: () => {
      invalidateAll();
      if (selectedClient) refreshClient(selectedClient.id);
    },
  });

  const createClientMutation = useMutation({
    mutationFn: (data: any) => api.post('/admin/clients', data).then((r) => r.data),
    onSuccess: (res) => {
      if (res?.success === false) {
        setCreateError(res.error || 'Failed to create client');
        return;
      }
      invalidateAll();
      closeCreate();
    },
    onError: (err: any) => {
      setCreateError(err?.response?.data?.error || err?.message || 'Failed to create client');
    },
  });

  function openCreate() {
    setCreateForm(EMPTY_CREATE_FORM);
    setCreateSubIds([]);
    setCreateError(null);
    setCreateOpen(true);
  }

  function closeCreate() {
    setCreateOpen(false);
    setCreateForm(EMPTY_CREATE_FORM);
    setCreateSubIds([]);
    setCreateError(null);
  }

  function submitCreate(e: FormEvent) {
    e.preventDefault();
    setCreateError(null);
    createClientMutation.mutate({
      ...createForm,
      subscription_ids: createSubIds,
    });
  }

  async function refreshClient(id: string) {
    const res = await api.get(`/admin/clients/${id}`);
    if (res.data?.data) setSelectedClient(res.data.data);
  }

  function openClient(client: Client) {
    setSelectedClient(client);
    setEditing(false);
    setAddSubOpen(false);
  }

  function closeSlider() {
    setSelectedClient(null);
    setEditing(false);
    setAddSubOpen(false);
  }

  function startEdit() {
    if (!selectedClient) return;
    setEditForm({
      business_name: selectedClient.business_name,
      contact_person: selectedClient.contact_person,
      designation: selectedClient.designation || '',
      contact_number: selectedClient.contact_number,
      email: selectedClient.email,
      business_address: selectedClient.business_address,
      gst_registered: selectedClient.gst_registered,
      gst_number: selectedClient.gst_number || '',
      accounts_email: selectedClient.accounts_email || '',
    });
    setEditing(true);
  }

  const filtered = clients.filter((c) =>
    c.business_name.toLowerCase().includes(search.toLowerCase()) ||
    c.contact_person.toLowerCase().includes(search.toLowerCase())
  );

  const activeSubTotal = selectedClient?.subscriptions
    ?.filter((cs) => cs.status === 'active')
    .reduce((sum, cs) => sum + (cs.subscription?.price || 0), 0) || 0;

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-xl font-bold text-[#0F172B]">Clients</h1>
          <p className="mt-1 text-sm text-[#62748E]">Manage active clients and their subscriptions</p>
        </div>
        <button
          onClick={openCreate}
          className="rounded-lg bg-[#0F172B] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#1E293B]"
        >
          + New Client
        </button>
      </div>

      <div className="mb-4">
        <input
          type="text"
          placeholder="Search clients..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full max-w-sm rounded-lg border border-[#E2E8F0] bg-white px-3 py-2 text-sm text-[#0F172B] placeholder-[#90A1B9] focus:border-[#2962FF] focus:outline-none focus:ring-1 focus:ring-[#2962FF]"
        />
      </div>

      {isLoading ? (
        <p className="py-8 text-center text-sm text-[#90A1B9]">Loading...</p>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-[#E2E8F0] bg-white py-12 text-center">
          <p className="text-sm text-[#90A1B9]">{search ? 'No matching clients.' : 'No clients yet. Click + New Client to add one, or share the onboarding link.'}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((client) => (
            <button
              key={client.id}
              onClick={() => openClient(client)}
              className={`flex w-full items-center justify-between rounded-lg border border-[#E2E8F0] bg-white px-5 py-4 text-left transition hover:shadow-sm ${
                client.status === 'cancelled' ? 'opacity-50' : ''
              }`}
            >
              <div className="flex items-center gap-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-600 text-sm font-semibold">
                  {client.business_name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <p className="text-sm font-medium text-[#0F172B]">{client.business_name}</p>
                  <p className="mt-0.5 text-xs text-[#62748E]">{client.contact_person}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-[#90A1B9]">
                  {client.subscriptions?.filter((s) => s.status === 'active').length || 0} active subs
                </span>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${STATUS_BADGE[client.status]}`}>
                  {client.status}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Client Detail Slider */}
      <SliderPanel open={!!selectedClient} onClose={closeSlider} title={selectedClient?.business_name || 'Client'} width="w-[560px]">
        {selectedClient && (
          <div className="space-y-6">
            {/* Status badge & actions */}
            <div className="flex items-center justify-between">
              <span className={`rounded-full px-3 py-1 text-xs font-medium capitalize ${STATUS_BADGE[selectedClient.status]}`}>
                {selectedClient.status}
              </span>
              <div className="flex gap-2">
                {selectedClient.status === 'active' && (
                  <>
                    <button onClick={() => statusMutation.mutate({ id: selectedClient.id, status: 'paused' })} className="rounded-md bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-100">Pause All</button>
                    <button onClick={() => statusMutation.mutate({ id: selectedClient.id, status: 'cancelled' })} className="rounded-md bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100">Cancel All</button>
                  </>
                )}
                {selectedClient.status === 'paused' && (
                  <>
                    <button onClick={() => statusMutation.mutate({ id: selectedClient.id, status: 'active' })} className="rounded-md bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100">Resume All</button>
                    <button onClick={() => statusMutation.mutate({ id: selectedClient.id, status: 'cancelled' })} className="rounded-md bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100">Cancel All</button>
                  </>
                )}
                {selectedClient.status === 'cancelled' && (
                  <button onClick={() => statusMutation.mutate({ id: selectedClient.id, status: 'active' })} className="rounded-md bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100">Reactivate</button>
                )}
              </div>
            </div>

            {/* Client info */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-[#90A1B9]">Client Info</h4>
                {!editing && (
                  <button onClick={startEdit} className="text-xs text-[#2962FF] hover:underline">Edit</button>
                )}
              </div>

              {editing ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    updateClientMutation.mutate({ id: selectedClient.id, data: editForm });
                  }}
                  className="space-y-3"
                >
                  <FormField label="Business Name" value={editForm.business_name} onChange={(v) => setEditForm({ ...editForm, business_name: v })} required />
                  <FormField label="Contact Person" value={editForm.contact_person} onChange={(v) => setEditForm({ ...editForm, contact_person: v })} required />
                  <FormField label="Designation" value={editForm.designation} onChange={(v) => setEditForm({ ...editForm, designation: v })} />
                  <FormField label="Contact Number" value={editForm.contact_number} onChange={(v) => setEditForm({ ...editForm, contact_number: v })} required />
                  <FormField label="Email" value={editForm.email} onChange={(v) => setEditForm({ ...editForm, email: v })} type="email" required />
                  <div>
                    <label className="mb-1 block text-xs font-medium text-[#62748E]">Business Address</label>
                    <textarea
                      value={editForm.business_address}
                      onChange={(e) => setEditForm({ ...editForm, business_address: e.target.value })}
                      required
                      rows={2}
                      className="w-full rounded-lg border border-[#E2E8F0] px-3 py-2 text-sm text-[#0F172B] focus:border-[#2962FF] focus:outline-none focus:ring-1 focus:ring-[#2962FF]"
                    />
                  </div>
                  <div className="flex gap-2 pt-2">
                    <button type="submit" disabled={updateClientMutation.isPending} className="rounded-lg bg-[#0F172B] px-4 py-2 text-sm font-medium text-white hover:bg-[#1E293B] disabled:opacity-50">
                      {updateClientMutation.isPending ? 'Saving...' : 'Save Changes'}
                    </button>
                    <button type="button" onClick={() => setEditing(false)} className="rounded-lg border border-[#E2E8F0] px-4 py-2 text-sm text-[#62748E] hover:bg-[#F1F5F9]">Cancel</button>
                  </div>
                </form>
              ) : (
                <div className="space-y-2">
                  <InfoRow label="Contact Person" value={selectedClient.contact_person} />
                  {selectedClient.designation && <InfoRow label="Designation" value={selectedClient.designation} />}
                  <InfoRow label="Contact Number" value={selectedClient.contact_number} />
                  <InfoRow label="Email" value={selectedClient.email} />
                  <InfoRow label="Business Address" value={selectedClient.business_address} />
                  <InfoRow label="GST Registered" value={selectedClient.gst_registered ? 'Yes' : 'No'} />
                  {selectedClient.gst_number && <InfoRow label="GST Number" value={selectedClient.gst_number} />}
                  {selectedClient.accounts_email && <InfoRow label="Accounts Email" value={selectedClient.accounts_email} />}
                </div>
              )}
            </div>

            {/* Subscriptions */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-[#90A1B9]">Subscriptions</h4>
                <button onClick={() => setAddSubOpen(!addSubOpen)} className="text-xs text-[#2962FF] hover:underline">
                  + Add Subscription
                </button>
              </div>

              {/* Add subscription multi-select */}
              {addSubOpen && (
                <div className="mb-3 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-3">
                  {/* Selected chips */}
                  {newSubIds.length > 0 && (
                    <div className="mb-2 flex flex-wrap gap-1.5">
                      {newSubIds.map((id) => {
                        const sub = allSubscriptions.find((s) => s.id === id);
                        return sub ? (
                          <span key={id} className="inline-flex items-center gap-1 rounded-full bg-[#0F172B] px-2.5 py-1 text-xs text-white">
                            {sub.name}
                            <button onClick={() => setNewSubIds((p) => p.filter((s) => s !== id))} className="hover:text-red-300">
                              <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </span>
                        ) : null;
                      })}
                    </div>
                  )}
                  <div className="max-h-48 overflow-y-auto">
                    {Object.entries(
                      allSubscriptions
                        .filter((s) => !selectedClient.subscriptions?.some((cs) => cs.subscription_id === s.id))
                        .reduce<Record<string, typeof allSubscriptions>>((acc, sub) => {
                          (acc[sub.squad] = acc[sub.squad] || []).push(sub);
                          return acc;
                        }, {})
                    ).map(([squad, subs]) => (
                      <div key={squad} className="mb-2">
                        <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-[#90A1B9]">{squad}</p>
                        {subs.map((sub) => (
                          <label key={sub.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-white">
                            <input
                              type="checkbox"
                              checked={newSubIds.includes(sub.id)}
                              onChange={() => setNewSubIds((p) => p.includes(sub.id) ? p.filter((s) => s !== sub.id) : [...p, sub.id])}
                              className="rounded border-[#E2E8F0] text-[#2962FF] focus:ring-[#2962FF]"
                            />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-[#0F172B]">{sub.name}</p>
                              <p className="text-xs text-[#90A1B9]">{sub.level} · {sub.plan} · ₹{sub.price.toLocaleString('en-IN')}/mo</p>
                            </div>
                          </label>
                        ))}
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={() => addSubsMutation.mutate({ clientId: selectedClient.id, subscription_ids: newSubIds })}
                    disabled={newSubIds.length === 0 || addSubsMutation.isPending}
                    className="mt-2 w-full rounded-lg bg-[#0F172B] px-3 py-2 text-xs font-medium text-white hover:bg-[#1E293B] disabled:opacity-50"
                  >
                    {addSubsMutation.isPending ? 'Adding...' : `Add ${newSubIds.length} Subscription(s)`}
                  </button>
                </div>
              )}

              {/* Current subscriptions list */}
              {(!selectedClient.subscriptions || selectedClient.subscriptions.length === 0) ? (
                <p className="py-4 text-center text-xs text-[#90A1B9]">No subscriptions assigned yet.</p>
              ) : (
                <div className="space-y-4">
                  {Object.entries(
                    selectedClient.subscriptions.reduce<Record<string, typeof selectedClient.subscriptions>>((acc, cs) => {
                      const squad = cs.subscription?.squad || 'Other';
                      (acc[squad] = acc[squad] || []).push(cs);
                      return acc;
                    }, {})
                  ).map(([squad, items]) => (
                    <div key={squad}>
                      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[#90A1B9]">{squad}</p>
                      <div className="space-y-2">
                        {items.map((cs) => (
                          <div
                            key={cs.id}
                            className={`rounded-lg border border-[#E2E8F0] bg-white px-4 py-3 ${cs.status === 'cancelled' ? 'opacity-50' : ''}`}
                          >
                            <div className="flex items-center justify-between">
                              <div>
                                <p className="text-sm font-medium text-[#0F172B]">{cs.subscription?.name || 'Unknown'}</p>
                                <p className="mt-0.5 text-xs text-[#90A1B9]">
                                  {cs.subscription ? `${cs.subscription.level} · ${cs.subscription.plan} · ₹${cs.subscription.price.toLocaleString('en-IN')}/mo` : ''}
                                </p>
                              </div>
                              <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${STATUS_BADGE[cs.status]}`}>
                                {cs.status}
                              </span>
                            </div>
                            <div className="mt-2 flex gap-1.5">
                              {cs.status === 'active' && (
                                <>
                                  <button onClick={() => subStatusMutation.mutate({ clientId: selectedClient.id, csId: cs.id, status: 'paused' })} className="rounded bg-amber-50 px-2 py-1 text-[10px] font-medium text-amber-700 hover:bg-amber-100">Pause</button>
                                  <button onClick={() => subStatusMutation.mutate({ clientId: selectedClient.id, csId: cs.id, status: 'cancelled' })} className="rounded bg-red-50 px-2 py-1 text-[10px] font-medium text-red-700 hover:bg-red-100">Cancel</button>
                                </>
                              )}
                              {cs.status === 'paused' && (
                                <>
                                  <button onClick={() => subStatusMutation.mutate({ clientId: selectedClient.id, csId: cs.id, status: 'active' })} className="rounded bg-emerald-50 px-2 py-1 text-[10px] font-medium text-emerald-700 hover:bg-emerald-100">Resume</button>
                                  <button onClick={() => subStatusMutation.mutate({ clientId: selectedClient.id, csId: cs.id, status: 'cancelled' })} className="rounded bg-red-50 px-2 py-1 text-[10px] font-medium text-red-700 hover:bg-red-100">Cancel</button>
                                </>
                              )}
                              {cs.status === 'cancelled' && (
                                <button onClick={() => subStatusMutation.mutate({ clientId: selectedClient.id, csId: cs.id, status: 'active' })} className="rounded bg-emerald-50 px-2 py-1 text-[10px] font-medium text-emerald-700 hover:bg-emerald-100">Reactivate</button>
                              )}
                              <button onClick={() => removeSubMutation.mutate({ clientId: selectedClient.id, csId: cs.id })} className="rounded bg-[#F1F5F9] px-2 py-1 text-[10px] font-medium text-[#62748E] hover:bg-[#E2E8F0]">Remove</button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Monthly total */}
              {activeSubTotal > 0 && (
                <div className="mt-3 flex items-center justify-between rounded-lg bg-[#F8FAFC] px-4 py-3">
                  <span className="text-xs font-medium text-[#62748E]">Monthly Total (Active)</span>
                  <span className="text-sm font-bold text-[#0F172B]">{'\u20B9'}{activeSubTotal.toLocaleString('en-IN')}/mo</span>
                </div>
              )}
            </div>
          </div>
        )}
      </SliderPanel>

      {/* Create Client Slider */}
      <SliderPanel open={createOpen} onClose={closeCreate} title="Create Client" width="w-[560px]">
        <form onSubmit={submitCreate} className="space-y-6">
          <div className="space-y-3">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-[#90A1B9]">Business Details</h4>
            <FormField label="Business Name" value={createForm.business_name} onChange={(v) => setCreateForm({ ...createForm, business_name: v })} required />
            <FormField label="Contact Person" value={createForm.contact_person} onChange={(v) => setCreateForm({ ...createForm, contact_person: v })} required />
            <FormField label="Designation" value={createForm.designation} onChange={(v) => setCreateForm({ ...createForm, designation: v })} />
            <FormField label="Contact Number" value={createForm.contact_number} onChange={(v) => setCreateForm({ ...createForm, contact_number: v })} required />
            <FormField label="Email" value={createForm.email} onChange={(v) => setCreateForm({ ...createForm, email: v })} type="email" required />
            <div>
              <label className="mb-1 block text-xs font-medium text-[#62748E]">Business Address *</label>
              <textarea
                value={createForm.business_address}
                onChange={(e) => setCreateForm({ ...createForm, business_address: e.target.value })}
                required
                rows={2}
                className="w-full rounded-lg border border-[#E2E8F0] px-3 py-2 text-sm text-[#0F172B] focus:border-[#2962FF] focus:outline-none focus:ring-1 focus:ring-[#2962FF]"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-[#62748E]">GST Registered *</label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 text-sm text-[#0F172B]">
                  <input
                    type="radio"
                    checked={createForm.gst_registered === true}
                    onChange={() => setCreateForm({ ...createForm, gst_registered: true })}
                    className="text-[#2962FF] focus:ring-[#2962FF]"
                  />
                  Yes
                </label>
                <label className="flex items-center gap-2 text-sm text-[#0F172B]">
                  <input
                    type="radio"
                    checked={createForm.gst_registered === false}
                    onChange={() => setCreateForm({ ...createForm, gst_registered: false, gst_number: '' })}
                    className="text-[#2962FF] focus:ring-[#2962FF]"
                  />
                  No
                </label>
              </div>
            </div>
            {createForm.gst_registered && (
              <FormField label="GST Number" value={createForm.gst_number} onChange={(v) => setCreateForm({ ...createForm, gst_number: v })} />
            )}
            <FormField label="Accounts Email" value={createForm.accounts_email} onChange={(v) => setCreateForm({ ...createForm, accounts_email: v })} type="email" />
          </div>

          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#90A1B9]">Assign Subscriptions *</h4>

            {createSubIds.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-1.5">
                {createSubIds.map((id) => {
                  const sub = allSubscriptions.find((s) => s.id === id);
                  return sub ? (
                    <span key={id} className="inline-flex items-center gap-1 rounded-full bg-[#0F172B] px-2.5 py-1 text-xs text-white">
                      {sub.name}
                      <button type="button" onClick={() => setCreateSubIds((p) => p.filter((s) => s !== id))} className="ml-0.5 hover:text-red-300">
                        <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </span>
                  ) : null;
                })}
              </div>
            )}

            <div className="max-h-64 overflow-y-auto rounded-lg border border-[#E2E8F0] p-2">
              {allSubscriptions.length === 0 ? (
                <p className="py-4 text-center text-xs text-[#90A1B9]">No subscriptions created yet. Create some first.</p>
              ) : (
                Object.entries(
                  allSubscriptions.reduce<Record<string, typeof allSubscriptions>>((acc, sub) => {
                    (acc[sub.squad] = acc[sub.squad] || []).push(sub);
                    return acc;
                  }, {})
                ).map(([squad, subs]) => (
                  <div key={squad} className="mb-2">
                    <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-[#90A1B9]">{squad}</p>
                    {subs.map((sub) => (
                      <label
                        key={sub.id}
                        className={`flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm transition ${
                          createSubIds.includes(sub.id) ? 'bg-blue-50' : 'hover:bg-[#F8FAFC]'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={createSubIds.includes(sub.id)}
                          onChange={() => setCreateSubIds((p) => p.includes(sub.id) ? p.filter((s) => s !== sub.id) : [...p, sub.id])}
                          className="rounded border-[#E2E8F0] text-[#2962FF] focus:ring-[#2962FF]"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-[#0F172B]">{sub.name}</p>
                          <p className="text-xs text-[#90A1B9]">{sub.level} · {sub.plan} · ₹{sub.price.toLocaleString('en-IN')}/mo</p>
                        </div>
                      </label>
                    ))}
                  </div>
                ))
              )}
            </div>
          </div>

          {createError && (
            <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{createError}</div>
          )}

          <div className="flex gap-2 pt-2">
            <button
              type="submit"
              disabled={createSubIds.length === 0 || createClientMutation.isPending}
              className="flex-1 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:opacity-50"
            >
              {createClientMutation.isPending ? 'Creating...' : `Create Client (${createSubIds.length} subscriptions)`}
            </button>
            <button
              type="button"
              onClick={closeCreate}
              className="rounded-lg border border-[#E2E8F0] px-4 py-2.5 text-sm font-medium text-[#62748E] transition hover:bg-[#F1F5F9]"
            >
              Cancel
            </button>
          </div>
        </form>
      </SliderPanel>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between border-b border-[#F1F5F9] pb-2">
      <span className="text-xs text-[#90A1B9]">{label}</span>
      <span className="text-sm text-[#0F172B] text-right max-w-[280px]">{value}</span>
    </div>
  );
}

function FormField({ label, value, onChange, type = 'text', required = false }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; required?: boolean;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-[#62748E]">{label}{required ? ' *' : ''}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        className="w-full rounded-lg border border-[#E2E8F0] px-3 py-2 text-sm text-[#0F172B] focus:border-[#2962FF] focus:outline-none focus:ring-1 focus:ring-[#2962FF]"
      />
    </div>
  );
}
