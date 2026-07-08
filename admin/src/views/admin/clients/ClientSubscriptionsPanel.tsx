'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
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

const PLAN_ORDER: SubscriptionPlan[] = ['Starter', 'Basic', 'Plus', 'Pro', 'Personal'];
const TIERS: SubscriptionTier[] = ['Junior', 'Pro', 'Top Talents'];
const TIER_COLOR: Record<SubscriptionTier, string> = {
  Junior: 'bg-canvas text-foreground-muted',
  Pro: 'bg-indigo-100 text-indigo-700',
  'Top Talents': 'bg-yellow-100 text-yellow-700',
};

// ============================================================
// Lifecycle grouping — buckets each subscription by the state of its linked
// broadcast card, mirroring the Subscription Cards section's buckets so the two
// stay consistent. Subscriptions with no linked card yet fall back to their
// own status. (Precedence matches AdminSubscriptionCards.categorize().)
// ============================================================
type SubLifecycleBucket =
  | 'newdeal' | 'published' | 'broadcaster' | 'selected'
  | 'assigned' | 'paused' | 'cancelled';

function subscriptionBucket(cs: ClientSubscription): SubLifecycleBucket {
  // No dedicated "Archived" bucket — the grouping mirrors the Subscription Cards
  // section, which surfaces archived/custom in their own tabs, not here. When
  // "Show archived" is on, an archived subscription still folds into its
  // lifecycle bucket (rendered with an "Archived" pill + Unarchive action).
  const card = cs.card;
  if (card) {
    // Cancelled/closed and paused win over the recipient pointer — both keep
    // selected_recipient_id set (for audit / resume), so check them first.
    if (card.cancelled_at || card.state === 'closed') return 'cancelled';
    if (card.paused_at) return 'paused';
    if (card.selected_recipient_id) return 'assigned';
    if (card.state === 'assigned') return 'selected';
    if (card.state === 'published') return card.needs_broadcast ? 'published' : 'broadcaster';
    return 'newdeal'; // 'new' | 'draft' | anything not yet published
  }
  if (cs.status === 'cancelled') return 'cancelled';
  if (cs.status === 'paused') return 'paused';
  return 'newdeal';
}

// Display order + default-open policy. New Deals / Published / Broadcasted /
// Assigned are the primary pipeline stages (open when they hold cards, shown
// collapsed when empty); the rest sit collapsed and only appear when non-empty.
const SUB_GROUPS: { key: SubLifecycleBucket; label: string; color: string; primary: boolean }[] = [
  { key: 'newdeal',     label: 'New Deals',   color: '#64748b', primary: true },
  { key: 'published',   label: 'Published',   color: '#3b82f6', primary: true },
  { key: 'broadcaster', label: 'Broadcasted', color: '#6366f1', primary: true },
  { key: 'selected',    label: 'Selected',    color: '#14b8a6', primary: false },
  { key: 'assigned',    label: 'Assigned',    color: '#10b981', primary: true },
  { key: 'paused',      label: 'Paused',      color: '#f59e0b', primary: false },
  { key: 'cancelled',   label: 'Cancelled',   color: '#ef4444', primary: false },
];

/**
 * Presentational subscriptions manager for one client. The parent owns the
 * client fetch (so the detail header and this tab share a single source of
 * truth) and passes the loaded client down. Everything here — adding a
 * subscription, per-subscription status, deliverable overrides and archiving —
 * calls back through `onRefetch` so the parent re-pulls the client.
 */
