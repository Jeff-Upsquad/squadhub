import { supabaseAdmin } from '../supabase';

export async function hydrateSubscription(subscriptionId: string) {
  const [{ data: sub }, { data: plans }, { data: types }] = await Promise.all([
    supabaseAdmin.from('subscriptions').select('*').eq('id', subscriptionId).single(),
    supabaseAdmin.from('subscription_plans').select('*').eq('subscription_id', subscriptionId).order('sort_order'),
    supabaseAdmin.from('subscription_deliverable_types').select('*').eq('subscription_id', subscriptionId).order('sort_order'),
  ]);

  if (!sub) return null;

  const planIds = (plans || []).map((p: any) => p.id);
  const delivsByPlan: Record<string, any[]> = {};
  const pricingByPlan: Record<string, any[]> = {};
  let countriesById: Record<string, any> = {};

  if (planIds.length > 0) {
    const [{ data: delivs }, { data: pricing }, { data: countries }] = await Promise.all([
      supabaseAdmin.from('subscription_plan_deliverables').select('*').in('plan_id', planIds).order('sort_order'),
      supabaseAdmin.from('subscription_plan_pricing').select('*').in('plan_id', planIds),
      supabaseAdmin.from('countries').select('*').order('sort_order'),
    ]);

    (delivs || []).forEach((d: any) => {
      (delivsByPlan[d.plan_id] = delivsByPlan[d.plan_id] || []).push(d);
    });
    (pricing || []).forEach((p: any) => {
      (pricingByPlan[p.plan_id] = pricingByPlan[p.plan_id] || []).push(p);
    });
    (countries || []).forEach((c: any) => { countriesById[c.id] = c; });
  }

  const typeById: Record<string, any> = {};
  (types || []).forEach((t: any) => { typeById[t.id] = t; });

  return {
    ...sub,
    plans: (plans || []).map((p: any) => ({
      ...p,
      pricing: (pricingByPlan[p.id] || []).map((pr: any) => ({
        ...pr,
        country: countriesById[pr.country_id] || null,
      })),
      deliverables: (delivsByPlan[p.id] || []).map((d: any) => ({
        ...d,
        deliverable_type: d.deliverable_type_id ? typeById[d.deliverable_type_id] || null : null,
      })),
    })),
    deliverable_types: types || [],
  };
}
