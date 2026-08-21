'use client';

// ============================================================
// Shared pricing primitives for the two catalogs rendered by this module:
// subscription plans (priced per month) and assignment packages (priced per
// project). Both store the same { price, margin_value, margin_type } shape,
// so the editor strip, draft handling and tier chrome live here once.
// ============================================================

import type { ReactNode } from 'react';
import type { Country, CurrencyCode, SubscriptionTier } from '@squadhub/shared';

/** The columns every catalog pricing row shares. */
export interface CatalogPricingRow {
  price: number;
  margin_value: number;
  margin_type: 'fixed' | 'percent';
}

export const TIERS: SubscriptionTier[] = ['Junior', 'Pro', 'Top Talents'];
export const TIER_COLOR: Record<SubscriptionTier, string> = {
  Junior: 'bg-canvas text-foreground-muted',
  Pro: 'bg-indigo-100 text-indigo-700',
  'Top Talents': 'bg-yellow-100 text-yellow-700',
};

export function currencySymbol(code: CurrencyCode | undefined | null) {
  return code === 'USD' ? '$' : '\u20B9';
}

export function formatPrice(price: number, code: CurrencyCode | undefined | null) {
  const sym = currencySymbol(code);
  return `${sym}${price.toLocaleString(code === 'USD' ? 'en-US' : 'en-IN')}`;
}
// A pending edit to one catalog row's pricing, held while a tier is in edit mode.
export type PriceDraft = { price: string; marginValue: string; marginType: 'fixed' | 'percent' };

/** Seed a draft from a saved pricing row (subscription plan or assignment package). */
export function draftFromRow(row: CatalogPricingRow | null | undefined): PriceDraft {
  return {
    price: row?.price == null ? '' : String(row.price),
    marginValue: row?.margin_value == null ? '0' : String(row.margin_value),
    marginType: row?.margin_type || 'fixed',
  };
}

// ============================================================
// Catalog Pricing Strip: controlled customer price + margin (₹/%). Shared by
// the subscription (per month) and assignment (per project) catalogs.
// Read-only until its tier is in edit mode; edits flow up as draft changes and
// are only persisted when the tier's Save is pressed.
// ============================================================

export function CatalogPricingStrip({
  editing, value, country, onChange, unitLabel,
}: {
  editing: boolean;
  value: PriceDraft;
  country: Country | null;
  onChange: (next: PriceDraft) => void;
  /** Billing unit shown next to the min. price, e.g. "/ mo" or "/ project". */
  unitLabel: string;
}) {
  const { price, marginValue, marginType } = value;
  const patch = (p: Partial<PriceDraft>) => onChange({ ...value, ...p });

  // Live figures derived from the current draft (or saved row when not editing).
  const priceN = parseInt(price, 10);
  const marginN = parseInt(marginValue, 10);
  const hasPrice = price.trim() !== '' && !isNaN(priceN) && priceN >= 0;
  const hasMargin = !isNaN(marginN) && marginN >= 0;
  // Percent margins: rupee cut rounds UP to the nearest hundred.
  const marginAmount = hasMargin
    ? marginType === 'percent'
      ? Math.ceil((((hasPrice ? priceN : 0) * marginN) / 100) / 100) * 100
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
        <PriceField label="Min. price">
          {hasPrice ? (
            <>
              <span className="text-sm font-medium text-foreground">{fmt(priceN)}</span>
              <span className="text-[11px] text-foreground-dim">{unitLabel} · bid floor</span>
            </>
          ) : (
            <span className="text-sm text-foreground-dim">—</span>
          )}
        </PriceField>
        <PriceField label="Margin">
          <span className="text-sm font-medium text-foreground">{marginAmount == null ? '—' : fmt(marginAmount)}</span>
          {marginPct != null && <span className="text-[11px] text-foreground-dim">· {marginPct}%</span>}
          {marginType === 'percent' && marginAmount != null && (
            <span className="text-[10px] text-foreground-dim">ceil ₹100</span>
          )}
        </PriceField>
        <PriceField label="Partner min">
          <span className="text-sm font-semibold text-emerald-600">{partner == null ? '—' : fmt(partner)}</span>
          <span className="text-[11px] text-foreground-dim">talent floor</span>
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
      {/* Min. price — business bid floor; talent floor = min − margin */}
      <PriceField label="Min. price">
        <span className="text-xs text-foreground-dim">{sym}</span>
        <input
          type="number"
          min={0}
          value={price}
          onChange={(e) => patch({ price: e.target.value })}
          placeholder="—"
          title="Business cannot bid below this. Talent floor is min minus margin."
          className="w-24 rounded-md border border-divider px-2 py-1 text-sm text-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        />
        <span className="text-[11px] text-foreground-dim">{unitLabel} · bid floor</span>
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
          title={marginType === 'percent' ? 'Editable — % of the business price; rupee cut rounds up to the nearest ₹100' : 'Auto-calculated from the rupee amount'}
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

      {/* Partner min (talent bid floor = min. price − margin) */}
      <PriceField label="Partner min">
        <span
          className="text-sm font-semibold text-emerald-600"
          title="Talent bid floor = min. price − margin (percent cuts round up to the nearest ₹100)"
        >
          {partner == null ? '—' : fmt(partner)}
        </span>
        <span className="text-[11px] text-foreground-dim">talent floor</span>
      </PriceField>
    </div>
  );
}
// Label-on-top field cell used across the pricing strip so inputs and computed
// values share a baseline and never collide.
export function PriceField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-foreground-dim">{label}</span>
      <div className="flex h-7 items-center gap-1">{children}</div>
    </div>
  );
}
