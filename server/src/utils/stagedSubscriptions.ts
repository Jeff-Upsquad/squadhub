import { supabaseAdmin } from '../supabase';

/**
 * Hydrate staged subscription selections (client_submission_subscriptions rows)
 * for a set of submission IDs. Each returned row includes:
 *   - subscription: base Subscription row
 *   - plan: base SubscriptionPlan row, extended with:
 *       - pricing: SubscriptionPlanPricing[] (country joined)
 *       - partner_pricing: SubscriptionPlanPartnerPricing[] (country joined)
 *       - deliverables: SubscriptionPlanDeliverable[] (deliverable_type joined)
 *
 * Pricing is returned for every country — the frontend picks the row matching
 * the lead's country. Keeps the API country-agnostic.
 */
export async function hydrateStagedSubscriptions(
  submissionIds: string[],
): Promise<Record<string, any[]>> {
  if (submissionIds.length === 0) return {};

  const { data: rows } = await supabaseAdmin
    .from('client_submission_subscriptions')
    .select('*')
    .in('submission_id', submissionIds)
    .order('created_at');

  const list = rows || [];
  if (list.length === 0) return {};

  const subIds = Array.from(new Set(list.map((r: any) => r.subscription_id)));
  const planIds = Array.from(new Set(list.map((r: any) => r.plan_id)));
  const stagedRowIds = list.map((r: any) => r.id);

  const [
    { data: subs },
    { data: plans },
    { data: pricing },
    { data: partnerPricing },
    { data: deliverables },
    { data: countries },
    { data: deliverableTypes },
    { data: cards },
  ] = await Promise.all([
    supabaseAdmin.from('subscriptions').select('*').in('id', subIds),
    supabaseAdmin.from('subscription_plans').select('*').in('id', planIds),
    supabaseAdmin.from('subscription_plan_pricing').select('*').in('plan_id', planIds),
    supabaseAdmin.from('subscription_plan_partner_pricing').select('*').in('plan_id', planIds),
    supabaseAdmin
      .from('subscription_plan_deliverables')
      .select('*')
      .in('plan_id', planIds)
      .order('sort_order'),
    supabaseAdmin.from('countries').select('*'),
    supabaseAdmin
      .from('subscription_deliverable_types')
      .select('*')
      .in('subscription_id', subIds),
    supabaseAdmin
      .from('subscription_cards')
      .select('submission_subscription_id, state')
      .in('submission_subscription_id', stagedRowIds),
  ]);

  const subMap: Record<string, any> = {};
  (subs || []).forEach((s: any) => { subMap[s.id] = s; });

  const countryMap: Record<string, any> = {};
  (countries || []).forEach((c: any) => { countryMap[c.id] = c; });

  const typeMap: Record<string, any> = {};
  (deliverableTypes || []).forEach((t: any) => { typeMap[t.id] = t; });

  const pricingByPlan: Record<string, any[]> = {};
  (pricing || []).forEach((pr: any) => {
    (pricingByPlan[pr.plan_id] = pricingByPlan[pr.plan_id] || []).push({
      ...pr,
      country: countryMap[pr.country_id] || null,
    });
  });

  const partnerPricingByPlan: Record<string, any[]> = {};
  (partnerPricing || []).forEach((pr: any) => {
    (partnerPricingByPlan[pr.plan_id] = partnerPricingByPlan[pr.plan_id] || []).push({
      ...pr,
      country: countryMap[pr.country_id] || null,
    });
  });

  const delivsByPlan: Record<string, any[]> = {};
  (deliverables || []).forEach((d: any) => {
    (delivsByPlan[d.plan_id] = delivsByPlan[d.plan_id] || []).push({
      ...d,
      deliverable_type: d.deliverable_type_id ? typeMap[d.deliverable_type_id] || null : null,
    });
  });

  const planMap: Record<string, any> = {};
  (plans || []).forEach((p: any) => {
    planMap[p.id] = {
      ...p,
      pricing: pricingByPlan[p.id] || [],
      partner_pricing: partnerPricingByPlan[p.id] || [],
      deliverables: delivsByPlan[p.id] || [],
    };
  });

  const cardStateByStagedId: Record<string, string> = {};
  (cards || []).forEach((c: any) => {
    cardStateByStagedId[c.submission_subscription_id] = c.state;
  });

  const bySubmission: Record<string, any[]> = {};
  list.forEach((r: any) => {
    const enriched = {
      ...r,
      subscription: subMap[r.subscription_id] || null,
      plan: planMap[r.plan_id] || null,
      card_state: cardStateByStagedId[r.id] ?? null,
    };
    (bySubmission[r.submission_id] = bySubmission[r.submission_id] || []).push(enriched);
  });

  return bySubmission;
}
