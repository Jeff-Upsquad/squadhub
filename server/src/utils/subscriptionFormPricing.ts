import { supabaseAdmin } from '../supabase';

/**
 * Seed per-tier pricing on a subscription brief from the admin Subscriptions
 * catalog (customer price + margin). Used when a public requirement form is
 * submitted so New Deals land with usable pricing instead of blanks.
 *
 * Rules:
 *   - proposed_price stays 0 (admin may fill later)
 *   - markup stays null so the plan catalog margin (fixed OR percent) is
 *     inherited live — percent margins re-apply on every bid amount
 *   - customer price always → subscription_price (the Final price in the editor)
 *   - client budget (if any) is reference only: stored per tier as
 *     tier_pricing.<tier>.client_budget, and optionally as a scalar
 *     subscription_cards.client_budget when a single amount applies
 */

const PLAN_TO_CANONICAL: Record<string, string> = {
  starter: 'Starter',
  basic: 'Basic',
  plus: 'Plus',
  pro: 'Pro',
  personal: 'Personal',
};

export type CatalogTierPricingEntry = {
  proposed_price: number;
  markup: number | null;
  subscription_price: number | null;
  /** Client's stated monthly budget for this tier (reference only). */
  client_budget?: number | null;
};

/** Resolve which country pricing row to use: explicit id, else India, else first. */
async function resolvePricingCountryId(
  preferredCountryId: string | null | undefined,
  pricingRows: Array<{ country_id: string }>,
): Promise<string | null> {
  if (pricingRows.length === 0) return null;
  if (preferredCountryId && pricingRows.some((r) => r.country_id === preferredCountryId)) {
    return preferredCountryId;
  }
  const { data: india } = await supabaseAdmin
    .from('countries')
    .select('id')
    .eq('name', 'India')
    .maybeSingle();
  const indiaId = (india as { id?: string } | null)?.id;
  if (indiaId && pricingRows.some((r) => r.country_id === indiaId)) return indiaId;
  return pricingRows[0]?.country_id ?? null;
}

/**
 * Build tier_pricing seeded from the Subscriptions catalog for the given
 * service + plan + tiers. Returns {} when the catalog can't be resolved
 * (unknown slug/plan, or no pricing rows).
 */
export async function buildCatalogTierPricing(opts: {
  serviceSlug: string;
  planName: string | null | undefined;
  tiers: string[];
  countryId: string | null | undefined;
  /**
   * Client's stated monthly budget(s). Prefer `tierBudgets` (per level).
   * A scalar `clientBudget` is applied to every selected tier when no
   * per-tier map is provided (legacy single-budget briefs).
   */
  clientBudget?: number | null | undefined;
  tierBudgets?: Record<string, number> | null | undefined;
}): Promise<Record<string, CatalogTierPricingEntry>> {
  const { serviceSlug, planName, tiers, countryId, clientBudget, tierBudgets } = opts;
  // Final always comes from the catalog. Client budgets are attached as
  // reference-only client_budget on each tier entry.
  const budgetFor = (tier: string): number | null => {
    const fromMap = tierBudgets?.[tier];
    if (typeof fromMap === 'number' && fromMap > 0) return fromMap;
    if (typeof clientBudget === 'number' && clientBudget > 0) return clientBudget;
    return null;
  };
  const canonicalPlan =
    planName ? PLAN_TO_CANONICAL[planName.toLowerCase()] || planName : '';
  if (!serviceSlug || !canonicalPlan || tiers.length === 0) return {};

  const { data: sub } = await supabaseAdmin
    .from('subscriptions')
    .select('id')
    .eq('slug', serviceSlug)
    .maybeSingle();
  if (!sub?.id) return {};

  const { data: planRows } = await supabaseAdmin
    .from('subscription_plans')
    .select('id, tier')
    .eq('subscription_id', sub.id)
    .eq('plan', canonicalPlan)
    .in('tier', tiers);
  if (!planRows || planRows.length === 0) return {};

  const planIds = planRows.map((p: { id: string }) => p.id);
  const { data: pricingRows } = await supabaseAdmin
    .from('subscription_plan_pricing')
    .select('plan_id, country_id, price, margin_value, margin_type')
    .in('plan_id', planIds);
  if (!pricingRows || pricingRows.length === 0) return {};

  const pricingCountryId = await resolvePricingCountryId(countryId, pricingRows);
  if (!pricingCountryId) return {};

  const planIdByTier: Record<string, string> = {};
  for (const p of planRows as Array<{ id: string; tier: string }>) {
    planIdByTier[p.tier] = p.id;
  }

  const pricingByPlanId: Record<
    string,
    { price: number; margin_value: number; margin_type: string }
  > = {};
  for (const row of pricingRows as Array<{
    plan_id: string;
    country_id: string;
    price: number;
    margin_value: number;
    margin_type: string;
  }>) {
    if (row.country_id !== pricingCountryId) continue;
    pricingByPlanId[row.plan_id] = {
      price: row.price,
      margin_value: row.margin_value,
      margin_type: row.margin_type,
    };
  }

  const out: Record<string, CatalogTierPricingEntry> = {};

  for (const tier of tiers) {
    const planId = planIdByTier[tier];
    const pricing = planId ? pricingByPlanId[planId] : undefined;
    const client_budget = budgetFor(tier);
    if (!pricing || !(pricing.price > 0)) {
      // Still seed a row so the editor shows the tier; margin/final stay blank.
      out[tier] = {
        proposed_price: 0,
        markup: null,
        subscription_price: null,
        ...(client_budget != null ? { client_budget } : {}),
      };
      continue;
    }

    // Keep markup null so percent (or fixed) plan margins stay live during
    // bidding — resolvePlanMargin recomputes against each bid amount.
    // Catalog min customer price seeds Final. Client budget is reference only.
    out[tier] = {
      proposed_price: 0,
      markup: null,
      subscription_price: pricing.price,
      ...(client_budget != null ? { client_budget } : {}),
    };
  }

  return out;
}

/** Scalar client_budget for the card row: single amount when only one tier
 *  has a budget, or when every stated budget is identical; otherwise null
 *  (per-tier values live on tier_pricing). */
export function resolveScalarClientBudget(
  tierBudgets: Record<string, number> | null | undefined,
  fallback?: number | null | undefined,
): number | null {
  const vals = Object.values(tierBudgets || {}).filter((v) => typeof v === 'number' && v > 0);
  if (vals.length === 0) {
    return typeof fallback === 'number' && fallback > 0 ? fallback : null;
  }
  if (vals.every((v) => v === vals[0])) return vals[0];
  return null;
}

/** True when a tier_pricing entry has a usable client-facing price. */
export function tierHasPublishablePrice(entry: {
  proposed_price?: number | null;
  subscription_price?: number | null;
} | null | undefined): boolean {
  if (!entry) return false;
  if (entry.subscription_price != null && entry.subscription_price > 0) return true;
  if (entry.proposed_price != null && entry.proposed_price > 0) return true;
  return false;
}

/** Coerce 0 proposed prices to null for columns with chk_proposed_price (> 0 or NULL). */
export function coerceProposedPrice(value: number | null | undefined): number | null {
  if (value == null || value <= 0) return null;
  return value;
}
