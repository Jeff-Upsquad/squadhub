import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requireMiniAppOrAdmin } from '../middleware/miniApp';
import { supabaseAdmin } from '../supabase';
import {
  hydrateCard,
  hydrateCardsBatch,
  matchPartnersForCard,
  reunifyTierGroupToDraft,
} from '../utils/subscriptionCards';
import {
  buildSquadhirePayloadForCard,
  deliverCardToSquadhire,
  fetchSquadhireRecipients,
  previewSquadhireMatches,
  notifySquadhireOfCardRecall,
  notifySquadhireOfManualAssignment,
  notifySquadhireOfManualRemoval,
} from '../utils/squadhireWebhook';
import { endActiveAssignmentTermsForCard } from '../utils/assignmentTerms';
import { handOffSpaceToNewTalent } from '../utils/spaceTalentHandoff';
import {
  syncClientSubscriptionForCard,
  type CardActor,
  type CardLifecycleResult,
} from '../utils/clientCardLink';
import {
  attachSubmissionToExistingClient,
  findExistingClientForSubmission,
  transitionSubmissionStatus,
} from '../utils/submissionPipeline';
import { logCardEvent } from '../utils/cardEvents';
import { copyCardToNewDraft } from '../utils/duplicateCard';

const router = Router();

router.use(requireAuth);
// Internal admins, plus anyone granted the Leads mini app — the web app
// renders these same modules for the team (see migration 164).
router.use(requireMiniAppOrAdmin('leads'));

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
    const submissionIdParam = String(req.query.submission_id || '').trim();
    const cardIdParam = String(req.query.card_id || '').trim();
    // Product-line filter for the separate admin modules: 'assignment' shows
    // only freelance assignment cards; 'subscription' excludes them (the
    // Subscription Cards module). Absent = all types (back-compat).
    const cardTypeParam = String(req.query.card_type || '').trim();

    let query = supabaseAdmin
      .from('subscription_cards')
      .select('*')
      .is('parent_card_id', null)
      // Soft-deleted cards live in the admin Trash, not in any card list.
      .is('deleted_at', null)
      .order('published_at', { ascending: false, nullsFirst: false });

    if (showArchived) {
      query = query.not('archived_at', 'is', null);
    } else {
      query = query.is('archived_at', null);
    }

    // `state` accepts a single value or a comma-separated list (e.g.
    // 'new,draft' for the New Deals queue). Unknown values are dropped.
    const VALID_STATES = ['new', 'draft', 'published', 'assigned', 'closed'];
    const requestedStates = stateParam
      ? stateParam.split(',').map((s) => s.trim()).filter((s) => VALID_STATES.includes(s))
      : [];
    if (requestedStates.length === 1) {
      query = query.eq('state', requestedStates[0]);
    } else if (requestedStates.length > 1) {
      query = query.in('state', requestedStates);
    } else if (showArchived) {
      // Archive view shows every state, including new/draft.
      query = query.in('state', ['new', 'draft', 'published', 'assigned', 'closed']);
    } else {
      query = query.in('state', ['published', 'assigned', 'closed']);
    }
    if (
      sourceParam === 'request' ||
      sourceParam === 'custom' ||
      sourceParam === 'submission' ||
      sourceParam === 'shared_form' ||
      sourceParam === 'landing_page_form' ||
      sourceParam === 'internal_brief'
    ) {
      query = query.eq('source', sourceParam);
    }
    if (publishedBy) query = query.eq('published_by', publishedBy);

    // Product-line scoping for the separate admin modules.
    if (cardTypeParam === 'assignment') {
      query = query.eq('card_type', 'assignment');
    } else if (cardTypeParam === 'subscription') {
      query = query.neq('card_type', 'assignment');
    }

    // Scope to a single lead's cards. The Contact detail panel calls this to
    // list every card associated with a submission via any of the known
    // linking paths:
    //   0. lead_submission_id — Stage B direct FK (preferred).
    //   1. submission_subscription_id — staged subscription path.
    //   2. customer_email — legacy request/shared_form cards.
    //   3. customer_phone (digit suffix) — same for phone-led leads.
    if (submissionIdParam) {
      const { data: leadRow } = await supabaseAdmin
        .from('client_submissions')
        .select('email, contact_number')
        .eq('id', submissionIdParam)
        .maybeSingle();

      const { data: stagedForSubmission } = await supabaseAdmin
        .from('client_submission_subscriptions')
        .select('id')
        .eq('submission_id', submissionIdParam);
      const allowedStagedIds = (stagedForSubmission || []).map((r: any) => r.id);

      const matchingCardIds = new Set<string>();
      const phoneDigits = leadRow?.contact_number
        ? String(leadRow.contact_number).replace(/\D/g, '')
        : '';
      const phoneSuffix = phoneDigits.length >= 7 ? phoneDigits : '';

      const [byDirect, byStaged, byEmail, byPhone] = await Promise.all([
        supabaseAdmin
          .from('subscription_cards')
          .select('id')
          .eq('lead_submission_id', submissionIdParam),
        allowedStagedIds.length > 0
          ? supabaseAdmin
              .from('subscription_cards')
              .select('id')
              .in('submission_subscription_id', allowedStagedIds)
          : Promise.resolve({ data: [] as { id: string }[] }),
        leadRow?.email
          ? supabaseAdmin
              .from('subscription_cards')
              .select('id')
              .ilike('customer_email', leadRow.email.trim())
          : Promise.resolve({ data: [] as { id: string }[] }),
        phoneSuffix
          ? supabaseAdmin
              .from('subscription_cards')
              .select('id')
              .ilike('customer_phone', `%${phoneSuffix}`)
          : Promise.resolve({ data: [] as { id: string }[] }),
      ]);
      (byDirect.data || []).forEach((r: any) => matchingCardIds.add(r.id));
      (byStaged.data || []).forEach((r: any) => matchingCardIds.add(r.id));
      (byEmail.data || []).forEach((r: any) => matchingCardIds.add(r.id));
      (byPhone.data || []).forEach((r: any) => matchingCardIds.add(r.id));

      if (matchingCardIds.size === 0) {
        res.json({ success: true, data: [] });
        return;
      }
      query = query.in('id', Array.from(matchingCardIds));
    }

    // When a specific card_id is requested (e.g., from ?card= in URL),
    // force-include it regardless of state/archive/parent filters so the
    // frontend can open the detail panel for any card state.
    let forceCard: any = null;
    if (cardIdParam) {
      const { data: fc } = await supabaseAdmin
        .from('subscription_cards')
        .select('*')
        .eq('id', cardIdParam)
        .maybeSingle();
      if (fc) forceCard = fc;
    }

    const { data: cards, error } = await query;
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    const list = cards || [];
    if (forceCard && !list.some((c: any) => c.id === forceCard.id)) {
      list.push(forceCard);
    }
    if (list.length === 0) {
      res.json({ success: true, data: [] });
      return;
    }

    // Hydrate the related rows in batches (one query per relation, not N+1).
    const stagedIds = list.map((c: any) => c.submission_subscription_id).filter(Boolean);
    // Users referenced by cards: who published, who filled out the brief
    // (created_by), and who verified a client-submitted brief (verified_by).
    const userIds = Array.from(
      new Set(
        list
          .flatMap((c: any) => [c.published_by, c.created_by, c.verified_by])
          .filter(Boolean),
      ),
    );

    const [{ data: stagedRows }, { data: cardUsers }] = await Promise.all([
      supabaseAdmin
        .from('client_submission_subscriptions')
        .select('*')
        .in('id', stagedIds.length ? stagedIds : ['00000000-0000-0000-0000-000000000000']),
      userIds.length
        ? supabaseAdmin
            .from('users')
            .select('id, display_name, email')
            .in('id', userIds)
        : Promise.resolve({ data: [] as any[] }),
    ]);

    const stagedById: Record<string, any> = {};
    (stagedRows || []).forEach((r: any) => { stagedById[r.id] = r; });
    const userById: Record<string, any> = {};
    (cardUsers || []).forEach((u: any) => { userById[u.id] = u; });

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
        .select('plan_id, country_id, price, margin_value, margin_type')
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
      if (c.source !== 'request' && c.source !== 'custom' && c.source !== 'shared_form' && c.source !== 'landing_page_form' && c.source !== 'internal_brief') continue;
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

    // Hydrate target countries/regions + recipient counts for the WHOLE list in
    // 4 queries (not 4 per card). All rows here are primary cards
    // (parent_card_id IS NULL), so batch hydration is valid — see hydrateCardsBatch.
    const batchHydrated = await hydrateCardsBatch(list);

    let hydrated = list.map((card: any) => {
      const staged = stagedById[card.submission_subscription_id] || null;
      const submission = staged ? submissionById[staged.submission_id] || null : null;
      const country = submission ? countryById[submission.country_id] || null : null;
      const plan = staged ? planById[staged.plan_id] || null : null;
      const subscription = staged ? subById[staged.subscription_id] || null : null;
      const publisher = card.published_by ? userById[card.published_by] || null : null;
      const creator = card.created_by ? userById[card.created_by] || null : null;
      const verifier = card.verified_by ? userById[card.verified_by] || null : null;

      // Frozen plan-side data wins over live reads. Populated at publish
      // time and cleared on recall — see utils/cardPlanSnapshot.ts.
      const snap =
        card.plan_snapshot && typeof card.plan_snapshot === 'object'
          ? (card.plan_snapshot as any)
          : null;

      let planDefaults: any[];
      if (snap?.deliverables) {
        planDefaults = (snap.deliverables as any[]).map((d) => ({
          id: d.id,
          kind: d.kind,
          deliverable_type_id: d.deliverable_type_id ?? null,
          deliverable_type_name: d.deliverable_type_name ?? null,
          per_day: Number(d.per_day) || 0,
          per_week: Number(d.per_week) || 0,
          per_month: Number(d.per_month) || 0,
        }));
      } else {
        const planIdForDelivs = staged?.plan_id ?? cardIdToResolvedPlanId[card.id] ?? null;
        planDefaults = buildPlanDefaultDeliverables(planIdForDelivs);
      }

      let priceForCountry: any = null;
      if (snap?.pricing && country) {
        const row = (snap.pricing as any[]).find((pr) => pr.country_id === country.id);
        if (row) priceForCountry = { ...row, plan_id: snap.plan?.id ?? staged?.plan_id ?? null };
      } else {
        const planPricing = staged ? pricingByPlan[staged.plan_id] || [] : [];
        priceForCountry = country
          ? planPricing.find((pr: any) => pr.country_id === country.id) || null
          : null;
      }

      // Hours come from the snapshot too. We keep plan name/tier live since
      // they rarely change and the admin column wants the current label.
      const planWithFrozenHours = plan
        ? snap?.plan
          ? { ...plan, daily_hours: snap.plan.daily_hours, weekly_hours: snap.plan.weekly_hours }
          : plan
        : null;

      const base = batchHydrated.get(card.id) ?? {};
      return {
        ...card,
        ...base,
        submission: submission ? { ...submission, country } : null,
        submission_subscription: staged
          ? {
              ...staged,
              subscription,
              plan: planWithFrozenHours
                ? {
                    ...planWithFrozenHours,
                    pricing: priceForCountry ? [{ ...priceForCountry, country }] : [],
                  }
                : null,
            }
          : null,
        published_by_user: publisher
          ? { id: publisher.id, display_name: publisher.display_name, email: publisher.email }
          : null,
        created_by_user: creator
          ? { id: creator.id, display_name: creator.display_name, email: creator.email }
          : null,
        verified_by_user: verifier
          ? { id: verifier.id, display_name: verifier.display_name, email: verifier.email }
          : null,
        plan_default_deliverables: planDefaults,
      };
    });

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
        // Match the same fields the list UI shows as the business name:
        // submission.business_name || brand_name (cards from shared_form /
        // request / custom have no linked submission, only brand_name), plus
        // the legacy customer_company. Missing brand_name here made those
        // cards render but stay invisible to search.
        const businessName = (c.submission?.business_name || '').toLowerCase();
        const brandName = (c.brand_name || '').toLowerCase();
        const customerCompany = (c.customer_company || '').toLowerCase();
        return (
          businessName.includes(needle) ||
          brandName.includes(needle) ||
          customerCompany.includes(needle)
        );
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
        .eq('card_id', cardId)
        .is('archived_at', null),
      supabaseAdmin
        .from('subscription_card_external_recipients')
        .select('external_user_id, talent_name, email, status, responded_at, assigned_manually, selected_at, selected_by, passed_over_at, notified_at')
        .eq('card_id', cardId)
        .is('archived_at', null),
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

