'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../../services/api';
import type {
  Client,
  ClientSubscription,
  ClientSubscriptionDeliverable,
  Subscription,
  SubscriptionDeliverableType,
  SubscriptionPlanRow,
  SubscriptionPlan,
  DeliverableKind,
} from '@squadhub/shared';
import SliderPanel from './SliderPanel';

const PLAN_ORDER: SubscriptionPlan[] = ['Starter', 'Basic', 'Plus', 'Pro', 'Personal'];

type InnerTab = 'active' | 'inactive';

export default function ClientSubscriptionsModule() {
  const [innerTab, setInnerTab] = useState<InnerTab>('active');
  const [search, setSearch] = useState('');
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);

  const { data: clientsRes, isLoading } = useQuery({
    queryKey: ['admin-clients'],
    queryFn: () => api.get('/admin/clients').then((r) => r.data),
  });

  const clients: Client[] = clientsRes?.data || [];

  const filtered = useMemo(() => {
    return clients
      .filter((c) => innerTab === 'active' ? c.status === 'active' : c.status !== 'active')
      .filter((c) =>
        c.business_name.toLowerCase().includes(search.toLowerCase()) ||
        c.contact_person.toLowerCase().includes(search.toLowerCase())
      );
  }, [clients, innerTab, search]);

  const activeCount = clients.filter((c) => c.status === 'active').length;
  const inactiveCount = clients.filter((c) => c.status !== 'active').length;

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-[family-name:var(--font-display)] text-xl font-bold text-[#0F172B]">Client Subscriptions</h1>
        <p className="mt-1 text-sm text-[#62748E]">Assign subscriptions and manage deliverables per client</p>
      </div>

      <div className="mb-4 flex items-center gap-2 border-b border-[#E2E8F0]">
        {([
          { id: 'active' as const, label: 'Active Clients', count: activeCount },
          { id: 'inactive' as const, label: 'Inactive Clients', count: inactiveCount },
        ]).map((t) => (
          <button
            key={t.id}
            onClick={() => setInnerTab(t.id)}
            className={`relative border-b-2 px-4 py-2 text-sm font-medium transition ${
              innerTab === t.id
                ? 'border-[#2962FF] text-[#0F172B]'
                : 'border-transparent text-[#62748E] hover:text-[#0F172B]'
            }`}
          >
            {t.label}
            <span className="ml-2 rounded-full bg-[#F1F5F9] px-2 py-0.5 text-[10px] text-[#62748E]">{t.count}</span>
          </button>
        ))}
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
          <p className="text-sm text-[#90A1B9]">No clients in this view.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((client) => (
            <ClientRow key={client.id} client={client} onOpen={() => setSelectedClient(client)} />
          ))}
        </div>
      )}

      <SliderPanel
        open={!!selectedClient}
        onClose={() => setSelectedClient(null)}
        title={selectedClient?.business_name || 'Client'}
        width="w-[640px]"
      >
        {selectedClient && (
          <ClientSubscriptionsDetail
            clientId={selectedClient.id}
            onUpdated={(c) => setSelectedClient(c)}
          />
        )}
      </SliderPanel>
    </div>
  );
}

// ============================================================
// Client list row
// ============================================================

function ClientRow({ client, onOpen }: { client: Client; onOpen: () => void }) {
  const activeSubs = (client.subscriptions || []).filter((cs) => cs.status === 'active').length;
  const totalSubs = (client.subscriptions || []).length;

  return (
    <button
      onClick={onOpen}
      className="flex w-full items-center justify-between rounded-lg border border-[#E2E8F0] bg-white px-5 py-4 text-left transition hover:shadow-sm"
    >
      <div className="flex items-center gap-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-600">
          {client.business_name.charAt(0).toUpperCase()}
        </div>
        <div>
          <p className="text-sm font-medium text-[#0F172B]">{client.business_name}</p>
          <p className="mt-0.5 text-xs text-[#62748E]">{client.contact_person}</p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
          client.country === 'India' ? 'bg-emerald-50 text-emerald-700' : 'bg-blue-50 text-blue-700'
        }`}>
          {client.country}
        </span>
        <span className="text-xs text-[#90A1B9]">
          {activeSubs}/{totalSubs} active
        </span>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${
          client.status === 'active' ? 'bg-emerald-100 text-emerald-700'
            : client.status === 'paused' ? 'bg-amber-100 text-amber-700'
            : 'bg-red-100 text-red-700'
        }`}>
          {client.status}
        </span>
      </div>
    </button>
  );
}

