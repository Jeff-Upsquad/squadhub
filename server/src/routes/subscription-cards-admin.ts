import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { supabaseAdmin } from '../supabase';
import { hydrateCard, matchPartnersForCard } from '../utils/subscriptionCards';
import {
  buildSquadhirePayloadForCard,
  deliverCardToSquadhire,
  notifySquadhireOfCardRecall,
  notifySquadhireOfManualAssignment,
} from '../utils/squadhireWebhook';
import { config } from '../config';

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
    const sourceParam = String(req.query.source || '').trim();
    const archivedParam = String(req.query.archived || '').trim();
    const showArchived = archivedParam === 'true';

    let query = supabaseAdmin
      .from('subscription_cards')
      .select('*')
      .is('parent_card_id', null)
      .order('published_at', { ascending: false, nullsFirst: false });

    if (showArchived) {
      query = query.not('archived_at', 'is', null);
    } else {
      query = query.is('archived_at', null);
    }

    if (stateParam === 'published' || stateParam === 'assigned' || stateParam === 'closed' || stateParam === 'draft') {
      query = query.eq('state', stateParam);
    } else if (showArchived) {
      // Archive view shows every state, including drafts.
      query = query.in('state', ['draft', 'published', 'assigned', 'closed']);
    } else {
      query = query.in('state', ['published', 'assigned', 'closed']);
    }
    if (
      sourceParam === 'request' ||
      sourceParam === 'custom' ||
      sourceParam === 'submission' ||
      sourceParam === 'shared_form' ||
      sourceParam === 'landing_page_form'
    ) {
      query = query.eq('source', sourceParam);
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
    const stagedIds = list.map((c: any) => c.submission_subscription_id).filter(Boolean);
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
      new Set((stagedRows || []).map((r: any) => r.submission_id).filter(Boolean)),
    );
    const subscriptionIds = Array.from(
      new Set((stagedRows || []).map((r: any) => r.subscription_id).filter(Boolean)),
    );
    const planIds = Array.from(
      new Set((stagedRows || []).map((r: any) => r.plan_id).filter(Boolean)),
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
        .select('id, slug, name')
        .in('id', subscriptionIds.length ? subscriptionIds : ['00000000-0000-0000-0000-000000000000']),
      supabaseAdmin
        .from('subscription_plans')
        .select('id, subscription_id, plan, tier')
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

    // Resolve plan_id for request/custom cards that aren't linked via
    // submission_subscription_id. They store service_type + plan_name on the
    // card itself; mirror AdminCardEditor's catalog lookup (slug + canonical
    // plan + first target tier) to find the matching subscription_plans row.
    const SERVICE_TYPE_TO_SLUG: Record<string, string> = {
      Designers: 'designer',
      Editors: 'video_editor',
      'Designer plus Editor': 'designer_video_editor',
    };
    const PLAN_NAME_TO_CANONICAL: Record<string, string> = {
      starter: 'Starter', basic: 'Basic', plus: 'Plus', pro: 'Pro', personal: 'Personal',
    };
    const resolveByCardId: Record<string, { slug: string; plan: string; tier: string }> = {};
    const slugsToLookup = new Set<string>();
    for (const c of list) {
      if (c.submission_subscription_id) continue;
      if (c.source !== 'request' && c.source !== 'custom' && c.source !== 'shared_form' && c.source !== 'landing_page_form') continue;
      const slug = SERVICE_TYPE_TO_SLUG[c.service_type ?? ''];
      const canonicalPlan = PLAN_NAME_TO_CANONICAL[String(c.plan_name ?? '').toLowerCase()];
      const tier = Array.isArray(c.target_tiers) ? c.target_tiers[0] : null;
      if (slug && canonicalPlan && tier) {
        resolveByCardId[c.id] = { slug, plan: canonicalPlan, tier };
        slugsToLookup.add(slug);
      }
    }

    const cardIdToResolvedPlanId: Record<string, string> = {};
    if (slugsToLookup.size > 0) {
      const { data: subRows } = await supabaseAdmin
        .from('subscriptions')
        .select('id, slug')
        .in('slug', Array.from(slugsToLookup));
      const subBySlug: Record<string, string> = {};
      (subRows || []).forEach((s: any) => { subBySlug[s.slug] = s.id; });
      const resolvedSubIds = (subRows || []).map((s: any) => s.id);
      if (resolvedSubIds.length > 0) {
        const { data: planRows } = await supabaseAdmin
          .from('subscription_plans')
          .select('id, subscription_id, plan, tier')
          .in('subscription_id', resolvedSubIds);
        const planByKey: Record<string, any> = {};
        (planRows || []).forEach((p: any) => {
          planByKey[`${p.subscription_id}|${p.plan}|${p.tier}`] = p;
          if (!planById[p.id]) planById[p.id] = p;
        });
        for (const [cardId, key] of Object.entries(resolveByCardId)) {
          const subId = subBySlug[key.slug];
          if (!subId) continue;
          const plan = planByKey[`${subId}|${key.plan}|${key.tier}`];
          if (plan) cardIdToResolvedPlanId[cardId] = plan.id;
        }
      }
    }

    // Fetch plan default deliverables (and the deliverable-type catalog needed
    // to label item rows) for every plan_id we touch — both staged and
    // request/custom-resolved.
    const allPlanIds = Array.from(new Set([
      ...planIds,
      ...Object.values(cardIdToResolvedPlanId),
    ]));
    const delivsByPlan: Record<string, any[]> = {};
    const delivTypeById: Record<string, { id: string; name: string }> = {};
    if (allPlanIds.length > 0) {
      const subscriptionIdsForDelivTypes = Array.from(new Set(
        allPlanIds.map((pid) => planById[pid]?.subscription_id).filter(Boolean) as string[],
      ));
      const [{ data: planDelivs }, { data: delivTypes }] = await Promise.all([
        supabaseAdmin
          .from('subscription_plan_deliverables')
          .select('id, plan_id, kind, deliverable_type_id, per_day, per_week, per_month, sort_order')
          .in('plan_id', allPlanIds)
          .order('sort_order'),
        subscriptionIdsForDelivTypes.length
          ? supabaseAdmin
              .from('subscription_deliverable_types')
              .select('id, name')
              .in('subscription_id', subscriptionIdsForDelivTypes)
          : Promise.resolve({ data: [] as any[] }),
      ]);
      (planDelivs || []).forEach((d: any) => {
        (delivsByPlan[d.plan_id] = delivsByPlan[d.plan_id] || []).push(d);
      });
      (delivTypes || []).forEach((t: any) => { delivTypeById[t.id] = t; });
    }

    const buildPlanDefaultDeliverables = (planId: string | null) => {
      if (!planId) return [];
      return (delivsByPlan[planId] || []).map((d: any) => ({
        id: d.id,
        kind: d.kind,
        deliverable_type_id: d.deliverable_type_id ?? null,
        deliverable_type_name: d.deliverable_type_id
          ? delivTypeById[d.deliverable_type_id]?.name ?? null
          : null,
        per_day: Number(d.per_day) || 0,
        per_week: Number(d.per_week) || 0,
        per_month: Number(d.per_month) || 0,
      }));
    };

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

      const planIdForDelivs = staged?.plan_id ?? cardIdToResolvedPlanId[card.id] ?? null;
      const planDefaults = buildPlanDefaultDeliverables(planIdForDelivs);

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
        plan_default_deliverables: planDefaults,
      };
    }));

    // Attach secondary card counts to each primary card.
    const cardIds = list.map((c: any) => c.id);
    const { data: secondaryRows } = await supabaseAdmin
      .from('subscription_cards')
      .select('parent_card_id')
      .in('parent_card_id', cardIds.length ? cardIds : ['00000000-0000-0000-0000-000000000000']);
    const secondaryCounts: Record<string, number> = {};
    (secondaryRows || []).forEach((r: any) => {
      secondaryCounts[r.parent_card_id] = (secondaryCounts[r.parent_card_id] || 0) + 1;
    });
    hydrated = hydrated.map((c: any) => ({
      ...c,
      secondary_card_count: secondaryCounts[c.id] || 0,
    }));

    if (search) {
      const needle = search.toLowerCase();
      hydrated = hydrated.filter((c: any) => {
        const businessName = (c.submission?.business_name || '').toLowerCase();
        const customerCompany = (c.customer_company || '').toLowerCase();
        return businessName.includes(needle) || customerCompany.includes(needle);
      });
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
        .select('external_user_id, talent_name, email, status, responded_at, assigned_manually, selected_at, selected_by, passed_over_at, notified_at')
        .eq('card_id', cardId),
    ]);

    const partnerIds = Array.from(new Set((partnerRows || []).map((r: any) => r.partner_id)));
    const { data: users } = await supabaseAdmin
      .from('users')
      .select('id, display_name, email, user_type')
      .in('id', partnerIds.length ? partnerIds : ['00000000-0000-0000-0000-000000000000']);
    const userById: Record<string, any> = {};
    (users || []).forEach((u: any) => { userById[u.id] = u; });

    const partners = (partnerRows || []).map((r: any) => {
      const u = userById[r.partner_id];
      return {
        id: r.partner_id,
        name: u?.display_name || u?.email || r.partner_id,
        user_type: u?.user_type ?? null,
        status: r.status,
        responded_at: r.responded_at,
        assigned_manually: !!r.assigned_manually,
        selected_at: r.selected_at ?? null,
        selected_by: r.selected_by ?? null,
        passed_over_at: r.passed_over_at ?? null,
      };
    });

    const STATUS_RANK: Record<string, number> = { accepted: 2, rejected: 1, pending: 0 };
    const talentByUser = new Map<string, any>();
    for (const r of talentRows || []) {
      const prev = talentByUser.get(r.external_user_id);
      if (!prev || (STATUS_RANK[r.status] ?? 0) > (STATUS_RANK[prev.status] ?? 0)) {
        talentByUser.set(r.external_user_id, r);
      }
    }
    const talents = Array.from(talentByUser.values()).map((r: any) => ({
      external_user_id: r.external_user_id,
      name: r.talent_name || null,
      email: r.email ?? null,
      status: r.status,
      responded_at: r.responded_at,
      assigned_manually: !!r.assigned_manually,
      selected_at: r.selected_at ?? null,
      selected_by: r.selected_by ?? null,
      passed_over_at: r.passed_over_at ?? null,
      notified_at: r.notified_at ?? null,
    }));

    res.json({ success: true, data: { partners, talents } });
  } catch (err: any) {
    console.error('Admin get card recipients error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

// ============================================================
// GET /admin/subscription-cards/:id/squadhire-recipients
// Fetch the full talent recipient list from SquadHire for this card.
// Calls SquadHire's webhook endpoint to get all broadcasted talents
// (including those who haven't responded yet).
// ============================================================
router.get('/:id/squadhire-recipients', async (req: Request, res: Response) => {
  try {
    const cardId = req.params.id as string;

    // We need the card's ID as the external_id SquadHire knows
    const { data: card } = await supabaseAdmin
      .from('subscription_cards')
      .select('id')
      .eq('id', cardId)
      .maybeSingle();
    if (!card) return res.status(404).json({ success: false, error: 'Card not found' });

    const baseUrl = config.squadhireWebhookUrl;
    if (!baseUrl || !config.squadhireWebhookSecret) {
      return res.json({ success: true, data: [], note: 'SquadHire integration not configured' });
    }

    // The webhook URL points to /api/webhooks/squadhub/cards — derive the recipients URL
    const recipientsUrl = baseUrl.replace(/\/cards\/?$/, '/cards/recipients');

    const response = await fetch(recipientsUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-SquadHub-Signature': config.squadhireWebhookSecret,
      },
      body: JSON.stringify({ external_id: cardId }),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      console.error(`SquadHire recipients fetch failed: ${response.status} ${text}`);
      return res.json({ success: true, data: [], note: `SquadHire returned ${response.status}` });
    }

    // SquadHire's response now includes `email` per talent (added in Profiles
    // 1424f61). The admin UI uses it to call /auto-accept-talent for any
    // pending row whose email matches a SquadHub user. Pass the payload
    // through unchanged.
    const result = (await response.json()) as { data?: any[] };
    res.json({ success: true, data: result.data || [] });
  } catch (err: any) {
    console.error('Admin get SquadHire recipients error:', err);
    // Non-fatal: return empty list so the UI still works
    res.json({ success: true, data: [], note: err?.message || 'Failed to reach SquadHire' });
  }
});

// ============================================================
// POST /admin/subscription-cards/:id/broadcast-pending
// Release all queued (notified_at IS NULL) talent recipients on a
// soft-published (manual) card. Always re-delivers the card payload to
// SquadHire first (idempotent on external_id) so the per-row
// notifySquadhireOfManualAssignment call won't 404 if Profiles' state has
// drifted from ours. Successful rows share a single `notified_at`
// timestamp so the UI can group them as one batch; failed rows stay
// queued for retry, and the response status reflects partial/total
// failure so the UI can surface it instead of pretending success.
// ============================================================
router.post('/:id/broadcast-pending', async (req: Request, res: Response) => {
  try {
    const cardId = req.params.id as string;

    const { data: card, error: cardErr } = await supabaseAdmin
      .from('subscription_cards')
      .select('id, state, distribution, squadhire_synced_at, squadhire_category_ids')
      .eq('id', cardId)
      .maybeSingle();
    if (cardErr) {
      res.status(500).json({ success: false, error: cardErr.message });
      return;
    }
    if (!card) {
      res.status(404).json({ success: false, error: 'Card not found' });
      return;
    }
    if (card.state !== 'published') {
      res.status(409).json({ success: false, error: 'Card must be published' });
      return;
    }
    if (card.distribution !== 'manual') {
      res.status(409).json({ success: false, error: 'This action only applies to soft-published cards' });
      return;
    }

    const { data: queued, error: qErr } = await supabaseAdmin
      .from('subscription_card_external_recipients')
      .select('id, external_user_id')
      .eq('card_id', cardId)
      .is('notified_at', null);
    if (qErr) {
      res.status(500).json({ success: false, error: qErr.message });
      return;
    }
    if (!queued || queued.length === 0) {
      res.status(409).json({ success: false, error: 'No queued talents to broadcast' });
      return;
    }

    const categoryIds = Array.isArray(card.squadhire_category_ids)
      ? (card.squadhire_category_ids as string[])
      : [];
    if (categoryIds.length === 0) {
      res.status(409).json({
        success: false,
        error: 'Card has no SquadHire categories. Add categories before broadcasting.',
      });
      return;
    }

    // Always re-deliver the card payload before notifying. The webhook is
    // idempotent on external_id, so a card already on Profiles becomes a
    // no-op upsert; a card Profiles has lost (deleted/wiped) gets re-created
    // here, preventing the manual-assignment call from 404'ing on it.
    const payload = await buildSquadhirePayloadForCard(cardId);
    if (payload) {
      await deliverCardToSquadhire(cardId, payload);
    }
    const { data: recheck } = await supabaseAdmin
      .from('subscription_cards')
      .select('squadhire_synced_at')
      .eq('id', cardId)
      .maybeSingle();
    if (!recheck?.squadhire_synced_at) {
      res.status(503).json({
        success: false,
        error: 'Card could not be synced to SquadHire. Try again in a few minutes.',
      });
      return;
    }

    const successfulIds: string[] = [];
    const failures: { talent_id: string; error: string }[] = [];
    for (const row of queued) {
      const outcome = await notifySquadhireOfManualAssignment(
        cardId,
        row.external_user_id as string,
        row.id as string,
      );
      if (outcome.delivered) {
        successfulIds.push(row.id as string);
      } else {
        failures.push({ talent_id: row.external_user_id as string, error: outcome.error || 'unknown_error' });
      }
    }

    if (successfulIds.length > 0) {
      const now = new Date().toISOString();
      const { error: updErr } = await supabaseAdmin
        .from('subscription_card_external_recipients')
        .update({ notified_at: now })
        .in('id', successfulIds);
      if (updErr) {
        // We notified SquadHire but failed to record it. Log and surface so
        // the admin knows to retry; the next call will hit duplicate-notify
        // territory but SquadHire's mirror table is idempotent on (card,
        // recipient).
        console.error('[broadcast-pending] notified rows but failed to set notified_at', updErr);
        res.status(500).json({ success: false, error: 'Notified SquadHire but failed to record state. Please retry.' });
        return;
      }
    }

    // 502 when nothing got through so the client mutation enters its error
    // state and the admin sees the actual failure instead of an apparent
    // "success" with the queue unchanged. Partial failure stays 200 with
    // the per-row breakdown so the admin can decide whether to retry.
    if (successfulIds.length === 0) {
      const firstError = failures[0]?.error || 'unknown_error';
      res.status(502).json({
        success: false,
        notified: 0,
        failed: failures.length,
        failures,
        error: `Broadcast to SquadHire failed for all ${failures.length} talent${failures.length !== 1 ? 's' : ''} (${firstError}). Please try again in a few minutes.`,
      });
      return;
    }

    res.json({
      success: true,
      notified: successfulIds.length,
      failed: failures.length,
      ...(failures.length > 0 ? { failures } : {}),
    });
  } catch (err: any) {
    console.error('Admin broadcast-pending error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

// ============================================================
// GET /admin/subscription-cards/:id/secondary-cards
// List secondary cards for a primary card, hydrated with recipient counts.
// ============================================================
router.get('/:id/secondary-cards', async (req: Request, res: Response) => {
  try {
    const parentId = req.params.id as string;

    const { data: parent } = await supabaseAdmin
      .from('subscription_cards')
      .select('id, submission_subscription_id')
      .eq('id', parentId)
      .is('parent_card_id', null)
      .maybeSingle();
    if (!parent) {
      res.status(404).json({ success: false, error: 'Primary card not found' });
      return;
    }

    const { data: secondaries, error } = await supabaseAdmin
      .from('subscription_cards')
      .select('*')
      .eq('parent_card_id', parentId)
      .order('published_at', { ascending: false });
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    const hydrated = await Promise.all(
      (secondaries || []).map((card: any) => hydrateCard(card, parentId)),
    );

    res.json({ success: true, data: hydrated });
  } catch (err: any) {
    console.error('Admin list secondary cards error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

// ============================================================
// POST /admin/subscription-cards/:id/secondary-cards
// Create and immediately publish a secondary card.
// ============================================================
const createSecondarySchema = z.object({
  partner_price_override: z.number().int().min(0).nullable().optional(),
  distribution: z.enum(['broadcast', 'manual']).default('manual'),
});

router.post('/:id/secondary-cards', async (req: Request, res: Response) => {
  try {
    const parentId = req.params.id as string;
    const parsed = createSecondarySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.errors[0].message });
      return;
    }
    const body = parsed.data;

    const { data: parent } = await supabaseAdmin
      .from('subscription_cards')
      .select('id, state, squadhire_category_ids')
      .eq('id', parentId)
      .is('parent_card_id', null)
      .maybeSingle();
    if (!parent) {
      res.status(404).json({ success: false, error: 'Primary card not found' });
      return;
    }
    if (parent.state !== 'published') {
      res.status(409).json({ success: false, error: 'Primary card must be published' });
      return;
    }

    const now = new Date().toISOString();
    const { data: secondary, error: insErr } = await supabaseAdmin
      .from('subscription_cards')
      .insert({
        parent_card_id: parentId,
        submission_subscription_id: null,
        state: 'published',
        distribution: body.distribution,
        partner_price_override: body.partner_price_override ?? null,
        published_at: now,
        published_by: (req as any).userId,
        squadhire_category_ids: parent.squadhire_category_ids || [],
      })
      .select('*')
      .single();
    if (insErr) {
      res.status(500).json({ success: false, error: insErr.message });
      return;
    }

    if (body.distribution === 'broadcast') {
      await matchPartnersForCard(secondary.id, parentId);
    }

    buildSquadhirePayloadForCard(secondary.id)
      .then((payload) => payload && deliverCardToSquadhire(secondary.id, payload))
      .catch((err) =>
        console.error('[create-secondary] squadhire delivery error', err),
      );

    const hydrated = await hydrateCard(secondary, parentId);
    res.json({ success: true, data: hydrated });
  } catch (err: any) {
    console.error('Admin create secondary card error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

// ============================================================
// POST /admin/subscription-cards/:id/close-secondary
// Close a single secondary card independently.
// ============================================================
router.post('/:id/close-secondary', async (req: Request, res: Response) => {
  try {
    const cardId = req.params.id as string;

    const { data: card } = await supabaseAdmin
      .from('subscription_cards')
      .select('id, state, parent_card_id')
      .eq('id', cardId)
      .maybeSingle();
    if (!card || !card.parent_card_id) {
      res.status(404).json({ success: false, error: 'Secondary card not found' });
      return;
    }
    if (card.state !== 'published') {
      res.status(409).json({ success: false, error: 'Card is not published' });
      return;
    }

    const now = new Date().toISOString();
    await supabaseAdmin
      .from('subscription_cards')
      .update({ state: 'closed', closed_at: now })
      .eq('id', cardId);

    buildSquadhirePayloadForCard(cardId)
      .then((payload) => payload && deliverCardToSquadhire(cardId, payload))
      .catch((err) =>
        console.error('[close-secondary] squadhire delivery error', err),
      );

    res.json({ success: true });
  } catch (err: any) {
    console.error('Admin close secondary card error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

// ============================================================
// POST /admin/subscription-cards/:id/recall
// Recall any card (primary or secondary). With acceptances the card
// becomes terminal+recalled (acceptees keep seeing it with the
// "Recalled" tag); without acceptances primary cards return to draft
// for re-publish, while secondary cards become terminal+recalled
// (no draft state for secondaries).
// ============================================================
router.post('/:id/recall', async (req: Request, res: Response) => {
  try {
    const cardId = req.params.id as string;

    const { data: card } = await supabaseAdmin
      .from('subscription_cards')
      .select('id, state, parent_card_id')
      .eq('id', cardId)
      .maybeSingle();
    if (!card) {
      res.status(404).json({ success: false, error: 'Card not found' });
      return;
    }
    if (card.state !== 'published') {
      res.status(409).json({ success: false, error: 'Only published cards can be recalled' });
      return;
    }

    const [{ count: acceptedPartners }, { count: acceptedTalents }] = await Promise.all([
      supabaseAdmin
        .from('subscription_card_recipients')
        .select('id', { count: 'exact', head: true })
        .eq('card_id', cardId)
        .eq('status', 'accepted'),
      supabaseAdmin
        .from('subscription_card_external_recipients')
        .select('id', { count: 'exact', head: true })
        .eq('card_id', cardId)
        .eq('status', 'accepted'),
    ]);
    const hasAcceptances = (acceptedPartners || 0) + (acceptedTalents || 0) > 0;
    const isSecondary = !!card.parent_card_id;

    // Drop only pending recipients.
    await supabaseAdmin
      .from('subscription_card_recipients')
      .delete()
      .eq('card_id', cardId)
      .eq('status', 'pending');
    await supabaseAdmin
      .from('subscription_card_external_recipients')
      .delete()
      .eq('card_id', cardId)
      .eq('status', 'pending');

    const now = new Date().toISOString();
    // Primary, no acceptances → draft (re-publishable from sales side).
    // Secondary, no acceptances → closed (no draft state for secondaries).
    // Either, with acceptances → closed + recalled_at (acceptees keep
    // seeing it with the "Recalled" tag).
    let updatePayload: Record<string, unknown>;
    if (!hasAcceptances && !isSecondary) {
      updatePayload = {
        state: 'draft' as const,
        published_at: null,
        published_by: null,
        squadhire_synced_at: null,
        squadhire_sync_attempts: 0,
        squadhire_sync_last_error: null,
      };
    } else {
      updatePayload = {
        state: 'closed' as const,
        closed_at: now,
        squadhire_synced_at: null,
        squadhire_sync_attempts: 0,
        squadhire_sync_last_error: null,
      };
      if (hasAcceptances) {
        updatePayload.recalled_at = now;
      }
    }

    const { data: updated, error: updErr } = await supabaseAdmin
      .from('subscription_cards')
      .update(updatePayload)
      .eq('id', cardId)
      .select('*')
      .single();
    if (updErr) {
      res.status(500).json({ success: false, error: updErr.message });
      return;
    }

    // Re-deliver card to SquadHire with the new state (and recalled_at if set).
    buildSquadhirePayloadForCard(updated.id)
      .then((payload) => payload && deliverCardToSquadhire(updated.id, payload))
      .catch((err) => console.error('[admin-recall] squadhire delivery error', err));

    // Only drop SquadHire mirror rows on a clean recall (no acceptances).
    if (!hasAcceptances) {
      notifySquadhireOfCardRecall(updated.id).catch((err) => {
        console.error('[admin-recall] squadhire recall notification error', err);
      });
    }

    // Cascade-close published secondaries when a primary card is recalled.
    if (!isSecondary) {
      const { data: secondaries } = await supabaseAdmin
        .from('subscription_cards')
        .select('id')
        .eq('parent_card_id', cardId)
        .eq('state', 'published');

      if (secondaries && secondaries.length > 0) {
        await supabaseAdmin
          .from('subscription_cards')
          .update({
            state: 'closed',
            closed_at: now,
            squadhire_synced_at: null,
            squadhire_sync_attempts: 0,
            squadhire_sync_last_error: null,
          })
          .eq('parent_card_id', cardId)
          .eq('state', 'published');

        for (const s of secondaries) {
          buildSquadhirePayloadForCard(s.id)
            .then((payload) => payload && deliverCardToSquadhire(s.id, payload))
            .catch((err) =>
              console.error('[admin-recall] cascade squadhire delivery error', err),
            );
        }
      }
    }

    res.json({ success: true, data: await hydrateCard(updated) });
  } catch (err: any) {
    console.error('Admin recall card error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

// ============================================================
// POST /admin/subscription-cards/:id/cancel
// Terminal cancel for a published card. Mirrors recall's flow
// (drop pending recipients, cascade to published secondaries,
// re-deliver to SquadHire) but always closes — no draft return
// path. Acceptees keep seeing the card with a "Cancelled" tag.
// ============================================================
router.post('/:id/cancel', async (req: Request, res: Response) => {
  try {
    const cardId = req.params.id as string;

    const { data: card } = await supabaseAdmin
      .from('subscription_cards')
      .select('id, state, parent_card_id')
      .eq('id', cardId)
      .maybeSingle();
    if (!card) {
      res.status(404).json({ success: false, error: 'Card not found' });
      return;
    }
    if (card.state !== 'published') {
      res.status(409).json({ success: false, error: 'Only published cards can be cancelled' });
      return;
    }

    const [{ count: acceptedPartners }, { count: acceptedTalents }] = await Promise.all([
      supabaseAdmin
        .from('subscription_card_recipients')
        .select('id', { count: 'exact', head: true })
        .eq('card_id', cardId)
        .eq('status', 'accepted'),
      supabaseAdmin
        .from('subscription_card_external_recipients')
        .select('id', { count: 'exact', head: true })
        .eq('card_id', cardId)
        .eq('status', 'accepted'),
    ]);
    const hasAcceptances = (acceptedPartners || 0) + (acceptedTalents || 0) > 0;
    const isSecondary = !!card.parent_card_id;

    // Drop only pending recipients (same as recall).
    await supabaseAdmin
      .from('subscription_card_recipients')
      .delete()
      .eq('card_id', cardId)
      .eq('status', 'pending');
    await supabaseAdmin
      .from('subscription_card_external_recipients')
      .delete()
      .eq('card_id', cardId)
      .eq('status', 'pending');

    const now = new Date().toISOString();
    const { data: updated, error: updErr } = await supabaseAdmin
      .from('subscription_cards')
      .update({
        state: 'closed' as const,
        closed_at: now,
        cancelled_at: now,
        squadhire_synced_at: null,
        squadhire_sync_attempts: 0,
        squadhire_sync_last_error: null,
      })
      .eq('id', cardId)
      .select('*')
      .single();
    if (updErr) {
      res.status(500).json({ success: false, error: updErr.message });
      return;
    }

    // Re-deliver card to SquadHire with the new state (and cancelled_at).
    buildSquadhirePayloadForCard(updated.id)
      .then((payload) => payload && deliverCardToSquadhire(updated.id, payload))
      .catch((err) => console.error('[admin-cancel] squadhire delivery error', err));

    // Only drop SquadHire mirror rows on a clean cancel (no acceptances).
    if (!hasAcceptances) {
      notifySquadhireOfCardRecall(updated.id).catch((err) => {
        console.error('[admin-cancel] squadhire recall notification error', err);
      });
    }

    // Cascade-cancel published secondaries when a primary card is cancelled.
    if (!isSecondary) {
      const { data: secondaries } = await supabaseAdmin
        .from('subscription_cards')
        .select('id')
        .eq('parent_card_id', cardId)
        .eq('state', 'published');

      if (secondaries && secondaries.length > 0) {
        await supabaseAdmin
          .from('subscription_cards')
          .update({
            state: 'closed',
            closed_at: now,
            cancelled_at: now,
            squadhire_synced_at: null,
            squadhire_sync_attempts: 0,
            squadhire_sync_last_error: null,
          })
          .eq('parent_card_id', cardId)
          .eq('state', 'published');

        for (const s of secondaries) {
          buildSquadhirePayloadForCard(s.id)
            .then((payload) => payload && deliverCardToSquadhire(s.id, payload))
            .catch((err) =>
              console.error('[admin-cancel] cascade squadhire delivery error', err),
            );
        }
      }
    }

    res.json({ success: true, data: await hydrateCard(updated) });
  } catch (err: any) {
    console.error('Admin cancel card error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

// ============================================================
// POST /admin/subscription-cards/:id/archive
// Soft-hide any card. Sets archived_at; the card stops appearing
// in the default Published Cards list and is dropped from talent
// feeds. State is preserved so we can describe what was archived
// in the Archive tab; republish/delete-permanent decide its fate.
// ============================================================
router.post('/:id/archive', async (req: Request, res: Response) => {
  try {
    const cardId = req.params.id as string;

    const { data: card } = await supabaseAdmin
      .from('subscription_cards')
      .select('id, archived_at')
      .eq('id', cardId)
      .maybeSingle();
    if (!card) {
      res.status(404).json({ success: false, error: 'Card not found' });
      return;
    }
    if (card.archived_at) {
      res.status(409).json({ success: false, error: 'Card is already archived' });
      return;
    }

    const now = new Date().toISOString();
    const { data: updated, error: updErr } = await supabaseAdmin
      .from('subscription_cards')
      .update({
        archived_at: now,
        squadhire_synced_at: null,
        squadhire_sync_attempts: 0,
        squadhire_sync_last_error: null,
      })
      .eq('id', cardId)
      .select('*')
      .single();
    if (updErr) {
      res.status(500).json({ success: false, error: updErr.message });
      return;
    }

    // Re-deliver to SquadHire so its local copy picks up archived_at
    // and flips status='archived'. Without this, the card stays visible
    // on the SquadHire business dashboard and in accepted talents'
    // Responded tab — the recall notification only drops pending
    // mirror rows, not the card itself.
    buildSquadhirePayloadForCard(updated.id)
      .then((payload) => payload && deliverCardToSquadhire(updated.id, payload))
      .catch((err) => console.error('[admin-archive] squadhire delivery error', err));

    // Drop SquadHire's mirror recipient rows so a future republish
    // doesn't re-surface stale pending offers to the same talents.
    notifySquadhireOfCardRecall(updated.id).catch((err) => {
      console.error('[admin-archive] squadhire mirror drop error', err);
    });

    res.json({ success: true, data: await hydrateCard(updated) });
  } catch (err: any) {
    console.error('Admin archive card error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

// ============================================================
// POST /admin/subscription-cards/:id/republish
// Bring an archived card back as a fresh manual-published card.
// Clears every recipient row (both partner + external), wipes
// closure timestamps, sets state='published' + distribution='manual'
// + archived_at=null, sets published_at/published_by to now/caller,
// and re-delivers to SquadHire. The user must explicitly broadcast
// or hand-pick from there.
// ============================================================
router.post('/:id/republish', async (req: Request, res: Response) => {
  try {
    const cardId = req.params.id as string;

    const { data: card } = await supabaseAdmin
      .from('subscription_cards')
      .select('id, archived_at')
      .eq('id', cardId)
      .maybeSingle();
    if (!card) {
      res.status(404).json({ success: false, error: 'Card not found' });
      return;
    }
    if (!card.archived_at) {
      res.status(409).json({ success: false, error: 'Only archived cards can be republished' });
      return;
    }

    // Wipe every recipient row from both tables.
    await supabaseAdmin
      .from('subscription_card_recipients')
      .delete()
      .eq('card_id', cardId);
    await supabaseAdmin
      .from('subscription_card_external_recipients')
      .delete()
      .eq('card_id', cardId);

    const now = new Date().toISOString();
    const { data: updated, error: updErr } = await supabaseAdmin
      .from('subscription_cards')
      .update({
        state: 'published' as const,
        distribution: 'manual' as const,
        archived_at: null,
        recalled_at: null,
        cancelled_at: null,
        closed_at: null,
        assigned_at: null,
        selected_recipient_type: null,
        selected_recipient_id: null,
        published_at: now,
        published_by: req.userId || null,
        squadhire_synced_at: null,
        squadhire_sync_attempts: 0,
        squadhire_sync_last_error: null,
      })
      .eq('id', cardId)
      .select('*')
      .single();
    if (updErr) {
      res.status(500).json({ success: false, error: updErr.message });
      return;
    }

    // Drop any leftover SquadHire mirror rows, then re-deliver fresh.
    notifySquadhireOfCardRecall(updated.id)
      .catch((err) => console.error('[admin-republish] squadhire mirror drop error', err))
      .finally(() => {
        buildSquadhirePayloadForCard(updated.id)
          .then((payload) => payload && deliverCardToSquadhire(updated.id, payload))
          .catch((err) => console.error('[admin-republish] squadhire delivery error', err));
      });

    res.json({ success: true, data: await hydrateCard(updated) });
  } catch (err: any) {
    console.error('Admin republish card error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

// ============================================================
// DELETE /admin/subscription-cards/:id
// Permanently delete a draft or archived card. Recipients
// (partner + external) and secondaries cascade-delete via FK.
// Notifies SquadHire to drop its mirrors. Drafts have never been
// broadcast; archived cards have already been recalled — both are
// safe to remove without racing active-card flows.
// ============================================================
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const cardId = req.params.id as string;

    const { data: card } = await supabaseAdmin
      .from('subscription_cards')
      .select('id, state, archived_at')
      .eq('id', cardId)
      .maybeSingle();
    if (!card) {
      res.status(404).json({ success: false, error: 'Card not found' });
      return;
    }
    if (!card.archived_at && card.state !== 'draft') {
      res.status(409).json({ success: false, error: 'Only draft or archived cards can be deleted permanently. Archive it first.' });
      return;
    }

    // Drop SquadHire mirror rows before we lose the card row.
    notifySquadhireOfCardRecall(cardId).catch((err) => {
      console.error('[admin-delete-card] squadhire mirror drop error', err);
    });

    const { error: delErr } = await supabaseAdmin
      .from('subscription_cards')
      .delete()
      .eq('id', cardId);
    if (delErr) {
      res.status(500).json({ success: false, error: delErr.message });
      return;
    }

    res.json({ success: true });
  } catch (err: any) {
    console.error('Admin delete card error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

// ============================================================
// POST /admin/subscription-cards/:id/mark-reviewed
// Stamps admin_reviewed_at so the "NEW" badge clears for this card.
// Idempotent — calling twice just refreshes the timestamp.
// The DB trigger resets admin_reviewed_at whenever selected_recipient_id
// changes, so a fresh selection re-opens the NEW badge automatically.
// ============================================================
router.post('/:id/mark-reviewed', async (req: Request, res: Response) => {
  try {
    const cardId = req.params.id as string;
    const { data: updated, error } = await supabaseAdmin
      .from('subscription_cards')
      .update({ admin_reviewed_at: new Date().toISOString() })
      .eq('id', cardId)
      .select('id, admin_reviewed_at')
      .maybeSingle();
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    if (!updated) {
      res.status(404).json({ success: false, error: 'Card not found' });
      return;
    }
    res.json({ success: true, data: updated });
  } catch (err: any) {
    console.error('Mark reviewed error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

export default router;
