'use client';

import { useEffect, useMemo, useState } from 'react';
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
const TIERS: SubscriptionTier[] = ['Junior', 'Pro', 'Elite'];
const TIER_COLOR: Record<SubscriptionTier, string> = {
  Junior: 'bg-slate-100 text-slate-600',
  Pro: 'bg-indigo-100 text-indigo-700',
  Elite: 'bg-yellow-100 text-yellow-700',
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
      <div className="flex w-56 shrink-0 flex-col border-r border-[#E2E8F0] bg-white">
        <div className="border-b border-[#E2E8F0] px-4 py-3">
          <div className="flex items-center gap-2">
            <svg className="h-5 w-5 text-[#2962FF]" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 7.5a1.5 1.5 0 011.5-1.5h13.5a1.5 1.5 0 011.5 1.5v9a1.5 1.5 0 01-1.5 1.5H5.25a1.5 1.5 0 01-1.5-1.5v-9zM8 10h8M8 14h5" />
            </svg>
            <h2 className="font-[family-name:var(--font-display)] text-sm font-bold text-[#0F172B]">Subscriptions</h2>
          </div>
        </div>

        <nav className="flex flex-col gap-0.5 p-2">
          <button
            onClick={() => setSelected({ type: 'countries' })}
            className={`flex items-center justify-between rounded-md px-3 py-2 text-left text-[13px] transition-colors ${
              selected?.type === 'countries'
                ? 'bg-[#EEF2FF] font-semibold text-[#2962FF]'
                : 'text-[#475569] hover:bg-[#F8FAFC]'
            }`}
          >
            <span className="flex items-center gap-2">
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9 9 0 100-18 9 9 0 000 18zm0 0a8.949 8.949 0 01-4.951-1.488A3.987 3.987 0 019 16.5v-1.5m5.25 5.97a8.968 8.968 0 004.242-6m-4.242 6a8.94 8.94 0 00.708-3.5m3.534-2.5a8.961 8.961 0 00.258-2.106m-9 4.106A8.942 8.942 0 013 12c0-1.602.42-3.105 1.156-4.408M14.25 3.104a8.969 8.969 0 00-4.5 0m4.5 0a8.969 8.969 0 014.594 2.508M9.75 3.104a8.97 8.97 0 00-4.594 2.508" />
              </svg>
              Countries
            </span>
            <span className="rounded-full bg-[#F1F5F9] px-1.5 py-0.5 text-[10px] font-semibold text-[#64748B]">{countries.length}</span>
          </button>

          <div className="my-1 border-t border-[#F1F5F9]" />

          {isLoading ? (
            <p className="px-3 py-2 text-xs text-[#90A1B9]">Loading...</p>
          ) : subs.map((s) => (
            <button
              key={s.id}
              onClick={() => setSelected({ type: 'subscription', id: s.id })}
              className={`flex items-center justify-between rounded-md px-3 py-2 text-left text-[13px] transition-colors ${
                selected?.type === 'subscription' && selected.id === s.id
                  ? 'bg-[#EEF2FF] font-semibold text-[#2962FF]'
                  : 'text-[#475569] hover:bg-[#F8FAFC]'
              }`}
            >
              <span>{s.name}</span>
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                  s.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
                }`}
              >
                {s.is_active ? 'Active' : 'Inactive'}
              </span>
            </button>
          ))}
        </nav>

        <div className="mt-auto border-t border-[#E2E8F0] p-3">
          <p className="text-[10px] text-[#90A1B9]">Catalog is fixed. Admin toggles plans / tiers / prices per country.</p>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-auto bg-[#F8FAFC] p-6">
        {selected?.type === 'countries' ? (
          <CountriesManager countries={countries} />
        ) : activeSub ? (
          <SubscriptionDetail key={activeSub.id} subscription={activeSub} countries={countries} />
        ) : (
          <p className="text-sm text-[#90A1B9]">Loading catalog...</p>
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
        <h1 className="font-[family-name:var(--font-display)] text-xl font-bold text-[#0F172B]">Countries</h1>
        <p className="mt-1 text-sm text-[#62748E]">Country catalog for plan pricing. India is billed in INR; everywhere else in USD.</p>
      </div>

      <div className="rounded-lg border border-[#E2E8F0] bg-white">
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
        <div className="flex items-center gap-2 border-t border-[#F1F5F9] p-3">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="New country name"
            className="flex-1 rounded-md border border-[#E2E8F0] px-3 py-1.5 text-sm text-[#0F172B] focus:border-[#2962FF] focus:outline-none focus:ring-1 focus:ring-[#2962FF]"
          />
          <select
            value={newCurrency}
            onChange={(e) => setNewCurrency(e.target.value as CurrencyCode)}
            className="rounded-md border border-[#E2E8F0] bg-white px-2 py-1.5 text-sm text-[#0F172B] focus:border-[#2962FF] focus:outline-none"
          >
            <option value="USD">USD</option>
            <option value="INR">INR</option>
          </select>
          <button
            onClick={() => newName.trim() && createCountry.mutate({ name: newName.trim(), currency: newCurrency })}
            disabled={!newName.trim() || createCountry.isPending}
            className="rounded-md bg-[#0F172B] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#1E293B] disabled:opacity-50"
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
            className="flex-1 rounded-md border border-[#E2E8F0] px-2 py-1 text-sm text-[#0F172B] focus:border-[#2962FF] focus:outline-none"
          />
          <button
            onClick={() => { onRename(name.trim() || country.name); setEditing(false); }}
            className="rounded-md bg-[#0F172B] px-2 py-1 text-xs text-white hover:bg-[#1E293B]"
          >
            Save
          </button>
          <button
            onClick={() => { setName(country.name); setEditing(false); }}
            className="rounded-md border border-[#E2E8F0] px-2 py-1 text-xs text-[#62748E] hover:bg-[#F1F5F9]"
          >
            Cancel
          </button>
        </>
      ) : (
        <>
          <span className="flex-1 text-sm text-[#0F172B]">{country.name}</span>
          <select
            value={country.currency}
            onChange={(e) => onChangeCurrency(e.target.value as CurrencyCode)}
            className="rounded-md border border-[#E2E8F0] bg-white px-2 py-1 text-xs text-[#0F172B] focus:border-[#2962FF] focus:outline-none"
          >
            <option value="USD">USD</option>
            <option value="INR">INR</option>
          </select>
          <button
            onClick={() => setEditing(true)}
            className="rounded-md p-1 text-[#90A1B9] hover:bg-[#F1F5F9] hover:text-[#0F172B]"
            aria-label="Rename"
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125" />
            </svg>
          </button>
          <button
            onClick={onToggleActive}
            className={`rounded-md px-2 py-1 text-[10px] font-medium ${
              country.is_active ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
            }`}
          >
            {country.is_active ? 'Active' : 'Inactive'}
          </button>
          <button
            onClick={onDelete}
            className="rounded-md p-1 text-[#90A1B9] hover:bg-red-50 hover:text-red-500"
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
  const plansByTier: Record<SubscriptionTier, SubscriptionPlanRow[]> = { Junior: [], Pro: [], Elite: [] };
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
            <h1 className="font-[family-name:var(--font-display)] text-xl font-bold text-[#0F172B]">{subscription.name}</h1>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${subscription.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
              {subscription.is_active ? 'Active' : 'Inactive'}
            </span>
          </div>
          {subscription.description && (
            <p className="mt-1 text-sm text-[#62748E]">{subscription.description}</p>
          )}
        </div>
        <button
          onClick={() => toggleActive.mutate(!subscription.is_active)}
          disabled={toggleActive.isPending}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition disabled:opacity-50 ${
            subscription.is_active
              ? 'border border-[#E2E8F0] bg-white text-[#0F172B] hover:bg-[#F1F5F9]'
              : 'bg-[#0F172B] text-white hover:bg-[#1E293B]'
          }`}
        >
          {subscription.is_active ? 'Mark Inactive' : 'Mark Active'}
        </button>
      </div>

      {/* SquadHire Profiles — top, compact dropdown */}
      <section className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div>
          <h2 className="font-[family-name:var(--font-display)] text-sm font-semibold text-[#0F172B]">SquadHire Profiles</h2>
          <p className="text-[11px] text-[#62748E]">Pre-fills new subscription cards. Sales can override per card.</p>
        </div>
        <div className="ml-auto min-w-[260px]">
          <SquadHireProfilesPanel subscriptionId={subscription.id} />
        </div>
      </section>

      {/* Plans, grouped by tier */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-[family-name:var(--font-display)] text-base font-semibold text-[#0F172B]">Plans</h2>
          <div className="flex items-center gap-2">
            <label className="text-xs text-[#62748E]">Pricing for</label>
            <select
              value={selectedCountryId}
              onChange={(e) => setSelectedCountryId(e.target.value)}
              className="rounded-md border border-[#E2E8F0] bg-white px-2 py-1 text-sm text-[#0F172B] focus:border-[#2962FF] focus:outline-none focus:ring-1 focus:ring-[#2962FF]"
            >
              {activeCountries.length === 0 && <option value="">No active countries</option>}
              {activeCountries.map((c) => (
                <option key={c.id} value={c.id}>{c.name} ({c.currency})</option>
              ))}
            </select>
          </div>
        </div>
        <div className="space-y-4">
          {TIERS.map((tier) => (
            <div key={tier}>
              <div className="mb-2 flex items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${TIER_COLOR[tier]}`}>{tier}</span>
                <span className="text-[11px] text-[#90A1B9]">{plansByTier[tier].length} plan{plansByTier[tier].length === 1 ? '' : 's'}</span>
              </div>
              <div className="space-y-2">
                {plansByTier[tier].length === 0 ? (
                  <p className="rounded-lg border border-dashed border-[#CBD5E1] bg-white px-4 py-3 text-xs text-[#90A1B9]">
                    No plans at {tier} tier yet. Run migration 027 to seed them.
                  </p>
                ) : plansByTier[tier].map((p) => (
                  <PlanRow
                    key={p.id}
                    subscriptionId={subscription.id}
                    plan={p}
                    deliverableTypes={subscription.deliverable_types || []}
                    selectedCountry={selectedCountry}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Deliverable Types */}
      <section>
        <h2 className="mb-3 font-[family-name:var(--font-display)] text-base font-semibold text-[#0F172B]">Deliverable Types</h2>
        <DeliverableTypesEditor subscriptionId={subscription.id} types={subscription.deliverable_types || []} />
      </section>
    </div>
  );
}

// ============================================================
// Plan Row: tier tag + inline price input for the selected country
// ============================================================

function PlanRow({
  subscriptionId, plan, deliverableTypes, selectedCountry,
}: {
  subscriptionId: string;
  plan: SubscriptionPlanRow;
  deliverableTypes: SubscriptionDeliverableType[];
  selectedCountry: Country | null;
}) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);

  const updatePlan = useMutation({
    mutationFn: (body: any) => api.put(`/admin/subscriptions/${subscriptionId}/plans/${plan.id}`, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-subs-catalog'] }),
    onError: (err: any) => alert(err?.response?.data?.error || err.message || 'Failed'),
  });

  const delivs = plan.deliverables || [];
  const pricing = plan.pricing || [];
  const currentPriceRow = selectedCountry
    ? pricing.find((p) => p.country_id === selectedCountry.id) || null
    : null;

  return (
    <div className={`rounded-lg border border-[#E2E8F0] bg-white ${plan.is_active ? '' : 'opacity-60'}`}>
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex h-6 w-6 items-center justify-center rounded text-[#90A1B9] hover:bg-[#F1F5F9]"
          aria-label="Toggle plan"
        >
          <svg className={`h-3 w-3 transition-transform ${expanded ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>

        <div className="w-24 text-sm font-medium text-[#0F172B]">{plan.plan}</div>

        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${TIER_COLOR[plan.tier] || TIER_COLOR.Junior}`}>
          {plan.tier || 'Junior'}
        </span>

        <PricingAndMarginInput
          planId={plan.id}
          country={selectedCountry}
          current={currentPriceRow}
        />

        <HoursInput
          subscriptionId={subscriptionId}
          planId={plan.id}
          dailyHours={plan.daily_hours}
          weeklyHours={plan.weekly_hours}
        />

        <div className="ml-auto flex items-center gap-3">
          <span className="text-xs text-[#90A1B9]">{delivs.length} deliverable{delivs.length === 1 ? '' : 's'}</span>
          <button
            onClick={() => updatePlan.mutate({ is_active: !plan.is_active })}
            className={`rounded-md px-3 py-1 text-xs font-medium ${
              plan.is_active
                ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
            }`}
          >
            {plan.is_active ? 'Active' : 'Inactive'}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="space-y-2 border-t border-[#E2E8F0] bg-[#F8FAFC] px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[#90A1B9]">Default deliverables</p>
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
// Min price + margin (₹/%) per (plan × country)
// Partner price is derived at use time as proposed - margin.
// ============================================================

function PricingAndMarginInput({
  planId, country, current,
}: {
  planId: string;
  country: Country | null;
  current: SubscriptionPlanPricing | null;
}) {
  const queryClient = useQueryClient();
  const [price, setPrice] = useState<string>(current?.price == null ? '' : String(current.price));
  const [marginValue, setMarginValue] = useState<string>(
    current?.margin_value == null ? '0' : String(current.margin_value),
  );
  const [marginType, setMarginType] = useState<'fixed' | 'percent'>(current?.margin_type || 'fixed');

  useEffect(() => {
    setPrice(current?.price == null ? '' : String(current.price));
    setMarginValue(current?.margin_value == null ? '0' : String(current.margin_value));
    setMarginType(current?.margin_type || 'fixed');
  }, [current?.id, country?.id]);

  const upsert = useMutation({
    mutationFn: (body: { country_id: string; price: number; margin_value: number; margin_type: 'fixed' | 'percent' }) =>
      api.post(`/admin/subscriptions/plans/${planId}/pricing`, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-subs-catalog'] }),
    onError: (err: any) => alert(err?.response?.data?.error || err.message || 'Failed'),
  });

  const removeRow = useMutation({
    mutationFn: (countryId: string) =>
      api.delete(`/admin/subscriptions/plans/${planId}/pricing/${countryId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-subs-catalog'] }),
  });

  function commitPrice() {
    if (!country) return;
    if (price.trim() === '') {
      if (current) removeRow.mutate(country.id);
      return;
    }
    const n = parseInt(price, 10);
    if (isNaN(n) || n < 0) return;
    const m = parseInt(marginValue, 10);
    if (current && current.price === n && current.margin_value === (isNaN(m) ? 0 : m) && current.margin_type === marginType) return;
    upsert.mutate({
      country_id: country.id,
      price: n,
      margin_value: isNaN(m) ? 0 : m,
      margin_type: marginType,
    });
  }

  function commitMargin(nextType?: 'fixed' | 'percent') {
    if (!country || !current) return;
    const n = parseInt(price, 10);
    const m = parseInt(marginValue, 10);
    const t = nextType ?? marginType;
    if (isNaN(n) || isNaN(m)) return;
    if (current.price === n && current.margin_value === m && current.margin_type === t) return;
    upsert.mutate({ country_id: country.id, price: n, margin_value: m, margin_type: t });
  }

  // Live partner-price preview using min price as the example basis.
  const minPriceN = parseInt(price, 10);
  const marginN = parseInt(marginValue, 10);
  const partnerPreview =
    !isNaN(minPriceN) && !isNaN(marginN)
      ? marginType === 'percent'
        ? Math.max(0, Math.round(minPriceN - (minPriceN * marginN) / 100))
        : Math.max(0, minPriceN - marginN)
      : null;

  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[#90A1B9]">Min</span>
        <span className="text-[11px] text-[#90A1B9]">{currencySymbol(country?.currency)}</span>
        <input
          type="number"
          min={0}
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          onBlur={commitPrice}
          placeholder="—"
          disabled={!country}
          className="w-20 rounded-md border border-[#E2E8F0] px-2 py-1 text-xs text-[#0F172B] focus:border-[#2962FF] focus:outline-none disabled:cursor-not-allowed disabled:bg-[#F8FAFC]"
        />
        <span className="text-[10px] text-[#CBD5E1]">/ mo</span>
      </div>

      <div className="flex items-center gap-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[#90A1B9]">Margin</span>
        <input
          type="number"
          min={0}
          value={marginValue}
          onChange={(e) => setMarginValue(e.target.value)}
          onBlur={() => commitMargin()}
          placeholder="0"
          disabled={!country || !current}
          className="w-16 rounded-md border border-[#E2E8F0] px-2 py-1 text-xs text-[#0F172B] focus:border-[#2962FF] focus:outline-none disabled:cursor-not-allowed disabled:bg-[#F8FAFC]"
        />
        <button
          type="button"
          onClick={() => {
            const next = marginType === 'fixed' ? 'percent' : 'fixed';
            setMarginType(next);
            commitMargin(next);
          }}
          disabled={!country || !current}
          className="rounded-md border border-[#E2E8F0] bg-white px-2 py-1 text-[10px] font-semibold text-[#0F172B] hover:bg-[#F1F5F9] disabled:cursor-not-allowed disabled:opacity-50"
          title="Toggle margin type"
        >
          {marginType === 'fixed' ? currencySymbol(country?.currency) : '%'}
        </button>
      </div>

      {partnerPreview != null && current && (
        <span
          className="text-[10px] text-[#10B981] font-medium"
          title="Partner price at min subscription price (= min − margin). Live partner price uses the customer's proposed price."
        >
          → Partner {currencySymbol(country?.currency)}{partnerPreview.toLocaleString()}
        </span>
      )}
    </div>
  );
}

// ============================================================
// Daily / weekly hours per plan (admin-editable defaults)
// ============================================================

function HoursInput({
  subscriptionId, planId, dailyHours, weeklyHours,
}: {
  subscriptionId: string;
  planId: string;
  dailyHours: number | null;
  weeklyHours: number | null;
}) {
  const queryClient = useQueryClient();
  const [daily, setDaily] = useState<string>(dailyHours == null ? '' : String(dailyHours));
  const [weekly, setWeekly] = useState<string>(weeklyHours == null ? '' : String(weeklyHours));

  useEffect(() => {
    setDaily(dailyHours == null ? '' : String(dailyHours));
    setWeekly(weeklyHours == null ? '' : String(weeklyHours));
  }, [dailyHours, weeklyHours]);

  const update = useMutation({
    mutationFn: (body: { daily_hours?: number | null; weekly_hours?: number | null }) =>
      api.put(`/admin/subscriptions/${subscriptionId}/plans/${planId}`, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-subs-catalog'] }),
    onError: (err: any) => alert(err?.response?.data?.error || err.message || 'Failed'),
  });

  function commitDaily() {
    const n = daily.trim() === '' ? null : Number(daily);
    if (n != null && (isNaN(n) || n < 0 || n > 24)) return;
    if ((dailyHours ?? null) === (n ?? null)) return;
    update.mutate({ daily_hours: n });
  }

  function commitWeekly() {
    const n = weekly.trim() === '' ? null : Number(weekly);
    if (n != null && (isNaN(n) || n < 0 || n > 168)) return;
    if ((weeklyHours ?? null) === (n ?? null)) return;
    update.mutate({ weekly_hours: n });
  }

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-[#90A1B9]">Hrs</span>
      <input
        type="number"
        step="0.5"
        min={0}
        max={24}
        value={daily}
        onChange={(e) => setDaily(e.target.value)}
        onBlur={commitDaily}
        placeholder="d"
        title="Daily hours"
        className="w-12 rounded-md border border-[#E2E8F0] px-2 py-1 text-xs text-[#0F172B] focus:border-[#2962FF] focus:outline-none"
      />
      <span className="text-[10px] text-[#CBD5E1]">/d</span>
      <input
        type="number"
        step="0.5"
        min={0}
        max={168}
        value={weekly}
        onChange={(e) => setWeekly(e.target.value)}
        onBlur={commitWeekly}
        placeholder="w"
        title="Weekly hours"
        className="w-12 rounded-md border border-[#E2E8F0] px-2 py-1 text-xs text-[#0F172B] focus:border-[#2962FF] focus:outline-none"
      />
      <span className="text-[10px] text-[#CBD5E1]">/w</span>
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
        <p className="text-xs text-[#90A1B9]">No default deliverables configured.</p>
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
        <div className="space-y-2 rounded-md border border-dashed border-[#CBD5E1] bg-white p-3">
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
          <div className="flex items-center gap-2 text-xs text-[#475569]">
            <NumInput label="/ day" value={perDay} onChange={setPerDay} />
            <NumInput label="/ week" value={perWeek} onChange={setPerWeek} />
            <NumInput label="/ month" value={perMonth} onChange={setPerMonth} />
          </div>
          <div className="flex gap-2">
            <button onClick={submitAdd} disabled={createDeliverable.isPending} className="rounded-md bg-[#0F172B] px-3 py-1 text-xs font-medium text-white hover:bg-[#1E293B] disabled:opacity-50">
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
          className="rounded-md border border-dashed border-[#CBD5E1] px-3 py-1.5 text-xs text-[#62748E] hover:bg-white hover:text-[#0F172B]"
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
    <div className="flex items-center gap-3 rounded-md bg-white px-3 py-2">
      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
        deliverable.kind === 'hours' ? 'bg-indigo-100 text-indigo-700' : 'bg-purple-100 text-purple-700'
      }`}>
        {deliverable.kind === 'hours' ? 'Hours' : 'Item'}
      </span>
      <span className="text-sm text-[#0F172B]">{typeName}</span>
      <div className="ml-auto flex items-center gap-2">
        <NumInput label="/d" value={perDay} onChange={setPerDay} onBlur={save} compact />
        <NumInput label="/w" value={perWeek} onChange={setPerWeek} onBlur={save} compact />
        <NumInput label="/m" value={perMonth} onChange={setPerMonth} onBlur={save} compact />
        <button onClick={onDelete} className="rounded-md p-1 text-[#90A1B9] hover:bg-red-50 hover:text-red-500">
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
        className={`rounded-md border border-[#E2E8F0] px-2 py-1 text-xs text-[#0F172B] focus:border-[#2962FF] focus:outline-none ${compact ? 'w-14' : 'w-20'}`}
      />
      <span className="text-[11px] text-[#90A1B9]">{label}</span>
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
    <div className="rounded-lg border border-[#E2E8F0] bg-white">
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
      <div className="flex items-center gap-2 border-t border-[#F1F5F9] p-3">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New deliverable type name"
          className="flex-1 rounded-md border border-[#E2E8F0] px-3 py-1.5 text-sm text-[#0F172B] focus:border-[#2962FF] focus:outline-none focus:ring-1 focus:ring-[#2962FF]"
        />
        <button
          onClick={() => newName.trim() && createType.mutate(newName.trim())}
          disabled={!newName.trim() || createType.isPending}
          className="rounded-md bg-[#0F172B] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#1E293B] disabled:opacity-50"
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
            className="flex-1 rounded-md border border-[#E2E8F0] px-2 py-1 text-sm text-[#0F172B] focus:border-[#2962FF] focus:outline-none"
          />
          <button
            onClick={() => { onRename(name.trim() || type.name); setEditing(false); }}
            className="rounded-md bg-[#0F172B] px-2 py-1 text-xs text-white hover:bg-[#1E293B]"
          >
            Save
          </button>
          <button
            onClick={() => { setName(type.name); setEditing(false); }}
            className="rounded-md border border-[#E2E8F0] px-2 py-1 text-xs text-[#62748E] hover:bg-[#F1F5F9]"
          >
            Cancel
          </button>
        </>
      ) : (
        <>
          <span className="flex-1 text-sm text-[#0F172B]">{type.name}</span>
          <button
            onClick={() => setEditing(true)}
            className="rounded-md p-1 text-[#90A1B9] hover:bg-[#F1F5F9] hover:text-[#0F172B]"
            aria-label="Rename"
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125" />
            </svg>
          </button>
          <button
            onClick={onToggleActive}
            className={`rounded-md px-2 py-1 text-[10px] font-medium ${
              type.is_active ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
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
