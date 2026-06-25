import { Router, Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'crypto';
import { supabaseAdmin } from '../supabase';
import { config } from '../config';

/**
 * Server-to-server integration API consumed by the sibling SquadBooks app
 * (books.squadhub.in). Authenticated with the shared SQUADBOOKS_ADMIN_API_KEY —
 * the same secret SquadHub sends when it calls SquadBooks' /api/admin/access,
 * here the call goes the other way (SquadBooks → SquadHub). No SquadHub user
 * session is involved, so this lives outside requireAuth/requireAdmin and does
 * its own constant-time key check. Returns 503 when the key is unset.
 *
 * Exposes ONLY the customer-facing subscription catalog (names + per-country
 * customer prices). Partner pricing / margins are deliberately NOT included.
 */
const router = Router();

function authorize(req: Request, res: Response, next: NextFunction): void {
  const key = config.squadbooksAdminApiKey;
  if (!key) {
    res.status(503).json({ success: false, error: 'SquadBooks integration not configured' });
    return;
  }
  const provided = String(req.header('x-admin-key') || '');
  const a = Buffer.from(provided);
  const b = Buffer.from(key);
  const ok = provided.length > 0 && a.length === b.length && timingSafeEqual(a, b);
  if (!ok) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return;
  }
  next();
}

router.use(authorize);

// GET /integrations/squadbooks/subscriptions
// Active subscriptions, each with its plan names (Starter…Personal) collapsed
// across tiers, plus per-country customer pricing — shaped so SquadBooks can
// render every subscription as a single catalog item.
router.get('/subscriptions', async (_req: Request, res: Response) => {
  try {
    const { data: subs, error: subErr } = await supabaseAdmin
      .from('subscriptions')
      .select('id, slug, name, description, sort_order')
      .eq('is_active', true)
      .order('sort_order');
    if (subErr) {
      res.status(500).json({ success: false, error: subErr.message });
      return;
    }

    const subIds = (subs || []).map((s: any) => s.id);
    if (subIds.length === 0) {
      res.json({ success: true, data: [] });
      return;
    }

    const [{ data: plans }, { data: countries }] = await Promise.all([
      supabaseAdmin
        .from('subscription_plans')
        .select('id, subscription_id, plan, tier, sort_order, monthly_hours, is_active')
        .in('subscription_id', subIds)
        .order('sort_order'),
      supabaseAdmin.from('countries').select('id, name, currency'),
    ]);

    const planIds = (plans || []).map((p: any) => p.id);
    const { data: pricing } = planIds.length
      ? await supabaseAdmin
          .from('subscription_plan_pricing')
          .select('plan_id, country_id, price')
          .in('plan_id', planIds)
      : { data: [] as any[] };

    const countryById: Record<string, { name: string; currency: string }> = {};
    (countries || []).forEach((c: any) => {
      countryById[c.id] = { name: c.name, currency: c.currency };
    });

    const pricingByPlan: Record<string, any[]> = {};
    (pricing || []).forEach((pr: any) => {
      (pricingByPlan[pr.plan_id] = pricingByPlan[pr.plan_id] || []).push(pr);
    });

    const plansBySub: Record<string, any[]> = {};
    (plans || []).forEach((p: any) => {
      if (p.is_active === false) return;
      (plansBySub[p.subscription_id] = plansBySub[p.subscription_id] || []).push(p);
    });

    // Each plan exists per (plan name × tier = Junior/Pro/Top Talents) with its
    // own per-country pricing. We return every plan row (tier preserved) so the
    // consumer can map each one to its own catalog item.
    const TIER_ORDER: Record<string, number> = { Junior: 1, Pro: 2, 'Top Talents': 3 };

    const data = (subs || []).map((s: any) => {
      const plans = (plansBySub[s.id] || [])
        .map((p: any) => {
          const prices = (pricingByPlan[p.id] || [])
            .map((pr: any) => {
              const c = countryById[pr.country_id];
              return c && typeof pr.price === 'number'
                ? { country: c.name, currency: c.currency, price: pr.price }
                : null;
            })
            .filter(Boolean) as { country: string; currency: string; price: number }[];
          return {
            plan: p.plan,
            tier: p.tier,
            sort: p.sort_order ?? 0,
            monthlyHours: Number(p.monthly_hours) || 0,
            prices,
          };
        })
        .sort(
          (a, b) =>
            a.sort - b.sort || (TIER_ORDER[a.tier] ?? 9) - (TIER_ORDER[b.tier] ?? 9),
        );

      return {
        slug: s.slug,
        name: s.name,
        description: s.description ?? null,
        plans,
      };
    });

    res.json({ success: true, data });
  } catch (err) {
    console.error('SquadBooks subscriptions integration error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
