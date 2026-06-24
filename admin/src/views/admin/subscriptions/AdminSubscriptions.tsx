'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../../services/api';
import SquadHireProfilesPanel from './SquadHireProfilesPanel';
import type {
  Subscription,
  SubscriptionPlan,
  SubscriptionPlanRow,
  SubscriptionPlanPricing,
  SubscriptionDeliverableType,
  SubscriptionPlanDeliverable,
  SubscriptionTier,
  DeliverableKind,
  Country,
  CurrencyCode,
} from '@squadhub/shared';

const PLAN_ORDER: SubscriptionPlan[] = ['Starter', 'Basic', 'Plus', 'Pro', 'Personal'];
const TIERS: SubscriptionTier[] = ['Junior', 'Pro', 'Top Talents'];
const TIER_COLOR: Record<SubscriptionTier, string> = {
  Junior: 'bg-canvas text-foreground-muted',
  Pro: 'bg-indigo-100 text-indigo-700',
  'Top Talents': 'bg-yellow-100 text-yellow-700',
};

function currencySymbol(code: CurrencyCode | undefined | null) {
  return code === 'USD' ? '$' : '\u20B9';
}

function formatPrice(price: number, code: CurrencyCode | undefined | null) {
  const sym = currencySymbol(code);
  return `${sym}${price.toLocaleString(code === 'USD' ? 'en-US' : 'en-IN')}`;
}

type SidebarItem = { type: 'countries' } | { type: 'subscription'; id: string };