// ============================================================
// Detail slider — per-client subscriptions + deliverables
// ============================================================

function ClientSubscriptionsDetail({
  clientId,
  onUpdated,
}: {
  clientId: string;
  onUpdated: (c: Client) => void;
}) {
  const queryClient = useQueryClient();

  const { data: clientRes, refetch } = useQuery({
    queryKey: ['admin-client-detail', clientId],
    queryFn: () => api.get(`/admin/clients/${clientId}`).then((r) => r.data),
  });
  const client: Client | null = clientRes?.data || null;

  useEffect(() => {
    if (client) onUpdated(client);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client?.id, client?.status, client?.subscriptions?.length]);

  const { data: catalogRes } = useQuery({
    queryKey: ['admin-subs-catalog'],
    queryFn: () => api.get('/admin/subscriptions').then((r) => r.data),
  });
  const catalog: Subscription[] = catalogRes?.data || [];

  const statusMutation = useMutation({
    mutationFn: (status: string) => api.put(`/admin/clients/${clientId}/status`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-clients'] });
      refetch();
    },
  });

  const [addOpen, setAddOpen] = useState(false);

  if (!client) return <p className="text-sm text-[#90A1B9]">Loading...</p>;

  const assignedSubscriptionIds = new Set((client.subscriptions || []).map((cs) => cs.subscription_id));

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
            client.country === 'India' ? 'bg-emerald-50 text-emerald-700' : 'bg-blue-50 text-blue-700'
          }`}>
            {client.country}
          </span>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${
            client.status === 'active' ? 'bg-emerald-100 text-emerald-700'
              : client.status === 'paused' ? 'bg-amber-100 text-amber-700'
              : 'bg-red-100 text-red-700'
          }`}>
            {client.status}
          </span>
          <div className="ml-auto flex gap-1.5">
            {client.status === 'active' && (
              <>
                <button onClick={() => statusMutation.mutate('paused')} className="rounded-md bg-amber-50 px-2 py-1 text-[10px] font-medium text-amber-700 hover:bg-amber-100">Pause All</button>
                <button onClick={() => statusMutation.mutate('cancelled')} className="rounded-md bg-red-50 px-2 py-1 text-[10px] font-medium text-red-700 hover:bg-red-100">Cancel All</button>
              </>
            )}
            {client.status === 'paused' && (
              <>
                <button onClick={() => statusMutation.mutate('active')} className="rounded-md bg-emerald-50 px-2 py-1 text-[10px] font-medium text-emerald-700 hover:bg-emerald-100">Resume All</button>
                <button onClick={() => statusMutation.mutate('cancelled')} className="rounded-md bg-red-50 px-2 py-1 text-[10px] font-medium text-red-700 hover:bg-red-100">Cancel All</button>
              </>
            )}
            {client.status === 'cancelled' && (
              <button onClick={() => statusMutation.mutate('active')} className="rounded-md bg-emerald-50 px-2 py-1 text-[10px] font-medium text-emerald-700 hover:bg-emerald-100">Reactivate</button>
            )}
          </div>
        </div>
        <p className="text-xs text-[#62748E]">{client.contact_person} · {client.email}</p>
      </div>

      {/* Subscriptions */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-[#90A1B9]">Subscriptions</h4>
          <button
            onClick={() => setAddOpen((v) => !v)}
            className="text-xs text-[#2962FF] hover:underline"
          >
            {addOpen ? 'Close' : '+ Add Subscription'}
          </button>
        </div>

        {addOpen && (
          <AddSubscriptionInline
            clientId={client.id}
            country={client.country}
            catalog={catalog}
            excludeSubscriptionIds={assignedSubscriptionIds}
            onDone={() => {
              setAddOpen(false);
              refetch();
              queryClient.invalidateQueries({ queryKey: ['admin-clients'] });
            }}
          />
        )}

        {(!client.subscriptions || client.subscriptions.length === 0) ? (
          <p className="py-4 text-center text-xs text-[#90A1B9]">No subscriptions assigned yet.</p>
        ) : (
          <div className="space-y-3">
            {(client.subscriptions || []).map((cs) => (
              <ClientSubscriptionCard
                key={cs.id}
                clientId={client.id}
                cs={cs}
                country={client.country}
                catalog={catalog}
                onRefetch={() => { refetch(); queryClient.invalidateQueries({ queryKey: ['admin-clients'] }); }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// Per-subscription card with deliverable editor
// ============================================================

function ClientSubscriptionCard({
  clientId, cs, country, catalog, onRefetch,
}: {
  clientId: string;
  cs: ClientSubscription;
  country: 'India' | 'International';
  catalog: Subscription[];
  onRefetch: () => void;
}) {
  const queryClient = useQueryClient();
  const subscription = catalog.find((s) => s.id === cs.subscription_id);
  const deliverableTypes = subscription?.deliverable_types?.filter((t) => t.is_active) || [];
  const price = cs.plan
    ? (country === 'India' ? cs.plan.price_inr : cs.plan.price_usd)
    : null;
  const priceLabel = price == null
    ? 'No price set'
    : `${country === 'India' ? '\u20B9' : '$'}${price.toLocaleString(country === 'India' ? 'en-IN' : 'en-US')}/mo`;

  const statusMutation = useMutation({
    mutationFn: (status: string) => api.put(`/admin/clients/${clientId}/subscriptions/${cs.id}/status`, { status }),
    onSuccess: () => onRefetch(),
  });

  const removeMutation = useMutation({
    mutationFn: () => api.delete(`/admin/clients/${clientId}/subscriptions/${cs.id}`),
    onSuccess: () => onRefetch(),
  });

  const resetMutation = useMutation({
    mutationFn: () => api.post(`/admin/clients/${clientId}/subscriptions/${cs.id}/deliverables/reset`),
    onSuccess: () => onRefetch(),
  });

  return (
    <div className={`rounded-lg border border-[#E2E8F0] bg-white p-4 ${cs.status === 'cancelled' ? 'opacity-60' : ''}`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-[#0F172B]">{subscription?.name || 'Unknown'}</p>
          <p className="mt-0.5 text-xs text-[#90A1B9]">
            {cs.plan?.plan || '—'} · {priceLabel}
          </p>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${
          cs.status === 'active' ? 'bg-emerald-100 text-emerald-700'
            : cs.status === 'paused' ? 'bg-amber-100 text-amber-700'
            : 'bg-red-100 text-red-700'
        }`}>
          {cs.status}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {cs.status === 'active' && (
          <>
            <button onClick={() => statusMutation.mutate('paused')} className="rounded bg-amber-50 px-2 py-1 text-[10px] font-medium text-amber-700 hover:bg-amber-100">Pause</button>
            <button onClick={() => statusMutation.mutate('cancelled')} className="rounded bg-red-50 px-2 py-1 text-[10px] font-medium text-red-700 hover:bg-red-100">Cancel</button>
          </>
        )}
        {cs.status === 'paused' && (
          <>
            <button onClick={() => statusMutation.mutate('active')} className="rounded bg-emerald-50 px-2 py-1 text-[10px] font-medium text-emerald-700 hover:bg-emerald-100">Resume</button>
            <button onClick={() => statusMutation.mutate('cancelled')} className="rounded bg-red-50 px-2 py-1 text-[10px] font-medium text-red-700 hover:bg-red-100">Cancel</button>
          </>
        )}
        {cs.status === 'cancelled' && (
          <button onClick={() => statusMutation.mutate('active')} className="rounded bg-emerald-50 px-2 py-1 text-[10px] font-medium text-emerald-700 hover:bg-emerald-100">Reactivate</button>
        )}
        <button onClick={() => resetMutation.mutate()} className="rounded bg-slate-100 px-2 py-1 text-[10px] font-medium text-slate-600 hover:bg-slate-200" disabled={resetMutation.isPending}>
          {resetMutation.isPending ? 'Resetting…' : 'Reset to plan'}
        </button>
        <button onClick={() => removeMutation.mutate()} className="rounded bg-[#F1F5F9] px-2 py-1 text-[10px] font-medium text-[#62748E] hover:bg-[#E2E8F0]">Remove</button>
      </div>

      <div className="mt-3 border-t border-[#F1F5F9] pt-3">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[#90A1B9]">Deliverables</p>
        <ClientDeliverablesEditor
          clientId={clientId}
          csId={cs.id}
          deliverables={cs.deliverables || []}
          deliverableTypes={deliverableTypes}
          onChange={onRefetch}
        />
      </div>
    </div>
  );
}

// ============================================================
// Editor for per-client deliverable overrides
// ============================================================

function ClientDeliverablesEditor({
  clientId, csId, deliverables, deliverableTypes, onChange,
}: {
  clientId: string;
  csId: string;
  deliverables: ClientSubscriptionDeliverable[];
  deliverableTypes: SubscriptionDeliverableType[];
  onChange: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<DeliverableKind>('item');
  const [typeId, setTypeId] = useState<string>('');
  const [perDay, setPerDay] = useState('');
  const [perWeek, setPerWeek] = useState('');
  const [perMonth, setPerMonth] = useState('');

  function resetForm() {
    setAdding(false); setKind('item'); setTypeId(''); setPerDay(''); setPerWeek(''); setPerMonth('');
  }

  const create = useMutation({
    mutationFn: (body: any) => api.post(`/admin/clients/${clientId}/subscriptions/${csId}/deliverables`, body),
    onSuccess: () => { onChange(); resetForm(); },
    onError: (err: any) => alert(err?.response?.data?.error || err.message || 'Failed'),
  });
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: any }) => api.put(`/admin/clients/${clientId}/subscriptions/${csId}/deliverables/${id}`, body),
    onSuccess: () => onChange(),
  });
  const del = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/clients/${clientId}/subscriptions/${csId}/deliverables/${id}`),
    onSuccess: () => onChange(),
  });

  function submitAdd() {
    if (kind === 'item' && !typeId) {
      alert('Pick a deliverable type for item deliverables.');
      return;
    }
    create.mutate({
      kind,
      deliverable_type_id: kind === 'item' ? typeId : null,
      per_day: parseFloat(perDay) || 0,
      per_week: parseFloat(perWeek) || 0,
      per_month: parseFloat(perMonth) || 0,
    });
  }

  return (
    <div className="space-y-2">
      {deliverables.length === 0 && !adding && (
        <p className="text-xs text-[#90A1B9]">No deliverables. Click +Add or Reset to plan.</p>
      )}

      {deliverables.map((d) => (
        <DeliverableInlineRow
          key={d.id}
          deliverable={d}
          deliverableTypes={deliverableTypes}
          onUpdate={(body) => update.mutate({ id: d.id, body })}
          onDelete={() => del.mutate(d.id)}
        />
      ))}

      {adding ? (
        <div className="space-y-2 rounded-md border border-dashed border-[#CBD5E1] bg-[#F8FAFC] p-3">
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-1.5 text-xs text-[#475569]">
              <input type="radio" checked={kind === 'hours'} onChange={() => setKind('hours')} />
              Hours
            </label>
            <label className="flex items-center gap-1.5 text-xs text-[#475569]">
              <input type="radio" checked={kind === 'item'} onChange={() => setKind('item')} />
              Item
            </label>
            {kind === 'item' && (
              <select
                value={typeId}
                onChange={(e) => setTypeId(e.target.value)}
                className="rounded-md border border-[#E2E8F0] px-2 py-1 text-sm text-[#0F172B] focus:border-[#2962FF] focus:outline-none"
              >
                <option value="">Select type…</option>
                {deliverableTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            )}
          </div>
          <div className="flex items-center gap-2">
            <NumInline label="/d" value={perDay} onChange={setPerDay} />
            <NumInline label="/w" value={perWeek} onChange={setPerWeek} />
            <NumInline label="/m" value={perMonth} onChange={setPerMonth} />
          </div>
          <div className="flex gap-2">
            <button onClick={submitAdd} disabled={create.isPending} className="rounded-md bg-[#0F172B] px-3 py-1 text-xs font-medium text-white hover:bg-[#1E293B] disabled:opacity-50">
              Add
            </button>
            <button onClick={resetForm} className="rounded-md border border-[#E2E8F0] px-3 py-1 text-xs text-[#62748E] hover:bg-[#F1F5F9]">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="rounded-md border border-dashed border-[#CBD5E1] px-3 py-1.5 text-xs text-[#62748E] hover:bg-[#F8FAFC] hover:text-[#0F172B]"
        >
          + Add deliverable
        </button>
      )}
    </div>
  );
}

function DeliverableInlineRow({
  deliverable, deliverableTypes, onUpdate, onDelete,
}: {
  deliverable: ClientSubscriptionDeliverable;
  deliverableTypes: SubscriptionDeliverableType[];
  onUpdate: (body: any) => void;
  onDelete: () => void;
}) {
  const [perDay, setPerDay] = useState(String(deliverable.per_day));
  const [perWeek, setPerWeek] = useState(String(deliverable.per_week));
  const [perMonth, setPerMonth] = useState(String(deliverable.per_month));

  useEffect(() => {
    setPerDay(String(deliverable.per_day));
    setPerWeek(String(deliverable.per_week));
    setPerMonth(String(deliverable.per_month));
  }, [deliverable.per_day, deliverable.per_week, deliverable.per_month]);

  const typeName = deliverable.kind === 'hours'
    ? 'Hours'
    : (deliverableTypes.find((t) => t.id === deliverable.deliverable_type_id)?.name || 'Unknown type');

  function save() {
    onUpdate({
      per_day: parseFloat(perDay) || 0,
      per_week: parseFloat(perWeek) || 0,
      per_month: parseFloat(perMonth) || 0,
    });
  }

  return (
    <div className="flex items-center gap-2 rounded-md bg-[#F8FAFC] px-3 py-1.5">
      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
        deliverable.kind === 'hours' ? 'bg-indigo-100 text-indigo-700' : 'bg-purple-100 text-purple-700'
      }`}>
        {deliverable.kind === 'hours' ? 'Hours' : 'Item'}
      </span>
      <span className="text-xs text-[#0F172B]">{typeName}</span>
      <div className="ml-auto flex items-center gap-2">
        <NumInline label="/d" value={perDay} onChange={setPerDay} onBlur={save} compact />
        <NumInline label="/w" value={perWeek} onChange={setPerWeek} onBlur={save} compact />
        <NumInline label="/m" value={perMonth} onChange={setPerMonth} onBlur={save} compact />
        <button onClick={onDelete} className="rounded-md p-1 text-[#90A1B9] hover:bg-red-50 hover:text-red-500">
          <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      </div>
    </div>
  );
}

function NumInline({
  label, value, onChange, onBlur, compact,
}: {
  label: string; value: string; onChange: (v: string) => void; onBlur?: () => void; compact?: boolean;
}) {
  return (
    <div className="flex items-center gap-1">
      <input
        type="number"
        min={0}
        step="0.01"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        className={`rounded-md border border-[#E2E8F0] px-2 py-0.5 text-xs text-[#0F172B] focus:border-[#2962FF] focus:outline-none ${compact ? 'w-12' : 'w-16'}`}
      />
      <span className="text-[10px] text-[#90A1B9]">{label}</span>
    </div>
  );
}

// ============================================================
// Add-subscription inline form (pick subscription + plan)
// ============================================================

function AddSubscriptionInline({
  clientId, country, catalog, excludeSubscriptionIds, onDone,
}: {
  clientId: string;
  country: 'India' | 'International';
  catalog: Subscription[];
  excludeSubscriptionIds: Set<string>;
  onDone: () => void;
}) {
  const [subscriptionId, setSubscriptionId] = useState<string>('');
  const [planId, setPlanId] = useState<string>('');

  const available = catalog.filter((s) => s.is_active && !excludeSubscriptionIds.has(s.id));
  const selectedSub = catalog.find((s) => s.id === subscriptionId) || null;

  const availablePlans: SubscriptionPlanRow[] = useMemo(() => {
    if (!selectedSub) return [];
    const priceField: 'price_inr' | 'price_usd' = country === 'India' ? 'price_inr' : 'price_usd';
    return (selectedSub.plans || [])
      .filter((p) => p.is_active && p[priceField] != null)
      .sort((a, b) => PLAN_ORDER.indexOf(a.plan) - PLAN_ORDER.indexOf(b.plan));
  }, [selectedSub, country]);

  const addMutation = useMutation({
    mutationFn: (pid: string) => api.post(`/admin/clients/${clientId}/subscriptions`, { plan_ids: [pid] }),
    onSuccess: () => onDone(),
    onError: (err: any) => alert(err?.response?.data?.error || err.message || 'Failed'),
  });

  return (
    <div className="mb-3 space-y-2 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-3">
      <div>
        <label className="mb-1 block text-xs font-medium text-[#62748E]">Subscription</label>
        <select
          value={subscriptionId}
          onChange={(e) => { setSubscriptionId(e.target.value); setPlanId(''); }}
          className="w-full rounded-md border border-[#E2E8F0] bg-white px-2 py-1.5 text-sm text-[#0F172B] focus:border-[#2962FF] focus:outline-none"
        >
          <option value="">Select subscription…</option>
          {available.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          {available.length === 0 && <option value="" disabled>No subscriptions available</option>}
        </select>
      </div>

      {selectedSub && (
        <div>
          <label className="mb-1 block text-xs font-medium text-[#62748E]">Plan ({country === 'India' ? 'INR' : 'USD'} prices only)</label>
          {availablePlans.length === 0 ? (
            <p className="rounded-md bg-white px-2 py-1.5 text-xs text-[#90A1B9]">No plans priced for {country} yet.</p>
          ) : (
            <select
              value={planId}
              onChange={(e) => setPlanId(e.target.value)}
              className="w-full rounded-md border border-[#E2E8F0] bg-white px-2 py-1.5 text-sm text-[#0F172B] focus:border-[#2962FF] focus:outline-none"
            >
              <option value="">Select plan…</option>
              {availablePlans.map((p) => {
                const price = country === 'India' ? p.price_inr : p.price_usd;
                const sym = country === 'India' ? '\u20B9' : '$';
                return (
                  <option key={p.id} value={p.id}>
                    {p.plan} — {sym}{(price || 0).toLocaleString(country === 'India' ? 'en-IN' : 'en-US')}/mo
                  </option>
                );
              })}
            </select>
          )}
        </div>
      )}

      <button
        onClick={() => planId && addMutation.mutate(planId)}
        disabled={!planId || addMutation.isPending}
        className="w-full rounded-md bg-[#0F172B] px-3 py-2 text-xs font-medium text-white hover:bg-[#1E293B] disabled:opacity-50"
      >
        {addMutation.isPending ? 'Adding...' : 'Add subscription'}
      </button>
      <p className="text-[10px] text-[#90A1B9]">Plan defaults will be copied as editable deliverables.</p>
    </div>
  );
}