interface MatchPreviewCard {
  id: string;
  state: string | null;
  distribution: string | null;
  squadhire_synced_at: string | null;
  squadhire_match_preview: SquadhireMatchPreviewCache | null;
}

interface SquadhireMatchPreviewCache {
  count: number;
  talents: Array<{ talent_user_id: string; talent_name: string }>;
  computed_at: string;
}

// Return the cached preview, or compute+store it, for a published broadcast
// card that hasn't been broadcast yet. Returns null for any other card (manual,
// draft, already-broadcast) — those show the real recipient list instead.
// `force` recomputes even when a cache exists (Refresh action).
async function getOrComputeMatchPreview(
  card: MatchPreviewCard,
  force = false,
): Promise<SquadhireMatchPreviewCache | null> {
  const eligible =
    card.state === 'published' &&
    card.distribution !== 'manual' &&
    !card.squadhire_synced_at;
  if (!eligible) return card.squadhire_match_preview ?? null;

  if (!force && card.squadhire_match_preview) return card.squadhire_match_preview;

  const preview = await previewSquadhireMatches(card.id);
  const cache: SquadhireMatchPreviewCache = {
    count: preview.count,
    talents: preview.talents,
    computed_at: new Date().toISOString(),
  };
  const { error } = await supabaseAdmin
    .from('subscription_cards')
    .update({ squadhire_match_preview: cache })
    .eq('id', card.id);
  if (error) console.error('[match-preview] failed to cache preview', error);
  return cache;
}

