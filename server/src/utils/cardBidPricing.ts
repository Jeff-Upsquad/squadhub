// ============================================================
// cardBidPricing
//
// Resolve the margin rules + bid floors for a subscription/assignment card
// so offer negotiation keeps the same margin and respects catalog mins.
//
// Business (customer) floor = plan pricing.price (catalog "Min. price")
// Talent (partner) floor    = that min after the same margin rule
// Margin:
//   - card.markup set  → fixed absolute cut (stays constant while bidding)
//   - else plan margin → fixed or percent; percent re-applies to each
//     business amount and the ₹ cut ceils up to the nearest hundred
// ============================================================

import {
  partnerPriceFromCustomer,
  resolveFinalMargin,
  resolveMinCustomerPrice,
  resolveMinPartnerPrice,
  type PlanMarginFields,
} from '@squadhub/shared';
import { supabaseAdmin } from '../supabase';

export interface CardBidPricing {
  card: {
    id: string;
    markup: number | null;
    partner_price_override: number | null;
    subscription_price: number | null;
    proposed_price: number | null;
  };
  /** Plan/catalog margin row used for percent/fixed re-application. */
  pricing: PlanMarginFields | null;
  /** Business bid floor (catalog min). null = no floor. */
  min_customer_price: number | null;
  /** Talent bid floor. null = no floor. */
  min_partner_price: number | null;
  margin_type: 'fixed' | 'percent' | null;
  margin_value: number | null;
}

async function resolveCountryIdForCard(card: {
  id: string;
  submission_subscription_id?: string | null;
  plan_snapshot?: any;
}): Promise<string | null> {
  const snap = card.plan_snapshot;
  const pricingRows: any[] = Array.isArray(snap?.pricing) ? snap.pricing : [];
  if (pricingRows.length === 1 && pricingRows[0]?.country_id) {
    return pricingRows[0].country_id as string;
  }

  if (card.submission_subscription_id) {
    const { data: subSub } = await supabaseAdmin
      .from('client_submission_subscriptions')
      .select('submission_id')
      .eq('id', card.submission_subscription_id)
      .maybeSingle();
    if (subSub?.submission_id) {
      const { data: sub } = await supabaseAdmin
        .from('client_submissions')
        .select('country_id')
        .eq('id', subSub.submission_id)
        .maybeSingle();
      if (sub?.country_id) return sub.country_id as string;
    }
  }

  // Prefer India when multiple/unknown.
  const { data: india } = await supabaseAdmin
    .from('countries')
    .select('id')
    .eq('name', 'India')
    .maybeSingle();
  return (india?.id as string | undefined) ?? null;
}

/**
 * Load bid pricing context for a card. Returns null if the card doesn't exist.
 */
export async function loadCardBidPricing(cardId: string): Promise<CardBidPricing | null> {
  const { data: card, error } = await supabaseAdmin
    .from('subscription_cards')
    .select(
      'id, markup, partner_price_override, subscription_price, proposed_price, submission_subscription_id, plan_snapshot, target_country_ids',
    )
    .eq('id', cardId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!card) return null;

  const cardFields = {
    markup: (card.markup as number | null) ?? null,
    partner_price_override: (card.partner_price_override as number | null) ?? null,
    subscription_price: (card.subscription_price as number | null) ?? null,
    proposed_price: (card.proposed_price as number | null) ?? null,
  };

  const snap = (card.plan_snapshot as any) || null;
  const pricingRows: any[] = Array.isArray(snap?.pricing) ? snap.pricing : [];
  const countryId = await resolveCountryIdForCard(card as any);

  let marginRow: PlanMarginFields | null = null;
  if (pricingRows.length) {
    const match =
      (countryId && pricingRows.find((p) => p.country_id === countryId)) ||
      (pricingRows.length === 1 ? pricingRows[0] : null);
    if (match) {
      marginRow = {
        price: match.price != null ? Number(match.price) : null,
        margin_value: match.margin_value != null ? Number(match.margin_value) : null,
        margin_type: (match.margin_type as 'fixed' | 'percent') ?? 'fixed',
      };
    }
  }

  // Live catalog fallback when no snapshot (draft / non-staged).
  if (!marginRow && snap?.plan?.id) {
    let q = supabaseAdmin
      .from('subscription_plan_pricing')
      .select('price, margin_value, margin_type, country_id')
      .eq('plan_id', snap.plan.id);
    if (countryId) q = q.eq('country_id', countryId);
    const { data: rows } = await q.limit(1);
    const row = rows?.[0];
    if (row) {
      marginRow = {
        price: row.price != null ? Number(row.price) : null,
        margin_value: row.margin_value != null ? Number(row.margin_value) : null,
        margin_type: (row.margin_type as 'fixed' | 'percent') ?? 'fixed',
      };
    }
  }

  // Card-level adjusted margin freezes the TYPE to fixed.
  const marginType: 'fixed' | 'percent' | null =
    cardFields.markup != null
      ? 'fixed'
      : marginRow?.margin_type === 'percent'
        ? 'percent'
        : marginRow?.margin_value != null
          ? 'fixed'
          : null;
  const marginValue =
    cardFields.markup != null
      ? cardFields.markup
      : marginRow?.margin_value != null
        ? marginRow.margin_value
        : null;

  return {
    card: { id: card.id as string, ...cardFields },
    pricing: marginRow,
    min_customer_price: resolveMinCustomerPrice(marginRow),
    min_partner_price: resolveMinPartnerPrice(cardFields, marginRow),
    margin_type: marginType,
    margin_value: marginValue,
  };
}

/**
 * Expand a business-side bid into the dual amount payload (customer + partner)
 * using the card's live margin rules. Throws a user-facing Error if below min.
 */
export function expandBusinessBid(
  customerAmount: number,
  ctx: CardBidPricing,
): {
  amount: number;
  partner_amount: number;
  margin_amount: number;
  margin_type: 'fixed' | 'percent' | null;
  margin_value: number | null;
  side: 'business';
} {
  const min = ctx.min_customer_price;
  if (min != null && customerAmount < min) {
    throw new Error(
      `Business bid must be at least ₹${min.toLocaleString('en-IN')} (catalog min price)`,
    );
  }
  const marginAmount = resolveFinalMargin(ctx.card, ctx.pricing, customerAmount) ?? 0;
  const partnerAmount = partnerPriceFromCustomer(customerAmount, ctx.card, ctx.pricing);
  const partnerMin = ctx.min_partner_price;
  if (partnerMin != null && partnerAmount < partnerMin) {
    throw new Error(
      `Talent side would fall below ₹${partnerMin.toLocaleString('en-IN')} (catalog partner min)`,
    );
  }
  return {
    amount: customerAmount,
    partner_amount: partnerAmount,
    margin_amount: marginAmount,
    margin_type: ctx.margin_type,
    margin_value: ctx.margin_value,
    side: 'business',
  };
}
