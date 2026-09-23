import { Router, Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'crypto';
import { supabaseAdmin } from '../supabase';
import { config } from '../config';
import {
  listAssignmentTerms,
  listUserPayments,
  getUserPaymentDetail,
} from '../services/partnerPayments';
import {
  listPaymentStatuses,
  upsertPaymentStatus,
  isPaymentStatus,
} from '../services/partnerPaymentStatus';

/**
 * Server-to-server integration API consumed by the sibling SquadBooks app
 * (books.squadhub.in). Authenticated with the shared SQUADBOOKS_ADMIN_API_KEY —
 * the same secret SquadHub sends when it calls SquadBooks' /api/admin/access,
 * here the call goes the other way (SquadBooks → SquadHub). No SquadHub user
 * session is involved, so this lives outside requireAuth/requireAdmin and does
 * its own constant-time key check. Returns 503 when the key is unset.
 *
 * Exposes:
 *   - the customer-facing subscription catalog (names + per-country customer
 *     prices) and client lookup;
 *   - the Partner Payments read API + payout status store.
 *
 * The Partner Payments endpoints exist so SquadBooks renders figures computed
 * HERE, by services/partnerPayments.ts, rather than by the hand-ported copy of
 * the math it used to carry (which drifted between manual syncs). SquadBooks
 * must not recompute any of these numbers itself.
 *
 * Note the asymmetry with the catalog endpoints above: those deliberately
 * withhold partner pricing / margins, but Partner Payments is a back-office
 * module and partner prices ARE its subject, so they are returned in full.
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

/** Last 10 digits of a phone number, ignoring spaces / punctuation / country code. */
function phoneKey(raw: string | null | undefined): string {
  const digits = String(raw ?? '').replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

// GET /integrations/squadbooks/lookup-client?email=&phone=
// Cross-app lookup the OTHER way: SquadBooks asks whether one of its customers
// also exists as a SquadHub admin "client" (so the customer detail can deep-link
// into the clients module). Matches by email first (case-insensitive), then by
// phone (last 10 digits of contact_number). Clients are global, so no workspace
// scoping. Returns only the matched client id.
router.get('/lookup-client', async (req: Request, res: Response) => {
  try {
    const email = String(req.query.email || '').trim();
    const phone = String(req.query.phone || '');
    const name = String(req.query.name || '').trim();
    if (!email && !phone && !name) {
      res.status(400).json({ success: false, error: 'email, phone or name required' });
      return;
    }

    if (email) {
      const { data, error } = await supabaseAdmin
        .from('clients')
        .select('id')
        .ilike('email', email)
        .order('created_at', { ascending: true })
        .limit(1);
      if (error) {
        res.status(500).json({ success: false, error: error.message });
        return;
      }
      if (data && data.length) {
        res.json({ success: true, found: true, clientId: data[0].id, matchedBy: 'email' });
        return;
      }
    }

    const key = phoneKey(phone);
    if (key.length >= 7) {
      const { data, error } = await supabaseAdmin
        .from('clients')
        .select('id, contact_number')
        .ilike('contact_number', `%${key}%`)
        .order('created_at', { ascending: true })
        .limit(50);
      if (error) {
        res.status(500).json({ success: false, error: error.message });
        return;
      }
      const hit = (data || []).find((c: any) => phoneKey(c.contact_number) === key);
      if (hit) {
        res.json({ success: true, found: true, clientId: hit.id, matchedBy: 'phone' });
        return;
      }
    }

    // Last resort: exact (case-insensitive) business-name match. Weaker than
    // email/phone — names can collide — so the result is flagged matchedBy:name.
    if (name) {
      const esc = name.replace(/[\\%_]/g, '\\$&');
      const { data, error } = await supabaseAdmin
        .from('clients')
        .select('id')
        .ilike('business_name', esc)
        .order('created_at', { ascending: true })
        .limit(1);
      if (error) {
        res.status(500).json({ success: false, error: error.message });
        return;
      }
      if (data && data.length) {
        res.json({ success: true, found: true, clientId: data[0].id, matchedBy: 'name' });
        return;
      }
    }

    res.json({ success: true, found: false });
  } catch (err) {
    console.error('SquadBooks lookup-client integration error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============================================================
// Partner Payments — the same service the SquadHub admin module and the partner
// mini app call, so all three surfaces show identical figures.
// ============================================================

// GET /integrations/squadbooks/partner-payments/terms?month=&status=&search=
router.get('/partner-payments/terms', async (req: Request, res: Response) => {
  try {
    const result = await listAssignmentTerms({
      status: (req.query.status as string) === 'all' ? 'all' : 'active',
      search: req.query.search as string | undefined,
      // SquadBooks is always month-scoped; fall back to the current month so the
      // endpoint never silently returns the legacy unenriched shape.
      month: typeof req.query.month === 'string' && req.query.month
        ? req.query.month
        : new Date().toISOString().slice(0, 7),
    });
    // Wrapped (rather than a bare array) so the resolved month travels with the
    // rows — SquadBooks echoes it back in its own UI.
    res.json({ success: true, data: { month: result.month, terms: result.data } });
  } catch (err: any) {
    console.error('SquadBooks partner-payments terms error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

// GET /integrations/squadbooks/partner-payments/users?month=&status=&search=
router.get('/partner-payments/users', async (req: Request, res: Response) => {
  try {
    const data = await listUserPayments({
      status: req.query.status as string | undefined,
      search: req.query.search as string | undefined,
      month: req.query.month,
    });
    res.json({ success: true, data });
  } catch (err: any) {
    console.error('SquadBooks partner-payments users error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

// GET /integrations/squadbooks/partner-payments/statuses?month=YYYY-MM
router.get('/partner-payments/statuses', async (req: Request, res: Response) => {
  try {
    const month = String(req.query.month || '');
    if (!/^\d{4}-\d{2}$/.test(month)) {
      res.status(400).json({ success: false, error: 'month must be YYYY-MM' });
      return;
    }
    const map = await listPaymentStatuses(month);
    res.json({ success: true, data: { month, statuses: [...map.values()] } });
  } catch (err: any) {
    console.error('SquadBooks partner-payments statuses error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

// POST /integrations/squadbooks/partner-payments/statuses
// SquadBooks user ids live in a different database, so `updated_by` stays null;
// `updated_source` records that the change came from there.
router.post('/partner-payments/statuses', async (req: Request, res: Response) => {
  try {
    const body = req.body ?? {};
    if (!isPaymentStatus(body.status)) {
      res.status(400).json({ success: false, error: 'Invalid status' });
      return;
    }
    if (body.recipient_type !== 'talent' && body.recipient_type !== 'partner') {
      res.status(400).json({ success: false, error: 'Invalid recipient type' });
      return;
    }
    const record = await upsertPaymentStatus({
      month: String(body.month || ''),
      recipientType: body.recipient_type,
      recipientId: String(body.recipient_id || ''),
      status: body.status,
      holdReason: body.hold_reason ?? null,
      source: 'squadbooks',
      updatedBy: null,
    });
    res.json({ success: true, data: record });
  } catch (err: any) {
    console.error('SquadBooks partner-payments status upsert error:', err);
    res.status(400).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

// GET /integrations/squadbooks/partner-payments/users/:recipientType/:recipientId?month=
// Declared last so it can't shadow the fixed sub-paths above.
router.get('/partner-payments/users/:recipientType/:recipientId', async (req: Request, res: Response) => {
  try {
    const recipientType = req.params.recipientType as 'talent' | 'partner';
    if (recipientType !== 'talent' && recipientType !== 'partner') {
      res.status(400).json({ success: false, error: 'Invalid recipient type' });
      return;
    }
    const data = await getUserPaymentDetail({
      recipientType,
      recipientId: req.params.recipientId as string,
      month: req.query.month,
    });
    res.json({ success: true, data });
  } catch (err: any) {
    console.error('SquadBooks partner-payments user detail error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

export default router;