router.get('/:id/squadhire-recipients', async (req: Request, res: Response) => {
  try {
    const cardId = req.params.id as string;

    // We need the card's ID as the external_id SquadHire knows
    const { data: card } = await supabaseAdmin
      .from('subscription_cards')
      .select('id, state, distribution, squadhire_synced_at, squadhire_match_preview')
      .eq('id', cardId)
      .maybeSingle();
    if (!card) return res.status(404).json({ success: false, error: 'Card not found' });

    // SquadHire's response includes `email` per talent (added in Profiles
    // 1424f61). The admin UI uses it to call /auto-accept-talent for any
    // pending row whose email matches a SquadHub user. fetchSquadhireRecipients
    // soft-fails to [] when unconfigured/unreachable so the UI still works.
    const data = await fetchSquadhireRecipients(cardId);

    // For a published broadcast card that hasn't been broadcast yet, show a
    // read-only "who would match" preview. Compute lazily on first view and
    // cache it; a Refresh action recomputes. Never notifies or writes recipients.
    const match_preview = await getOrComputeMatchPreview(card as MatchPreviewCard);

    res.json({ success: true, data, match_preview });
  } catch (err: any) {
    console.error('Admin get SquadHire recipients error:', err);
    // Non-fatal: return empty list so the UI still works
    res.json({ success: true, data: [], note: err?.message || 'Failed to reach SquadHire' });
  }
});

// ============================================================
// POST /admin/subscription-cards/:id/refresh-matches
// Force-recompute the read-only match preview for a published broadcast card.
// Backs the "Refresh" button on the recipients view. No-op-safe on cards that
// aren't published broadcast cards (returns whatever preview is stored).
// ============================================================
router.post('/:id/refresh-matches', async (req: Request, res: Response) => {
  try {
    const cardId = req.params.id as string;
    const { data: card } = await supabaseAdmin
      .from('subscription_cards')
      .select('id, state, distribution, squadhire_synced_at, squadhire_match_preview')
      .eq('id', cardId)
      .maybeSingle();
    if (!card) return res.status(404).json({ success: false, error: 'Card not found' });

    const match_preview = await getOrComputeMatchPreview(card as MatchPreviewCard, true);
    res.json({ success: true, match_preview });
  } catch (err: any) {
    console.error('Admin refresh matches error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Failed to refresh matches' });
  }
});

