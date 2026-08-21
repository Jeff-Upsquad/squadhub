'use client';

// ============================================================
// Assignment catalog detail pane.
//
// Subscriptions have a list price; assignments don't — the price is whatever
// the business and the talent agree on. What the catalog owns is OUR CUT per
// service and level, as a flat amount or a percentage, applied in whichever
// direction the deal runs:
//
//   priced brief   business commits ₹10,000 → talent is shown ₹10,000 − cut
//   unpriced brief talent quotes   ₹10,000 → business is shown ₹10,000 + cut
//
// Both previews below are computed with the same shared helpers the server
// uses on real bids, so what an admin sees here is what the sides will see.
// ============================================================

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../../services/api';
import { TIERS, TIER_COLOR, currencySymbol, PriceField } from './catalogPricing';
import {
  customerPriceFromPartner,
  partnerPriceFromCustomer,
  type AssignmentService,
  type AssignmentServiceMargin,
  type Country,
  type SubscriptionTier,
} from '@squadhub/shared';

/** Base amount the worked example is shown against. */
const EXAMPLE_BASE_INR = 10000;
const EXAMPLE_BASE_USD = 1000;

type MarginDraft = { value: string; type: 'fixed' | 'percent' };

function draftFrom(row: AssignmentServiceMargin | null | undefined): MarginDraft {
  return {
    value: row?.margin_value == null ? '' : String(row.margin_value),
    type: row?.margin_type || 'fixed',
  };
}

function marginFor(
  service: AssignmentService,
  tier: SubscriptionTier,
  countryId: string | null,
): AssignmentServiceMargin | null {
  if (!countryId) return null;
  return (
    (service.margins || []).find((m) => m.tier === tier && m.country_id === countryId) || null
  );
}

