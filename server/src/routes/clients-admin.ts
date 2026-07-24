import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { requireMiniAppOrAdmin } from '../middleware/miniApp';
import { supabaseAdmin } from '../supabase';
import { config } from '../config';
import {
  PIPELINE_STATUSES,
  transitionSubmissionStatus,
} from '../utils/submissionPipeline';
import { hydrateStagedSubscriptions } from '../utils/stagedSubscriptions';
import { hydrateCardsBatch } from '../utils/subscriptionCards';
import { findCardIdForClientSubscription } from '../utils/clientCardLink';
import { pauseCardCore, resumeCardCore } from './subscription-cards-admin-select';
import { cancelCardCore, archiveCardCore, reinstateCardCore } from './subscription-cards-admin';

const router = Router();

router.use(requireAuth);

// The Clients module is admin-only. The single exception is the CRM lead
// lookup, which the Leads mini app's brief form calls to prefill a customer
// from an existing CRM lead — a read, so it also accepts the 'leads' grant.
const LEADS_READABLE = new Set(['/lookup-crm-lead']);
router.use((req, res, next) =>
  req.method === 'GET' && LEADS_READABLE.has(req.path)
    ? requireMiniAppOrAdmin('leads')(req, res, next)
    : requireAdmin(req, res, next),
);

/** Actor for propagating a Clients-module action onto the linked card. */
function cardActor(req: Request) {
  return {
    userId: (req as any).userId ?? (req as any).user?.id ?? null,
    userName: (req as any).userName ?? null,
  };
}

const countryIdSchema = z.string().uuid();

// ============================================================
// Helpers
// ============================================================

// Copy a plan's default deliverables into a new client_subscription
async function copyPlanDeliverables(clientSubscriptionId: string, planId: string) {
  const { data: planDelivs } = await supabaseAdmin
    .from('subscription_plan_deliverables')
    .select('*')
    .eq('plan_id', planId)
    .order('sort_order');

  if (!planDelivs || planDelivs.length === 0) return;

  const rows = planDelivs.map((d: any) => ({
    client_subscription_id: clientSubscriptionId,
    source_plan_deliverable_id: d.id,
    kind: d.kind,
    deliverable_type_id: d.deliverable_type_id,
    per_day: d.per_day,
    per_week: d.per_week,
    per_month: d.per_month,
    sort_order: d.sort_order,
  }));

  await supabaseAdmin.from('client_subscription_deliverables').insert(rows);
}

// Assign a set of plans to a client: inserts client_subscriptions rows
// and copies plan defaults into client_subscription_deliverables.
async function assignPlansToClient(clientId: string, planIds: string[]) {
  if (planIds.length === 0) return { error: null };

  // Look up subscription_id for each plan
  const { data: plans, error: planErr } = await supabaseAdmin
    .from('subscription_plans')
    .select('id, subscription_id')
    .in('id', planIds);

  if (planErr) return { error: planErr.message };
  if (!plans || plans.length !== planIds.length) {
    return { error: 'One or more plans not found' };
  }

  const inserts = plans.map((p: any) => ({
    client_id: clientId,
    subscription_id: p.subscription_id,
    plan_id: p.id,
  }));

  const { data: cs, error: csErr } = await supabaseAdmin
    .from('client_subscriptions')
    .insert(inserts)
    .select();

  if (csErr) return { error: csErr.message };

  // Copy default deliverables for each new client subscription
  await Promise.all(
    (cs || []).map((row: any) => copyPlanDeliverables(row.id, row.plan_id)),
  );

  return { error: null };
}