// ============================================================
// Ensure a local recipient row exists for every talent SquadHire has matched
// to this card but that we haven't recorded yet. Soft-published cards live on
// SquadHire as matched candidates with no local row until they respond or are
// broadcast; this materializes the pending ones as queued (notified_at NULL,
// not hand-picked) rows so the broadcast release can notify them and the UI can
// later move them into a "Sent" batch. Already-known talents (responded, or
// previously released) are skipped via the (card, system, recipient) conflict
// key. Soft-failing: if SquadHire is unreachable the match list comes back
// empty and we simply fall back to whatever local rows already exist.
// ============================================================
async function materializeSquadhireMatchesAsQueued(cardId: string): Promise<void> {
  const matches = await fetchSquadhireRecipients(cardId);
  const pendingMatches = matches.filter((m) => m.status === 'pending');
  if (pendingMatches.length === 0) return;

  const { data: existing } = await supabaseAdmin
    .from('subscription_card_external_recipients')
    .select('external_user_id')
    .eq('card_id', cardId);
  const known = new Set((existing || []).map((r: any) => r.external_user_id as string));

  const rows = pendingMatches
    .filter((m) => !known.has(m.talent_user_id))
    .map((m) => ({
      card_id: cardId,
      external_system: 'squadhire',
      external_recipient_id: m.talent_user_id,
      external_user_id: m.talent_user_id,
      talent_name: m.talent_name ?? null,
      email: m.email ?? null,
      status: 'pending' as const,
      responded_at: null,
      assigned_manually: false,
      notified_at: null,
    }));
  if (rows.length === 0) return;

  const { error } = await supabaseAdmin
    .from('subscription_card_external_recipients')
    .upsert(rows, { onConflict: 'card_id,external_system,external_recipient_id', ignoreDuplicates: true });
  if (error) {
    console.error('[broadcast] failed to materialize SquadHire matches as queued rows', error);
  }
}

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

    // The queue the admin sees under "Pending Broadcast" is the union of locally
    // hand-picked rows (assign-talent, notified_at NULL) AND talents SquadHire
    // matched to the card by category — which have NO local row until they
    // respond or are broadcast. Materialize those matches as queued rows so the
    // release below notifies them too. Without this, a soft-published card whose
    // queue is entirely SquadHire-side matches shows N in the UI but finds 0
    // here ("No queued talents to broadcast"). Runs after the sync recheck so
    // SquadHire definitely has the card before we ask it for its match list.
    await materializeSquadhireMatchesAsQueued(cardId);

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
// Release queued (notified_at IS NULL) hand-picked talents to SquadHire for a
// soft-published (manual) card. Self-contained, soft-failing variant used by
// the unified /broadcast-now action: an empty queue is a no-op (notified: 0),
// not an error, because the admin may be broadcasting partners only.
// ============================================================
async function releaseQueuedTalentsSoft(
  cardId: string,
): Promise<{ notified: number; failed: number; failures: { talent_id: string; error: string }[]; sync_error?: string }> {
  const { data: queued } = await supabaseAdmin
    .from('subscription_card_external_recipients')
    .select('id, external_user_id')
    .eq('card_id', cardId)
    .is('notified_at', null);
  if (!queued || queued.length === 0) {
    return { notified: 0, failed: 0, failures: [] };
  }

  const { data: card } = await supabaseAdmin
    .from('subscription_cards')
    .select('squadhire_category_ids')
    .eq('id', cardId)
    .maybeSingle();
  const categoryIds = Array.isArray(card?.squadhire_category_ids)
    ? (card!.squadhire_category_ids as string[])
    : [];
  const failAll = (error: string, sync_error: string) => ({
    notified: 0,
    failed: queued.length,
    failures: queued.map((q) => ({ talent_id: q.external_user_id as string, error })),
    sync_error,
  });
  if (categoryIds.length === 0) {
    return failAll('no_squadhire_categories', 'Card has no SquadHire categories. Add categories before broadcasting.');
  }

  // Re-deliver the card payload first (idempotent on external_id) so the
  // per-row notify can't 404 if SquadHire's mirror has drifted.
  const payload = await buildSquadhirePayloadForCard(cardId);
  if (payload) await deliverCardToSquadhire(cardId, payload);
  const { data: recheck } = await supabaseAdmin
    .from('subscription_cards')
    .select('squadhire_synced_at')
    .eq('id', cardId)
    .maybeSingle();
  if (!recheck?.squadhire_synced_at) {
    return failAll('squadhire_sync_failed', 'Card could not be synced to SquadHire. Try again in a few minutes.');
  }

  const successfulIds: string[] = [];
  const failures: { talent_id: string; error: string }[] = [];
  for (const row of queued) {
    const outcome = await notifySquadhireOfManualAssignment(
      cardId,
      row.external_user_id as string,
      row.id as string,
    );
    if (outcome.delivered) successfulIds.push(row.id as string);
    else failures.push({ talent_id: row.external_user_id as string, error: outcome.error || 'unknown_error' });
  }
  if (successfulIds.length > 0) {
    await supabaseAdmin
      .from('subscription_card_external_recipients')
      .update({ notified_at: new Date().toISOString() })
      .in('id', successfulIds);
  }
  return { notified: successfulIds.length, failed: failures.length, failures };
}