export default function AssignmentServiceDetail({
  service,
  countries,
}: {
  service: AssignmentService;
  countries: Country[];
}) {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin-assignment-catalog'] });

  const updateService = useMutation({
    mutationFn: (body: any) => api.put(`/admin/assignment-catalog/${service.id}`, body),
    onSuccess: invalidate,
    onError: (err: any) => alert(err?.response?.data?.error || err.message || 'Failed'),
  });
  const deleteService = useMutation({
    mutationFn: () => api.delete(`/admin/assignment-catalog/${service.id}`),
    onSuccess: invalidate,
    onError: (err: any) => alert(err?.response?.data?.error || err.message || 'Failed'),
  });
  const upsertMargin = useMutation({
    mutationFn: (body: { tier: string; country_id: string; margin_value: number; margin_type: 'fixed' | 'percent' }) =>
      api.post(`/admin/assignment-catalog/${service.id}/margins`, body),
  });
  const removeMargin = useMutation({
    mutationFn: ({ tier, countryId }: { tier: string; countryId: string }) =>
      api.delete(`/admin/assignment-catalog/${service.id}/margins/${encodeURIComponent(tier)}/${countryId}`),
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

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, MarginDraft>>({});
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(service.name);

  // Switching country (or service) drops any in-progress edit so a draft can
  // never be saved against the wrong country.
  useEffect(() => {
    setEditing(false);
    setDrafts({});
  }, [selectedCountryId, service.id]);
  useEffect(() => { setName(service.name); setRenaming(false); }, [service.id, service.name]);

  function startEdit() {
    const d: Record<string, MarginDraft> = {};
    TIERS.forEach((t) => { d[t] = draftFrom(marginFor(service, t, selectedCountryId || null)); });
    setDrafts(d);
    setEditing(true);
  }

  async function save() {
    if (!selectedCountry) return;
    setSaving(true);
    try {
      for (const tier of TIERS) {
        const d = drafts[tier];
        if (!d) continue;
        const cur = marginFor(service, tier, selectedCountry.id);
        if (d.value.trim() === '') {
          if (cur) await removeMargin.mutateAsync({ tier, countryId: selectedCountry.id });
          continue;
        }
        const value = parseInt(d.value, 10);
        if (isNaN(value) || value < 0) continue;
        if (d.type === 'percent' && value > 100) {
          alert(`${tier}: a percentage margin cannot exceed 100.`);
          setSaving(false);
          return;
        }
        if (cur && cur.margin_value === value && cur.margin_type === d.type) continue;
        await upsertMargin.mutateAsync({
          tier,
          country_id: selectedCountry.id,
          margin_value: value,
          margin_type: d.type,
        });
      }
      await invalidate();
      setEditing(false);
      setDrafts({});
    } catch (err: any) {
      alert(err?.response?.data?.error || err?.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  const configuredCount = useMemo(
    () => TIERS.filter((t) => marginFor(service, t, selectedCountryId || null)).length,
    [service, selectedCountryId],
  );

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            {renaming ? (
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && name.trim()) updateService.mutate({ name: name.trim() });
                  if (e.key === 'Escape') { setName(service.name); setRenaming(false); }
                }}
                onBlur={() => {
                  if (name.trim() && name.trim() !== service.name) updateService.mutate({ name: name.trim() });
                  setRenaming(false);
                }}
                autoFocus
                className="rounded-md border border-accent px-2 py-1 font-[family-name:var(--font-display)] text-xl font-bold text-foreground focus:outline-none"
              />
            ) : (
              <h1
                onDoubleClick={() => setRenaming(true)}
                title="Double-click to rename"
                className="font-[family-name:var(--font-display)] text-xl font-bold text-foreground"
              >
                {service.name}
              </h1>
            )}
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${service.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-canvas text-foreground-muted'}`}>
              {service.is_active ? 'Active' : 'Inactive'}
            </span>
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">Assignments</span>
          </div>
          <p className="mt-1 text-sm text-foreground-muted">
            {service.description || 'One-off assignment work.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => updateService.mutate({ is_active: !service.is_active })}
            disabled={updateService.isPending}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition disabled:opacity-50 ${
              service.is_active
                ? 'border border-divider bg-surface text-foreground hover:bg-canvas'
                : 'bg-ink text-white hover:bg-ink-hover'
            }`}
          >
            {service.is_active ? 'Mark Inactive' : 'Mark Active'}
          </button>
          <button
            onClick={() => {
              if (confirm(`Delete "${service.name}" and its margins? Cards keep their service, they just stop resolving a margin.`)) {
                deleteService.mutate();
              }
            }}
            className="rounded-lg border border-divider px-3 py-2 text-sm font-medium text-rose-600 hover:bg-rose-50"
          >
            Delete
          </button>
        </div>
      </div>

      <section>
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <h2 className="font-[family-name:var(--font-display)] text-base font-semibold text-foreground">Our margin</h2>
            <p className="max-w-2xl text-[11px] text-foreground-muted">
              Assignments have no list price — the amount is whatever the two sides agree on. This is the cut we keep on
              it: subtracted from a price the business commits to, added to a price a talent quotes.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <label className="text-xs text-foreground-muted">Margins for</label>
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
            {editing ? (
              <>
                <button
                  onClick={() => { setEditing(false); setDrafts({}); }}
                  disabled={saving}
                  className="rounded-md border border-divider px-3 py-1.5 text-xs font-medium text-foreground-muted hover:bg-canvas disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={save}
                  disabled={saving}
                  className="rounded-md bg-ink px-3 py-1.5 text-xs font-medium text-white hover:bg-ink-hover disabled:opacity-50"
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </>
            ) : (
              <button
                onClick={startEdit}
                disabled={!selectedCountry}
                className="rounded-md bg-ink px-3 py-1.5 text-xs font-medium text-white hover:bg-ink-hover disabled:opacity-50"
              >
                Edit margins
              </button>
            )}
          </div>
        </div>

        {!editing && configuredCount === 0 && (
          <p className="mb-3 rounded-lg border border-dashed border-divider-strong bg-surface px-4 py-3 text-xs text-foreground-dim">
            No margin set for {selectedCountry?.name || 'this country'} yet — assignment cards on this service fall back to
            whatever margin the admin types on the card itself.
          </p>
        )}

        <div className="space-y-2">
          {TIERS.map((tier) => {
            const saved = marginFor(service, tier, selectedCountryId || null);
            const value = editing && drafts[tier] ? drafts[tier] : draftFrom(saved);
            return (
              <MarginRow
                key={tier}
                tier={tier}
                editing={editing}
                value={value}
                country={selectedCountry}
                onChange={(next) => setDrafts((prev) => ({ ...prev, [tier]: next }))}
              />
            );
          })}
        </div>
      </section>
    </div>
  );
}

// ============================================================
// One level's margin: the rule on the left, both directions worked out on
// the right so the effect on each side is never a guess.
// ============================================================

function MarginRow({
  tier, editing, value, country, onChange,
}: {
  tier: SubscriptionTier;
  editing: boolean;
  value: MarginDraft;
  country: Country | null;
  onChange: (next: MarginDraft) => void;
}) {
  const patch = (p: Partial<MarginDraft>) => onChange({ ...value, ...p });

  const parsed = parseInt(value.value, 10);
  const hasValue = value.value.trim() !== '' && !isNaN(parsed) && parsed >= 0;
  const sym = currencySymbol(country?.currency);
  const locale = country?.currency === 'USD' ? 'en-US' : 'en-IN';
  const fmt = (n: number) => `${sym}${n.toLocaleString(locale)}`;
  const base = country?.currency === 'USD' ? EXAMPLE_BASE_USD : EXAMPLE_BASE_INR;

  // Worked both ways with the shared helpers the server bids through, so the
  // preview can't drift from the real maths (percent cuts ceil to 100).
  const rule = hasValue ? { margin_value: parsed, margin_type: value.type } : null;
  const talentSees = rule ? partnerPriceFromCustomer(base, {}, rule) : null;
  const businessSees = rule ? customerPriceFromPartner(base, {}, rule) : null;

  return (
    <div className={`rounded-xl border bg-surface ${editing ? 'border-accent' : 'border-divider-strong'}`}>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3">
        <span className={`rounded-md px-3 py-1 text-sm font-bold ${TIER_COLOR[tier]}`}>{tier}</span>

        {editing ? (
          <PriceField label="We keep">
            <label
              className={`flex items-center gap-1 rounded-md border px-2 py-1 ${value.type === 'fixed' ? 'border-accent bg-surface' : 'border-divider bg-surface-alt'}`}
            >
              <span className="text-xs text-foreground-dim">{sym}</span>
              <input
                type="number"
                min={0}
                step={1}
                value={value.type === 'fixed' ? value.value : ''}
                onChange={(e) => patch({ value: e.target.value, type: 'fixed' })}
                onFocus={() => { if (value.type !== 'fixed') patch({ type: 'fixed', value: '' }); }}
                placeholder="0"
                className={`w-20 bg-transparent text-sm focus:outline-none ${value.type === 'fixed' ? 'text-foreground' : 'text-foreground-muted'}`}
              />
            </label>
            <span className="text-[11px] text-foreground-dim">or</span>
            <label
              className={`flex items-center gap-1 rounded-md border px-2 py-1 ${value.type === 'percent' ? 'border-accent bg-surface' : 'border-divider bg-surface-alt'}`}
            >
              <input
                type="number"
                min={0}
                max={100}
                step={1}
                value={value.type === 'percent' ? value.value : ''}
                onChange={(e) => patch({ value: e.target.value, type: 'percent' })}
                onFocus={() => { if (value.type !== 'percent') patch({ type: 'percent', value: '' }); }}
                placeholder="0"
                className={`w-14 bg-transparent text-sm focus:outline-none ${value.type === 'percent' ? 'text-foreground' : 'text-foreground-muted'}`}
              />
              <span className="text-xs text-foreground-dim">%</span>
            </label>
            <span className="text-[11px] text-foreground-dim">clear both to remove</span>
          </PriceField>
        ) : (
          <PriceField label="We keep">
            {hasValue ? (
              <>
                <span className="text-sm font-semibold text-foreground">
                  {value.type === 'percent' ? `${parsed}%` : fmt(parsed)}
                </span>
                {value.type === 'percent' && (
                  <span className="text-[10px] text-foreground-dim">ceil {sym}100</span>
                )}
              </>
            ) : (
              <span className="text-sm text-foreground-dim">—</span>
            )}
          </PriceField>
        )}

        <div className="ml-auto flex flex-wrap items-center gap-x-5 gap-y-1">
          <ExampleLeg
            label="Business commits"
            from={fmt(base)}
            arrow="talent sees"
            to={talentSees == null ? '—' : fmt(talentSees)}
            tone="emerald"
          />
          <ExampleLeg
            label="Talent quotes"
            from={fmt(base)}
            arrow="business sees"
            to={businessSees == null ? '—' : fmt(businessSees)}
            tone="indigo"
          />
        </div>
      </div>
    </div>
  );
}

function ExampleLeg({
  label, from, arrow, to, tone,
}: {
  label: string;
  from: string;
  arrow: string;
  to: string;
  tone: 'emerald' | 'indigo';
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-foreground-dim">
        {label} {from}
      </span>
      <div className="flex h-7 items-center gap-1.5">
        <span className="text-[11px] text-foreground-dim">{arrow}</span>
        <span className={`text-sm font-semibold ${tone === 'emerald' ? 'text-emerald-600' : 'text-indigo-600'}`}>{to}</span>
      </div>
    </div>
  );
}

/** Sidebar list data for the Assignments tab, shared with the module shell. */
export function useAssignmentCatalog() {
  return useQuery({
    queryKey: ['admin-assignment-catalog'],
    queryFn: () => api.get('/admin/assignment-catalog').then((r) => r.data?.data as AssignmentService[]),
  });
}

/** "+ Add service" used by the module shell's Assignments sidebar. */
export function useCreateAssignmentService() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api.post('/admin/assignment-catalog', { name }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-assignment-catalog'] }),
    onError: (err: any) => alert(err?.response?.data?.error || err.message || 'Failed'),
  });
}
