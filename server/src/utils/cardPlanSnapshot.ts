// ============================================================
// cardPlanSnapshot
//
// At publish time we freeze the plan-side data a card displays
// (hours, deliverables, pricing) onto the card itself, so later
// edits to the plan don't silently rewrite a card that partners
// have already seen. To make changes the card must be recalled,
// which puts it back to draft and clears the snapshot.
// ============================================================
import { supabaseAdmin } from '../supabase';

export type PlanSnapshot = {
  plan: {
    id: string;
    plan: string | null;
    tier: string | null;
    daily_hours: number | null;
    weekly_hours: number | null;
  };
  deliverables: Array<{
    id: string;
    kind: 'hours' | 'item';
    deliverable_type_id: string | null;
    deliverable_type_name: string | null;
    per_day: number;
    per_week: number;
    per_month: number;
    sort_order: number;
  }>;
  pricing: Array<{
    country_id: string;
    price: number;
    margin_value: number;
    margin_type: 'fixed' | 'percent';
  }>;
  partner_pricing: Array<{
    country_id: string;
    price: number;
  }>;
  snapshotted_at: string;
};

// Service-type → subscription-slug lookup. Mirrors the live read path used
// for request/custom cards in subscription-cards-admin.ts.
const SERVICE_TYPE_TO_SLUG: Record<string, string> = {
  Designers: 'designer',
  Editors: 'video_editor',
  'Designer plus Editor': 'designer_video_editor',
};

const PLAN_NAME_TO_CANONICAL: Record<string, string> = {
  starter: 'Starter',
  basic: 'Basic',
  plus: 'Plus',
  pro: 'Pro',
  personal: 'Personal',
};

/**
 * Resolve the subscription_plans.id a card is anchored to. Staged cards have
 * it via client_submission_subscriptions.plan_id; request/custom cards encode
 * it implicitly through service_type + plan_name + target_tiers[0].
 */
export async function resolvePlanIdForCard(card: any): Promise<string | null> {
  if (card?.submission_subscription_id) {
    const { data } = await supabaseAdmin
      .from('client_submission_subscriptions')
      .select('plan_id')
      .eq('id', card.submission_subscription_id)
      .maybeSingle();
    return (data?.plan_id as string | undefined) ?? null;
  }

  const slug = SERVICE_TYPE_TO_SLUG[String(card?.service_type ?? '')];
  const canonicalPlan = PLAN_NAME_TO_CANONICAL[String(card?.plan_name ?? '').toLowerCase()];
  const tier = Array.isArray(card?.target_tiers) ? card.target_tiers[0] : null;
  if (!slug || !canonicalPlan || !tier) return null;

  const { data: sub } = await supabaseAdmin
    .from('subscriptions')
    .select('id')
    .eq('slug', slug)
    .maybeSingle();
  if (!sub?.id) return null;

  const { data: plan } = await supabaseAdmin
    .from('subscription_plans')
    .select('id')
    .eq('subscription_id', sub.id)
    .ilike('plan', canonicalPlan)
    .ilike('tier', tier)
    .maybeSingle();
  return (plan?.id as string | undefined) ?? null;
}

/**
 * Read plan, deliverables, and per-country pricing for one plan_id and pack
 * them into the shape we persist on subscription_cards.plan_snapshot.
 */
export async function buildPlanSnapshot(planId: string): Promise<PlanSnapshot | null> {
  const { data: plan } = await supabaseAdmin
    .from('subscription_plans')
    .select('id, subscription_id, plan, tier, daily_hours, weekly_hours')
    .eq('id', planId)
    .maybeSingle();
  if (!plan) return null;

  const [
    { data: deliverables },
    { data: deliverableTypes },
    { data: pricing },
    { data: partnerPricing },
  ] = await Promise.all([
    supabaseAdmin
      .from('subscription_plan_deliverables')
      .select('id, kind, deliverable_type_id, per_day, per_week, per_month, sort_order')
      .eq('plan_id', planId)
      .order('sort_order'),
    supabaseAdmin
      .from('subscription_deliverable_types')
      .select('id, name')
      .eq('subscription_id', plan.subscription_id),
    supabaseAdmin
      .from('subscription_plan_pricing')
      .select('country_id, price, margin_value, margin_type')
      .eq('plan_id', planId),
    supabaseAdmin
      .from('subscription_plan_partner_pricing')
      .select('country_id, price')
      .eq('plan_id', planId),
  ]);

  const typeNameById: Record<string, string> = {};
  (deliverableTypes ?? []).forEach((t: any) => { typeNameById[t.id] = t.name; });

  return {
    plan: {
      id: plan.id,
      plan: plan.plan ?? null,
      tier: plan.tier ?? null,
      daily_hours: plan.daily_hours != null ? Number(plan.daily_hours) : null,
      weekly_hours: plan.weekly_hours != null ? Number(plan.weekly_hours) : null,
    },
    deliverables: (deliverables ?? []).map((d: any) => ({
      id: d.id,
      kind: d.kind,
      deliverable_type_id: d.deliverable_type_id ?? null,
      deliverable_type_name: d.deliverable_type_id
        ? typeNameById[d.deliverable_type_id] ?? null
        : null,
      per_day: Number(d.per_day) || 0,
      per_week: Number(d.per_week) || 0,
      per_month: Number(d.per_month) || 0,
      sort_order: Number(d.sort_order) || 0,
    })),
    pricing: (pricing ?? []).map((p: any) => ({
      country_id: p.country_id,
      price: Number(p.price) || 0,
      margin_value: Number(p.margin_value) || 0,
      margin_type: (p.margin_type as 'fixed' | 'percent') ?? 'fixed',
    })),
    partner_pricing: (partnerPricing ?? []).map((p: any) => ({
      country_id: p.country_id,
      price: Number(p.price) || 0,
    })),
    snapshotted_at: new Date().toISOString(),
  };
}

/**
 * Convenience: resolve plan_id for a card and build the snapshot.
 * Returns null if the card has no resolvable plan (e.g. malformed
 * request/custom cards) — caller decides how to handle that.
 */
export async function buildPlanSnapshotForCard(card: any): Promise<PlanSnapshot | null> {
  const planId = await resolvePlanIdForCard(card);
  if (!planId) return null;
  return buildPlanSnapshot(planId);
}
