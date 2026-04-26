import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { supabaseAdmin } from '../supabase';

const router = Router();

router.use(requireAuth, requireAdmin);

// GET /admin/gross-profit/clients?country_id=&subscription_slug=&include_paused=false
//
// Aggregates monthly gross profit per client. Pricing is keyed on (plan_id,
// client.country_id) — partner price is the plan-level default; the
// per-card subscription_cards.partner_price_override lives on the lead pipeline
// (client_submission_subscriptions) and is not yet wired into active
// client_subscriptions, so it's intentionally not consulted here.
router.get('/clients', async (req: Request, res: Response) => {
  try {
    const countryFilter = (req.query.country_id as string) || '';
    const subscriptionSlugFilter = (req.query.subscription_slug as string) || '';
    const includePaused = req.query.include_paused === 'true';

    const statuses = includePaused ? ['active', 'paused'] : ['active'];

    const [csRes, cpRes, ppRes] = await Promise.all([
      supabaseAdmin
        .from('client_subscriptions')
        .select(`
          id, status, plan_id,
          client:clients!inner ( id, business_name, country_id, status,
            country:countries ( id, name, currency ) ),
          subscription:subscriptions ( id, slug, name ),
          plan:subscription_plans ( id, plan, tier )
        `)
        .in('status', statuses)
        .eq('client.status', 'active'),
      supabaseAdmin.from('subscription_plan_pricing').select('plan_id, country_id, price'),
      supabaseAdmin.from('subscription_plan_partner_pricing').select('plan_id, country_id, price'),
    ]);

    if (csRes.error) {
      res.status(500).json({ success: false, error: csRes.error.message });
      return;
    }
    if (cpRes.error) {
      res.status(500).json({ success: false, error: cpRes.error.message });
      return;
    }
    if (ppRes.error) {
      res.status(500).json({ success: false, error: ppRes.error.message });
      return;
    }

    const customerByPlanCountry: Record<string, number> = {};
    for (const row of cpRes.data || []) {
      customerByPlanCountry[`${row.plan_id}:${row.country_id}`] = row.price;
    }
    const partnerByPlanCountry: Record<string, number> = {};
    for (const row of ppRes.data || []) {
      partnerByPlanCountry[`${row.plan_id}:${row.country_id}`] = row.price;
    }

    type SubBreakdown = {
      client_subscription_id: string;
      status: string;
      subscription: { id: string; slug: string; name: string } | null;
      plan: { id: string; plan: string; tier: string } | null;
      customer_price: number;
      partner_price: number;
      gross_profit: number;
      missing_customer_price: boolean;
      missing_partner_price: boolean;
    };

    type ClientAgg = {
      id: string;
      business_name: string;
      country: { id: string; name: string; currency: string };
      active_subscription_count: number;
      paused_subscription_count: number;
      monthly_revenue: number;
      monthly_partner_cost: number;
      gross_profit: number;
      margin_pct: number;
      has_missing_pricing: boolean;
      subscriptions: SubBreakdown[];
    };

    const clientsAgg: Record<string, ClientAgg> = {};

    for (const cs of (csRes.data || []) as any[]) {
      const c = cs.client;
      if (!c) continue;
      if (countryFilter && c.country_id !== countryFilter) continue;
      const sub = cs.subscription;
      const plan = cs.plan;
      if (subscriptionSlugFilter && sub?.slug !== subscriptionSlugFilter) continue;

      const key = `${cs.plan_id}:${c.country_id}`;
      const customerPriceRaw = customerByPlanCountry[key];
      const partnerPriceRaw = partnerByPlanCountry[key];
      const customerPrice = customerPriceRaw ?? 0;
      const partnerPrice = partnerPriceRaw ?? 0;
      const subGrossProfit = customerPrice - partnerPrice;
      const missingCustomer = customerPriceRaw === undefined;
      const missingPartner = partnerPriceRaw === undefined;

      if (!clientsAgg[c.id]) {
        clientsAgg[c.id] = {
          id: c.id,
          business_name: c.business_name,
          country: c.country
            ? { id: c.country.id, name: c.country.name, currency: c.country.currency }
            : { id: c.country_id, name: '', currency: '' },
          active_subscription_count: 0,
          paused_subscription_count: 0,
          monthly_revenue: 0,
          monthly_partner_cost: 0,
          gross_profit: 0,
          margin_pct: 0,
          has_missing_pricing: false,
          subscriptions: [],
        };
      }

      const agg = clientsAgg[c.id];
      if (cs.status === 'active') agg.active_subscription_count += 1;
      else if (cs.status === 'paused') agg.paused_subscription_count += 1;
      agg.monthly_revenue += customerPrice;
      agg.monthly_partner_cost += partnerPrice;
      agg.gross_profit += subGrossProfit;
      if (missingCustomer || missingPartner) agg.has_missing_pricing = true;
      agg.subscriptions.push({
        client_subscription_id: cs.id,
        status: cs.status,
        subscription: sub
          ? { id: sub.id, slug: sub.slug, name: sub.name }
          : null,
        plan: plan
          ? { id: plan.id, plan: plan.plan, tier: plan.tier }
          : null,
        customer_price: customerPrice,
        partner_price: partnerPrice,
        gross_profit: subGrossProfit,
        missing_customer_price: missingCustomer,
        missing_partner_price: missingPartner,
      });
    }

    const clientsList = Object.values(clientsAgg).map((c) => ({
      ...c,
      margin_pct: c.monthly_revenue > 0 ? (c.gross_profit / c.monthly_revenue) * 100 : 0,
    }));
    clientsList.sort((a, b) => b.gross_profit - a.gross_profit);

    type CurrencySummary = {
      currency: string;
      revenue: number;
      partner_cost: number;
      gross_profit: number;
      margin_pct: number;
      client_count: number;
    };
    const summaryByCurrency: Record<string, CurrencySummary> = {};
    for (const c of clientsList) {
      const cur = c.country.currency || 'UNKNOWN';
      if (!summaryByCurrency[cur]) {
        summaryByCurrency[cur] = {
          currency: cur,
          revenue: 0,
          partner_cost: 0,
          gross_profit: 0,
          margin_pct: 0,
          client_count: 0,
        };
      }
      const s = summaryByCurrency[cur];
      s.revenue += c.monthly_revenue;
      s.partner_cost += c.monthly_partner_cost;
      s.gross_profit += c.gross_profit;
      s.client_count += 1;
    }
    const summary = Object.values(summaryByCurrency)
      .map((s) => ({
        ...s,
        margin_pct: s.revenue > 0 ? (s.gross_profit / s.revenue) * 100 : 0,
      }))
      .sort((a, b) => a.currency.localeCompare(b.currency));

    res.json({
      success: true,
      data: {
        summary_by_currency: summary,
        clients: clientsList,
      },
    });
  } catch (err) {
    console.error('Gross profit clients error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
