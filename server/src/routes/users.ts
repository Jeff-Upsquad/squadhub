import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { supabaseAdmin } from '../supabase';
import { hydrateCard } from '../utils/subscriptionCards';

const router = Router();

// Resolve the set of submission_subscription_ids the current user can see, by
// walking client_user_access → clients(submission_id) → client_submission_subscriptions.
// Returns an empty array if the user has no client access.
async function getStagedSubIdsForUser(userId: string): Promise<string[]> {
  const { data: access } = await supabaseAdmin
    .from('client_user_access')
    .select('client_id')
    .eq('user_id', userId);
  const clientIds = Array.from(new Set((access || []).map((a: any) => a.client_id)));
  if (clientIds.length === 0) return [];

  const { data: clients } = await supabaseAdmin
    .from('clients')
    .select('submission_id')
    .in('id', clientIds);
  const submissionIds = Array.from(
    new Set((clients || []).map((c: any) => c.submission_id).filter(Boolean)),
  );
  if (submissionIds.length === 0) return [];

  const { data: staged } = await supabaseAdmin
    .from('client_submission_subscriptions')
    .select('id')
    .in('submission_id', submissionIds);
  return (staged || []).map((s: any) => s.id);
}

const updateProfileSchema = z.object({
  display_name: z.string().min(1).max(50).optional(),
  avatar_url: z.string().url().nullable().optional(),
});

