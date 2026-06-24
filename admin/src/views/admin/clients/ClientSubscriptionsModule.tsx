'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../../services/api';
import type {
  Client,
  ClientSubscription,
  ClientSubscriptionDeliverable,
  Country,
  Subscription,
  SubscriptionDeliverableType,
  SubscriptionPlanRow,
  SubscriptionPlan,
  SubscriptionTier,
  DeliverableKind,
} from '@squadhub/shared';
import { resolveFinalizedPrice } from '@squadhub/shared';
import SliderPanel from './SliderPanel';

const PLAN_ORDER: SubscriptionPlan[] = ['Starter', 'Basic', 'Plus', 'Pro', 'Personal'];
const TIERS: SubscriptionTier[] = ['Junior', 'Pro', 'Top Talents'];
const TIER_COLOR: Record<SubscriptionTier, string> = {
  Junior: 'bg-canvas text-foreground-muted',
  Pro: 'bg-indigo-100 text-indigo-700',
  'Top Talents': 'bg-yellow-100 text-yellow-700',
};

type InnerTab = 'active' | 'inactive';

export default function ClientSubscriptionsModule() {
  const [innerTab, setInnerTab] = useState<InnerTab>('active');
  const [search, setSearch] = useState('');
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);

  const { data: clientsRes, isLoading } = useQuery({
    queryKey: ['admin-clients'],
    queryFn: () => api.get('/admin/clients').then((r) => r.data),
  });

  const { data: countriesRes } = useQuery({
    queryKey: ['admin-countries'],
    queryFn: () => api.get('/admin/countries').then((r) => r.data),
  });

  const clients: Client[] = clientsRes?.data || [];
  const countries: Country[] = countriesRes?.data || [];
  const countryById = new Map<string, Country>();
  countries.forEach((c) => countryById.set(c.id, c));

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
        <h1 className="font-[family-name:var(--font-display)] text-xl font-bold text-foreground">Client Subscriptions</h1>
        <p className="mt-1 text-sm text-foreground-muted">Assign subscriptions and manage deliverables per client</p>
      </div>

      <div className="mb-4 flex items-center gap-2 border-b border-divider">
        {([
          { id: 'active' as const, label: 'Active Clients', count: activeCount },
          { id: 'inactive' as const, label: 'Inactive Clients', count: inactiveCount },
        ]).map((t) => (
          <button
            key={t.id}
            onClick={() => setInnerTab(t.id)}
            className={`relative border-b-2 px-4 py-2 text-sm font-medium transition ${
              innerTab === t.id
                ? 'border-accent text-foreground'
                : 'border-transparent text-foreground-muted hover:text-foreground'
            }`}
          >
            {t.label}
            <span className="ml-2 rounded-full bg-canvas px-2 py-0.5 text-[10px] text-foreground-muted">{t.count}</span>
          </button>
        ))}
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
          <p className="text-sm text-foreground-dim">No clients in this view.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((client) => (
            <ClientRow
              key={client.id}
              client={client}
              country={countryById.get(client.country_id) || null}
              onOpen={() => setSelectedClient(client)}
            />
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

function ClientRow({
  client, country, onOpen,
}: { client: Client; country: Country | null; onOpen: () => void }) {
  const activeSubs = (client.subscriptions || []).filter((cs) => cs.status === 'active').length;
  const totalSubs = (client.subscriptions || []).length;

  return (
    <button
      onClick={onOpen}
      className="flex w-full items-center justify-between rounded-lg border border-divider bg-surface px-5 py-4 text-left transition hover:shadow-sm"
    >
      <div className="flex items-center gap-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-canvas text-sm font-semibold text-foreground-muted">
          {client.business_name.charAt(0).toUpperCase()}
        </div>
        <div>
          <p className="text-sm font-medium text-foreground">{client.business_name}</p>
          <p className="mt-0.5 text-xs text-foreground-muted">{client.contact_person}</p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
          {country?.name || '—'}
        </span>
        <span className="text-xs text-foreground-dim">
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
// Detail slider
// ============================================================

function ClientSubscriptionsDetail({
  clientId, onUpdated,
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

  const { data: countriesRes } = useQuery({
    queryKey: ['admin-countries'],
    queryFn: () => api.get('/admin/countries').then((r) => r.data),
  });
  const countries: Country[] = countriesRes?.data || [];

  const statusMutation = useMutation({
    mutationFn: (status: string) => api.put(`/admin/clients/${clientId}/status`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-clients'] });
      refetch();
    },
  });

  const [addOpen, setAddOpen] = useState(false);

  if (!client) return <p className="text-sm text-foreground-dim">Loading...</p>;

  const country = client.country || countries.find((c) => c.id === client.country_id) || null;
  const assignedSubscriptionIds = new Set((client.subscriptions || []).map((cs) => cs.subscription_id));

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
            {country?.name || '—'}
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
        <p className="text-xs text-foreground-muted">{client.contact_person} · {client.email}</p>
      </div>

      {/* Subscriptions */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-foreground-dim">Subscriptions</h4>
          <button
            onClick={() => setAddOpen((v) => !v)}
            className="text-xs text-accent hover:underline"
          >
            {addOpen ? 'Close' : '+ Add Subscription'}
          </button>
        </div>

        {addOpen && (
          <AddSubscriptionInline
            clientId={client.id}
            country={country}
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
          <p className="py-4 text-center text-xs text-foreground-dim">No subscriptions assigned yet.</p>
        ) : (
          <div className="space-y-3">
            {(client.subscriptions || []).map((cs) => (
              <ClientSubscriptionCard
                key={cs.id}
                clientId={client.id}
                cs={cs}
                country={country}
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
  country: Country | null;
  catalog: Subscription[];
  onRefetch: () => void;
}) {
  const subscription = catalog.find((s) => s.id === cs.subscription_id);
  const deliverableTypes = subscription?.deliverable_types?.filter((t) => t.is_active) || [];

  const pricing = cs.plan?.pricing?.find((p) => p.country_id === country?.id) || null;
  const sym = country?.currency === 'USD' ? '$' : '\u20B9';
  const locale = country?.currency === 'USD' ? 'en-US' : 'en-IN';
  // Show the price the client is actually billed: the linked card's finalized
  // subscription price (or proposed price). Fall back to the plan's catalog
  // price only if neither is set. Treat 0 as "not set" rather than a real price.
  const finalizedPrice = cs.card ? resolveFinalizedPrice(cs.card) : null;
  const catalogPrice = pricing && pricing.price > 0 ? pricing.price : null;
  const priceVal = finalizedPrice ?? catalogPrice;
  const priceLabel = priceVal != null
    ? `${sym}${priceVal.toLocaleString(locale)}/mo`
    : 'No price set';

  const statusMutation = useMutation({
    mutationFn: (status: string) => api.put(`/admin/clients/${clientId}/subscriptions/${cs.id}/status`, { status }),
    onSuccess: () => onRefetch(),
  });

  const removeMutation = useMutation({
    mutationFn: () => api.delete(`/admin/clients/${clientId}/subscriptions/${cs.id}`),
    onSuccess: () => onRefetch(),
  });

  const card = cs.card;

  async function copyCode(code: string) {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      // fallback
    }
  }

  const { data: linkStatusRes, refetch: refetchLinkStatus } = useQuery({
    queryKey: ['card-link-status', card?.id],
    queryFn: () => api.get(`/admin/subscription-cards/${card?.id}/link-status`).then((r) => r.data),
    enabled: !!card?.id,
  });

  const unlinkMutation = useMutation({
    mutationFn: () => api.post(`/admin/subscription-cards/${card!.id}/unlink`),
    onSuccess: () => { refetchLinkStatus(); onRefetch(); },
  });

  const linkedFolderName = linkStatusRes?.data?.linked_folder_name ?? null;

  return (
    <div className={`rounded-lg border border-divider bg-surface p-4 ${cs.status === 'cancelled' ? 'opacity-60' : ''}`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-foreground">{subscription?.name || 'Unknown'}</p>
          <div className="mt-1 flex items-center gap-2">
            <span className="text-xs text-foreground-dim">{cs.plan?.plan || '—'}</span>
            {cs.plan?.tier && (
              <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${TIER_COLOR[cs.plan.tier]}`}>
                {cs.plan.tier}
              </span>
            )}
            <span className="text-xs text-foreground-dim">· {priceLabel}</span>
          </div>
          {linkedFolderName && (
            <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[9px] font-medium text-emerald-700">
              <svg className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
              </svg>
              {linkedFolderName}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {card?.card_code && (
            <button
              onClick={() => copyCode(card.card_code!)}
              className="group relative flex items-center gap-1 rounded-md border border-divider bg-surface px-2 py-1 text-[10px] font-mono text-foreground-muted hover:bg-surface-alt"
              title="Copy card code"
            >
              {card.card_code}
              <svg className="h-3 w-3 text-foreground-dim group-hover:text-foreground" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 011.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 00-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 01-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 00-3.375-3.375h-1.5a1.125 1.125 0 01-1.125-1.125v-1.5a3.375 3.375 0 00-3.375-3.375H9.75" />
              </svg>
            </button>
          )}
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${
            cs.status === 'active' ? 'bg-emerald-100 text-emerald-700'
              : cs.status === 'paused' ? 'bg-amber-100 text-amber-700'
              : 'bg-red-100 text-red-700'
          }`}>
            {cs.status}
          </span>
        </div>
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
        <button onClick={() => removeMutation.mutate()} className="rounded bg-canvas px-2 py-1 text-[10px] font-medium text-foreground-muted hover:bg-well">Remove</button>
          {linkedFolderName && (
            <button onClick={() => unlinkMutation.mutate()} className="rounded bg-rose-50 px-2 py-1 text-[10px] font-medium text-rose-700 hover:bg-rose-100" disabled={unlinkMutation.isPending}>
              {unlinkMutation.isPending ? 'Unlinking…' : 'Unlink'}
            </button>
          )}
        </div>

      <div className="mt-3 border-t border-divider pt-3">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-foreground-dim">Deliverables</p>
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
        <p className="text-xs text-foreground-dim">No deliverables. Click +Add to create one.</p>
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
        <div className="space-y-2 rounded-md border border-dashed border-divider-strong bg-surface-alt p-3">
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-1.5 text-xs text-foreground-muted">
              <input type="radio" checked={kind === 'hours'} onChange={() => setKind('hours')} />
              Hours
            </label>
            <label className="flex items-center gap-1.5 text-xs text-foreground-muted">
              <input type="radio" checked={kind === 'item'} onChange={() => setKind('item')} />
              Item
            </label>
            {kind === 'item' && (
              <select
                value={typeId}
                onChange={(e) => setTypeId(e.target.value)}
                className="rounded-md border border-divider px-2 py-1 text-sm text-foreground focus:border-accent focus:outline-none"
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
            <button onClick={submitAdd} disabled={create.isPending} className="rounded-md bg-ink px-3 py-1 text-xs font-medium text-white hover:bg-ink-hover disabled:opacity-50">
              Add
            </button>
            <button onClick={resetForm} className="rounded-md border border-divider px-3 py-1 text-xs text-foreground-muted hover:bg-canvas">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="rounded-md border border-dashed border-divider-strong px-3 py-1.5 text-xs text-foreground-muted hover:bg-surface-alt hover:text-foreground"
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
  const isLinked = deliverable.source_plan_deliverable_id != null;
  const isActive = deliverable.is_active !== false;

  const typeName = deliverable.kind === 'hours'
    ? 'Hours'
    : (deliverableTypes.find((t) => t.id === deliverable.deliverable_type_id)?.name || 'Unknown type');

  // Custom-row local state for value editing
  const [perDay, setPerDay] = useState(String(deliverable.per_day));
  const [perWeek, setPerWeek] = useState(String(deliverable.per_week));
  const [perMonth, setPerMonth] = useState(String(deliverable.per_month));

  useEffect(() => {
    setPerDay(String(deliverable.per_day));
    setPerWeek(String(deliverable.per_week));
    setPerMonth(String(deliverable.per_month));
  }, [deliverable.per_day, deliverable.per_week, deliverable.per_month]);

  function saveValues() {
    onUpdate({
      per_day: parseFloat(perDay) || 0,
      per_week: parseFloat(perWeek) || 0,
      per_month: parseFloat(perMonth) || 0,
    });
  }

  return (
    <div className={`flex items-center gap-2 rounded-md bg-surface-alt px-3 py-1.5 ${isActive ? '' : 'opacity-50'}`}>
      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
        deliverable.kind === 'hours' ? 'bg-indigo-100 text-indigo-700' : 'bg-purple-100 text-purple-700'
      }`}>
        {deliverable.kind === 'hours' ? 'Hours' : 'Item'}
      </span>
      <span className="text-xs text-foreground">{typeName}</span>
      {!isLinked && (
        <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[9px] font-semibold text-amber-700">Custom</span>
      )}
      <div className="ml-auto flex items-center gap-2">
        {isLinked ? (
          <>
            <ReadOnlyValue label="/d" value={deliverable.per_day} />
            <ReadOnlyValue label="/w" value={deliverable.per_week} />
            <ReadOnlyValue label="/m" value={deliverable.per_month} />
          </>
        ) : (
          <>
            <NumInline label="/d" value={perDay} onChange={setPerDay} onBlur={saveValues} compact />
            <NumInline label="/w" value={perWeek} onChange={setPerWeek} onBlur={saveValues} compact />
            <NumInline label="/m" value={perMonth} onChange={setPerMonth} onBlur={saveValues} compact />
          </>
        )}
        <button
          onClick={() => onUpdate({ is_active: !isActive })}
          className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
            isActive
              ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
              : 'bg-canvas text-foreground-muted hover:bg-well'
          }`}
        >
          {isActive ? 'Active' : 'Inactive'}
        </button>
        {!isLinked && (
          <button onClick={onDelete} className="rounded-md p-1 text-foreground-dim hover:bg-red-50 hover:text-red-500" aria-label="Delete custom deliverable">
            <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

function ReadOnlyValue({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-1">
      <span className="min-w-[2.5rem] rounded-md border border-transparent bg-surface px-2 py-0.5 text-right text-xs text-foreground-muted">
        {value}
      </span>
      <span className="text-[10px] text-foreground-dim">{label}</span>
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
        className={`rounded-md border border-divider px-2 py-0.5 text-xs text-foreground focus:border-accent focus:outline-none ${compact ? 'w-12' : 'w-16'}`}
      />
      <span className="text-[10px] text-foreground-dim">{label}</span>
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
  country: Country | null;
  catalog: Subscription[];
  excludeSubscriptionIds: Set<string>;
  onDone: () => void;
}) {
  const [subscriptionId, setSubscriptionId] = useState<string>('');
  const [planId, setPlanId] = useState<string>('');

  const available = catalog.filter((s) => s.is_active && !excludeSubscriptionIds.has(s.id));
  const selectedSub = catalog.find((s) => s.id === subscriptionId) || null;

  const availablePlans: SubscriptionPlanRow[] = useMemo(() => {
    if (!selectedSub || !country) return [];
    return (selectedSub.plans || [])
      .filter((p) => p.is_active && (p.pricing || []).some((pr) => pr.country_id === country.id))
      .sort((a, b) => PLAN_ORDER.indexOf(a.plan) - PLAN_ORDER.indexOf(b.plan));
  }, [selectedSub, country]);

  const addMutation = useMutation({
    mutationFn: (pid: string) => api.post(`/admin/clients/${clientId}/subscriptions`, { plan_ids: [pid] }),
    onSuccess: () => onDone(),
    onError: (err: any) => alert(err?.response?.data?.error || err.message || 'Failed'),
  });

  const sym = country?.currency === 'USD' ? '$' : '\u20B9';
  const locale = country?.currency === 'USD' ? 'en-US' : 'en-IN';

  return (
    <div className="mb-3 space-y-2 rounded-lg border border-divider bg-surface-alt p-3">
      <div>
        <label className="mb-1 block text-xs font-medium text-foreground-muted">Subscription</label>
        <select
          value={subscriptionId}
          onChange={(e) => { setSubscriptionId(e.target.value); setPlanId(''); }}
          className="w-full rounded-md border border-divider bg-surface px-2 py-1.5 text-sm text-foreground focus:border-accent focus:outline-none"
        >
          <option value="">Select subscription…</option>
          {available.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          {available.length === 0 && <option value="" disabled>No subscriptions available</option>}
        </select>
      </div>

      {selectedSub && (
        <div>
          <label className="mb-1 block text-xs font-medium text-foreground-muted">
            Plan {country ? `(${country.currency} for ${country.name})` : ''}
          </label>
          {availablePlans.length === 0 ? (
            <p className="rounded-md bg-surface px-2 py-1.5 text-xs text-foreground-dim">
              No plans priced for {country?.name || 'this country'} yet.
            </p>
          ) : (
            <select
              value={planId}
              onChange={(e) => setPlanId(e.target.value)}
              className="w-full rounded-md border border-divider bg-surface px-2 py-1.5 text-sm text-foreground focus:border-accent focus:outline-none"
            >
              <option value="">Select plan…</option>
              {TIERS.map((tier) => {
                const inTier = availablePlans.filter((p) => p.tier === tier);
                if (inTier.length === 0) return null;
                return (
                  <optgroup key={tier} label={tier}>
                    {inTier.map((p) => {
                      const price = (p.pricing || []).find((pr) => pr.country_id === country?.id)?.price ?? 0;
                      return (
                        <option key={p.id} value={p.id}>
                          {p.plan} — {sym}{price.toLocaleString(locale)}/mo
                        </option>
                      );
                    })}
                  </optgroup>
                );
              })}
            </select>
          )}
        </div>
      )}

      <button
        onClick={() => planId && addMutation.mutate(planId)}
        disabled={!planId || addMutation.isPending}
        className="w-full rounded-md bg-ink px-3 py-2 text-xs font-medium text-white hover:bg-ink-hover disabled:opacity-50"
      >
        {addMutation.isPending ? 'Adding...' : 'Add subscription'}
      </button>
      <p className="text-[10px] text-foreground-dim">Plan defaults will be copied as editable deliverables.</p>
    </div>
  );
}
