// ============================================================
// cardBilling
//
// Resolve the full monthly partner price, currency, committed hours, finalized
// client price, and plan snapshot for a set of subscription cards. Pricing
// mirrors the shared resolvePartnerPrice helper (override, else finalized −
// plan margin); hours come from the plan snapshot frozen on the card at publish
// time.
//
// Extracted from subscription-assignments-admin.ts so both the Active
// Subscriptions billing view and the assignment-term ledger (which snapshots
// these values onto each term when it opens) resolve them the same way.
// ============================================================
import { resolvePartnerPrice, resolveFinalizedPrice } from '@squadhub/shared';
import { supabaseAdmin } from '../supabase';

export interface CardBilling {
  partner_price: number | null; // monthly, full
  currency: string | null;
  daily_hours: number | null;
  weekly_hours: number | null;
  monthly_hours: number | null;
  missing_partner_price: boolean;
  /** Finalized monthly client price (subscription_price, else proposed_price). */
  subscription_price: number | null;
  /** The card's frozen plan snapshot (plan/tier/hours/deliverables/pricing). */
  plan_snapshot: any | null;
}

export async function loadCardBilling(cardIds: string[]): Promise<Map<string, CardBilling>> {
  const out = new Map<string, CardBilling>();
  if (cardIds.length === 0) return out;

  const { data: cards, error } = await supabaseAdmin
    .from('subscription_cards')
    .select(
      'id, submission_subscription_id, subscription_price, proposed_price, markup, partner_price_override, plan_snapshot',
    )
    .in('id', cardIds);
  if (error) throw new Error(error.message);

  // The card itself carries no billing country. For staged cards it's the
  // client-submission's country; resolve that chain in batch so we can pick the
  // right margin row / currency. (Margin is usually moot — markup on the card
  // overrides it — but currency still needs a country.)
  const cardList = (cards || []) as any[];
  const subSubIds = cardList
    .map((c) => c.submission_subscription_id)
    .filter((v): v is string => !!v);
  const cardCountry = new Map<string, string>();
  if (subSubIds.length) {
    const { data: subSubs } = await supabaseAdmin
      .from('client_submission_subscriptions')
      .select('id, submission_id')
      .in('id', subSubIds);
    const submissionIdBySubSub = new Map<string, string>();
    (subSubs || []).forEach((s: any) => submissionIdBySubSub.set(s.id, s.submission_id));
    const submissionIds = [...new Set([...submissionIdBySubSub.values()].filter(Boolean))];
    const countryBySubmission = new Map<string, string>();
    if (submissionIds.length) {
      const { data: subs } = await supabaseAdmin
        .from('client_submissions')
        .select('id, country_id')
        .in('id', submissionIds);
      (subs || []).forEach((s: any) => {
        if (s.country_id) countryBySubmission.set(s.id, s.country_id);
      });
    }
    for (const c of cardList) {
      const subId = c.submission_subscription_id
        ? submissionIdBySubSub.get(c.submission_subscription_id)
        : null;
      const countryId = subId ? countryBySubmission.get(subId) : null;
      if (countryId) cardCountry.set(c.id, countryId);
    }
  }

  // Batch the lookups the snapshot can't answer: currency (per country) and
  // monthly_hours (not stored in the snapshot — only daily/weekly are).
  const countryIds = new Set<string>();
  const planIds = new Set<string>();
  const prepared = cardList.map((card: any) => {
    const snap = (card.plan_snapshot as any) || null;
    const pricingRows: any[] = Array.isArray(snap?.pricing) ? snap.pricing : [];
    // Pick the margin row for the card's billing country; fall back to the sole
    // pricing row when there's exactly one (covers cards we couldn't map a country for).
    let countryId: string | null = cardCountry.get(card.id) ?? null;
    let marginRow =
      (countryId && pricingRows.find((p) => p.country_id === countryId)) || null;
    if (!marginRow && pricingRows.length === 1) {
      marginRow = pricingRows[0];
      if (!countryId) countryId = marginRow.country_id ?? null;
    }
    if (countryId) countryIds.add(countryId);
    const planId: string | null = snap?.plan?.id ?? null;
    if (planId) planIds.add(planId);
    return { card, snap, marginRow, countryId, planId };
  });

  const [{ data: countries }, { data: plans }] = await Promise.all([
    countryIds.size
      ? supabaseAdmin.from('countries').select('id, currency').in('id', [...countryIds])
      : Promise.resolve({ data: [] as any[] }),
    planIds.size
      ? supabaseAdmin.from('subscription_plans').select('id, monthly_hours').in('id', [...planIds])
      : Promise.resolve({ data: [] as any[] }),
  ]);
  const currencyByCountry = new Map<string, string>();
  (countries || []).forEach((c: any) => currencyByCountry.set(c.id, c.currency));
  const monthlyByPlan = new Map<string, number | null>();
  (plans || []).forEach((p: any) =>
    monthlyByPlan.set(p.id, p.monthly_hours != null ? Number(p.monthly_hours) : null),
  );

  for (const { card, snap, marginRow, countryId, planId } of prepared) {
    const partnerPrice = resolvePartnerPrice(card, marginRow);
    const daily = snap?.plan?.daily_hours != null ? Number(snap.plan.daily_hours) : null;
    const weekly = snap?.plan?.weekly_hours != null ? Number(snap.plan.weekly_hours) : null;
    const monthlyFromPlan = planId ? monthlyByPlan.get(planId) ?? null : null;
    const monthly = monthlyFromPlan != null ? monthlyFromPlan : weekly != null ? weekly * 4 : null;
    out.set(card.id, {
      partner_price: partnerPrice,
      currency: countryId ? currencyByCountry.get(countryId) ?? null : null,
      daily_hours: daily,
      weekly_hours: weekly,
      monthly_hours: monthly,
      missing_partner_price: partnerPrice == null,
      subscription_price: resolveFinalizedPrice(card),
      plan_snapshot: snap,
    });
  }
  return out;
}

/** Single-card convenience used when opening an assignment term. */
export async function resolveCardBilling(cardId: string): Promise<CardBilling | null> {
  const map = await loadCardBilling([cardId]);
  return map.get(cardId) ?? null;
}
