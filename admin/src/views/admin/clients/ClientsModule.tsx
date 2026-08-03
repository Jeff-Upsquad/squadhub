'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../../services/api';
import { useAuthStore } from '../../../stores/authStore';
import type { Client, Country, Subscription, ClientStatus, SalesPerson } from '@squadhub/shared';
import SliderPanel from './SliderPanel';
import { PlanPicker } from './NewClientsModule';
import ClientSubscriptionsPanel from './ClientSubscriptionsPanel';
import ClientAccessPanel from './ClientAccessPanel';
import { openCrmLeadById } from '../../../utils/squadCrm';
import { openSquadhireBusiness, type SquadhireBusinessMatch } from '../../../utils/squadHire';

interface SquadBooksMatch {
  found: boolean;
  orgId?: string;
  customerId?: string;
  customerName?: string;
  matchedBy?: string;
  squadbooksUrl?: string;
}

interface CrmLeadMatch {
  found: boolean;
  lead_id?: string;
  matched_by?: string;
}

interface HireBusinessMatch extends SquadhireBusinessMatch {}

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
  const searchParams = useSearchParams();
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusTab, setStatusTab] = useState<ClientStatus>('active');
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<typeof EMPTY_CREATE_FORM>(EMPTY_CREATE_FORM);
  const [createPlanIds, setCreatePlanIds] = useState<string[]>([]);
  const [createError, setCreateError] = useState<string | null>(null);

  const { data: clientsRes, isLoading } = useQuery({
    queryKey: ['admin-clients'],
    queryFn: () => api.get('/admin/clients').then((r) => r.data),
  });
  const clients: Client[] = clientsRes?.data || [];

  // Access counts per client (from the access endpoint) so each row can show
  // how many users it's shared with — the at-a-glance value of the old
  // standalone Client Access list, kept inside the unified Clients view.
  const { data: accessRes } = useQuery({
    queryKey: ['admin-client-access'],
    queryFn: () => api.get('/admin/client-access').then((r) => r.data),
  });
  const accessCountById = useMemo(() => {
    const m = new Map<string, number>();
    (accessRes?.data || []).forEach((c: { id: string; user_access_count: number }) =>
      m.set(c.id, c.user_access_count || 0));
    return m;
  }, [accessRes]);

  // Deep-link support: ?client=<id> auto-opens that client once the list has
  // loaded, switching the status tab so the row is also visible behind it.
  // Fires once per param value so closing the detail doesn't re-open it.
  const clientParam = searchParams.get('client');
  const handledClientParam = useRef<string | null>(null);
  useEffect(() => {
    if (!clientParam) { handledClientParam.current = null; return; }
    if (handledClientParam.current === clientParam) return;
    const match = clients.find((c) => c.id === clientParam);
    if (match) {
      setStatusTab(match.status);
      setSelectedClientId(match.id);
      handledClientParam.current = clientParam;
    }
  }, [clientParam, clients]);

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
    createClientMutation.mutate({ ...createForm, plan_ids: createPlanIds });
  }

  function togglePlanFor(list: string[], setList: (v: string[]) => void, id: string) {
    setList(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  }

  const filtered = clients.filter((c) =>
    c.business_name.toLowerCase().includes(search.toLowerCase()) ||
    c.contact_person.toLowerCase().includes(search.toLowerCase())
  );

  const sections: { key: ClientStatus; label: string; clients: Client[] }[] = [
    { key: 'active',    label: 'Active',    clients: filtered.filter((c) => c.status === 'active') },
    { key: 'paused',    label: 'Paused',    clients: filtered.filter((c) => c.status === 'paused') },
    { key: 'cancelled', label: 'Cancelled', clients: filtered.filter((c) => c.status === 'cancelled') },
  ];
  const activeSection = sections.find((s) => s.key === statusTab) || sections[0];

  const createSelectedCountry = activeCountries.find((c) => c.id === createForm.country_id) || null;

  // ---- Detail view ----
  if (selectedClientId) {
    return (
      <ClientDetail
        clientId={selectedClientId}
        catalog={catalog}
        countries={countries}
        activeCountries={activeCountries}
        salesPeople={salesPeople}
        onBack={() => setSelectedClientId(null)}
      />
    );
  }

  // ---- List view ----
  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-xl font-bold text-foreground">Clients</h1>
          <p className="mt-1 text-sm text-foreground-muted">Open a client to manage its subscriptions, deliverables and access — all in one place.</p>
        </div>
        <button
          onClick={openCreate}
          className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-white transition hover:bg-ink-hover"
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
          className="w-full max-w-sm rounded-lg border border-divider bg-surface px-3 py-2 text-sm text-foreground placeholder-foreground-dim focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </div>

      {isLoading ? (
        <p className="py-8 text-center text-sm text-foreground-dim">Loading...</p>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-divider bg-surface py-12 text-center">
          <p className="text-sm text-foreground-dim">{search ? 'No matching clients.' : 'No clients yet. Click + New Client to add one, or share the onboarding link.'}</p>
        </div>
      ) : (
        <div>
          <div className="mb-4 flex gap-1 border-b border-divider">
            {sections.map((section) => {
              const isActive = statusTab === section.key;
              return (
                <button
                  key={section.key}
                  onClick={() => setStatusTab(section.key)}
                  className={`flex items-center gap-2 border-b-2 px-3 py-2 text-sm transition ${
                    isActive
                      ? 'border-accent text-foreground font-medium'
                      : 'border-transparent text-foreground-muted hover:text-foreground'
                  }`}
                >
                  <span>{section.label}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                    isActive ? 'bg-accent text-white' : 'bg-canvas text-foreground-muted'
                  }`}>
                    {section.clients.length}
                  </span>
                </button>
              );
            })}
          </div>
          {activeSection.clients.length === 0 ? (
            <p className="py-8 text-center text-sm text-foreground-dim">No {activeSection.label.toLowerCase()} clients.</p>
          ) : (
            <div className="space-y-2">
              {activeSection.clients.map((client) => {
                const countryName = client.country?.name || countries.find((c) => c.id === client.country_id)?.name || '—';
                const activeSubs = client.subscriptions?.filter((s) => s.status === 'active').length || 0;
                const accessCount = accessCountById.get(client.id) || 0;
                return (
                  <button
                    key={client.id}
                    onClick={() => setSelectedClientId(client.id)}
                    className={`flex w-full items-center justify-between rounded-lg border border-divider bg-surface px-5 py-4 text-left transition hover:shadow-sm ${
                      client.status === 'cancelled' ? 'opacity-50' : ''
                    }`}
                  >
                    <div className="flex items-center gap-4">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-canvas text-foreground-muted text-sm font-semibold">
                        {client.business_name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-foreground">{client.business_name}</p>
                        <p className="mt-0.5 text-xs text-foreground-muted">{client.contact_person}</p>
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
                      <span className="text-xs text-foreground-dim">{activeSubs} active subs</span>
                      <span className="text-xs text-foreground-dim">
                        {accessCount > 0 ? `${accessCount} user${accessCount !== 1 ? 's' : ''}` : 'No access'}
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
        </div>
      )}

      {/* Create Client Slider */}
      <SliderPanel open={createOpen} onClose={closeCreate} title="Create Client" width="w-[560px]">
        <form onSubmit={submitCreate} className="space-y-6">
          <div className="space-y-3">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-foreground-dim">Business Details</h4>
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
              <label className="mb-1 block text-xs font-medium text-foreground-muted">Business Address *</label>
              <textarea
                value={createForm.business_address}
                onChange={(e) => setCreateForm({ ...createForm, business_address: e.target.value })}
                required
                rows={2}
                className="w-full rounded-lg border border-divider px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground-muted">GST Registered *</label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 text-sm text-foreground">
                  <input
                    type="radio"
                    checked={createForm.gst_registered === true}
                    onChange={() => setCreateForm({ ...createForm, gst_registered: true })}
                    className="text-accent focus:ring-accent"
                  />
                  Yes
                </label>
                <label className="flex items-center gap-2 text-sm text-foreground">
                  <input
                    type="radio"
                    checked={createForm.gst_registered === false}
                    onChange={() => setCreateForm({ ...createForm, gst_registered: false, gst_number: '' })}
                    className="text-accent focus:ring-accent"
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
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-foreground-dim">
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
              className="rounded-lg border border-divider px-4 py-2.5 text-sm font-medium text-foreground-muted transition hover:bg-canvas"
            >
              Cancel
            </button>
          </div>
        </form>
      </SliderPanel>
    </div>
  );
}

// ============================================================
// Full-page client detail with Overview / Subscriptions / Access tabs
// ============================================================

type DetailTab = 'overview' | 'subscriptions' | 'access';

function ClientDetail({
  clientId, catalog, countries, activeCountries, salesPeople, onBack,
}: {
  clientId: string;
  catalog: Subscription[];
  countries: Country[];
  activeCountries: Country[];
  salesPeople: SalesPerson[];
  onBack: () => void;
}) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<DetailTab>('overview');
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<any>({});
  const [showArchived, setShowArchived] = useState(false);

  const { data: clientRes, isLoading } = useQuery({
    queryKey: ['admin-client-detail', clientId, showArchived],
    queryFn: () =>
      api.get(`/admin/clients/${clientId}`, { params: showArchived ? { include_archived: 1 } : {} }).then((r) => r.data),
  });
  const client: Client | null = clientRes?.data || null;

  const refetchAll = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['admin-client-detail', clientId] });
    queryClient.invalidateQueries({ queryKey: ['admin-clients'] });
    queryClient.invalidateQueries({ queryKey: ['admin-clients-count'] });
  }, [queryClient, clientId]);

  const country = client ? (client.country || countries.find((c) => c.id === client.country_id) || null) : null;

  // Cross-app connections (lookup-only Phase 1): CRM lead, SquadHire business
  // user, SquadBooks customer. Soft-match by submission_id / email / phone.
  const { data: crmMatch } = useQuery<CrmLeadMatch>({
    queryKey: ['client-crm-lead', clientId],
    queryFn: () =>
      api.get(`/admin/clients/${clientId}/crm-lead`).then((r) => r.data.data as CrmLeadMatch),
  });

  const { data: hireMatch } = useQuery<HireBusinessMatch>({
    queryKey: ['client-squadhire-business', clientId],
    queryFn: () =>
      api.get(`/admin/clients/${clientId}/squadhire-business`).then((r) => r.data.data as HireBusinessMatch),
  });

  const { data: booksMatch } = useQuery<SquadBooksMatch>({
    queryKey: ['client-squadbooks-customer', clientId],
    queryFn: () =>
      api.get(`/admin/clients/${clientId}/squadbooks-customer`).then((r) => r.data.data as SquadBooksMatch),
  });

  const openInSquadBooks = () => {
    if (!booksMatch?.found || !booksMatch.squadbooksUrl) return;
    const token = useAuthStore.getState().accessToken;
    if (!token) {
      alert('Your session expired — please sign in again to open SquadBooks.');
      return;
    }
    const next = encodeURIComponent(`/customers?focus=${booksMatch.customerId}`);
    const url =
      `${booksMatch.squadbooksUrl}/sso#t=${encodeURIComponent(token)}` +
      `&w=${encodeURIComponent(booksMatch.orgId || '')}&wn=&next=${next}`;
    window.open(url, '_blank', 'noopener');
  };

  const connBtn =
    'rounded-md border border-divider bg-surface px-3 py-1.5 text-xs font-medium text-foreground hover:bg-canvas';
  const connBtnDisabled =
    'cursor-not-allowed rounded-md border border-divider bg-surface px-3 py-1.5 text-xs font-medium text-foreground-dim opacity-50';

  const statusMutation = useMutation({
    mutationFn: (status: ClientStatus) => api.put(`/admin/clients/${clientId}/status`, { status }),
    onSuccess: () => refetchAll(),
  });

  const updateClientMutation = useMutation({
    mutationFn: (data: any) => api.put(`/admin/clients/${clientId}`, data),
    onSuccess: () => { setEditing(false); refetchAll(); },
  });

  const updateSpMutation = useMutation({
    mutationFn: (payload: any) => api.patch(`/admin/clients/${clientId}/sales-people`, payload).then((r) => r.data),
    onSuccess: () => refetchAll(),
    onError: (err: any) => alert(err?.response?.data?.error || err.message || 'Failed to update sales person'),
  });

  function startEdit() {
    if (!client) return;
    setEditForm({
      business_name: client.business_name,
      contact_person: client.contact_person,
      designation: client.designation || '',
      contact_number: client.contact_number,
      email: client.email,
      business_address: client.business_address,
      gst_registered: client.gst_registered,
      gst_number: client.gst_number || '',
      accounts_email: client.accounts_email || '',
      country_id: client.country_id,
    });
    setEditing(true);
  }

  if (isLoading || !client) {
    return (
      <div>
        <BackBar onBack={onBack} />
        <p className="py-12 text-center text-sm text-foreground-dim">Loading client…</p>
      </div>
    );
  }

  const activeSubsCount = (client.subscriptions || []).filter((s) => s.status === 'active').length;

  const tabs: { id: DetailTab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'subscriptions', label: 'Subscriptions' },
    { id: 'access', label: 'Access' },
  ];

  return (
    <div>
      <BackBar onBack={onBack} />

      {/* Header */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-canvas text-lg font-semibold text-foreground-muted">
            {client.business_name.charAt(0).toUpperCase()}
          </div>
          <div>
            <h1 className="font-[family-name:var(--font-display)] text-xl font-bold text-foreground">{client.business_name}</h1>
            <div className="mt-1 flex items-center gap-2">
              <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium capitalize ${STATUS_BADGE[client.status]}`}>
                {client.status}
              </span>
              <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-medium text-emerald-700">
                {country?.name || '—'}
              </span>
              <span className="text-xs text-foreground-dim">{activeSubsCount} active subscription{activeSubsCount !== 1 ? 's' : ''}</span>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {crmMatch?.found && crmMatch.lead_id ? (
            <button
              type="button"
              onClick={() => openCrmLeadById(crmMatch.lead_id)}
              title={`Open this contact in Squad CRM${crmMatch.matched_by ? ` (matched by ${crmMatch.matched_by})` : ''}`}
              className={connBtn}
            >
              Open in Squad CRM ↗
            </button>
          ) : (
            <button type="button" disabled title="No matching lead in Squad CRM" className={connBtnDisabled}>
              Open in Squad CRM
            </button>
          )}
          {hireMatch?.found && (hireMatch.admin_url || (hireMatch.squadhireAdminUrl && hireMatch.business_user_id)) ? (
            <button
              type="button"
              onClick={() => openSquadhireBusiness(hireMatch)}
              title={
                hireMatch.company_name
                  ? `Open ${hireMatch.company_name} in SquadHire${hireMatch.matched_by ? ` (matched by ${hireMatch.matched_by})` : ''}`
                  : 'Open business user in SquadHire'
              }
              className={connBtn}
            >
              Open in SquadHire ↗
            </button>
          ) : (
            <button
              type="button"
              disabled
              title="No matching business user in SquadHire"
              className={connBtnDisabled}
            >
              Open in SquadHire
            </button>
          )}
          {booksMatch?.found ? (
            <button
              type="button"
              onClick={openInSquadBooks}
              title={
                booksMatch.matchedBy === 'name'
                  ? 'Matched by name — open in SquadBooks (verify it is the same customer)'
                  : 'Open this customer in SquadBooks'
              }
              className={connBtn}
            >
              Open in SquadBooks{booksMatch.matchedBy === 'name' ? ' (by name)' : ''} ↗
            </button>
          ) : (
            <button type="button" disabled title="No matching customer in SquadBooks" className={connBtnDisabled}>
              Open in SquadBooks
            </button>
          )}
          {client.status === 'active' && (
            <>
              <button onClick={() => statusMutation.mutate('paused')} className="rounded-md bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-100">Pause All</button>
              <button onClick={() => statusMutation.mutate('cancelled')} className="rounded-md bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100">Cancel All</button>
            </>
          )}
          {client.status === 'paused' && (
            <>
              <button onClick={() => statusMutation.mutate('active')} className="rounded-md bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100">Resume All</button>
              <button onClick={() => statusMutation.mutate('cancelled')} className="rounded-md bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100">Cancel All</button>
            </>
          )}
          {client.status === 'cancelled' && (
            <button onClick={() => statusMutation.mutate('active')} className="rounded-md bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100">Reactivate</button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="mb-5 flex gap-1 border-b border-divider">
        {tabs.map((t) => {
          const isActive = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 border-b-2 px-4 py-2 text-sm transition ${
                isActive ? 'border-accent text-foreground font-medium' : 'border-transparent text-foreground-muted hover:text-foreground'
              }`}
            >
              {t.label}
              {t.id === 'subscriptions' && activeSubsCount > 0 && (
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${isActive ? 'bg-accent text-white' : 'bg-canvas text-foreground-muted'}`}>
                  {activeSubsCount}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Tab content — constrained width for readability */}
      <div className="max-w-3xl">
        {tab === 'overview' && (
          <div className="space-y-6">
            <div>
              <div className="mb-2 flex items-center justify-between">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-foreground-dim">Client Info</h4>
                {!editing && <button onClick={startEdit} className="text-xs text-accent hover:underline">Edit</button>}
              </div>

              {editing ? (
                <form
                  onSubmit={(e) => { e.preventDefault(); updateClientMutation.mutate(editForm); }}
                  className="space-y-3"
                >
                  <FormField label="Business Name" value={editForm.business_name} onChange={(v) => setEditForm({ ...editForm, business_name: v })} required />
                  <CountryField countries={activeCountries} value={editForm.country_id} onChange={(v) => setEditForm({ ...editForm, country_id: v })} />
                  <FormField label="Contact Person" value={editForm.contact_person} onChange={(v) => setEditForm({ ...editForm, contact_person: v })} required />
                  <FormField label="Designation" value={editForm.designation} onChange={(v) => setEditForm({ ...editForm, designation: v })} />
                  <FormField label="Contact Number" value={editForm.contact_number} onChange={(v) => setEditForm({ ...editForm, contact_number: v })} required />
                  <FormField label="Email" value={editForm.email} onChange={(v) => setEditForm({ ...editForm, email: v })} type="email" required />
                  <div>
                    <label className="mb-1 block text-xs font-medium text-foreground-muted">Business Address</label>
                    <textarea
                      value={editForm.business_address}
                      onChange={(e) => setEditForm({ ...editForm, business_address: e.target.value })}
                      required
                      rows={2}
                      className="w-full rounded-lg border border-divider px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                    />
                  </div>
                  <div className="flex gap-2 pt-2">
                    <button type="submit" disabled={updateClientMutation.isPending} className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-white hover:bg-ink-hover disabled:opacity-50">
                      {updateClientMutation.isPending ? 'Saving...' : 'Save Changes'}
                    </button>
                    <button type="button" onClick={() => setEditing(false)} className="rounded-lg border border-divider px-4 py-2 text-sm text-foreground-muted hover:bg-canvas">Cancel</button>
                  </div>
                </form>
              ) : (
                <div className="space-y-2">
                  <InfoRow label="Contact Person" value={client.contact_person} />
                  {client.designation && <InfoRow label="Designation" value={client.designation} />}
                  <InfoRow label="Contact Number" value={client.contact_number} />
                  <InfoRow label="Email" value={client.email} />
                  <InfoRow label="Business Address" value={client.business_address} />
                  <InfoRow label="GST Registered" value={client.gst_registered ? 'Yes' : 'No'} />
                  {client.gst_number && <InfoRow label="GST Number" value={client.gst_number} />}
                  {client.accounts_email && <InfoRow label="Accounts Email" value={client.accounts_email} />}
                </div>
              )}
            </div>

            <div className="space-y-3">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-foreground-dim">Sales Attribution</h4>
              <div>
                <label className="mb-1 block text-xs text-foreground-muted">Primary Sales Person</label>
                <select
                  value={client.primary_sales_person_id || ''}
                  onChange={(e) => updateSpMutation.mutate({ primary_sales_person_id: e.target.value || null })}
                  className="w-full rounded-md border border-divider bg-surface px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none"
                >
                  <option value="">— Not assigned —</option>
                  {salesPeople.map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-foreground-muted">Secondary Sales Person</label>
                <select
                  value={client.secondary_sales_person_id || ''}
                  onChange={(e) => updateSpMutation.mutate({ secondary_sales_person_id: e.target.value || null })}
                  className="w-full rounded-md border border-divider bg-surface px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none"
                >
                  <option value="">— None —</option>
                  {salesPeople
                    .filter((p) => p.id !== client.primary_sales_person_id)
                    .map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}
                </select>
              </div>
            </div>
          </div>
        )}

        {tab === 'subscriptions' && (
          <ClientSubscriptionsPanel
            client={client}
            country={country}
            catalog={catalog}
            showArchived={showArchived}
            onToggleArchived={setShowArchived}
            onRefetch={refetchAll}
          />
        )}

        {tab === 'access' && <ClientAccessPanel clientId={clientId} />}
      </div>
    </div>
  );
}

function BackBar({ onBack }: { onBack: () => void }) {
  return (
    <button
      onClick={onBack}
      className="mb-4 inline-flex items-center gap-1.5 text-sm text-foreground-muted transition hover:text-foreground"
    >
      <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
      </svg>
      Clients
    </button>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between border-b border-divider pb-2">
      <span className="text-xs text-foreground-dim">{label}</span>
      <span className="text-sm text-foreground text-right max-w-[280px]">{value}</span>
    </div>
  );
}

function FormField({ label, value, onChange, type = 'text', required = false }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; required?: boolean;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-foreground-muted">{label}{required ? ' *' : ''}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        className="w-full rounded-lg border border-divider px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
      />
    </div>
  );
}

function CountryField({ countries, value, onChange }: {
  countries: Country[]; value: string; onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-foreground-muted">Country *</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required
        className="w-full rounded-lg border border-divider bg-surface px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
      >
        <option value="">Select a country…</option>
        {countries.map((c) => (
          <option key={c.id} value={c.id}>{c.name} ({c.currency})</option>
        ))}
      </select>
    </div>
  );
}