async function enrichClient(
  client: any,
  opts: { includeArchived?: boolean; withCardLifecycle?: boolean } = {},
) {
  // Raw linked-card rows keyed by id — collected as we match cards below so we
  // can (optionally) compute each card's lifecycle bucket for the client detail
  // Subscriptions tab. Only populated/used when `withCardLifecycle` is set, so
  // the clients LIST endpoint (which calls enrichClient per row) stays lean.
  const rawCardsById: Record<string, any> = {};
  // Hydrate the country
  let country: any = null;
  if (client.country_id) {
    const { data: c } = await supabaseAdmin
      .from('countries')
      .select('*')
      .eq('id', client.country_id)
      .single();
    country = c;
  }

  // Hydrate sales persons
  const spIds = [client.primary_sales_person_id, client.secondary_sales_person_id].filter(Boolean);
  let primary_sales_person: any = null;
  let secondary_sales_person: any = null;
  if (spIds.length > 0) {
    const { data: sps } = await supabaseAdmin
      .from('users')
      .select('id, display_name, email, avatar_url')
      .in('id', spIds);
    const map: Record<string, any> = {};
    (sps || []).forEach((u: any) => { map[u.id] = u; });
    primary_sales_person = client.primary_sales_person_id ? map[client.primary_sales_person_id] || null : null;
    secondary_sales_person = client.secondary_sales_person_id ? map[client.secondary_sales_person_id] || null : null;
  }

  let csQuery = supabaseAdmin
    .from('client_subscriptions')
    .select('*')
    .eq('client_id', client.id);
  if (!opts.includeArchived) csQuery = csQuery.is('archived_at', null);
  const { data: cs } = await csQuery.order('created_at');

  if (!cs || cs.length === 0) {
    return { ...client, country, primary_sales_person, secondary_sales_person, subscriptions: [] };
  }

  const subIds = Array.from(new Set(cs.map((c: any) => c.subscription_id)));
  const planIds = Array.from(new Set(cs.map((c: any) => c.plan_id)));
  const csIds = cs.map((c: any) => c.id);

  const [{ data: subs }, { data: plans }, { data: pricing }, { data: delivs }] = await Promise.all([
    supabaseAdmin.from('subscriptions').select('*').in('id', subIds),
    supabaseAdmin.from('subscription_plans').select('*').in('id', planIds),
    supabaseAdmin.from('subscription_plan_pricing').select('*').in('plan_id', planIds),
    supabaseAdmin.from('client_subscription_deliverables').select('*').in('client_subscription_id', csIds).order('sort_order'),
  ]);

  const subsMap: Record<string, any> = {};
  (subs || []).forEach((s: any) => { subsMap[s.id] = s; });
  const plansMap: Record<string, any> = {};
  (plans || []).forEach((p: any) => { plansMap[p.id] = p; });
  const pricingByPlan: Record<string, any[]> = {};
  (pricing || []).forEach((p: any) => {
    (pricingByPlan[p.plan_id] = pricingByPlan[p.plan_id] || []).push(p);
  });
  const delivsByCs: Record<string, any[]> = {};
  (delivs || []).forEach((d: any) => {
    (delivsByCs[d.client_subscription_id] = delivsByCs[d.client_subscription_id] || []).push(d);
  });

  // Fetch cards linked through the original submission.
  // Uses the same three matching strategies as GET /admin/subscription-cards:
  //   1. submission_subscription_id — cards published from staged subs
  //   2. customer_email — request/shared_form cards
  //   3. customer_phone (suffix) — same for phone-led leads
  let cardBySubPlan: Record<string, any> = {};
  const matchedTextCardIds = new Set<string>();
  let unmatchedCards: Record<string, any> = {};
  if (client.submission_id) {
    const { data: leadRow } = await supabaseAdmin
      .from('client_submissions')
      .select('email, contact_number')
      .eq('id', client.submission_id)
      .maybeSingle();

    const { data: stagedSubs } = await supabaseAdmin
      .from('client_submission_subscriptions')
      .select('id, subscription_id, plan_id')
      .eq('submission_id', client.submission_id);

    const matchingCardIds = new Set<string>();
    const cardByStagedId: Record<string, any> = {};

    if (stagedSubs && stagedSubs.length > 0) {
      const stagedIds = stagedSubs.map((s: any) => s.id);
      const { data: stgCards } = await supabaseAdmin
        .from('subscription_cards')
        .select('id, submission_subscription_id, state, published_at, card_code, linked_folder_id, linked_at, proposed_price, subscription_price, markup, partner_price_override, cancelled_at, paused_at, selected_recipient_id, archived_at, parent_card_id, distribution, publish_targets, squadhire_category_ids, squadhire_synced_at')
        .in('submission_subscription_id', stagedIds);

      (stgCards || []).forEach((crd: any) => {
        matchingCardIds.add(crd.id);
        cardByStagedId[crd.submission_subscription_id] = crd;
        rawCardsById[crd.id] = crd;
      });
    }

    const phoneDigits = leadRow?.contact_number
      ? String(leadRow.contact_number).replace(/\D/g, '')
      : '';
    const phoneSuffix = phoneDigits.length >= 7 ? phoneDigits : '';

    const [byEmail, byPhone] = await Promise.all([
      leadRow?.email
        ? supabaseAdmin
            .from('subscription_cards')
            .select('id, service_type, plan_name, state, published_at, card_code, linked_folder_id, linked_at, proposed_price, subscription_price, markup, partner_price_override, cancelled_at, paused_at, selected_recipient_id, archived_at, deleted_at, parent_card_id, distribution, publish_targets, squadhire_category_ids, squadhire_synced_at')
            .ilike('customer_email', leadRow.email.trim())
        : Promise.resolve({ data: [] as any[] }),
      phoneSuffix
        ? supabaseAdmin
            .from('subscription_cards')
            .select('id, service_type, plan_name, state, published_at, card_code, linked_folder_id, linked_at, proposed_price, subscription_price, markup, partner_price_override, cancelled_at, paused_at, selected_recipient_id, archived_at, deleted_at, parent_card_id, distribution, publish_targets, squadhire_category_ids, squadhire_synced_at')
            .ilike('customer_phone', `%${phoneSuffix}`)
        : Promise.resolve({ data: [] as any[] }),
    ]);

    [...(byEmail.data || []), ...(byPhone.data || [])].forEach((crd: any) => {
      if (crd?.id) rawCardsById[crd.id] = crd;
    });

    // Index cards matched by staged sub ID → keyed by (subscription_id, plan_id)
    if (stagedSubs) {
      stagedSubs.forEach((ss: any) => {
        const card = cardByStagedId[ss.id];
        if (card) {
          cardBySubPlan[`${ss.subscription_id}:${ss.plan_id}`] = card;
        }
      });
    }

    // For email/phone-matched cards, try to match by service_type + plan_name
    // against each client_subscription's subscription name and plan name.
    const textCards = [...(byEmail.data || []), ...(byPhone.data || [])]
      .filter((crd: any) => !matchingCardIds.has(crd.id) && crd.service_type && crd.plan_name);

    const normService = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/s$/, '');

    if (textCards.length > 0 && cs.length > 0) {
      textCards.forEach((crd: any) => {
        const cardServiceNorm = normService(crd.service_type);
        const cardPlanNorm = normService(crd.plan_name);
        cs.forEach((c: any) => {
          const subName = subsMap[c.subscription_id]?.name || '';
          const planName = plansMap[c.plan_id]?.plan || '';
          const subNorm = normService(subName);
          const planNorm = normService(planName);
          const subWords = subName.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
          const svcWordMatch = subWords.some((w: string) => w.replace(/s$/, '') === cardServiceNorm);
          if (
            subName && planName &&
            cardPlanNorm === planNorm &&
            (cardServiceNorm === subNorm || svcWordMatch)
          ) {
            const key = `${c.subscription_id}:${c.plan_id}`;
            const existing = cardBySubPlan[key];
            const statePriority: Record<string, number> = { draft: 0, published: 1, assigned: 2, closed: 3 };
            const newPrio = statePriority[crd.state] ?? 0;
            const oldPrio = existing ? (statePriority[existing.state] ?? 0) : -1;
            if (!existing || newPrio > oldPrio) {
              cardBySubPlan[key] = { id: crd.id, state: crd.state, published_at: crd.published_at, card_code: crd.card_code, linked_folder_id: crd.linked_folder_id, linked_at: crd.linked_at, proposed_price: crd.proposed_price ?? null, subscription_price: crd.subscription_price ?? null, markup: crd.markup ?? null, partner_price_override: crd.partner_price_override ?? null };
            }
            matchedTextCardIds.add(crd.id);
          }
        });
      });
    }

    // Collect email/phone-matched cards that didn't match any subscription.
    // Archived cards and cards moved to Trash are excluded — the "Other Cards"
    // section must only surface live linked cards (and archived/trashed cards
    // must not auto-create a subscription below either).
    unmatchedCards = textCards
      .filter((crd: any) => !matchedTextCardIds.has(crd.id) && !crd.archived_at && !crd.deleted_at)
      .reduce((acc: Record<string, any>, crd: any) => {
        if (!acc[crd.id]) acc[crd.id] = { id: crd.id, state: crd.state, published_at: crd.published_at, card_code: crd.card_code, linked_folder_id: crd.linked_folder_id, linked_at: crd.linked_at, proposed_price: crd.proposed_price ?? null, subscription_price: crd.subscription_price ?? null, markup: crd.markup ?? null, partner_price_override: crd.partner_price_override ?? null };
        return acc;
      }, {});

    // For unmatched cards, auto-create the corresponding subscription.
    // Uses word-level matching (not substring) to avoid false matches.
    if (Object.keys(unmatchedCards).length > 0) {
      const { data: allSubs } = await supabaseAdmin
        .from('subscriptions').select('id, name').order('name');
      const { data: allPlans } = await supabaseAdmin.from('subscription_plans').select('*');
      const existingKeys = new Set(cs.map((c: any) => `${c.subscription_id}:${c.plan_id}`));
      const createdCs: any[] = [];

      for (const crd of Object.values(unmatchedCards) as any[]) {
        const fullCrd = (byEmail.data || []).concat(byPhone.data || []).find((c: any) => c.id === crd.id);
        if (!fullCrd?.service_type || !fullCrd?.plan_name) continue;
        const cardSvcNorm = normService(fullCrd.service_type);
        const cardPlanNorm = normService(fullCrd.plan_name);

        // Find subscriptions whose name contains service_type as a whole word.
        // Prefer exact normalized match first, then word match — when multiple
        // match, pick the subscription where the matched word accounts for a
        // larger fraction of the name (e.g. "Video Editor" over "Designer + Editor"
        // for service type "Editors", since "Editor" is 50% vs 33%).
        let matchedSub = (allSubs || []).find(
          (s: any) => normService(s.name) === cardSvcNorm,
        );
        if (!matchedSub) {
          const wordMatches = (allSubs || []).filter((s: any) => {
            const words = s.name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
            return words.some((w: string) => w.replace(/s$/, '') === cardSvcNorm);
          });
          if (wordMatches.length === 1) {
            matchedSub = wordMatches[0];
          } else if (wordMatches.length > 1) {
            matchedSub = wordMatches.sort((a: any, b: any) => {
              const aFrac = cardSvcNorm.length / a.name.length;
              const bFrac = cardSvcNorm.length / b.name.length;
              return bFrac - aFrac;
            })[0];
          }
        }

        if (!matchedSub) continue;

        const matchedPlan = (allPlans || []).find(
          (p: any) => p.subscription_id === matchedSub.id && normService(p.plan) === cardPlanNorm,
        );
        if (!matchedPlan) continue;

        const key = `${matchedSub.id}:${matchedPlan.id}`;
        if (existingKeys.has(key)) continue;

        const { data: newCs } = await supabaseAdmin
          .from('client_subscriptions')
          .insert({ client_id: client.id, subscription_id: matchedSub.id, plan_id: matchedPlan.id, status: 'active' })
          .select('*')
          .single();

        if (newCs) {
          createdCs.push(newCs);
          subsMap[matchedSub.id] = matchedSub;
          plansMap[matchedPlan.id] = matchedPlan;
          cardBySubPlan[key] = { id: crd.id, state: crd.state, published_at: crd.published_at, card_code: crd.card_code, linked_folder_id: crd.linked_folder_id, linked_at: crd.linked_at, proposed_price: crd.proposed_price ?? null, subscription_price: crd.subscription_price ?? null, markup: crd.markup ?? null, partner_price_override: crd.partner_price_override ?? null };
          matchedTextCardIds.add(crd.id);
          existingKeys.add(key);
        }
      }

      // Extend cs with newly created subscriptions
      if (createdCs.length > 0) {
        (cs as any[]).push(...createdCs);
      }

      // Rebuild unmatchedCards without the ones we just matched (still
      // excluding archived / trashed cards, as above).
      unmatchedCards = textCards
        .filter((crd: any) => !matchedTextCardIds.has(crd.id) && !crd.archived_at && !crd.deleted_at)
        .reduce((acc: Record<string, any>, crd: any) => {
          if (!acc[crd.id]) acc[crd.id] = { id: crd.id, state: crd.state, published_at: crd.published_at, card_code: crd.card_code, linked_folder_id: crd.linked_folder_id, linked_at: crd.linked_at, proposed_price: crd.proposed_price ?? null, subscription_price: crd.subscription_price ?? null, markup: crd.markup ?? null, partner_price_override: crd.partner_price_override ?? null };
          return acc;
        }, {});
    }
  }

  // Compute each linked card's "needs broadcast" flag (published-but-unsent) so
  // the client detail Subscriptions tab can bucket cards by lifecycle exactly
  // like the Subscription Cards section (published vs broadcasted). Gated behind
  // withCardLifecycle so the clients LIST never pays for it, and best-effort:
  // a failure here must never break the client payload.
  let needsBroadcastById = new Map<string, boolean>();
  if (opts.withCardLifecycle) {
    const rawCards = Object.values(rawCardsById);
    if (rawCards.length > 0) {
      try {
        const hydrated = await hydrateCardsBatch(rawCards);
        needsBroadcastById = new Map(
          Array.from(hydrated.entries()).map(([id, h]) => [id, !!h.needs_broadcast]),
        );
      } catch (err) {
        console.error('enrichClient: needs_broadcast hydration failed', err);
      }
    }
  }

  // Normalize a linked card to the exact shape the Subscriptions tab consumes:
  // pull lifecycle fields from the raw row (which carries every selected column)
  // and stamp the computed needs_broadcast. Also keeps internal columns
  // (distribution, publish_targets, …) from leaking into the API response.
  const normalizeLinkedCard = (mini: any): any => {
    if (!mini) return null;
    const raw = rawCardsById[mini.id] || mini;
    return {
      id: raw.id,
      state: raw.state,
      published_at: raw.published_at ?? null,
      card_code: raw.card_code ?? null,
      linked_folder_id: raw.linked_folder_id ?? null,
      linked_at: raw.linked_at ?? null,
      proposed_price: raw.proposed_price ?? null,
      subscription_price: raw.subscription_price ?? null,
      markup: raw.markup ?? null,
      partner_price_override: raw.partner_price_override ?? null,
      cancelled_at: raw.cancelled_at ?? null,
      paused_at: raw.paused_at ?? null,
      selected_recipient_id: raw.selected_recipient_id ?? null,
      needs_broadcast: needsBroadcastById.get(raw.id) ?? false,
    };
  };

  return {
    ...client,
    country,
    primary_sales_person,
    secondary_sales_person,
    subscriptions: cs.map((c: any) => ({
      ...c,
      subscription: subsMap[c.subscription_id] || null,
      plan: plansMap[c.plan_id]
        ? { ...plansMap[c.plan_id], pricing: pricingByPlan[c.plan_id] || [] }
        : null,
      deliverables: delivsByCs[c.id] || [],
      card: normalizeLinkedCard(cardBySubPlan[`${c.subscription_id}:${c.plan_id}`] || null),
    })),
    linkedCards: Object.values(unmatchedCards),
  };
}

