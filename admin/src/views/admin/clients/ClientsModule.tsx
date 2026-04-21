import { useEffect, useState, type FormEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../../services/api';
import type { Client, Country, Subscription, ClientStatus, SalesPerson } from '@squadhub/shared';
import SliderPanel from './SliderPanel';
import { PlanPicker } from './NewClientsModule';

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
  country_id: '',
};

export default function ClientsModule() {
  const queryClient = useQueryClient();
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<any>({});
  const [addSubOpen, setAddSubOpen] = useState(false);
  const [addPlanIds, setAddPlanIds] = useState<string[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<typeof EMPTY_CREATE_FORM>(EMPTY_CREATE_FORM);
  const [createPlanIds, setCreatePlanIds] = useState<string[]>([]);
  const [createError, setCreateError] = useState<string | null>(null);

  const { data: clientsRes, isLoading } = useQuery({
    queryKey: ['admin-clients'],
    queryFn: () => api.get('/admin/clients').then((r) => r.data),
  });
  const clients: Client[] = clientsRes?.data || [];

  const { data: catalogRes } = useQuery({
    queryKey: ['admin-subs-catalog'],
    queryFn: () => api.get('/admin/subscriptions').then((r) => r.data),
  });
  const catalog: Subscription[] = catalogRes?.data || [];

  const { data: countriesRes } = useQuery({
    queryKey: ['admin-countries'],
    queryFn: () => api.get('/admin/countries').then((r) => r.data),
  });
  const countries: Country[] = countriesRes?.data || [];
  const activeCountries = countries.filter((c) => c.is_active);

  const { data: peopleRes } = useQuery({
    queryKey: ['admin-sales-people'],
    queryFn: () => api.get('/admin/onboarding-links/sales-people').then((r) => r.data),
  });
  const salesPeople: SalesPerson[] = peopleRes?.data || [];

  const updateSpMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: any }) =>
      api.patch(`/admin/clients/${id}/sales-people`, payload).then((r) => r.data),
    onSuccess: () => {
      invalidateAll();
      if (selectedClient) refreshClient(selectedClient.id);
    },
    onError: (err: any) => alert(err?.response?.data?.error || err.message || 'Failed to update sales person'),
  });

  // Default create-form country to first active country once loaded
  useEffect(() => {
    if (!createForm.country_id && activeCountries.length > 0) {
      setCreateForm((prev) => ({ ...prev, country_id: activeCountries[0].id }));
    }
  }, [activeCountries.length]);  // eslint-disable-line react-hooks/exhaustive-deps

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['admin-clients'] });
    queryClient.invalidateQueries({ queryKey: ['admin-clients-count'] });
  };

  const updateClientMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => api.put(`/admin/clients/${id}`, data),
    onSuccess: () => {
      invalidateAll();
      setEditing(false);
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
    mutationFn: ({ clientId, plan_ids }: { clientId: string; plan_ids: string[] }) =>
      api.post(`/admin/clients/${clientId}/subscriptions`, { plan_ids }),
    onSuccess: () => {
      invalidateAll();
      setAddSubOpen(false);
      setAddPlanIds([]);
      if (selectedClient) refreshClient(selectedClient.id);
    },
    onError: (err: any) => alert(err?.response?.data?.error || err.message || 'Failed to add'),
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
    setCreateForm({ ...EMPTY_CREATE_FORM, country_id: activeCountries[0]?.id || '' });
    setCreatePlanIds([]);
    setCreateError(null);
    setCreateOpen(true);
  }

  function closeCreate() {
    setCreateOpen(false);
    setCreateForm({ ...EMPTY_CREATE_FORM, country_id: activeCountries[0]?.id || '' });
    setCreatePlanIds([]);
    setCreateError(null);
  }

  function submitCreate(e: FormEvent) {
    e.preventDefault();
    setCreateError(null);
    createClientMutation.mutate({
      ...createForm,
      plan_ids: createPlanIds,
    });
  }

  function togglePlanFor(list: string[], setList: (v: string[]) => void, id: string) {
    setList(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  }

  async function refreshClient(id: string) {
    const res = await api.get(`/admin/clients/${id}`);
    if (res.data?.data) setSelectedClient(res.data.data);
  }

  function openClient(client: Client) {
    setSelectedClient(client);
    setEditing(false);
    setAddSubOpen(false);
    setAddPlanIds([]);
  }

  function closeSlider() {
    setSelectedClient(null);
    setEditing(false);
    setAddSubOpen(false);
    setAddPlanIds([]);
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
      country_id: selectedClient.country_id,
    });
    setEditing(true);
  }

  const filtered = clients.filter((c) =>
    c.business_name.toLowerCase().includes(search.toLowerCase()) ||
    c.contact_person.toLowerCase().includes(search.toLowerCase())
  );

  const createSelectedCountry = activeCountries.find((c) => c.id === createForm.country_id) || null;
  const selectedClientCountry = selectedClient ? countries.find((c) => c.id === selectedClient.country_id) || null : null;

  const assignedSubscriptionIds = new Set((selectedClient?.subscriptions || []).map((cs) => cs.subscription_id));
  const addCatalog = catalog.filter((s) => s.is_active && !assignedSubscriptionIds.has(s.id));

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
          {filtered.map((client) => {
            const countryName = client.country?.name || countries.find((c) => c.id === client.country_id)?.name || '—';
            return (
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
                  {client.primary_sales_person && (
                    <span className="rounded-full bg-orange-50 px-2 py-0.5 text-[10px] font-medium text-orange-700">
                      SP: {client.primary_sales_person.display_name}
                    </span>
                  )}
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                    {countryName}
                  </span>
                  <span className="text-xs text-[#90A1B9]">
                    {client.subscriptions?.filter((s) => s.status === 'active').length || 0} active subs
                  </span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${STATUS_BADGE[client.status]}`}>
                    {client.status}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Client Detail Slider */}
      <SliderPanel open={!!selectedClient} onClose={closeSlider} title={selectedClient?.business_name || 'Client'} width="w-[560px]">
        {selectedClient && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className={`rounded-full px-3 py-1 text-xs font-medium capitalize ${STATUS_BADGE[selectedClient.status]}`}>
                  {selectedClient.status}
                </span>
                <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
                  {selectedClientCountry?.name || '—'}
                </span>
              </div>
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
                  <CountryField
                    countries={activeCountries}
                    value={editForm.country_id}
                    onChange={(v) => setEditForm({ ...editForm, country_id: v })}
                  />
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

            {/* Sales Attribution */}
            <div className="space-y-3">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-[#90A1B9]">Sales Attribution</h4>
              <div>
                <label className="mb-1 block text-xs text-[#62748E]">Primary Sales Person</label>
                <select
                  value={selectedClient.primary_sales_person_id || ''}
                  onChange={(e) => updateSpMutation.mutate({
                    id: selectedClient.id,
                    payload: { primary_sales_person_id: e.target.value || null },
                  })}
                  className="w-full rounded-md border border-[#E2E8F0] bg-white px-3 py-2 text-sm text-[#0F172B] focus:border-[#2962FF] focus:outline-none"
                >
                  <option value="">— Not assigned —</option>
                  {salesPeople.map((p) => (
                    <option key={p.id} value={p.id}>{p.display_name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-[#62748E]">Secondary Sales Person</label>
                <select
                  value={selectedClient.secondary_sales_person_id || ''}
                  onChange={(e) => updateSpMutation.mutate({
                    id: selectedClient.id,
                    payload: { secondary_sales_person_id: e.target.value || null },
                  })}
                  className="w-full rounded-md border border-[#E2E8F0] bg-white px-3 py-2 text-sm text-[#0F172B] focus:border-[#2962FF] focus:outline-none"
                >
                  <option value="">— None —</option>
                  {salesPeople
                    .filter((p) => p.id !== selectedClient.primary_sales_person_id)
                    .map((p) => (
                      <option key={p.id} value={p.id}>{p.display_name}</option>
                    ))}
                </select>
              </div>
            </div>

            {/* Subscriptions */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-[#90A1B9]">Subscriptions</h4>
                <button onClick={() => setAddSubOpen(!addSubOpen)} className="text-xs text-[#2962FF] hover:underline">
                  + Add Subscription
                </button>
              </div>

              {addSubOpen && (
                <div className="mb-3 space-y-3 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-3">
                  <PlanPicker
                    catalog={addCatalog}
                    country={selectedClientCountry}
                    selectedPlanIds={addPlanIds}
                    onToggle={(id) => togglePlanFor(addPlanIds, setAddPlanIds, id)}
                  />
                  <button
                    onClick={() => addSubsMutation.mutate({ clientId: selectedClient.id, plan_ids: addPlanIds })}
                    disabled={addPlanIds.length === 0 || addSubsMutation.isPending}
                    className="w-full rounded-md bg-[#0F172B] px-3 py-2 text-xs font-medium text-white hover:bg-[#1E293B] disabled:opacity-50"
                  >
                    {addSubsMutation.isPending ? 'Adding...' : `Add ${addPlanIds.length} Plan(s)`}
                  </button>
                </div>
              )}

              {(!selectedClient.subscriptions || selectedClient.subscriptions.length === 0) ? (
                <p className="py-4 text-center text-xs text-[#90A1B9]">No subscriptions assigned yet.</p>
              ) : (
                <div className="space-y-2">
                  {selectedClient.subscriptions.map((cs) => {
                    const priceRow = cs.plan?.pricing?.find((p) => p.country_id === selectedClient.country_id);
                    const sym = selectedClientCountry?.currency === 'USD' ? '$' : '\u20B9';
                    const locale = selectedClientCountry?.currency === 'USD' ? 'en-US' : 'en-IN';
                    const priceLabel = priceRow
                      ? `${sym}${priceRow.price.toLocaleString(locale)}/mo`
                      : 'No price set';
                    return (
                      <div
                        key={cs.id}
                        className={`rounded-lg border border-[#E2E8F0] bg-white px-4 py-3 ${cs.status === 'cancelled' ? 'opacity-50' : ''}`}
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-medium text-[#0F172B]">{cs.subscription?.name || 'Unknown'}</p>
                            <p className="mt-0.5 text-xs text-[#90A1B9]">
                              {cs.plan?.plan || '—'} · {cs.plan?.tier || '—'} · {priceLabel}
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
                    );
                  })}
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
            <CountryField
              countries={activeCountries}
              value={createForm.country_id}
              onChange={(v) => { setCreateForm({ ...createForm, country_id: v }); setCreatePlanIds([]); }}
            />
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
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#90A1B9]">
              Assign Plans {createSelectedCountry ? `(${createSelectedCountry.currency} pricing for ${createSelectedCountry.name})` : ''} *
            </h4>
            <PlanPicker
              catalog={catalog}
              country={createSelectedCountry}
              selectedPlanIds={createPlanIds}
              onToggle={(id) => togglePlanFor(createPlanIds, setCreatePlanIds, id)}
            />
          </div>

          {createError && (
            <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{createError}</div>
          )}

          <div className="flex gap-2 pt-2">
            <button
              type="submit"
              disabled={createPlanIds.length === 0 || !createForm.country_id || createClientMutation.isPending}
              className="flex-1 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:opacity-50"
            >
              {createClientMutation.isPending ? 'Creating...' : `Create Client (${createPlanIds.length} plans)`}
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

function CountryField({
  countries, value, onChange,
}: {
  countries: Country[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-[#62748E]">Country *</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required
        className="w-full rounded-lg border border-[#E2E8F0] bg-white px-3 py-2 text-sm text-[#0F172B] focus:border-[#2962FF] focus:outline-none focus:ring-1 focus:ring-[#2962FF]"
      >
        <option value="">Select a country…</option>
        {countries.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name} ({c.currency})
          </option>
        ))}
      </select>
    </div>
  );
}