export default function AdminSubscriptions() {
  const { data: listRes, isLoading } = useQuery({
    queryKey: ['admin-subs-catalog'],
    queryFn: () => api.get('/admin/subscriptions').then((r) => r.data),
  });

  const { data: countriesRes } = useQuery({
    queryKey: ['admin-countries'],
    queryFn: () => api.get('/admin/countries').then((r) => r.data),
  });

  const subs: Subscription[] = listRes?.data || [];
  const countries: Country[] = countriesRes?.data || [];
  const [selected, setSelected] = useState<SidebarItem | null>(null);

  useEffect(() => {
    if (!selected && subs.length > 0) setSelected({ type: 'subscription', id: subs[0].id });
  }, [subs, selected]);

  const activeSub = useMemo(
    () => (selected?.type === 'subscription' ? subs.find((s) => s.id === selected.id) || null : null),
    [subs, selected],
  );

  return (
    <div className="-m-6 flex h-[calc(100vh)] overflow-hidden">
      {/* Inner sidebar */}
      <div className="flex w-56 shrink-0 flex-col border-r border-divider bg-surface">
        <div className="border-b border-divider px-4 py-3">
          <div className="flex items-center gap-2">
            <svg className="h-5 w-5 text-accent" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 7.5a1.5 1.5 0 011.5-1.5h13.5a1.5 1.5 0 011.5 1.5v9a1.5 1.5 0 01-1.5 1.5H5.25a1.5 1.5 0 01-1.5-1.5v-9zM8 10h8M8 14h5" />
            </svg>
            <h2 className="font-[family-name:var(--font-display)] text-sm font-bold text-foreground">Subscriptions</h2>
          </div>
        </div>

        <nav className="flex flex-col gap-0.5 p-2">
          <button
            onClick={() => setSelected({ type: 'countries' })}
            className={`flex items-center justify-between rounded-md px-3 py-2 text-left text-[13px] transition-colors ${
              selected?.type === 'countries'
                ? 'bg-[#EEF2FF] font-semibold text-accent'
                : 'text-foreground-muted hover:bg-surface-alt'
            }`}
          >
            <span className="flex items-center gap-2">
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9 9 0 100-18 9 9 0 000 18zm0 0a8.949 8.949 0 01-4.951-1.488A3.987 3.987 0 019 16.5v-1.5m5.25 5.97a8.968 8.968 0 004.242-6m-4.242 6a8.94 8.94 0 00.708-3.5m3.534-2.5a8.961 8.961 0 00.258-2.106m-9 4.106A8.942 8.942 0 013 12c0-1.602.42-3.105 1.156-4.408M14.25 3.104a8.969 8.969 0 00-4.5 0m4.5 0a8.969 8.969 0 014.594 2.508M9.75 3.104a8.97 8.97 0 00-4.594 2.508" />
              </svg>
              Countries
            </span>
            <span className="rounded-full bg-canvas px-1.5 py-0.5 text-[10px] font-semibold text-foreground-muted">{countries.length}</span>
          </button>

          <div className="my-1 border-t border-divider" />

          {isLoading ? (
            <p className="px-3 py-2 text-xs text-foreground-dim">Loading...</p>
          ) : subs.map((s) => (
            <button
              key={s.id}
              onClick={() => setSelected({ type: 'subscription', id: s.id })}
              className={`flex items-center justify-between rounded-md px-3 py-2 text-left text-[13px] transition-colors ${
                selected?.type === 'subscription' && selected.id === s.id
                  ? 'bg-[#EEF2FF] font-semibold text-accent'
                  : 'text-foreground-muted hover:bg-surface-alt'
              }`}
            >
              <span>{s.name}</span>
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                  s.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-canvas text-foreground-muted'
                }`}
              >
                {s.is_active ? 'Active' : 'Inactive'}
              </span>
            </button>
          ))}
        </nav>

        <div className="mt-auto border-t border-divider p-3">
          <p className="text-[10px] text-foreground-dim">Catalog is fixed. Admin toggles plans / tiers / prices per country.</p>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-auto bg-surface-alt p-6">
        {selected?.type === 'countries' ? (
          <CountriesManager countries={countries} />
        ) : activeSub ? (
          <SubscriptionDetail key={activeSub.id} subscription={activeSub} countries={countries} />
        ) : (
          <p className="text-sm text-foreground-dim">Loading catalog...</p>
        )}
      </div>
    </div>
  );
}

// ============================================================
// Countries Manager
// ============================================================

function CountriesManager({ countries }: { countries: Country[] }) {
  const queryClient = useQueryClient();
  const [newName, setNewName] = useState('');
  const [newCurrency, setNewCurrency] = useState<CurrencyCode>('USD');

  const createCountry = useMutation({
    mutationFn: (body: { name: string; currency: CurrencyCode }) => api.post('/admin/countries', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-countries'] });
      queryClient.invalidateQueries({ queryKey: ['admin-subs-catalog'] });
      setNewName('');
      setNewCurrency('USD');
    },
    onError: (err: any) => alert(err?.response?.data?.error || err.message || 'Failed'),
  });

  const updateCountry = useMutation({
    mutationFn: ({ id, body }: { id: string; body: any }) => api.put(`/admin/countries/${id}`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-countries'] });
      queryClient.invalidateQueries({ queryKey: ['admin-subs-catalog'] });
    },
    onError: (err: any) => alert(err?.response?.data?.error || err.message || 'Failed'),
  });

  const deleteCountry = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/countries/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-countries'] }),
    onError: (err: any) => alert(err?.response?.data?.error || err.message || 'Cannot delete'),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-[family-name:var(--font-display)] text-xl font-bold text-foreground">Countries</h1>
        <p className="mt-1 text-sm text-foreground-muted">Country catalog for plan pricing. India is billed in INR; everywhere else in USD.</p>
      </div>

      <div className="rounded-lg border border-divider bg-surface">
        <div className="divide-y divide-[#F1F5F9]">
          {countries.map((c) => (
            <CountryRow
              key={c.id}
              country={c}
              onRename={(name) => updateCountry.mutate({ id: c.id, body: { name } })}
              onChangeCurrency={(currency) => updateCountry.mutate({ id: c.id, body: { currency } })}
              onToggleActive={() => updateCountry.mutate({ id: c.id, body: { is_active: !c.is_active } })}
              onDelete={() => {
                if (confirm(`Delete "${c.name}"? Only possible if no plans or clients reference it.`)) {
                  deleteCountry.mutate(c.id);
                }
              }}
            />
          ))}
        </div>
        <div className="flex items-center gap-2 border-t border-divider p-3">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="New country name"
            className="flex-1 rounded-md border border-divider px-3 py-1.5 text-sm text-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <select
            value={newCurrency}
            onChange={(e) => setNewCurrency(e.target.value as CurrencyCode)}
            className="rounded-md border border-divider bg-surface px-2 py-1.5 text-sm text-foreground focus:border-accent focus:outline-none"
          >
            <option value="USD">USD</option>
            <option value="INR">INR</option>
          </select>
          <button
            onClick={() => newName.trim() && createCountry.mutate({ name: newName.trim(), currency: newCurrency })}
            disabled={!newName.trim() || createCountry.isPending}
            className="rounded-md bg-ink px-3 py-1.5 text-xs font-medium text-white hover:bg-ink-hover disabled:opacity-50"
          >
            Add
          </button>
        </div>
      </div>
    </div>
  );
}

function CountryRow({
  country, onRename, onChangeCurrency, onToggleActive, onDelete,
}: {
  country: Country;
  onRename: (name: string) => void;
  onChangeCurrency: (c: CurrencyCode) => void;
  onToggleActive: () => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(country.name);

  useEffect(() => setName(country.name), [country.name]);

  return (
    <div className={`flex items-center gap-3 px-3 py-2 ${country.is_active ? '' : 'opacity-50'}`}>
      {editing ? (
        <>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="flex-1 rounded-md border border-divider px-2 py-1 text-sm text-foreground focus:border-accent focus:outline-none"
          />
          <button
            onClick={() => { onRename(name.trim() || country.name); setEditing(false); }}
            className="rounded-md bg-ink px-2 py-1 text-xs text-white hover:bg-ink-hover"
          >
            Save
          </button>
          <button
            onClick={() => { setName(country.name); setEditing(false); }}
            className="rounded-md border border-divider px-2 py-1 text-xs text-foreground-muted hover:bg-canvas"
          >
            Cancel
          </button>
        </>
      ) : (
        <>
          <span className="flex-1 text-sm text-foreground">{country.name}</span>
          <select
            value={country.currency}
            onChange={(e) => onChangeCurrency(e.target.value as CurrencyCode)}
            className="rounded-md border border-divider bg-surface px-2 py-1 text-xs text-foreground focus:border-accent focus:outline-none"
          >
            <option value="USD">USD</option>
            <option value="INR">INR</option>
          </select>
          <button
            onClick={() => setEditing(true)}
            className="rounded-md p-1 text-foreground-dim hover:bg-canvas hover:text-foreground"
            aria-label="Rename"
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125" />
            </svg>
          </button>
          <button
            onClick={onToggleActive}
            className={`rounded-md px-2 py-1 text-[10px] font-medium ${
              country.is_active ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100' : 'bg-canvas text-foreground-muted hover:bg-well'
            }`}
          >
            {country.is_active ? 'Active' : 'Inactive'}
          </button>
          <button
            onClick={onDelete}
            className="rounded-md p-1 text-foreground-dim hover:bg-red-50 hover:text-red-500"
            aria-label="Delete"
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </>
      )}
    </div>
  );
}

// ============================================================
// Subscription Detail
// ============================================================

function SubscriptionDetail({ subscription, countries }: { subscription: Subscription; countries: Country[] }) {
  const queryClient = useQueryClient();

  const toggleActive = useMutation({
    mutationFn: (is_active: boolean) =>
      api.put(`/admin/subscriptions/${subscription.id}`, { is_active }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-subs-catalog'] }),
  });

  const plans: SubscriptionPlanRow[] = subscription.plans || [];
  const plansByTier: Record<SubscriptionTier, SubscriptionPlanRow[]> = { Junior: [], Pro: [], 'Top Talents': [] };
  plans.forEach((p) => {
    const tier: SubscriptionTier = p.tier && plansByTier[p.tier] ? p.tier : 'Junior';
    plansByTier[tier].push(p);
  });
  (Object.keys(plansByTier) as SubscriptionTier[]).forEach((t) => {
    plansByTier[t].sort((a, b) => PLAN_ORDER.indexOf(a.plan) - PLAN_ORDER.indexOf(b.plan));
  });

  const activeCountries = countries.filter((c) => c.is_active);
  const [selectedCountryId, setSelectedCountryId] = useState<string>('');

  useEffect(() => {
    if (!selectedCountryId && activeCountries.length > 0) {
      const india = activeCountries.find((c) => c.name === 'India');
      setSelectedCountryId((india || activeCountries[0]).id);
    }
  }, [activeCountries, selectedCountryId]);

  const selectedCountry = activeCountries.find((c) => c.id === selectedCountryId) || null;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-[family-name:var(--font-display)] text-xl font-bold text-foreground">{subscription.name}</h1>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${subscription.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-canvas text-foreground-muted'}`}>
              {subscription.is_active ? 'Active' : 'Inactive'}
            </span>
          </div>
          {subscription.description && (
            <p className="mt-1 text-sm text-foreground-muted">{subscription.description}</p>
          )}
        </div>
        <button
          onClick={() => toggleActive.mutate(!subscription.is_active)}
          disabled={toggleActive.isPending}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition disabled:opacity-50 ${
            subscription.is_active
              ? 'border border-divider bg-surface text-foreground hover:bg-canvas'
              : 'bg-ink text-white hover:bg-ink-hover'
          }`}
        >
          {subscription.is_active ? 'Mark Inactive' : 'Mark Active'}
        </button>
      </div>

      {/* SquadHire Profiles — top, compact dropdown */}
      <section className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div>
          <h2 className="font-[family-name:var(--font-display)] text-sm font-semibold text-foreground">SquadHire Profiles</h2>
          <p className="text-[11px] text-foreground-muted">Pre-fills new subscription cards. Sales can override per card.</p>
        </div>
        <div className="ml-auto min-w-[260px]">
          <SquadHireProfilesPanel subscriptionId={subscription.id} />
        </div>
      </section>

      {/* Plans, grouped by tier */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-[family-name:var(--font-display)] text-base font-semibold text-foreground">Plans</h2>
          <div className="flex items-center gap-2">
            <label className="text-xs text-foreground-muted">Pricing for</label>
            <select
              value={selectedCountryId}
              onChange={(e) => setSelectedCountryId(e.target.value)}
              className="rounded-md border border-divider bg-surface px-2 py-1 text-sm text-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            >
              {activeCountries.length === 0 && <option value="">No active countries</option>}
              {activeCountries.map((c) => (
                <option key={c.id} value={c.id}>{c.name} ({c.currency})</option>
              ))}
            </select>
          </div>
        </div>
        <div className="space-y-3">
          {TIERS.map((tier) => (
            <TierSection
              key={tier}
              tier={tier}
              plans={plansByTier[tier]}
              subscription={subscription}
              selectedCountry={selectedCountry}
            />
          ))}
        </div>
      </section>

      {/* Deliverable Types */}
      <section>
        <h2 className="mb-3 font-[family-name:var(--font-display)] text-base font-semibold text-foreground">Deliverable Types</h2>
        <DeliverableTypesEditor subscriptionId={subscription.id} types={subscription.deliverable_types || []} />
      </section>
    </div>
  );
}

// ============================================================
// Tier Section: prominent, collapsible group of plans per tier
// ============================================================

// A pending edit to one plan's pricing, held while a tier is in edit mode.
type PriceDraft = { price: string; marginValue: string; marginType: 'fixed' | 'percent' };

function draftFromRow(row: SubscriptionPlanPricing | null | undefined): PriceDraft {
  return {
    price: row?.price == null ? '' : String(row.price),
    marginValue: row?.margin_value == null ? '0' : String(row.margin_value),
    marginType: row?.margin_type || 'fixed',
  };
}

function TierSection({
  tier, plans, subscription, selectedCountry,
}: {
  tier: SubscriptionTier;
  plans: SubscriptionPlanRow[];
  subscription: Subscription;
  selectedCountry: Country | null;
}) {
  const queryClient = useQueryClient();
  const [collapsed, setCollapsed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, PriceDraft>>({});

  const rowFor = (p: SubscriptionPlanRow) =>
    selectedCountry ? p.pricing?.find((r) => r.country_id === selectedCountry.id) || null : null;

  // Switching country (or losing it) discards any in-progress edit, so drafts
  // can never be saved against the wrong country.
  useEffect(() => {
    setEditing(false);
    setDrafts({});
  }, [selectedCountry?.id]);

  const upsert = useMutation({
    mutationFn: ({ planId, body }: { planId: string; body: { country_id: string; price: number; margin_value: number; margin_type: 'fixed' | 'percent' } }) =>
      api.post(`/admin/subscriptions/plans/${planId}/pricing`, body),
  });
  const removeRow = useMutation({
    mutationFn: ({ planId, countryId }: { planId: string; countryId: string }) =>
      api.delete(`/admin/subscriptions/plans/${planId}/pricing/${countryId}`),
  });

  function startEdit() {
    const d: Record<string, PriceDraft> = {};
    plans.forEach((p) => { d[p.id] = draftFromRow(rowFor(p)); });
    setDrafts(d);
    setCollapsed(false);
    setEditing(true);
  }
  function cancelEdit() {
    setEditing(false);
    setDrafts({});
  }

  // Persist every changed (or cleared) plan in this tier, then leave edit mode.
  async function save() {
    if (!selectedCountry) return;
    setSaving(true);
    try {
      for (const p of plans) {
        const d = drafts[p.id];
        if (!d) continue;
        const cur = rowFor(p);
        if (d.price.trim() === '') {
          if (cur) await removeRow.mutateAsync({ planId: p.id, countryId: selectedCountry.id });
          continue;
        }
        const price = parseInt(d.price, 10);
        if (isNaN(price) || price < 0) continue;
        const m = parseInt(d.marginValue, 10);
        const mm = isNaN(m) || m < 0 ? 0 : m;
        if (cur && cur.price === price && cur.margin_value === mm && cur.margin_type === d.marginType) continue;
        await upsert.mutateAsync({
          planId: p.id,
          body: { country_id: selectedCountry.id, price, margin_value: mm, margin_type: d.marginType },
        });
      }
      await queryClient.invalidateQueries({ queryKey: ['admin-subs-catalog'] });
      setEditing(false);
      setDrafts({});
    } catch (err: any) {
      alert(err?.response?.data?.error || err?.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  // Customer-price range across this tier's plans for the selected country,
  // shown in the header so it stays useful when the section is collapsed.
  const prices = selectedCountry
    ? plans
        .map((p) => p.pricing?.find((r) => r.country_id === selectedCountry.id)?.price)
        .filter((v): v is number => typeof v === 'number')
    : [];
  const sym = currencySymbol(selectedCountry?.currency);
  const locale = selectedCountry?.currency === 'USD' ? 'en-US' : 'en-IN';
  const lo = prices.length ? Math.min(...prices) : null;
  const hi = prices.length ? Math.max(...prices) : null;
  const range =
    lo == null
      ? null
      : lo === hi
        ? `${sym}${lo.toLocaleString(locale)}`
        : `${sym}${lo.toLocaleString(locale)} – ${sym}${hi!.toLocaleString(locale)}`;

  const canEdit = plans.length > 0 && !!selectedCountry;

  return (
    <div className={`overflow-hidden rounded-xl border bg-surface ${editing ? 'border-accent' : 'border-divider-strong'}`}>
      <div className="flex w-full items-center gap-3 px-4 py-3">
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
          className="flex flex-1 items-center gap-3 text-left"
        >
          <svg
            className={`h-4 w-4 shrink-0 text-foreground-dim transition-transform ${collapsed ? '' : 'rotate-90'}`}
            fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          <span className={`rounded-md px-3 py-1 text-sm font-bold ${TIER_COLOR[tier]}`}>{tier}</span>
          <span className="text-xs font-medium text-foreground-dim">
            {plans.length} plan{plans.length === 1 ? '' : 's'}
          </span>
          {range && (
            <span className="ml-auto mr-2 text-xs">
              <span className="font-semibold text-foreground">{range}</span>
              <span className="text-foreground-dim"> / mo</span>
            </span>
          )}
        </button>

        {canEdit && (editing ? (
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={cancelEdit}
              disabled={saving}
              className="rounded-md border border-divider px-3 py-1 text-xs font-medium text-foreground-muted hover:bg-canvas disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="rounded-md bg-ink px-3 py-1 text-xs font-medium text-white hover:bg-ink-hover disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={startEdit}
            className="flex shrink-0 items-center gap-1.5 rounded-md border border-divider px-3 py-1 text-xs font-medium text-foreground hover:bg-canvas"
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125" />
            </svg>
            Edit
          </button>
        ))}
      </div>

      {!collapsed && (
        <div className="space-y-2 border-t border-divider bg-surface-alt p-3">
          {plans.length === 0 ? (
            <p className="rounded-lg border border-dashed border-divider-strong bg-surface px-4 py-3 text-xs text-foreground-dim">
              No plans at {tier} tier yet. Run migration 027 to seed them.
            </p>
          ) : (
            plans.map((p) => (
              <PlanRow
                key={p.id}
                subscriptionId={subscription.id}
                plan={p}
                deliverableTypes={subscription.deliverable_types || []}
                selectedCountry={selectedCountry}
                editing={editing}
                draft={drafts[p.id]}
                onDraftChange={(next) => setDrafts((prev) => ({ ...prev, [p.id]: next }))}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================
// Plan Row: tier tag + inline price input for the selected country
// ============================================================

function PlanRow({
  subscriptionId, plan, deliverableTypes, selectedCountry, editing, draft, onDraftChange,
}: {
  subscriptionId: string;
  plan: SubscriptionPlanRow;
  deliverableTypes: SubscriptionDeliverableType[];
  selectedCountry: Country | null;
  editing: boolean;
  draft: PriceDraft | undefined;
  onDraftChange: (next: PriceDraft) => void;
}) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);

  const updatePlan = useMutation({
    mutationFn: (body: any) => api.put(`/admin/subscriptions/${subscriptionId}/plans/${plan.id}`, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-subs-catalog'] }),
    onError: (err: any) => alert(err?.response?.data?.error || err.message || 'Failed'),
  });

  const delivs = plan.deliverables || [];
  const currentPriceRow = selectedCountry
    ? (plan.pricing || []).find((p) => p.country_id === selectedCountry.id) || null
    : null;

  // Show the draft while this tier is being edited; otherwise the saved row.
  const value = editing && draft ? draft : draftFromRow(currentPriceRow);

  return (
    <div className={`rounded-lg border bg-surface ${editing ? 'border-accent/50' : 'border-divider'} ${plan.is_active ? '' : 'opacity-60'}`}>
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex h-6 w-6 items-center justify-center rounded text-foreground-dim hover:bg-canvas"
          aria-label="Toggle plan"
        >
          <svg className={`h-3 w-3 transition-transform ${expanded ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>

        <div className="w-24 text-sm font-medium text-foreground">{plan.plan}</div>

        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${TIER_COLOR[plan.tier] || TIER_COLOR.Junior}`}>
          {plan.tier || 'Junior'}
        </span>

        <PlanHours plan={plan} />

        <div className="ml-auto flex items-center gap-3">
          <span className="text-xs text-foreground-dim">{delivs.length} deliverable{delivs.length === 1 ? '' : 's'}</span>
          <button
            onClick={() => updatePlan.mutate({ is_active: !plan.is_active })}
            className={`rounded-md px-3 py-1 text-xs font-medium ${
              plan.is_active
                ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                : 'bg-canvas text-foreground-muted hover:bg-well'
            }`}
          >
            {plan.is_active ? 'Active' : 'Inactive'}
          </button>
        </div>
      </div>

      {/* Pricing strip — read-only until the tier is in edit mode */}
      <div className="border-t border-divider px-4 py-3">
        <PlanPricingStrip
          editing={editing}
          value={value}
          country={selectedCountry}
          onChange={onDraftChange}
        />
      </div>

      {expanded && (
        <div className="space-y-2 border-t border-divider bg-surface-alt px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-foreground-dim">Default deliverables</p>
          <PlanDeliverablesEditor
            subscriptionId={subscriptionId}
            planId={plan.id}
            deliverables={delivs}
            deliverableTypes={deliverableTypes.filter((t) => t.is_active)}
          />
        </div>
      )}
    </div>
  );
}

// ============================================================
// Plan Pricing Strip: controlled customer price + margin (₹/%).
// Read-only until its tier is in edit mode; edits flow up as draft changes and
// are only persisted when the tier's Save is pressed.
// ============================================================

function PlanPricingStrip({
  editing, value, country, onChange,
}: {
  editing: boolean;
  value: PriceDraft;
  country: Country | null;
  onChange: (next: PriceDraft) => void;
}) {
  const { price, marginValue, marginType } = value;
  const patch = (p: Partial<PriceDraft>) => onChange({ ...value, ...p });

  // Live figures derived from the current draft (or saved row when not editing).
  const priceN = parseInt(price, 10);
  const marginN = parseInt(marginValue, 10);
  const hasPrice = price.trim() !== '' && !isNaN(priceN) && priceN >= 0;
  const hasMargin = !isNaN(marginN) && marginN >= 0;
  const marginAmount = hasMargin
    ? marginType === 'percent'
      ? Math.round(((hasPrice ? priceN : 0) * marginN) / 100)
      : marginN
    : null;
  const marginPct =
    marginType === 'percent'
      ? hasMargin
        ? marginN
        : null
      : hasPrice && priceN > 0 && marginAmount != null
        ? Math.round((marginAmount / priceN) * 1000) / 10
        : null;
  const partner = hasPrice && marginAmount != null ? Math.max(0, priceN - marginAmount) : null;
  const sym = currencySymbol(country?.currency);
  const locale = country?.currency === 'USD' ? 'en-US' : 'en-IN';
  const fmt = (n: number) => `${sym}${n.toLocaleString(locale)}`;

  // Read-only display — shown whenever the tier is not in edit mode.
  if (!editing) {
    return (
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <PriceField label="Customer price">
          {hasPrice ? (
            <>
              <span className="text-sm font-medium text-foreground">{fmt(priceN)}</span>
              <span className="text-[11px] text-foreground-dim">/ mo</span>
            </>
          ) : (
            <span className="text-sm text-foreground-dim">—</span>
          )}
        </PriceField>
        <PriceField label="Margin">
          <span className="text-sm font-medium text-foreground">{marginAmount == null ? '—' : fmt(marginAmount)}</span>
          {marginPct != null && <span className="text-[11px] text-foreground-dim">· {marginPct}%</span>}
        </PriceField>
        <PriceField label="Partner price">
          <span className="text-sm font-semibold text-emerald-600">{partner == null ? '—' : fmt(partner)}</span>
        </PriceField>
      </div>
    );
  }

  // Editing mode — both margin figures shown; the toggle picks the editable one,
  // the other is auto-calculated. Preserves the rupee amount across switches.
  const amountFieldValue = marginType === 'fixed' ? marginValue : marginAmount == null ? '' : String(marginAmount);
  const percentFieldValue =
    marginType === 'percent'
      ? marginValue
      : marginPct == null
        ? ''
        : Number.isInteger(marginPct) ? String(marginPct) : marginPct.toFixed(1);
  const useFixed = () => { if (marginType !== 'fixed') patch({ marginType: 'fixed', marginValue: String(marginAmount ?? 0) }); };
  const usePercent = () => { if (marginType !== 'percent') patch({ marginType: 'percent', marginValue: String(marginPct == null ? 0 : Math.round(marginPct)) }); };

  return (
    <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
      {/* Customer price (minimum monthly) */}
      <PriceField label="Customer price">
        <span className="text-xs text-foreground-dim">{sym}</span>
        <input
          type="number"
          min={0}
          value={price}
          onChange={(e) => patch({ price: e.target.value })}
          placeholder="—"
          className="w-24 rounded-md border border-divider px-2 py-1 text-sm text-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        />
        <span className="text-[11px] text-foreground-dim">/ mo</span>
      </PriceField>

      {/* Margin — rupee amount and percent shown together; toggle picks which is editable */}
      <PriceField label="Margin">
        {/* Amount (₹) */}
        <label
          className={`flex items-center gap-1 rounded-md border px-2 py-1 ${marginType === 'fixed' ? 'border-accent bg-surface' : 'border-divider bg-surface-alt'}`}
          title={marginType === 'fixed' ? 'Editable — margin as a rupee amount' : 'Auto-calculated from the percentage'}
        >
          <span className="text-xs text-foreground-dim">{sym}</span>
          <input
            type="number"
            min={0}
            step={1}
            value={amountFieldValue}
            onChange={(e) => { if (marginType === 'fixed') patch({ marginValue: e.target.value }); }}
            readOnly={marginType !== 'fixed'}
            placeholder="0"
            className={`w-16 bg-transparent text-sm focus:outline-none ${marginType === 'fixed' ? 'text-foreground' : 'cursor-default text-foreground-muted'}`}
          />
        </label>

        {/* Percent (%) */}
        <label
          className={`flex items-center gap-1 rounded-md border px-2 py-1 ${marginType === 'percent' ? 'border-accent bg-surface' : 'border-divider bg-surface-alt'}`}
          title={marginType === 'percent' ? 'Editable — margin as a percentage of the customer price' : 'Auto-calculated from the rupee amount'}
        >
          <input
            type="number"
            min={0}
            step={1}
            value={percentFieldValue}
            onChange={(e) => { if (marginType === 'percent') patch({ marginValue: e.target.value }); }}
            readOnly={marginType !== 'percent'}
            placeholder="0"
            className={`w-14 bg-transparent text-sm focus:outline-none ${marginType === 'percent' ? 'text-foreground' : 'cursor-default text-foreground-muted'}`}
          />
          <span className="text-xs text-foreground-dim">%</span>
        </label>

        {/* Mode toggle — chooses the editable figure */}
        <div className="ml-0.5 inline-flex overflow-hidden rounded-md border border-divider">
          <button
            type="button"
            onClick={useFixed}
            title="Drive margin by rupee amount"
            className={`px-2 py-1 text-[11px] font-medium transition-colors ${marginType === 'fixed' ? 'bg-ink text-white' : 'bg-surface text-foreground-muted hover:bg-canvas'}`}
          >
            {sym}
          </button>
          <button
            type="button"
            onClick={usePercent}
            title="Drive margin by percentage"
            className={`border-l border-divider px-2 py-1 text-[11px] font-medium transition-colors ${marginType === 'percent' ? 'bg-ink text-white' : 'bg-surface text-foreground-muted hover:bg-canvas'}`}
          >
            %
          </button>
        </div>
      </PriceField>

      {/* Partner price (computed = customer − margin) */}
      <PriceField label="Partner price">
        <span
          className="text-sm font-semibold text-emerald-600"
          title="What the partner is paid = customer price − margin"
        >
          {partner == null ? '—' : fmt(partner)}
        </span>
      </PriceField>
    </div>
  );
}

// Label-on-top field cell used across the pricing strip so inputs and computed
// values share a baseline and never collide.
function PriceField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-foreground-dim">{label}</span>
      <div className="flex h-7 items-center gap-1">{children}</div>
    </div>
  );
}

// Compact read-only daily / weekly / monthly hours shown on every plan row so
// the commitment is visible without expanding the deliverables section.
function PlanHours({ plan }: { plan: SubscriptionPlanRow }) {
  const fmt = (v: number | null | undefined) => {
    if (v == null) return '—';
    const n = Number(v);
    return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, '');
  };
  return (
    <div className="flex items-center gap-1.5 text-[11px] text-foreground-muted" title="Hours — daily / weekly / monthly">
      <svg className="h-3.5 w-3.5 text-foreground-dim" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <span><span className="font-semibold text-foreground">{fmt(plan.daily_hours)}</span><span className="text-foreground-dim">/d</span></span>
      <span className="text-divider-strong">·</span>
      <span><span className="font-semibold text-foreground">{fmt(plan.weekly_hours)}</span><span className="text-foreground-dim">/w</span></span>
      <span className="text-divider-strong">·</span>
      <span><span className="font-semibold text-foreground">{fmt(plan.monthly_hours)}</span><span className="text-foreground-dim">/m</span></span>
    </div>
  );
}

// ============================================================
// Plan Deliverables Editor
// ============================================================

function PlanDeliverablesEditor({
  subscriptionId, planId, deliverables, deliverableTypes,
}: {
  subscriptionId: string;
  planId: string;
  deliverables: SubscriptionPlanDeliverable[];
  deliverableTypes: SubscriptionDeliverableType[];
}) {
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<DeliverableKind>('item');
  const [typeId, setTypeId] = useState<string>('');
  const [perDay, setPerDay] = useState('');
  const [perWeek, setPerWeek] = useState('');
  const [perMonth, setPerMonth] = useState('');

  function resetForm() {
    setAdding(false); setKind('item'); setTypeId(''); setPerDay(''); setPerWeek(''); setPerMonth('');
  }

  const createDeliverable = useMutation({
    mutationFn: (body: any) => api.post(`/admin/subscriptions/${subscriptionId}/plans/${planId}/deliverables`, body),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['admin-subs-catalog'] }); resetForm(); },
    onError: (err: any) => alert(err?.response?.data?.error || err.message || 'Failed'),
  });

  const updateDeliverable = useMutation({
    mutationFn: ({ id, body }: { id: string; body: any }) => api.put(`/admin/subscriptions/plan-deliverables/${id}`, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-subs-catalog'] }),
  });

  const deleteDeliverable = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/subscriptions/plan-deliverables/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-subs-catalog'] }),
  });

  function submitAdd() {
    if (kind === 'item' && !typeId) {
      alert('Pick a deliverable type for item deliverables.');
      return;
    }
    createDeliverable.mutate({
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
        <p className="text-xs text-foreground-dim">No default deliverables configured.</p>
      )}

      {deliverables.map((d) => (
        <DeliverableEditableRow
          key={d.id}
          deliverable={d}
          deliverableTypes={deliverableTypes}
          onUpdate={(body) => updateDeliverable.mutate({ id: d.id, body })}
          onDelete={() => deleteDeliverable.mutate(d.id)}
        />
      ))}

      {adding ? (
        <div className="space-y-2 rounded-md border border-dashed border-divider-strong bg-surface p-3">
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
          <div className="flex items-center gap-2 text-xs text-foreground-muted">
            <NumInput label="/ day" value={perDay} onChange={setPerDay} />
            <NumInput label="/ week" value={perWeek} onChange={setPerWeek} />
            <NumInput label="/ month" value={perMonth} onChange={setPerMonth} />
          </div>
          <div className="flex gap-2">
            <button onClick={submitAdd} disabled={createDeliverable.isPending} className="rounded-md bg-ink px-3 py-1 text-xs font-medium text-white hover:bg-ink-hover disabled:opacity-50">
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
          className="rounded-md border border-dashed border-divider-strong px-3 py-1.5 text-xs text-foreground-muted hover:bg-surface hover:text-foreground"
        >
          + Add deliverable
        </button>
      )}
    </div>
  );
}

function DeliverableEditableRow({
  deliverable, deliverableTypes, onUpdate, onDelete,
}: {
  deliverable: SubscriptionPlanDeliverable;
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
    <div className="flex items-center gap-3 rounded-md bg-surface px-3 py-2">
      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
        deliverable.kind === 'hours' ? 'bg-indigo-100 text-indigo-700' : 'bg-purple-100 text-purple-700'
      }`}>
        {deliverable.kind === 'hours' ? 'Hours' : 'Item'}
      </span>
      <span className="text-sm text-foreground">{typeName}</span>
      <div className="ml-auto flex items-center gap-2">
        <NumInput label="/d" value={perDay} onChange={setPerDay} onBlur={save} compact />
        <NumInput label="/w" value={perWeek} onChange={setPerWeek} onBlur={save} compact />
        <NumInput label="/m" value={perMonth} onChange={setPerMonth} onBlur={save} compact />
        <button onClick={onDelete} className="rounded-md p-1 text-foreground-dim hover:bg-red-50 hover:text-red-500">
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      </div>
    </div>
  );
}

function NumInput({
  label, value, onChange, onBlur, compact,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  compact?: boolean;
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
        className={`rounded-md border border-divider px-2 py-1 text-xs text-foreground focus:border-accent focus:outline-none ${compact ? 'w-14' : 'w-20'}`}
      />
      <span className="text-[11px] text-foreground-dim">{label}</span>
    </div>
  );
}

// ============================================================
// Deliverable Types Editor (subscription-level catalog)
// ============================================================

function DeliverableTypesEditor({
  subscriptionId, types,
}: {
  subscriptionId: string;
  types: SubscriptionDeliverableType[];
}) {
  const queryClient = useQueryClient();
  const [newName, setNewName] = useState('');

  const createType = useMutation({
    mutationFn: (name: string) => api.post(`/admin/subscriptions/${subscriptionId}/deliverable-types`, { name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-subs-catalog'] });
      setNewName('');
    },
    onError: (err: any) => alert(err?.response?.data?.error || err.message || 'Failed'),
  });

  const updateType = useMutation({
    mutationFn: ({ id, body }: { id: string; body: any }) => api.put(`/admin/subscriptions/deliverable-types/${id}`, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-subs-catalog'] }),
  });

  const sorted = [...types].sort((a, b) => a.sort_order - b.sort_order);

  return (
    <div className="rounded-lg border border-divider bg-surface">
      <div className="divide-y divide-[#F1F5F9]">
        {sorted.map((t) => (
          <TypeRow
            key={t.id}
            type={t}
            onRename={(name) => updateType.mutate({ id: t.id, body: { name } })}
            onToggleActive={() => updateType.mutate({ id: t.id, body: { is_active: !t.is_active } })}
          />
        ))}
      </div>
      <div className="flex items-center gap-2 border-t border-divider p-3">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New deliverable type name"
          className="flex-1 rounded-md border border-divider px-3 py-1.5 text-sm text-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        />
        <button
          onClick={() => newName.trim() && createType.mutate(newName.trim())}
          disabled={!newName.trim() || createType.isPending}
          className="rounded-md bg-ink px-3 py-1.5 text-xs font-medium text-white hover:bg-ink-hover disabled:opacity-50"
        >
          Add
        </button>
      </div>
    </div>
  );
}

function TypeRow({
  type, onRename, onToggleActive,
}: {
  type: SubscriptionDeliverableType;
  onRename: (name: string) => void;
  onToggleActive: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(type.name);

  useEffect(() => setName(type.name), [type.name]);

  return (
    <div className={`flex items-center gap-3 px-3 py-2 ${type.is_active ? '' : 'opacity-50'}`}>
      {editing ? (
        <>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="flex-1 rounded-md border border-divider px-2 py-1 text-sm text-foreground focus:border-accent focus:outline-none"
          />
          <button
            onClick={() => { onRename(name.trim() || type.name); setEditing(false); }}
            className="rounded-md bg-ink px-2 py-1 text-xs text-white hover:bg-ink-hover"
          >
            Save
          </button>
          <button
            onClick={() => { setName(type.name); setEditing(false); }}
            className="rounded-md border border-divider px-2 py-1 text-xs text-foreground-muted hover:bg-canvas"
          >
            Cancel
          </button>
        </>
      ) : (
        <>
          <span className="flex-1 text-sm text-foreground">{type.name}</span>
          <button
            onClick={() => setEditing(true)}
            className="rounded-md p-1 text-foreground-dim hover:bg-canvas hover:text-foreground"
            aria-label="Rename"
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125" />
            </svg>
          </button>
          <button
            onClick={onToggleActive}
            className={`rounded-md px-2 py-1 text-[10px] font-medium ${
              type.is_active ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100' : 'bg-canvas text-foreground-muted hover:bg-well'
            }`}
          >
            {type.is_active ? 'Active' : 'Inactive'}
          </button>
        </>
      )}
    </div>
  );
}

export { formatPrice, currencySymbol };
