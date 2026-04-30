import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { supabaseAdmin } from '../supabase';
import { hydrateCard } from '../utils/subscriptionCards';

const router = Router();

router.use(requireAuth);
router.use(requireAdmin);

// ============================================================
// GET /admin/subscription-cards — list ALL published+closed cards
// across every sales user. Org-wide variant of /subscription-cards/published-by-me.
// Optional query params: state, published_by, search (business_name ilike).
// ============================================================
router.get('/', async (req: Request, res: Response) => {
  try {
    const stateParam = String(req.query.state || '').trim();
    const publishedBy = String(req.query.published_by || '').trim();
    const search = String(req.query.search || '').trim();

    let query = supabaseAdmin
      .from('subscription_cards')
      .select('*')
      .order('published_at', { ascending: false });

    if (stateParam === 'published' || stateParam === 'closed') {
      query = query.eq('state', stateParam);
    } else {
      query = query.in('state', ['published', 'closed']);
    }
    if (publishedBy) query = query.eq('published_by', publishedBy);

    const { data: cards, error } = await query;
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    const list = cards || [];
    if (list.length === 0) {
      res.json({ success: true, data: [] });
      return;
    }

    // Hydrate the related rows in batches (one query per relation, not N+1).
    const stagedIds = list.map((c: any) => c.submission_subscription_id);
    const publisherIds = Array.from(
      new Set(list.map((c: any) => c.published_by).filter(Boolean)),
    );

    const [{ data: stagedRows }, { data: publishers }] = await Promise.all([
      supabaseAdmin
        .from('client_submission_subscriptions')
        .select('*')
        .in('id', stagedIds.length ? stagedIds : ['00000000-0000-0000-0000-000000000000']),
      publisherIds.length
        ? supabaseAdmin
            .from('users')
            .select('id, display_name, email')
            .in('id', publisherIds)
        : Promise.resolve({ data: [] as any[] }),
    ]);

    const stagedById: Record<string, any> = {};
    (stagedRows || []).forEach((r: any) => { stagedById[r.id] = r; });
    const publisherById: Record<string, any> = {};
    (publishers || []).forEach((u: any) => { publisherById[u.id] = u; });

    const submissionIds = Array.from(
      new Set((stagedRows || []).map((r: any) => r.submission_id)),
    );
    const subscriptionIds = Array.from(
      new Set((stagedRows || []).map((r: any) => r.subscription_id)),
    );
    const planIds = Array.from(
      new Set((stagedRows || []).map((r: any) => r.plan_id)),
    );

    const [
      { data: submissions },
      { data: subs },
      { data: plans },
      { data: pricing },
      { data: countries },
    ] = await Promise.all([
      supabaseAdmin
        .from('client_submissions')
        .select('id, business_name, country_id')
        .in('id', submissionIds.length ? submissionIds : ['00000000-0000-0000-0000-000000000000']),
      supabaseAdmin
        .from('subscriptions')
        .select('id, name')
        .in('id', subscriptionIds.length ? subscriptionIds : ['00000000-0000-0000-0000-000000000000']),
      supabaseAdmin
        .from('subscription_plans')
        .select('id, plan, tier')
        .in('id', planIds.length ? planIds : ['00000000-0000-0000-0000-000000000000']),
      supabaseAdmin
        .from('subscription_plan_pricing')
        .select('plan_id, country_id, price')
        .in('plan_id', planIds.length ? planIds : ['00000000-0000-0000-0000-000000000000']),
      supabaseAdmin.from('countries').select('id, name, currency'),
    ]);

    const submissionById: Record<string, any> = {};
    (submissions || []).forEach((s: any) => { submissionById[s.id] = s; });
    const subById: Record<string, any> = {};
    (subs || []).forEach((s: any) => { subById[s.id] = s; });
    const planById: Record<string, any> = {};
    (plans || []).forEach((p: any) => { planById[p.id] = p; });
    const countryById: Record<string, any> = {};
    (countries || []).forEach((c: any) => { countryById[c.id] = c; });
    const pricingByPlan: Record<string, any[]> = {};
    (pricing || []).forEach((p: any) => {
      (pricingByPlan[p.plan_id] = pricingByPlan[p.plan_id] || []).push(p);
    });

    let hydrated = await Promise.all(list.map(async (card: any) => {
      const staged = stagedById[card.submission_subscription_id] || null;
      const submission = staged ? submissionById[staged.submission_id] || null : null;
      const country = submission ? countryById[submission.country_id] || null : null;
      const plan = staged ? planById[staged.plan_id] || null : null;
      const subscription = staged ? subById[staged.subscription_id] || null : null;
      const planPricing = staged ? pricingByPlan[staged.plan_id] || [] : [];
      const priceForCountry = country
        ? planPricing.find((pr: any) => pr.country_id === country.id) || null
        : null;
      const publisher = card.published_by ? publisherById[card.published_by] || null : null;

      const base = await hydrateCard(card);
      return {
        ...base,
        submission: submission ? { ...submission, country } : null,
        submission_subscription: staged
          ? {
              ...staged,
              subscription,
              plan: plan
                ? {
                    ...plan,
                    pricing: priceForCountry ? [{ ...priceForCountry, country }] : [],
                  }
                : null,
            }
          : null,
        published_by_user: publisher
          ? { id: publisher.id, display_name: publisher.display_name, email: publisher.email }
          : null,
      };
    }));

    if (search) {
      const needle = search.toLowerCase();
      hydrated = hydrated.filter((c: any) =>
        (c.submission?.business_name || '').toLowerCase().includes(needle),
      );
    }

    res.json({ success: true, data: hydrated });
  } catch (err: any) {
    console.error('Admin list subscription cards error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

// ============================================================
// GET /admin/subscription-cards/:id/recipients — names + statuses for the side panel.
// Same response shape as the user-scoped /subscription-cards/:id/recipients,
// but no publisher check — admins can view any card's recipients.
// ============================================================
router.get('/:id/recipients', async (req: Request, res: Response) => {
  try {
    const cardId = req.params.id as string;

    const [{ data: partnerRows }, { data: talentRows }] = await Promise.all([
      supabaseAdmin
        .from('subscription_card_recipients')
        .select('partner_id, status, responded_at, assigned_manually, selected_at, selected_by, passed_over_at')
        .eq('card_id', cardId),
      supabaseAdmin
        .from('subscription_card_external_recipients')
        .select('external_user_id, talent_name, status, responded_at, assigned_manually, selected_at, selected_by, passed_over_at')
        .eq('card_id', cardId),
    ]);

    const partnerIds = Array.from(new Set((partnerRows || []).map((r: any) => r.partner_id)));
    const { data: users } = await supabaseAdmin
      .from('users')
      .select('id, display_name, email')
      .in('id', partnerIds.length ? partnerIds : ['00000000-0000-0000-0000-000000000000']);
    const userById: Record<string, any> = {};
    (users || []).forEach((u: any) => { userById[u.id] = u; });

    const partners = (partnerRows || []).map((r: any) => {
      const u = userById[r.partner_id];
      return {
        id: r.partner_id,
        name: u?.display_name || u?.email || r.partner_id,
        status: r.status,
        responded_at: r.responded_at,
        assigned_manually: !!r.assigned_manually,
        selected_at: r.selected_at ?? null,
        selected_by: r.selected_by ?? null,
        passed_over_at: r.passed_over_at ?? null,
      };
    });

    const talents = (talentRows || []).map((r: any) => ({
      external_user_id: r.external_user_id,
      name: r.talent_name || null,
      status: r.status,
      responded_at: r.responded_at,
      assigned_manually: !!r.assigned_manually,
      selected_at: r.selected_at ?? null,
      selected_by: r.selected_by ?? null,
      passed_over_at: r.passed_over_at ?? null,
    }));

    res.json({ success: true, data: { partners, talents } });
  } catch (err: any) {
    console.error('Admin get card recipients error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

export default router;