// ============================================================
// Client Submissions (New Clients)
// ============================================================

async function hydrateSalesPeopleOn<T extends { primary_sales_person_id?: string | null; secondary_sales_person_id?: string | null }>(rows: T[]): Promise<Array<T & { primary_sales_person?: any; secondary_sales_person?: any }>> {
  const ids = new Set<string>();
  rows.forEach((r) => {
    if (r.primary_sales_person_id) ids.add(r.primary_sales_person_id);
    if (r.secondary_sales_person_id) ids.add(r.secondary_sales_person_id);
  });
  if (ids.size === 0) return rows;
  const { data } = await supabaseAdmin
    .from('users')
    .select('id, display_name, email, avatar_url')
    .in('id', Array.from(ids));
  const map: Record<string, any> = {};
  (data || []).forEach((u: any) => { map[u.id] = u; });
  return rows.map((r) => ({
    ...r,
    primary_sales_person: r.primary_sales_person_id ? map[r.primary_sales_person_id] || null : null,
    secondary_sales_person: r.secondary_sales_person_id ? map[r.secondary_sales_person_id] || null : null,
  }));
}

// Fetch all client_submission_brands rows for the given submission ids,
// with their target_regions hydrated. Returns a Record keyed by
// submission_id, brands ordered updated_at DESC inside each value.
async function hydrateBrandsBySubmission(submissionIds: string[]): Promise<Record<string, any[]>> {
  if (submissionIds.length === 0) return {};

  const { data: brands } = await supabaseAdmin
    .from('client_submission_brands')
    .select('*')
    .in('submission_id', submissionIds)
    .order('updated_at', { ascending: false });

  const rows = (brands || []) as any[];
  if (rows.length === 0) return {};

  const brandIds = rows.map((b) => b.id);
  const { data: regions } = await supabaseAdmin
    .from('client_submission_brand_regions')
    .select('brand_id, region')
    .in('brand_id', brandIds);

  // Per-role requirement details live on subscription_cards now (one card
  // per role ticked on /connect). Pull the slim view needed for the New
  // Clients slider so each BrandCard can render per-role notes + hours.
  const { data: cards } = await supabaseAdmin
    .from('subscription_cards')
    .select('id, brand_id, service_type, requirement_note, hours_note, state, created_at')
    .in('brand_id', brandIds)
    .order('created_at', { ascending: true });

  const regionsByBrand: Record<string, string[]> = {};
  for (const r of (regions || []) as any[]) {
    (regionsByBrand[r.brand_id] = regionsByBrand[r.brand_id] || []).push(r.region);
  }

  const cardsByBrand: Record<string, any[]> = {};
  for (const c of (cards || []) as any[]) {
    if (!c.brand_id) continue;
    (cardsByBrand[c.brand_id] = cardsByBrand[c.brand_id] || []).push(c);
  }

  const bySubmission: Record<string, any[]> = {};
  for (const b of rows) {
    const enriched = {
      ...b,
      target_regions: regionsByBrand[b.id] || [],
      cards: cardsByBrand[b.id] || [],
    };
    (bySubmission[b.submission_id] = bySubmission[b.submission_id] || []).push(enriched);
  }
  return bySubmission;
}