export default function ClientSubscriptionsPanel({
  client,
  country,
  catalog,
  showArchived,
  onToggleArchived,
  onRefetch,
}: {
  client: Client;
  country: Country | null;
  catalog: Subscription[];
  showArchived: boolean;
  onToggleArchived: (v: boolean) => void;
  onRefetch: () => void;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const assignedSubscriptionIds = new Set((client.subscriptions || []).map((cs) => cs.subscription_id));
  const subs = client.subscriptions || [];
  const linkedCards = (client as unknown as { linkedCards?: { id: string; state: string }[] }).linkedCards || [];

  const grouped = useMemo(() => {
    const g: Record<SubLifecycleBucket, ClientSubscription[]> = {
      newdeal: [], published: [], broadcaster: [], selected: [],
      assigned: [], paused: [], cancelled: [],
    };
    subs.forEach((cs) => { g[subscriptionBucket(cs)].push(cs); });
    return g;
  }, [subs]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-foreground-dim">Subscriptions</h4>
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-foreground-muted">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => onToggleArchived(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-divider text-accent focus:ring-accent"
            />
            Show archived
          </label>
        </div>
        <button
          onClick={() => setAddOpen((v) => !v)}
          className="rounded-md bg-ink px-3 py-1.5 text-xs font-medium text-white transition hover:bg-ink-hover"
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
            onRefetch();
          }}
        />
      )}

      {subs.length === 0 ? (
        <p className="rounded-lg border border-divider bg-surface py-8 text-center text-xs text-foreground-dim">
          {showArchived ? 'No subscriptions yet.' : 'No active subscriptions. Click “+ Add Subscription” to assign one.'}
        </p>
      ) : (
        <div className="space-y-0.5">
          {SUB_GROUPS.map((g) => {
            const items = grouped[g.key];
            // Secondary groups only appear when they hold cards; the four primary
            // stages always render (empty ones show collapsed with a 0 count).
            if (items.length === 0 && !g.primary) return null;
            return (
              <SubscriptionGroup
                key={g.key}
                label={g.label}
                color={g.color}
                count={items.length}
                defaultOpen={g.primary && items.length > 0}
              >
                {items.map((cs) => (
                  <ClientSubscriptionCard
                    key={cs.id}
                    clientId={client.id}
                    cs={cs}
                    country={country}
                    catalog={catalog}
                    onRefetch={onRefetch}
                  />
                ))}
              </SubscriptionGroup>
            );
          })}
        </div>
      )}

      {linkedCards.length > 0 && (
        <div className="space-y-2 pt-2">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-foreground-dim">Other Cards</h4>
          <div className="divide-y divide-divider rounded-lg border border-divider bg-surface">
            {linkedCards.map((lc) => (
              <div key={lc.id} className="flex items-center justify-between px-4 py-3">
                <span className="text-sm text-foreground">Card</span>
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-canvas px-2 py-0.5 text-[10px] font-semibold capitalize text-foreground-muted">
                    {lc.state}
                  </span>
                  <a
                    href={`/admin/subscription-cards?card=${lc.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded bg-accent px-2 py-1 text-[10px] font-medium text-white hover:bg-accent-strong"
                  >
                    View Card
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Collapsible lifecycle group — chevron + colored dot + label + count, then a
// hairline. Primary stages open by default (when non-empty); an empty primary
// stage renders collapsed. User toggles persist for the panel's lifetime.
// ============================================================

function SubscriptionGroup({
  label, color, count, defaultOpen, children,
}: {
  label: string;
  color: string;
  count: number;
  defaultOpen: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2.5 py-2 text-left"
      >
        <svg
          className={`h-3.5 w-3.5 shrink-0 text-foreground-dim transition-transform ${open ? 'rotate-90' : ''}`}
          fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
        <span className="text-xs font-bold uppercase tracking-wider text-foreground">{label}</span>
        <span className="min-w-[1.25rem] rounded-full bg-canvas px-1.5 py-0.5 text-center text-[10px] font-semibold tabular-nums text-foreground-muted">
          {count}
        </span>
        <span className="ml-1 flex-1 self-center border-t border-divider" />
      </button>
      {open && (
        count > 0 ? (
          <div className="space-y-3 pb-2 pl-6">{children}</div>
        ) : (
          <p className="pb-2 pl-6 text-xs text-foreground-dim">No cards in this group.</p>
        )
      )}
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
  const isArchived = !!cs.archived_at;

  const pricing = cs.plan?.pricing?.find((p) => p.country_id === country?.id) || null;
  const sym = country?.currency === 'USD' ? '$' : '₹';
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

  const archiveMutation = useMutation({
    mutationFn: () => api.delete(`/admin/clients/${clientId}/subscriptions/${cs.id}`),
    onSuccess: () => onRefetch(),
  });

  const unarchiveMutation = useMutation({
    mutationFn: () => api.post(`/admin/clients/${clientId}/subscriptions/${cs.id}/unarchive`),
    onSuccess: () => onRefetch(),
  });

  const card = cs.card;

  async function copyCode(code: string) {
    try { await navigator.clipboard.writeText(code); } catch { /* ignore */ }
  }

  return (
    <div className={`rounded-lg border border-divider bg-surface p-4 ${cs.status === 'cancelled' || isArchived ? 'opacity-60' : ''}`}>
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
          {isArchived && (
            <span className="rounded-full bg-canvas px-2 py-0.5 text-[10px] font-medium text-foreground-muted">Archived</span>
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
        {card?.id && (
          <a
            href={`/admin/subscription-cards?card=${card.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded bg-accent px-2 py-1 text-[10px] font-medium text-white hover:bg-accent-strong"
          >
            View card ↗
          </a>
        )}
        {!isArchived && cs.status === 'active' && (
          <>
            <button onClick={() => statusMutation.mutate('paused')} className="rounded bg-amber-50 px-2 py-1 text-[10px] font-medium text-amber-700 hover:bg-amber-100">Pause</button>
            <button onClick={() => statusMutation.mutate('cancelled')} className="rounded bg-red-50 px-2 py-1 text-[10px] font-medium text-red-700 hover:bg-red-100">Cancel</button>
          </>
        )}
        {!isArchived && cs.status === 'paused' && (
          <>
            <button onClick={() => statusMutation.mutate('active')} className="rounded bg-emerald-50 px-2 py-1 text-[10px] font-medium text-emerald-700 hover:bg-emerald-100">Resume</button>
            <button onClick={() => statusMutation.mutate('cancelled')} className="rounded bg-red-50 px-2 py-1 text-[10px] font-medium text-red-700 hover:bg-red-100">Cancel</button>
          </>
        )}
        {!isArchived && cs.status === 'cancelled' && (
          <button onClick={() => statusMutation.mutate('active')} className="rounded bg-emerald-50 px-2 py-1 text-[10px] font-medium text-emerald-700 hover:bg-emerald-100">Reactivate</button>
        )}
        {isArchived ? (
          <button onClick={() => unarchiveMutation.mutate()} className="rounded bg-emerald-50 px-2 py-1 text-[10px] font-medium text-emerald-700 hover:bg-emerald-100" disabled={unarchiveMutation.isPending}>
            {unarchiveMutation.isPending ? 'Unarchiving…' : 'Unarchive'}
          </button>
        ) : (
          <button onClick={() => archiveMutation.mutate()} className="rounded bg-canvas px-2 py-1 text-[10px] font-medium text-foreground-muted hover:bg-well" disabled={archiveMutation.isPending}>
            Archive
          </button>
        )}
      </div>

      {!isArchived && (
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
      )}
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

  const sym = country?.currency === 'USD' ? '$' : '₹';
  const locale = country?.currency === 'USD' ? 'en-US' : 'en-IN';

  return (
    <div className="space-y-2 rounded-lg border border-divider bg-surface-alt p-3">
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