// ============================================================
// POST /admin/subscription-cards/:id/broadcast-now
// The unified "Broadcast" action for the New Deal pipeline. Publishing only
// builds a staged recipient list; THIS sends it:
//   • Partners — release every staged row (broadcast_at = now) so it surfaces
//     in the partner opportunities feed.
//   • Talents —
//       broadcast mode: deliver the card to SquadHire, which matches + notifies
//         every qualifying talent.
//       manual (soft-publish): notify only the hand-picked queued talents,
//         leaving non-selected talents untouched.
// ============================================================
router.post('/:id/broadcast-now', async (req: Request, res: Response) => {
  try {
    const cardId = req.params.id as string;

    const { data: card } = await supabaseAdmin
      .from('subscription_cards')
      .select('id, state, distribution, publish_targets')
      .eq('id', cardId)
      .maybeSingle();
    if (!card) {
      res.status(404).json({ success: false, error: 'Card not found' });
      return;
    }
    if (card.state !== 'published') {
      res.status(409).json({ success: false, error: 'Only published cards can be broadcast' });
      return;
    }

    const publishTargets: string[] = card.publish_targets || ['partner', 'talent'];

    // 1. Release staged partners in the current round.
    let partnersReleased = 0;
    if (publishTargets.includes('partner')) {
      const { data: released, error: relErr } = await supabaseAdmin
        .from('subscription_card_recipients')
        .update({ broadcast_at: new Date().toISOString() })
        .eq('card_id', cardId)
        .is('broadcast_at', null)
        .is('archived_at', null)
        .select('id');
      if (relErr) {
        res.status(500).json({ success: false, error: relErr.message });
        return;
      }
      partnersReleased = released?.length ?? 0;
    }

    // 2. Talents.
    let talents:
      | { mode: 'broadcast'; synced: boolean }
      | { mode: 'manual'; notified: number; failed: number; failures: { talent_id: string; error: string }[]; sync_error?: string }
      | null = null;

    if (publishTargets.includes('talent')) {
      if (card.distribution === 'broadcast') {
        const payload = await buildSquadhirePayloadForCard(cardId);
        if (payload) await deliverCardToSquadhire(cardId, payload);
        const { data: recheck } = await supabaseAdmin
          .from('subscription_cards')
          .select('squadhire_synced_at')
          .eq('id', cardId)
          .maybeSingle();
        const synced = !!recheck?.squadhire_synced_at;
        talents = { mode: 'broadcast', synced };
        if (!synced) {
          res.status(503).json({
            success: false,
            partners_released: partnersReleased,
            error: 'Partners released, but the card could not be synced to SquadHire. Retry in a few minutes.',
          });
          return;
        }
      } else {
        talents = { mode: 'manual', ...(await releaseQueuedTalentsSoft(cardId)) };
        if (talents.notified === 0 && talents.failed > 0) {
          res.status(502).json({
            success: false,
            partners_released: partnersReleased,
            talents,
            error: talents.sync_error || 'Broadcast to SquadHire failed for all queued talents.',
          });
          return;
        }
      }
    }

    await logCardEvent({
      cardId,
      eventType: 'broadcast',
      actorId: (req as any).userId ?? null,
      actorType: 'admin',
      actorLabel: (req as any).userName ?? null,
      metadata: { partners_released: partnersReleased, talents },
    });

    res.json({ success: true, partners_released: partnersReleased, talents });
  } catch (err: any) {
    console.error('Admin broadcast-now error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

// ============================================================
// GET /admin/subscription-cards/:id/events
// Chronological activity feed for a card (oldest → newest).
// ============================================================
router.get('/:id/events', async (req: Request, res: Response) => {
  try {
    const cardId = req.params.id as string;
    const { data, error } = await supabaseAdmin
      .from('subscription_card_events')
      .select('id, event_type, actor_id, actor_type, actor_label, metadata, created_at')
      .eq('card_id', cardId)
      .order('created_at', { ascending: true });
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true, data: data || [] });
  } catch (err: any) {
    console.error('Admin card events error:', err);
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
      .select('id, state, squadhire_category_ids, plan_snapshot')
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
        // Secondaries display the parent's plan terms; mirror the parent's
        // frozen snapshot so the same freeze rules apply (no live drift).
        plan_snapshot: parent.plan_snapshot ?? null,
      })
      .select('*')
      .single();
    if (insErr) {
      res.status(500).json({ success: false, error: insErr.message });
      return;
    }

    if (body.distribution === 'broadcast') {
      await matchPartnersForCard(secondary.id, { targetingCardId: parentId });
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
// Recall any card (primary or secondary). Primary cards ALWAYS return to
// an editable draft for re-publish — pulled back from everyone, including
// any acceptees (use Cancel to terminate-but-keep-visible instead).
// Secondary cards have no draft state, so they become terminal+recalled
// (acceptees keep seeing them with the "Recalled" tag when accepted).
// ============================================================
router.post('/:id/recall', async (req: Request, res: Response) => {
  try {
    const cardId = req.params.id as string;

    const { data: card } = await supabaseAdmin
      .from('subscription_cards')
      .select('id, state, parent_card_id, brief_group_id')
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

    // Grouped (multi-tier) recall. A multi-tier brief is fanned out into one
    // published card per tier, linked by brief_group_id and shown to the admin
    // as a SINGLE card — so a recall must pull back EVERY tier, reunifying them
    // into one editable draft. Recalling only the active tier (the old
    // behaviour) left the other tier siblings published; the next publish then
    // minted a fresh group, stranding them as an orphaned duplicate card in
    // Broadcasted. Primary cards only — secondaries never carry a group.
    if (!card.parent_card_id && card.brief_group_id) {
      const anchorId = await reunifyTierGroupToDraft(
        card.brief_group_id,
        (req as any).userId ?? null,
      );
      if (anchorId) {
        const { data: anchor } = await supabaseAdmin
          .from('subscription_cards')
          .select('*')
          .eq('id', anchorId)
          .single();
        await logCardEvent({
          cardId: anchorId,
          eventType: 'recalled',
          actorId: (req as any).userId ?? null,
          actorType: 'admin',
          actorLabel: (req as any).userName ?? null,
          metadata: { returned_to_draft: true, grouped: true, brief_group_id: card.brief_group_id },
        });
        res.json({ success: true, data: await hydrateCard(anchor) });
        return;
      }
      // Single live member left in the group — fall through to plain recall.
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
    // Primary cards ALWAYS return to an editable draft on recall — pulled back
    // from everyone (including acceptees) and re-publishable from the sales
    // side. Use Cancel to terminate-but-keep-visible instead. Secondaries have
    // no draft state, so they go terminal (+ recalled_at when accepted).
    const returnsToDraft = !isSecondary;

    // SquadHire takedown for primary → draft MUST run while the card still
    // has published_at / state='published'. The draft update below clears
    // both, and buildSquadhirePayloadForCard's never-published guard then
    // returns null — leaving the SquadHire mirror live (talents keep seeing
    // the card). Await so a failed network hop still doesn't race the wipe.
    if (returnsToDraft) {
      try {
        await notifySquadhireOfCardRecall(cardId);
      } catch (err) {
        console.error('[admin-recall] squadhire pre-draft takedown error', err);
      }
    }

    if (returnsToDraft) {
      // Pull from EVERYONE so a re-publish rebuilds a fresh recipient list.
      await supabaseAdmin
        .from('subscription_card_recipients')
        .delete()
        .eq('card_id', cardId);
      await supabaseAdmin
        .from('subscription_card_external_recipients')
        .delete()
        .eq('card_id', cardId);
    } else {
      // Secondary recall is terminal — drop only pending recipients; accepted
      // acceptees keep seeing the card with the "Recalled" tag.
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
    }

    const now = new Date().toISOString();
    let updatePayload: Record<string, unknown>;
    if (returnsToDraft) {
      updatePayload = {
        state: 'draft' as const,
        published_at: null,
        published_by: null,
        squadhire_synced_at: null,
        squadhire_sync_attempts: 0,
        squadhire_sync_last_error: null,
        // Clear the frozen plan snapshot — back to live reads until republish.
        plan_snapshot: null,
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

    // Secondary (or any non-draft) path: re-deliver with the new state so
    // SquadHire picks up closed + recalled_at. Primary draft returns already
    // took the mirror down above — a post-wipe re-deliver would no-op.
    if (!returnsToDraft) {
      buildSquadhirePayloadForCard(updated.id)
        .then((payload) => payload && deliverCardToSquadhire(updated.id, payload))
        .catch((err) => console.error('[admin-recall] squadhire delivery error', err));
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

    await logCardEvent({
      cardId,
      eventType: 'recalled',
      actorId: (req as any).userId ?? null,
      actorType: 'admin',
      actorLabel: (req as any).userName ?? null,
      metadata: { returned_to_draft: returnsToDraft, had_acceptances: hasAcceptances, is_secondary: isSecondary },
    });

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
export async function cancelCardCore(cardId: string, actor: CardActor): Promise<CardLifecycleResult> {
  try {
    const { data: card } = await supabaseAdmin
      .from('subscription_cards')
      .select('id, state, parent_card_id, paused_at, selected_recipient_type, selected_recipient_id')
      .eq('id', cardId)
      .maybeSingle();
    if (!card) {
      return { httpStatus: 404, body: { success: false, error: 'Card not found' } };
    }
    if (card.state !== 'published' && card.state !== 'assigned') {
      return { httpStatus: 409, body: { success: false, error: 'Only published or assigned cards can be cancelled' } };
    }

    // Cancelling a LIVE (assigned, possibly paused) subscription: billing stops
    // today — the active term ends the day before (no-op when already paused,
    // pause ended it) — and the assigned talent is retired on SquadHire with an
    // "assignment updated" push. The card then follows the normal close path.
    const cancelWarnings: string[] = [];
    if (card.state === 'assigned') {
      const todayIst = new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const dayBefore = new Date(new Date(todayIst + 'T00:00:00Z').getTime() - 86400000)
        .toISOString()
        .slice(0, 10);
      await endActiveAssignmentTermsForCard(cardId, dayBefore);

      // The cancel day is unbilled — drop today's auto-elapsed rows (manual
      // overrides are kept), mirroring the pause flow.
      const { data: linkRow } = await supabaseAdmin
        .from('subscription_cards')
        .select('linked_folder_id')
        .eq('id', cardId)
        .maybeSingle();
      if ((linkRow as any)?.linked_folder_id) {
        await supabaseAdmin
          .from('elapsed_time_entries')
          .delete()
          .eq('folder_id', (linkRow as any).linked_folder_id)
          .eq('date', todayIst)
          .eq('source', 'auto');
      }

      if (card.selected_recipient_type === 'talent' && card.selected_recipient_id) {
        await supabaseAdmin
          .from('subscription_card_external_recipients')
          .update({ archived_at: new Date().toISOString() })
          .eq('card_id', cardId)
          .eq('external_user_id', card.selected_recipient_id)
          .is('archived_at', null);
        const removal = await notifySquadhireOfManualRemoval(cardId, card.selected_recipient_id, { notify: true });
        if (!removal.delivered) {
          cancelWarnings.push('SquadHire could not be updated — the talent may still see this client. Check the integration.');
        }
      }

      // The engagement is over: unwind the linked space (default assignee,
      // open tasks off the talent, client access), same as a talent change
      // with no replacement. Best-effort.
      if (card.selected_recipient_type && card.selected_recipient_id) {
        handOffSpaceToNewTalent({
          cardId,
          oldRecipientType: card.selected_recipient_type as 'talent' | 'partner',
          oldRecipientId: card.selected_recipient_id,
          newRecipientType: null,
          newRecipientId: null,
        }).catch((err) => console.error('[admin-cancel] space hand-off failed', err));
      }
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
        paused_at: null,
        squadhire_synced_at: null,
        squadhire_sync_attempts: 0,
        squadhire_sync_last_error: null,
      })
      .eq('id', cardId)
      .select('*')
      .single();
    if (updErr) {
      return { httpStatus: 500, body: { success: false, error: updErr.message } };
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

    // Mirror onto the linked Clients-module subscription (best-effort).
    await syncClientSubscriptionForCard(cardId, { status: 'cancelled' });

    await logCardEvent({
      cardId,
      eventType: 'cancelled',
      actorId: actor.userId,
      actorType: 'admin',
      actorLabel: actor.userName ?? null,
      metadata: { had_acceptances: hasAcceptances, is_secondary: isSecondary, was_assigned: card.state === 'assigned' },
    });

    return {
      httpStatus: 200,
      body: {
        success: true,
        data: await hydrateCard(updated),
        ...(cancelWarnings.length ? { warning: cancelWarnings.join(' ') } : {}),
      },
    };
  } catch (err: any) {
    console.error('Admin cancel card error:', err);
    return { httpStatus: 500, body: { success: false, error: err?.message || 'Internal server error' } };
  }
}

router.post('/:id/cancel', async (req: Request, res: Response) => {
  const result = await cancelCardCore(req.params.id as string, {
    userId: (req as any).userId ?? null,
    userName: (req as any).userName ?? null,
  });
  res.status(result.httpStatus).json(result.body);
});

// ============================================================
// POST /admin/subscription-cards/:id/archive
// Soft-hide any card. Sets archived_at; the card stops appearing
// in the default Subscription Cards list and is dropped from talent
// feeds. State is preserved so we can describe what was archived
// in the Archive tab; republish/delete-permanent decide its fate.
// ============================================================
export async function archiveCardCore(cardId: string, actor: CardActor): Promise<CardLifecycleResult> {
  try {
    const { data: card } = await supabaseAdmin
      .from('subscription_cards')
      .select('id, archived_at')
      .eq('id', cardId)
      .maybeSingle();
    if (!card) {
      return { httpStatus: 404, body: { success: false, error: 'Card not found' } };
    }
    if (card.archived_at) {
      return { httpStatus: 409, body: { success: false, error: 'Card is already archived' } };
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
      return { httpStatus: 500, body: { success: false, error: updErr.message } };
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

    // Mirror onto the linked Clients-module subscription (best-effort).
    await syncClientSubscriptionForCard(cardId, { archived: true });

    await logCardEvent({
      cardId,
      eventType: 'archived',
      actorId: actor.userId,
      actorType: 'admin',
      actorLabel: actor.userName ?? null,
    });

    return { httpStatus: 200, body: { success: true, data: await hydrateCard(updated) } };
  } catch (err: any) {
    console.error('Admin archive card error:', err);
    return { httpStatus: 500, body: { success: false, error: err?.message || 'Internal server error' } };
  }
}

router.post('/:id/archive', async (req: Request, res: Response) => {
  const result = await archiveCardCore(req.params.id as string, {
    userId: (req as any).userId ?? null,
    userName: (req as any).userName ?? null,
  });
  res.status(result.httpStatus).json(result.body);
});

// ============================================================
// POST /admin/subscription-cards/:id/reinstate
// Inverse of /archive: clear archived_at and restore the card to its
// EXACT pre-archive state. Unlike /republish, this touches nothing
// else — state, distribution, recipients, and every lifecycle
// timestamp are left as they were, so a Cancelled / Soft-Published /
// assigned card comes back exactly as it went in. Re-delivers to
// SquadHire so its mirror leaves 'archived' and re-matches the card.
// ============================================================
export async function reinstateCardCore(cardId: string, actor: CardActor): Promise<CardLifecycleResult> {
  try {
    const { data: card } = await supabaseAdmin
      .from('subscription_cards')
      .select('id, archived_at')
      .eq('id', cardId)
      .maybeSingle();
    if (!card) {
      return { httpStatus: 404, body: { success: false, error: 'Card not found' } };
    }
    if (!card.archived_at) {
      return { httpStatus: 409, body: { success: false, error: 'Only archived cards can be reinstated' } };
    }

    const { data: updated, error: updErr } = await supabaseAdmin
      .from('subscription_cards')
      .update({
        archived_at: null,
        // Force a fresh SquadHire re-delivery below; leave everything
        // else (state, recipients, cancelled_at/closed_at/assigned_at…)
        // untouched so the card returns to its exact previous state.
        squadhire_synced_at: null,
        squadhire_sync_attempts: 0,
        squadhire_sync_last_error: null,
      })
      .eq('id', cardId)
      .select('*')
      .single();
    if (updErr) {
      return { httpStatus: 500, body: { success: false, error: updErr.message } };
    }

    // Re-deliver to SquadHire so its mirror flips out of 'archived' and
    // the card re-matches. SquadHire re-derives its recipient pool on
    // ingest, restoring the pending offers the archive recall had dropped
    // — so we deliberately do NOT call notifySquadhireOfCardRecall here.
    buildSquadhirePayloadForCard(updated.id)
      .then((payload) => payload && deliverCardToSquadhire(updated.id, payload))
      .catch((err) => console.error('[admin-reinstate] squadhire delivery error', err));

    // Mirror onto the linked Clients-module subscription (best-effort): clear
    // the archive flag but leave status alone (a cancelled card stays cancelled).
    await syncClientSubscriptionForCard(cardId, { archived: false });

    await logCardEvent({
      cardId,
      eventType: 'reinstated',
      actorId: actor.userId,
      actorType: 'admin',
      actorLabel: actor.userName ?? null,
    });

    return { httpStatus: 200, body: { success: true, data: await hydrateCard(updated) } };
  } catch (err: any) {
    console.error('Admin reinstate card error:', err);
    return { httpStatus: 500, body: { success: false, error: err?.message || 'Internal server error' } };
  }
}

router.post('/:id/reinstate', async (req: Request, res: Response) => {
  const result = await reinstateCardCore(req.params.id as string, {
    userId: (req as any).userId ?? null,
    userName: (req as any).userName ?? null,
  });
  res.status(result.httpStatus).json(result.body);
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
// ============================================================
// POST /admin/subscription-cards/:id/duplicate
//
// Copy a card (any state — broadcasted / published / assigned / paused /
// cancelled) into a fresh DRAFT in New Deals with all the same details but NONE
// of its recipients, assignees, terms, or linked space. The admin edits it there
// and publishes it as a brand-new deal.
// ============================================================
router.post('/:id/duplicate', async (req: Request, res: Response) => {
  try {
    const cardId = req.params.id as string;
    const { data: card } = await supabaseAdmin
      .from('subscription_cards')
      .select('id')
      .eq('id', cardId)
      .maybeSingle();
    if (!card) { res.status(404).json({ success: false, error: 'Card not found' }); return; }

    const actorId = (req as any).user?.id ?? (req as any).userId ?? null;
    const result = await copyCardToNewDraft(cardId, {}, actorId);
    if ('error' in result) { res.status(500).json({ success: false, error: result.error }); return; }

    await logCardEvent({
      cardId: result.id,
      eventType: 'created',
      actorId,
      actorType: 'admin',
      actorLabel: (req as any).userName ?? null,
      metadata: { duplicated_from: cardId },
    });

    res.json({ success: true, data: { id: result.id } });
  } catch (err: any) {
    console.error('Duplicate card error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

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
        // A republished card starts a fresh life — never paused.
        paused_at: null,
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

    await logCardEvent({
      cardId,
      eventType: 'republished',
      actorId: (req as any).userId ?? null,
      actorType: 'admin',
      actorLabel: (req as any).userName ?? null,
    });

    res.json({ success: true, data: await hydrateCard(updated) });
  } catch (err: any) {
    console.error('Admin republish card error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

// ============================================================
// DELETE /admin/subscription-cards/:id
// Soft-delete a draft or archived card: stamp deleted_at/deleted_by so
// the card moves to the admin Trash (restorable) instead of vanishing.
// Drops SquadHire mirrors so it leaves talent feeds. The real purge —
// row delete + FK cascade of recipients/secondaries — happens later
// from Trash via "Delete forever" (DELETE /admin/trash/permanent).
// Drafts have never been broadcast; archived cards have already been
// recalled — both are safe to move without racing active-card flows.
// ============================================================
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const cardId = req.params.id as string;

    const { data: card } = await supabaseAdmin
      .from('subscription_cards')
      .select('id, state, archived_at, deleted_at')
      .eq('id', cardId)
      .maybeSingle();
    if (!card) {
      res.status(404).json({ success: false, error: 'Card not found' });
      return;
    }
    // Already in Trash — idempotent no-op.
    if (card.deleted_at) {
      res.json({ success: true });
      return;
    }
    if (!card.archived_at && card.state !== 'draft') {
      res.status(409).json({ success: false, error: 'Only draft or archived cards can be deleted. Archive it first.' });
      return;
    }

    // Drop SquadHire mirror rows so the card leaves every talent feed while it
    // sits in Trash. Restore returns it to its prior draft/archived state
    // (both already out of feeds), so no re-delivery is needed on restore.
    notifySquadhireOfCardRecall(cardId).catch((err) => {
      console.error('[admin-delete-card] squadhire mirror drop error', err);
    });

    const { error: updErr } = await supabaseAdmin
      .from('subscription_cards')
      .update({ deleted_at: new Date().toISOString(), deleted_by: req.userId || null })
      .eq('id', cardId);
    if (updErr) {
      res.status(500).json({ success: false, error: updErr.message });
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
//
// Side effect: when the card is in the 'assigned' state, this also
// commits the lead → client. If a client matching the lead already
// exists (by submission_id / business / email / phone), the lead's
// staged subscriptions are attached to that client. Otherwise a fresh
// client is materialised. Submission status is flipped to 'converted'
// either way, so the lead leaves the Leads section and shows in Clients.
// ============================================================
router.post('/:id/mark-reviewed', async (req: Request, res: Response) => {
  try {
    const cardId = req.params.id as string;

    const { data: card, error: cardErr } = await supabaseAdmin
      .from('subscription_cards')
      .select('id, state, selected_recipient_id, submission_subscription_id')
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

    let promotion: {
      submissionId: string | null;
      clientId: string | null;
      action: 'promoted' | 'attached' | 'noop';
      matchedBy?: 'submission_id' | 'business_name' | 'email' | 'phone';
      clientBusinessName?: string;
    } = { submissionId: null, clientId: null, action: 'noop' };

    const shouldPromote = card.state === 'assigned' && !!card.submission_subscription_id;
    if (shouldPromote) {
      const { data: stagedSub, error: stagedErr } = await supabaseAdmin
        .from('client_submission_subscriptions')
        .select('submission_id')
        .eq('id', card.submission_subscription_id)
        .maybeSingle();
      if (stagedErr) {
        res.status(500).json({ success: false, error: stagedErr.message });
        return;
      }

      const submissionId = stagedSub?.submission_id ?? null;
      if (submissionId) {
        const { data: submission, error: subErr } = await supabaseAdmin
          .from('client_submissions')
          .select('*')
          .eq('id', submissionId)
          .maybeSingle();
        if (subErr) {
          res.status(500).json({ success: false, error: subErr.message });
          return;
        }

        if (submission) {
          let match;
          try {
            match = await findExistingClientForSubmission(submission);
          } catch (e: any) {
            res.status(500).json({ success: false, error: e?.message || 'Failed to find existing client' });
            return;
          }

          if (match) {
            const result = await attachSubmissionToExistingClient(submissionId, match.id);
            if (!result.ok) {
              res.status(result.code).json({ success: false, error: result.error });
              return;
            }
            promotion = {
              submissionId,
              clientId: result.clientId,
              action: 'attached',
              matchedBy: match.matchedBy,
              clientBusinessName: match.business_name,
            };
          } else {
            const result = await transitionSubmissionStatus(submissionId, 'converted');
            if (!result.ok) {
              // 409 means the lead is already past 'converted' (e.g. onboarding/closed) — treat as noop, still stamp.
              if (result.code !== 409) {
                res.status(result.code).json({ success: false, error: result.error });
                return;
              }
            } else {
              promotion = {
                submissionId,
                clientId: result.clientId,
                action: submission.status === 'converted' ? 'noop' : 'promoted',
              };
            }
          }
        }
      }
    }

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
    res.json({ success: true, data: { ...updated, promotion } });
  } catch (err: any) {
    console.error('Mark reviewed error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

export default router;