router.get('/submissions', async (_req: Request, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('client_submissions')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    const enriched = await hydrateSalesPeopleOn(data || []);
    const submissionIds = enriched.map((s: any) => s.id);

    const [stagedMap, brandsMap] = await Promise.all([
      hydrateStagedSubscriptions(submissionIds),
      hydrateBrandsBySubmission(submissionIds),
    ]);

    const withStaged = enriched.map((s: any) => ({
      ...s,
      selected_subscriptions: stagedMap[s.id] || [],
      brands: brandsMap[s.id] || [],
    }));

    res.json({ success: true, data: withStaged });
  } catch (err) {
    console.error('List submissions error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /admin/clients/lookup-crm-lead?submission_id=&phone=&email= —
// resolves a published card's customer to its corresponding Squad CRM
// lead. The CRM (`crm_leads` table) shares this Supabase project, so we
// can query it directly. Tries identifiers in order:
//   1. sh_client_submission_id  — strongest link; set when CRM converted
//      the lead into a SquadHub client_submission.
//   2. phone_e164 (suffix-match) — covers leads that came in via WhatsApp
//      first and were never explicitly linked to a submission. Cards
//      typically store a local phone like "9447402340"; CRM stores E.164
//      "+919447402340". Strip non-digits from the input and suffix-match.
//   3. email (case-insensitive)  — last-resort fallback.
// Returns { lead_id, matched_by } on hit, or null if nothing matches.
router.get('/lookup-crm-lead', async (req: Request, res: Response) => {
  try {
    const submissionId = (req.query.submission_id as string | undefined)?.trim();
    const phone = (req.query.phone as string | undefined)?.trim();
    const email = (req.query.email as string | undefined)?.trim();

    // 1. Submission link
    if (submissionId) {
      const { data, error } = await supabaseAdmin
        .from('crm_leads')
        .select('id')
        .eq('sh_client_submission_id', submissionId)
        .is('merged_into_lead_id', null)
        .maybeSingle();
      if (error) {
        res.status(500).json({ success: false, error: error.message });
        return;
      }
      if (data) {
        res.json({ success: true, data: { lead_id: data.id, matched_by: 'submission_id' } });
        return;
      }
    }

    // 2. Phone suffix-match
    if (phone) {
      const cleaned = phone.replace(/\D/g, '');
      if (cleaned.length >= 7) {
        const { data, error } = await supabaseAdmin
          .from('crm_leads')
          .select('id')
          .ilike('phone_e164', `%${cleaned}`)
          .is('merged_into_lead_id', null)
          .limit(1);
        if (error) {
          res.status(500).json({ success: false, error: error.message });
          return;
        }
        if (data && data.length > 0) {
          res.json({ success: true, data: { lead_id: data[0].id, matched_by: 'phone' } });
          return;
        }
      }
    }

    // 3. Email
    if (email && email.includes('@')) {
      const { data, error } = await supabaseAdmin
        .from('crm_leads')
        .select('id')
        .ilike('email', email)
        .is('merged_into_lead_id', null)
        .limit(1);
      if (error) {
        res.status(500).json({ success: false, error: error.message });
        return;
      }
      if (data && data.length > 0) {
        res.json({ success: true, data: { lead_id: data[0].id, matched_by: 'email' } });
        return;
      }
    }

    res.json({ success: true, data: null });
  } catch (err) {
    console.error('GET /lookup-crm-lead error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PATCH /admin/clients/submissions/:id/sales-people — admin can add/change SPs
const updateSubmissionSpSchema = z.object({
  primary_sales_person_id: z.string().uuid().nullable().optional(),
  secondary_sales_person_id: z.string().uuid().nullable().optional(),
});

router.patch('/submissions/:id/sales-people', async (req: Request, res: Response) => {
  try {
    const body = updateSubmissionSpSchema.parse(req.body);
    const patch: Record<string, any> = {};
    if (body.primary_sales_person_id !== undefined) patch.primary_sales_person_id = body.primary_sales_person_id;
    if (body.secondary_sales_person_id !== undefined) patch.secondary_sales_person_id = body.secondary_sales_person_id;

    if (Object.keys(patch).length === 0) {
      res.json({ success: true, data: null });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('client_submissions')
      .update(patch)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    const [enriched] = await hydrateSalesPeopleOn([data]);
    res.json({ success: true, data: enriched });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Update submission SPs error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PATCH /admin/clients/:id/sales-people — admin can add/change SPs on approved clients
router.patch('/:id/sales-people', async (req: Request, res: Response) => {
  try {
    const body = updateSubmissionSpSchema.parse(req.body);
    const patch: Record<string, any> = {};
    if (body.primary_sales_person_id !== undefined) patch.primary_sales_person_id = body.primary_sales_person_id;
    if (body.secondary_sales_person_id !== undefined) patch.secondary_sales_person_id = body.secondary_sales_person_id;

    if (Object.keys(patch).length === 0) {
      res.json({ success: true, data: null });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('clients')
      .update(patch)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    const [enriched] = await hydrateSalesPeopleOn([data]);
    res.json({ success: true, data: enriched });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Update client SPs error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Count of leads in active pipeline (not converted/onboarding/closed) — drives the sidebar badge.
router.get('/submissions/count', async (_req: Request, res: Response) => {
  try {
    const { count, error } = await supabaseAdmin
      .from('client_submissions')
      .select('*', { count: 'exact', head: true })
      .in('status', ['new', 'in_progress', 'selection']);

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true, data: { count: count || 0 } });
  } catch (err) {
    console.error('Count submissions error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PATCH /admin/clients/submissions/:id/status — admin updates pipeline status.
// Transitioning to 'converted' materialises the Client + client_subscriptions.
const submissionStatusSchema = z.object({
  status: z.enum(PIPELINE_STATUSES),
});

router.patch('/submissions/:id/status', async (req: Request, res: Response) => {
  try {
    const body = submissionStatusSchema.parse(req.body);
    const result = await transitionSubmissionStatus(req.params.id as string, body.status);
    if (!result.ok) {
      res.status(result.code).json({ success: false, error: result.error });
      return;
    }
    res.json({ success: true, data: { status: result.status, client_id: result.clientId } });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Update submission status error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PATCH /admin/clients/submissions/:id/country — admin updates billing country on a lead.
const submissionCountrySchema = z.object({ country_id: z.string().uuid() });

router.patch('/submissions/:id/country', async (req: Request, res: Response) => {
  try {
    const body = submissionCountrySchema.parse(req.body);

    const { data: submission } = await supabaseAdmin
      .from('client_submissions')
      .select('status')
      .eq('id', req.params.id)
      .maybeSingle();
    if (!submission) {
      res.status(404).json({ success: false, error: 'Submission not found' });
      return;
    }
    if (submission.status === 'converted' || submission.status === 'closed') {
      res.status(409).json({ success: false, error: 'Cannot change billing country on a converted or closed lead' });
      return;
    }

    const { data: country } = await supabaseAdmin
      .from('countries')
      .select('id, is_active')
      .eq('id', body.country_id)
      .maybeSingle();
    if (!country || !country.is_active) {
      res.status(400).json({ success: false, error: 'Country not found or inactive' });
      return;
    }

    const { error } = await supabaseAdmin
      .from('client_submissions')
      .update({ country_id: body.country_id })
      .eq('id', req.params.id as string);

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true, data: { country_id: body.country_id } });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Admin update lead country error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Staged subscription management — mirrors the sales endpoints but without the
// primary/secondary-SP guard (admin can edit any lead).
const addStagedSubSchema = z.object({
  subscription_id: z.string().uuid(),
  plan_id: z.string().uuid(),
});

router.get('/submissions/:id/subscriptions', async (req: Request, res: Response) => {
  try {
    const leadId = req.params.id as string;
    const map = await hydrateStagedSubscriptions([leadId]);
    res.json({ success: true, data: map[leadId] || [] });
  } catch (err) {
    console.error('Admin list staged subs error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.post('/submissions/:id/subscriptions', async (req: Request, res: Response) => {
  try {
    const body = addStagedSubSchema.parse(req.body);

    const { data: submission } = await supabaseAdmin
      .from('client_submissions')
      .select('status')
      .eq('id', req.params.id)
      .maybeSingle();

    if (!submission) {
      res.status(404).json({ success: false, error: 'Submission not found' });
      return;
    }
    if (submission.status === 'converted' || submission.status === 'closed') {
      res.status(409).json({ success: false, error: 'Cannot edit subscriptions on a converted or closed lead' });
      return;
    }

    const { data: plan } = await supabaseAdmin
      .from('subscription_plans')
      .select('id, subscription_id, is_active')
      .eq('id', body.plan_id)
      .maybeSingle();
    if (!plan || plan.subscription_id !== body.subscription_id) {
      res.status(400).json({ success: false, error: 'Plan does not belong to the given subscription' });
      return;
    }
    if (!plan.is_active) {
      res.status(400).json({ success: false, error: 'Plan is inactive' });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('client_submission_subscriptions')
      .insert({
        submission_id: req.params.id,
        subscription_id: body.subscription_id,
        plan_id: body.plan_id,
      })
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
    console.error('Admin add staged sub error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.delete('/submissions/:id/subscriptions/:rowId', async (req: Request, res: Response) => {
  try {
    const { data: submission } = await supabaseAdmin
      .from('client_submissions')
      .select('status')
      .eq('id', req.params.id)
      .maybeSingle();
    if (!submission) {
      res.status(404).json({ success: false, error: 'Submission not found' });
      return;
    }
    if (submission.status === 'converted' || submission.status === 'closed') {
      res.status(409).json({ success: false, error: 'Cannot edit subscriptions on a converted or closed lead' });
      return;
    }

    const { error } = await supabaseAdmin
      .from('client_submission_subscriptions')
      .delete()
      .eq('id', req.params.rowId)
      .eq('submission_id', req.params.id);

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Admin delete staged sub error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============================================================
// Clients Management
// ============================================================

// POST /admin/clients — manually create a client
const createClientSchema = z.object({
  business_name: z.string().min(1).max(200),
  contact_person: z.string().min(1).max(200),
  designation: z.string().max(200).optional().or(z.literal('')),
  contact_number: z.string().min(1).max(20),
  email: z.string().email(),
  business_address: z.string().min(1).max(1000),
  gst_registered: z.boolean(),
  gst_number: z.string().max(50).optional().or(z.literal('')),
  accounts_email: z.string().email().optional().or(z.literal('')),
  country_id: countryIdSchema,
  plan_ids: z.array(z.string().uuid()).min(1),
});

router.post('/', async (req: Request, res: Response) => {
  try {
    const body = createClientSchema.parse(req.body);

    const { data: client, error: clientErr } = await supabaseAdmin
      .from('clients')
      .insert({
        submission_id: null,
        business_name: body.business_name,
        contact_person: body.contact_person,
        designation: body.designation || null,
        contact_number: body.contact_number,
        email: body.email,
        business_address: body.business_address,
        gst_registered: body.gst_registered,
        gst_number: body.gst_number || null,
        accounts_email: body.accounts_email || null,
        country_id: body.country_id,
      })
      .select()
      .single();

    if (clientErr || !client) {
      res.status(500).json({ success: false, error: clientErr?.message || 'Failed to create client' });
      return;
    }

    const { error: assignErr } = await assignPlansToClient(client.id, body.plan_ids);
    if (assignErr) {
      res.status(500).json({ success: false, error: assignErr });
      return;
    }

    const enriched = await enrichClient(client);
    res.json({ success: true, data: enriched });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Create client error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.get('/', async (_req: Request, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('clients')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    const enriched = await Promise.all((data || []).map((c: any) => enrichClient(c)));
    res.json({ success: true, data: enriched });
  } catch (err) {
    console.error('List clients error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.get('/count', async (_req: Request, res: Response) => {
  try {
    const { count, error } = await supabaseAdmin
      .from('clients')
      .select('*', { count: 'exact', head: true });

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true, data: { count: count || 0 } });
  } catch (err) {
    console.error('Count clients error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('clients')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error) {
      res.status(404).json({ success: false, error: 'Client not found' });
      return;
    }

    const includeArchived = req.query.include_archived === '1';
    const enriched = await enrichClient(data, { includeArchived, withCardLifecycle: true });
    res.json({ success: true, data: enriched });
  } catch (err) {
    console.error('Get client error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /admin/clients/:id/squadbooks-customer
// Asks the sibling SquadBooks app whether this client also exists there as a
// customer (matched by email then phone, across all workspaces). When it does,
// returns the workspace + customer id so the admin can deep-link into SquadBooks
// via SSO. Returns { found:false } when there's no match or the integration is
// unconfigured/unreachable — the button just stays disabled in that case.
router.get('/:id/squadbooks-customer', async (req: Request, res: Response) => {
  if (!config.squadbooksUrl || !config.squadbooksAdminApiKey) {
    res.json({ success: true, data: { found: false } });
    return;
  }
  try {
    const { data: client, error } = await supabaseAdmin
      .from('clients')
      .select('email, contact_number, business_name')
      .eq('id', req.params.id)
      .single();
    if (error || !client) {
      res.status(404).json({ success: false, error: 'Client not found' });
      return;
    }

    const qs = new URLSearchParams();
    if (client.email) qs.set('email', client.email);
    if (client.contact_number) qs.set('phone', client.contact_number);
    if (client.business_name) qs.set('name', client.business_name);
    if (![...qs.keys()].length) {
      res.json({ success: true, data: { found: false } });
      return;
    }

    const r = await fetch(
      `${config.squadbooksUrl}/api/integrations/squadbooks/customer-match?${qs.toString()}`,
      { headers: { 'x-admin-key': config.squadbooksAdminApiKey } },
    );
    if (!r.ok) {
      res.json({ success: true, data: { found: false } });
      return;
    }
    const match = (await r.json()) as {
      found?: boolean;
      orgId?: string;
      customerId?: string;
      customerName?: string;
      matchedBy?: string;
    };
    if (!match.found || !match.orgId || !match.customerId) {
      res.json({ success: true, data: { found: false } });
      return;
    }
    res.json({
      success: true,
      data: {
        found: true,
        orgId: match.orgId,
        customerId: match.customerId,
        customerName: match.customerName || '',
        matchedBy: match.matchedBy || 'email',
        squadbooksUrl: config.squadbooksUrl,
      },
    });
  } catch (err) {
    console.error('GET /:id/squadbooks-customer error:', err);
    res.json({ success: true, data: { found: false } });
  }
});

const updateClientSchema = z.object({
  business_name: z.string().min(1).max(200).optional(),
  contact_person: z.string().min(1).max(200).optional(),
  designation: z.string().max(200).optional(),
  contact_number: z.string().min(1).max(20).optional(),
  email: z.string().email().optional(),
  business_address: z.string().min(1).max(1000).optional(),
  gst_registered: z.boolean().optional(),
  gst_number: z.string().max(50).optional(),
  accounts_email: z.string().email().optional().or(z.literal('')),
  country_id: countryIdSchema.optional(),
});

router.put('/:id', async (req: Request, res: Response) => {
  try {
    const body = updateClientSchema.parse(req.body);
    const { data, error } = await supabaseAdmin
      .from('clients')
      .update(body)
      .eq('id', req.params.id)
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
    console.error('Update client error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PUT /admin/clients/:id/status — change client status
const statusSchema = z.object({
  status: z.enum(['active', 'paused', 'cancelled']),
});

router.put('/:id/status', async (req: Request, res: Response) => {
  try {
    const body = statusSchema.parse(req.body);

    const { data: client, error } = await supabaseAdmin
      .from('clients')
      .update({ status: body.status })
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    if (body.status === 'paused' || body.status === 'cancelled') {
      await supabaseAdmin
        .from('client_subscriptions')
        .update({ status: body.status })
        .eq('client_id', req.params.id)
        .eq('status', 'active');
    }

    if (body.status === 'active') {
      await supabaseAdmin
        .from('client_subscriptions')
        .update({ status: 'active' })
        .eq('client_id', req.params.id)
        .eq('status', 'paused');
    }

    const enriched = await enrichClient(client);
    res.json({ success: true, data: enriched });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Update client status error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============================================================
// Client Subscription Management (add/remove plans + status)
// ============================================================

const addPlansSchema = z.object({
  plan_ids: z.array(z.string().uuid()).min(1),
});

router.post('/:id/subscriptions', async (req: Request, res: Response) => {
  try {
    const body = addPlansSchema.parse(req.body);
    const { error } = await assignPlansToClient(req.params.id as string, body.plan_ids);
    if (error) {
      res.status(500).json({ success: false, error });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Add client subscriptions error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.put('/:clientId/subscriptions/:csId/status', async (req: Request, res: Response) => {
  try {
    const body = statusSchema.parse(req.body);
    const { data, error } = await supabaseAdmin
      .from('client_subscriptions')
      .update({ status: body.status })
      .eq('id', req.params.csId)
      .eq('client_id', req.params.clientId)
      .select()
      .single();

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    // Propagate to the linked subscription card so billing, the talent's
    // SquadHire assignment, and the Subscription Cards tabs stay in sync. The card
    // cores reverse-sync back to this same row (harmless — already set). A
    // client_subscription with no card, or a card whose state doesn't allow the
    // transition, just leaves the Clients-side status changed + a warning.
    let cardWarning: string | undefined;
    const cardId = await findCardIdForClientSubscription(req.params.clientId as string, req.params.csId as string);
    if (cardId) {
      const actor = cardActor(req);
      const result =
        body.status === 'paused' ? await pauseCardCore(cardId, actor)
        : body.status === 'cancelled' ? await cancelCardCore(cardId, actor)
        : body.status === 'active' ? await resumeCardCore(cardId, 'rebroadcast', actor)
        : null;
      if (result && result.httpStatus >= 400 && result.body?.error) {
        cardWarning = `Client status set to ${body.status}, but the linked card wasn't updated: ${result.body.error}`;
      }
    }

    res.json({ success: true, data, ...(cardWarning ? { warning: cardWarning } : {}) });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Update client subscription status error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Archive a client subscription (soft-delete via archived_at).
// Kept on DELETE to avoid breaking existing callers; behavior is now archive, not hard-delete.
router.delete('/:clientId/subscriptions/:csId', async (req: Request, res: Response) => {
  try {
    const { error } = await supabaseAdmin
      .from('client_subscriptions')
      .update({ archived_at: new Date().toISOString() })
      .eq('id', req.params.csId)
      .eq('client_id', req.params.clientId)
      .is('archived_at', null);

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    // Archive the linked card too (best-effort), so it leaves the active
    // pipeline in Subscription Cards. "Already archived" is not an error here.
    let cardWarning: string | undefined;
    const cardId = await findCardIdForClientSubscription(req.params.clientId as string, req.params.csId as string);
    if (cardId) {
      const result = await archiveCardCore(cardId, cardActor(req));
      if (result.httpStatus >= 400 && result.body?.error && result.body.error !== 'Card is already archived') {
        cardWarning = `Subscription archived, but the linked card wasn't: ${result.body.error}`;
      }
    }
    res.json({ success: true, message: 'Subscription archived', ...(cardWarning ? { warning: cardWarning } : {}) });
  } catch (err) {
    console.error('Archive client subscription error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.post('/:clientId/subscriptions/:csId/unarchive', async (req: Request, res: Response) => {
  try {
    const { error } = await supabaseAdmin
      .from('client_subscriptions')
      .update({ archived_at: null })
      .eq('id', req.params.csId)
      .eq('client_id', req.params.clientId);

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    // Reinstate the linked card too (best-effort). "Only archived cards can be
    // reinstated" just means the card wasn't archived — not an error here.
    let cardWarning: string | undefined;
    const cardId = await findCardIdForClientSubscription(req.params.clientId as string, req.params.csId as string);
    if (cardId) {
      const result = await reinstateCardCore(cardId, cardActor(req));
      if (result.httpStatus >= 400 && result.body?.error && result.body.error !== 'Only archived cards can be reinstated') {
        cardWarning = `Subscription unarchived, but the linked card wasn't reinstated: ${result.body.error}`;
      }
    }
    res.json({ success: true, message: 'Subscription unarchived', ...(cardWarning ? { warning: cardWarning } : {}) });
  } catch (err) {
    console.error('Unarchive client subscription error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============================================================
// Per-client deliverable overrides
// ============================================================

router.get('/:clientId/subscriptions/:csId/deliverables', async (req: Request, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('client_subscription_deliverables')
      .select('*')
      .eq('client_subscription_id', req.params.csId)
      .order('sort_order');

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true, data });
  } catch (err) {
    console.error('List client deliverables error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

const createDeliverableSchema = z.object({
  kind: z.enum(['hours', 'item']),
  deliverable_type_id: z.string().uuid().nullable().optional(),
  per_day: z.number().min(0).default(0),
  per_week: z.number().min(0).default(0),
  per_month: z.number().min(0).default(0),
}).refine(
  (v) => (v.kind === 'hours' ? !v.deliverable_type_id : !!v.deliverable_type_id),
  { message: 'kind=hours requires no deliverable_type_id; kind=item requires one' },
);

router.post('/:clientId/subscriptions/:csId/deliverables', async (req: Request, res: Response) => {
  try {
    const body = createDeliverableSchema.parse(req.body);

    const { data: existing } = await supabaseAdmin
      .from('client_subscription_deliverables')
      .select('sort_order')
      .eq('client_subscription_id', req.params.csId)
      .order('sort_order', { ascending: false })
      .limit(1);
    const nextSort = ((existing?.[0]?.sort_order as number) ?? 0) + 1;

    const { data, error } = await supabaseAdmin
      .from('client_subscription_deliverables')
      .insert({
        client_subscription_id: req.params.csId,
        kind: body.kind,
        deliverable_type_id: body.kind === 'item' ? body.deliverable_type_id! : null,
        per_day: body.per_day,
        per_week: body.per_week,
        per_month: body.per_month,
        sort_order: nextSort,
      })
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
    console.error('Create client deliverable error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

const updateDeliverableSchema = z.object({
  deliverable_type_id: z.string().uuid().nullable().optional(),
  per_day: z.number().min(0).optional(),
  per_week: z.number().min(0).optional(),
  per_month: z.number().min(0).optional(),
  is_active: z.boolean().optional(),
});

router.put('/:clientId/subscriptions/:csId/deliverables/:id', async (req: Request, res: Response) => {
  try {
    const body = updateDeliverableSchema.parse(req.body);

    // Linked rows (source_plan_deliverable_id set) follow the plan — only is_active is editable here.
    const { data: existing, error: fetchErr } = await supabaseAdmin
      .from('client_subscription_deliverables')
      .select('source_plan_deliverable_id')
      .eq('id', req.params.id)
      .eq('client_subscription_id', req.params.csId)
      .single();

    if (fetchErr || !existing) {
      res.status(404).json({ success: false, error: 'Deliverable not found' });
      return;
    }

    const patch: Record<string, any> = {};
    if (body.is_active !== undefined) patch.is_active = body.is_active;

    if (existing.source_plan_deliverable_id == null) {
      // Custom row: values are editable too
      if (body.deliverable_type_id !== undefined) patch.deliverable_type_id = body.deliverable_type_id;
      if (body.per_day !== undefined) patch.per_day = body.per_day;
      if (body.per_week !== undefined) patch.per_week = body.per_week;
      if (body.per_month !== undefined) patch.per_month = body.per_month;
    }

    if (Object.keys(patch).length === 0) {
      res.json({ success: true, data: null });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('client_subscription_deliverables')
      .update(patch)
      .eq('id', req.params.id)
      .eq('client_subscription_id', req.params.csId)
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
    console.error('Update client deliverable error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.delete('/:clientId/subscriptions/:csId/deliverables/:id', async (req: Request, res: Response) => {
  try {
    const { error } = await supabaseAdmin
      .from('client_subscription_deliverables')
      .delete()
      .eq('id', req.params.id)
      .eq('client_subscription_id', req.params.csId);

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true, message: 'Deliverable removed' });
  } catch (err) {
    console.error('Delete client deliverable error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /admin/clients/:clientId/subscriptions/:csId/deliverables/reset
// Wipes overrides and re-copies the plan's current defaults.
router.post('/:clientId/subscriptions/:csId/deliverables/reset', async (req: Request, res: Response) => {
  try {
    const { data: cs, error: csErr } = await supabaseAdmin
      .from('client_subscriptions')
      .select('id, plan_id')
      .eq('id', req.params.csId)
      .eq('client_id', req.params.clientId)
      .single();

    if (csErr || !cs) {
      res.status(404).json({ success: false, error: 'Client subscription not found' });
      return;
    }

    await supabaseAdmin
      .from('client_subscription_deliverables')
      .delete()
      .eq('client_subscription_id', cs.id);

    await copyPlanDeliverables(cs.id, cs.plan_id);

    const { data } = await supabaseAdmin
      .from('client_subscription_deliverables')
      .select('*')
      .eq('client_subscription_id', cs.id)
      .order('sort_order');

    res.json({ success: true, data });
  } catch (err) {
    console.error('Reset deliverables error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