// GET /users/search?q=&limit=10 — autocomplete users by display_name (mention picker)
router.get('/search', requireAuth, async (req: Request, res: Response) => {
  try {
    const q = ((req.query.q as string) || '').trim();
    const limit = Math.min(parseInt((req.query.limit as string) || '10', 10), 25);

    let query = supabaseAdmin
      .from('users')
      .select('id, display_name, avatar_url, user_type, email')
      .eq('status', 'active')
      .neq('id', req.userId!)
      .order('display_name', { ascending: true })
      .limit(limit);

    if (q.length > 0) {
      query = query.ilike('display_name', `%${q}%`);
    }

    const { data, error } = await query;
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.json({ success: true, data: data || [] });
  } catch (err) {
    console.error('User search error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /users/me — get current user's profile
router.get('/me', requireAuth, async (req: Request, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('id', req.userId!)
      .single();

    if (error || !data) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }

    res.json({ success: true, data });
  } catch (err) {
    console.error('Get user error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PUT /users/me — update current user's profile
router.put('/me', requireAuth, async (req: Request, res: Response) => {
  try {
    const body = updateProfileSchema.parse(req.body);

    const { data, error } = await supabaseAdmin
      .from('users')
      .update(body)
      .eq('id', req.userId!)
      .select()
      .single();

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.json({ success: true, data });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Update user error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /users/me/client-links — get current user's client assignments
router.get('/me/client-links', requireAuth, async (req: Request, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('partner_client_assignments')
      .select('*, clients(id, business_name, contact_person, status)')
      .eq('user_id', req.userId!)
      .order('created_at', { ascending: false });

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    const enriched = (data || []).map((a: any) => ({
      ...a,
      client: a.clients,
      clients: undefined,
    }));

    res.json({ success: true, data: enriched });
  } catch (err) {
    console.error('Get client links error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /users/me/clients — clients the user has been granted access to (client_user_access)
router.get('/me/clients', requireAuth, async (req: Request, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('client_user_access')
      .select('id, client_id, role_id, created_at, clients(id, business_name, contact_person, status)')
      .eq('user_id', req.userId!)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Get my clients supabase error:', error);
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    const roleIds = Array.from(new Set((data || []).map((a: any) => a.role_id).filter(Boolean)));
    const rolesMap: Record<string, any> = {};
    if (roleIds.length > 0) {
      const { data: roles } = await supabaseAdmin
        .from('roles')
        .select('id, name, color, is_system')
        .in('id', roleIds);
      (roles || []).forEach((r: any) => { rolesMap[r.id] = r; });
    }

    const enriched = (data || [])
      .filter((a: any) => a.clients) // filter out deleted clients
      .map((a: any) => ({
        id: a.id,
        client_id: a.client_id,
        role_id: a.role_id,
        role: a.role_id ? rolesMap[a.role_id] || null : null,
        created_at: a.created_at,
        client: a.clients,
      }));

    res.json({ success: true, data: enriched });
  } catch (err) {
    console.error('Get my clients error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /users/me/design-folders — folders from the Design Workflow profile the user can access
router.get('/me/design-folders', requireAuth, async (req: Request, res: Response) => {
  try {
    // Find the design-workflow profile id
    const { data: profile } = await supabaseAdmin
      .from('custom_profiles')
      .select('id')
      .eq('slug', 'design-workflow')
      .single();

    if (!profile) {
      res.json({ success: true, data: [] });
      return;
    }

    // Fetch all folders linked to this profile
    const { data: folders, error } = await supabaseAdmin
      .from('folders')
      .select('id, name, space_id, created_at, spaces:space_id(id, name, workspace_id)')
      .eq('profile_id', profile.id)
      .is('deleted_at', null);

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    // Filter to folders the user has access to
    const { checkResourceAccess } = await import('../middleware/permissions');
    const accessible = [];
    for (const f of folders || []) {
      const level = await checkResourceAccess(req.userId!, 'folder', f.id);
      if (level) {
        accessible.push({
          id: f.id,
          name: f.name,
          space_id: f.space_id,
          space: (f as any).spaces,
          created_at: f.created_at,
          my_access_level: level,
        });
      }
    }

    res.json({ success: true, data: accessible });
  } catch (err) {
    console.error('Get design folders error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /users/me/published-cards — published subscription cards for any client
// the user has access to (via client_user_access). Mirrors the admin list shape.
router.get('/me/published-cards', requireAuth, async (req: Request, res: Response) => {
  try {
    const stagedIds = await getStagedSubIdsForUser(req.userId!);
    if (stagedIds.length === 0) {
      res.json({ success: true, data: [] });
      return;
    }

    const { data: cards, error } = await supabaseAdmin
      .from('subscription_cards')
      .select('*')
      .in('submission_subscription_id', stagedIds)
      .eq('state', 'published')
      .is('archived_at', null)
      .order('published_at', { ascending: false });
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    const list = cards || [];
    if (list.length === 0) {
      res.json({ success: true, data: [] });
      return;
    }

    const cardStagedIds = list.map((c: any) => c.submission_subscription_id);
    const { data: stagedRows } = await supabaseAdmin
      .from('client_submission_subscriptions')
      .select('*')
      .in('id', cardStagedIds);

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

    const stagedById: Record<string, any> = {};
    (stagedRows || []).forEach((r: any) => { stagedById[r.id] = r; });
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

    const hydrated = await Promise.all(list.map(async (card: any) => {
      const staged = stagedById[card.submission_subscription_id] || null;
      const submission = staged ? submissionById[staged.submission_id] || null : null;
      const country = submission ? countryById[submission.country_id] || null : null;
      const plan = staged ? planById[staged.plan_id] || null : null;
      const subscription = staged ? subById[staged.subscription_id] || null : null;
      const planPricing = staged ? pricingByPlan[staged.plan_id] || [] : [];
      const priceForCountry = country
        ? planPricing.find((pr: any) => pr.country_id === country.id) || null
        : null;

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
      };
    }));

    res.json({ success: true, data: hydrated });
  } catch (err: any) {
    console.error('Get my published cards error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

// GET /users/me/published-cards/:cardId/recipients — same shape as admin/sales recipients,
// scoped to cards visible to the current user.
router.get('/me/published-cards/:cardId/recipients', requireAuth, async (req: Request, res: Response) => {
  try {
    const stagedIds = await getStagedSubIdsForUser(req.userId!);
    if (stagedIds.length === 0) {
      res.status(403).json({ success: false, error: 'Card not visible to you' });
      return;
    }

    const { data: card } = await supabaseAdmin
      .from('subscription_cards')
      .select('id, state, submission_subscription_id')
      .eq('id', req.params.cardId)
      .maybeSingle();
    if (!card || card.state !== 'published' || !stagedIds.includes(card.submission_subscription_id)) {
      res.status(403).json({ success: false, error: 'Card not visible to you' });
      return;
    }

    // Aggregate recipients from primary + all secondary cards.
    const allCardIds = [card.id];
    const { data: secondaries } = await supabaseAdmin
      .from('subscription_cards')
      .select('id')
      .eq('parent_card_id', card.id);
    (secondaries || []).forEach((s: any) => allCardIds.push(s.id));

    const [{ data: partnerRows }, { data: talentRows }] = await Promise.all([
      supabaseAdmin
        .from('subscription_card_recipients')
        .select('partner_id, status, responded_at, assigned_manually')
        .in('card_id', allCardIds),
      supabaseAdmin
        .from('subscription_card_external_recipients')
        .select('external_user_id, talent_name, status, responded_at, assigned_manually')
        .in('card_id', allCardIds),
    ]);

    // Deduplicate partners by partner_id, keeping best status.
    const STATUS_RANK: Record<string, number> = { accepted: 2, pending: 1, rejected: 0 };
    const partnerMap = new Map<string, any>();
    for (const r of partnerRows || []) {
      const prev = partnerMap.get(r.partner_id);
      if (!prev || (STATUS_RANK[r.status] ?? 0) > (STATUS_RANK[prev.status] ?? 0)) {
        partnerMap.set(r.partner_id, r);
      }
    }

    const partnerIds = Array.from(partnerMap.keys());
    const { data: users } = await supabaseAdmin
      .from('users')
      .select('id, display_name, email')
      .in('id', partnerIds.length ? partnerIds : ['00000000-0000-0000-0000-000000000000']);
    const userById: Record<string, any> = {};
    (users || []).forEach((u: any) => { userById[u.id] = u; });

    const partners = Array.from(partnerMap.values()).map((r: any) => {
      const u = userById[r.partner_id];
      return {
        id: r.partner_id,
        name: u?.display_name || u?.email || r.partner_id,
        status: r.status,
        responded_at: r.responded_at,
        assigned_manually: !!r.assigned_manually,
      };
    });

    // Deduplicate talents by external_user_id, keeping best status.
    const talentMap = new Map<string, any>();
    for (const r of talentRows || []) {
      const prev = talentMap.get(r.external_user_id);
      if (!prev || (STATUS_RANK[r.status] ?? 0) > (STATUS_RANK[prev.status] ?? 0)) {
        talentMap.set(r.external_user_id, r);
      }
    }
    const talents = Array.from(talentMap.values()).map((r: any) => ({
      external_user_id: r.external_user_id,
      name: r.talent_name || null,
      status: r.status,
      responded_at: r.responded_at,
      assigned_manually: !!r.assigned_manually,
    }));

    res.json({ success: true, data: { partners, talents } });
  } catch (err: any) {
    console.error('Get my published card recipients error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

export default router;
