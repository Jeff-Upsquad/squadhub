import {
  formatDeliverableCadence,
  partnerPriceFromCustomer,
  resolveFinalizedPrice,
  resolveFinalMargin,
  resolveMinCustomerPrice,
  resolveMinPartnerPrice,
  resolvePartnerPrice,
  type PlanMarginFields,
} from '@squadhub/shared';
import { config } from '../config';
import { supabaseAdmin } from '../supabase';
import { loadAssignmentMargin } from './assignmentCatalog';
import { resolveHireBusinessUserIdForCardDelivery } from './clientExternalLinks';

/**
 * Outbound delivery of a published subscription card to SquadHire's webhook.
 *
 * Strategy mirrors Profiles' callback service (deliberately — keeps the two
 * halves of the link symmetric):
 *   - Attempted inline at publish time, 3 attempts with 0/2/10s backoff.
 *   - If still undelivered, the card row is left with squadhire_synced_at
 *     NULL and squadhire_sync_last_error populated. A setInterval sweeper
 *     (startSquadhireSyncSweeper) retries every 5 min up to MAX_SYNC_ATTEMPTS.
 *   - If SQUADHIRE_WEBHOOK_URL is unset, delivery is a no-op with a logged
 *     reason, so local dev without SquadHire configured still works.
 *
 * The payload follows SquadHire's ingest contract (see its
 * ingestSubscriptionCardSchema): external_id, content, match_rules,
 * published_at, expires_at? — with `content` and `match_rules` being
 * free-form JSONB so SquadHub can evolve without a Profiles migration.
 */

const REQUEST_TIMEOUT_MS = 3_000;
// Activation now includes idempotent partner-account provisioning on the
// return leg, which can involve two Supabase projects and needs a wider budget.
const ACTIVATION_REQUEST_TIMEOUT_MS = 15_000;
const INLINE_ATTEMPTS = 3;
const INLINE_BACKOFF_MS = [0, 2_000, 10_000];
const MAX_SYNC_ATTEMPTS = 10;
const SWEEPER_INTERVAL_MS = 5 * 60 * 1_000;

// Check if a card has any offers (bidding started) — used to auto-derive
// percent from fixed margin so talent price never drops to zero on counters.
async function fetchBiddingStateForWebhook(externalId: string): Promise<{ hasOffers: boolean }> {
  if (!config.squadhireWebhookUrl || !config.squadhireWebhookSecret) return { hasOffers: false };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2000);
  try {
    const url = new URL(config.squadhireWebhookUrl);
    url.pathname = '/api/webhooks/squadhub/cards/offers-snapshot';
    url.search = '';
    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-SquadHub-Signature': config.squadhireWebhookSecret,
      },
      body: JSON.stringify({ external_id: externalId, source: 'squadhub' }),
      signal: controller.signal,
    });
    if (!res.ok) return { hasOffers: false };
    const json = (await res.json()) as { snapshot?: { offers?: unknown[] } };
    return { hasOffers: Array.isArray(json?.snapshot?.offers) && json.snapshot.offers.length > 0 };
  } catch {
    return { hasOffers: false };
  } finally {
    clearTimeout(timer);
  }
}
const SWEEPER_BATCH_SIZE = 20;

// Default hours/day per standard plan name. Used as a fallback for
// request/custom cards that aren't linked to a subscription_plan and don't
// have an explicit hours deliverable. Mirrors PLAN_HOURS in Profiles'
// request-cards.controller so both sides agree on the talent-facing label.
const PLAN_HOURS: Record<string, number> = {
  starter: 1,
  basic: 2,
  plus: 4,
  pro: 6,
  personal: 8,
};

// Card sources that DON'T link to a staged subscription
// (client_submission_subscriptions). For these, customer/plan/email metadata
// lives directly on the subscription_cards row instead of the staged record.
// Keep in sync with the chk_source constraint in supabase migrations.
const NON_STAGED_SOURCES = new Set([
  'request',
  'custom',
  'shared_form',
  'landing_page_form',
  'internal_brief',
]);

export interface SquadhireCardPayload {
  external_id: string;
  content: Record<string, unknown>;
  match_rules: Record<string, unknown>;
  published_at: string;
  expires_at?: string;
  // `active` while the card is live in SquadHub (state = 'published').
  // `archived` after Recall (back to draft) or Close. Profiles filters
  // archived cards out of talent-facing queries, so the talents stop
  // seeing the card. Always sent so reruns of the same delivery stay
  // idempotent.
  status: 'active' | 'assigned' | 'archived';
  // `broadcast` (default) = SquadHire broadcasts the card to talents.
  // `manual` = card appears in SquadHire's admin Published Cards list
  // but is NOT broadcast — talents only see it if hand-picked. Mirrors
  // the SquadHub side of the same lever. Always sent.
  distribution: 'broadcast' | 'manual';
  // The client lead's email — passed so SquadHire can resolve it to a
  // business_user and surface accepted talents in that client's dashboard
  // view. Omitted when the lead has no email or it doesn't look like one;
  // SquadHire's validator requires a valid email when present and we'd
  // rather skip the field than fail the whole delivery on a typo.
  business_email?: string;
  // Sent so SquadHire can either find a matching business_user by phone
  // or, if neither email nor phone resolve to an existing user, create a
  // pending invitation with these contact details. Phone is sent as the
  // raw string the customer typed; SquadHire normalises it on its side.
  business_phone?: string;
  business_contact_name?: string;
  business_company?: string;
  // Canonical SquadHire business_users.id from Hub's cross-app identity
  // link (stored stamp + activated-preferring soft-match). Profiles should
  // attach the card to this id when present so email-invite vs phone-login
  // splits don't hide the card on the business portal. Optional for
  // backwards compat with older Profiles deploys (unknown keys are stripped).
  business_user_id?: string;
  // ISO timestamp set when an admin recalled a card that already had
  // acceptances. SquadHire renders a "Recalled" tag on the talent's
  // accepted view but otherwise keeps the card visible. Absent on
  // never-recalled cards and on clean recalls (which become drafts).
  recalled_at?: string;
  // ISO timestamp set when an admin archived a card from SquadHub's
  // Archive tab. Stronger hide than recall — SquadHire removes the card
  // from BOTH talent (pending and responded) AND business dashboards.
  // Cleared on republish; sent as null in that case so SquadHire can
  // transition out of archived. Omitted entirely when never archived.
  archived_at?: string | null;
  // ISO timestamp set when an admin PAUSED an assigned subscription. The card
  // stays state='assigned' (pause only pulls the talent + ends the billing
  // term), so this is the only signal that lets SquadHire move the card from
  // its Active section to Paused. Sent as null when not paused so a resume
  // clears it. Requires SquadHub to re-deliver the card on pause/resume.
  paused_at?: string | null;
  // ISO timestamp set when an admin CANCELLED the subscription (card closed).
  // Rides alongside status='archived'; lets SquadHire's Cancelled section tell
  // a true cancel apart from a recall or plain close. Sent as null otherwise.
  cancelled_at?: string | null;
  // True when this card was created by SquadHub as a secondary (child of
  // another card via parent_card_id). SquadHire's business dashboard hides
  // secondaries from the published-cards list — only the primary surfaces.
  // Always sent so SquadHire can flip the flag both ways without ambiguity.
  is_secondary: boolean;
  // Shared id across the per-tier sibling cards SquadHub fanned out from one
  // multi-tier brief. SquadHire's business dashboard collapses cards with the
  // same group_id into a single card with a tab per tier. NULL on single-tier
  // / legacy cards. Always sent so SquadHire can group (or ungroup) cleanly.
  group_id: string | null;
  // Product line. 'subscription' (default) = the recurring-plan card; talents
  // see it in the subscription feed and the business portal under My
  // subscription. 'assignment' = a one-off freelance project — talent clients
  // tag it "Assignment" in the same feed and the business portal lists it in a
  // separate Assignments section. The project budget reuses content.monthly_price
  // / content.customer_monthly_price; the timeline rides in
  // content.assignment_details. Always sent so the consumer can store it on its
  // own card_type column without parsing content.
  card_type: 'subscription' | 'assignment' | 'hiring';
}

interface AttemptOutcome {
  delivered: boolean;
  error?: string;
  recipientCount?: number;
  // SquadHire refused this call on the merits (HTTP 409) — e.g. the talent's
  // level doesn't match the card's tier, or they're suspended. Unlike a
  // transport failure this can never succeed on retry, so callers stop
  // retrying and surface the message to the admin instead.
  rejected?: boolean;
}

// ------------------------------------------------------------
// Payload construction
// ------------------------------------------------------------

/**
 * Build the webhook payload from a card id by reading the card + joined
 * targeting rows + the subscription/plan names. Returns null if the card
 * disappeared (deleted between publish and sweeper tick).
 */
export async function buildSquadhirePayloadForCard(
  cardId: string,
): Promise<SquadhireCardPayload | null> {
  const { data: card } = await supabaseAdmin
    .from('subscription_cards')
    .select(
      'id, state, distribution, card_type, assignment_details, submission_subscription_id, working_days, brand_name, business_nature, notes, requirement_note, requirement_voice_url, additional_requirements, customer_location, custom_deliverables, disabled_default_deliverable_ids, target_tiers, min_experience_years, target_languages, squadhire_category_ids, published_at, partner_price_override, parent_card_id, brief_group_id, recalled_at, archived_at, paused_at, cancelled_at, source, proposed_price, subscription_price, markup, customer_company, customer_email, customer_phone, customer_name, service_type, plan_name, plan_snapshot, lead_submission_id',
    )
    .eq('id', cardId)
    .maybeSingle();
  if (!card) return null;

  // Frozen plan-side data (hours, deliverables, pricing) captured at publish
  // time. When set, all plan reads below short-circuit to this object so the
  // partner sees what existed at publish, not whatever the plan looks like now.
  const planSnapshot =
    (card as any).plan_snapshot && typeof (card as any).plan_snapshot === 'object'
      ? ((card as any).plan_snapshot as {
          plan?: { id: string; plan: string | null; tier: string | null; daily_hours: number | null; weekly_hours: number | null };
          deliverables?: Array<{ id: string; kind: 'hours' | 'item'; deliverable_type_id: string | null; deliverable_type_name: string | null; per_day: number; per_week: number; per_month: number; sort_order: number }>;
          pricing?: Array<{ country_id: string; price: number; margin_value: number; margin_type: 'fixed' | 'percent' }>;
          partner_pricing?: Array<{ country_id: string; price: number }>;
        })
      : null;

  // For secondary cards, resolve content fields from the parent.
  let contentSource = card;
  if (card.parent_card_id) {
    const { data: parent } = await supabaseAdmin
      .from('subscription_cards')
      .select(
        'id, submission_subscription_id, working_days, brand_name, business_nature, notes, requirement_note, requirement_voice_url, additional_requirements, customer_location, custom_deliverables, disabled_default_deliverable_ids, target_tiers, min_experience_years, target_languages, squadhire_category_ids, proposed_price, subscription_price, markup, partner_price_override',
      )
      .eq('id', card.parent_card_id)
      .maybeSingle();
    if (!parent) return null;
    contentSource = parent as any;
  }

  // Never-published guard — the single chokepoint for EVERY delivery path
  // (archive / reinstate / inline publish / retry sweeper).
  //
  // Default: a card that was never published has no talent-facing mirror on
  // SquadHire, so "delivering" it would CREATE the card there and risk a
  // first-ingest fan-out/WhatsApp blast (reproduced 2026-07-05: archive of
  // broadcast drafts created mirrors). Only cards actually published
  // (published_at set) or advanced past it (assigned / closed) may reach
  // SquadHire for normal publish/reinstate traffic.
  //
  // Exception — archive takedown of CRM pending briefs: deal-briefs create a
  // business-visible status='submitted' mirror on SquadHire via the separate
  // /pending-brief endpoint, WITHOUT publishing on Hub. When those cards are
  // archived on Hub, we MUST still re-deliver so Hire can hide them. The
  // payload status maps to 'archived' (archived_at is set), and Profiles'
  // ingest skips fan-out for non-active statuses — so even a first-contact
  // create can't broadcast. This is the belt to the sweeper's own filter.
  const isArchiveTakedown = !!(card as any).archived_at;
  const wasEverPublished =
    !!(card as any).published_at ||
    card.state === 'published' ||
    card.state === 'assigned' ||
    card.state === 'closed';
  if (!wasEverPublished && !isArchiveTakedown) {
    console.warn(
      '[squadhire] skipping delivery — card was never published',
      { cardId, state: card.state, archived: isArchiveTakedown },
    );
    return null;
  }

  // Skip-if-empty gate: an admin who didn't pick any SquadHire categories
  // doesn't want this card on SquadHire. The publish handler treats a null
  // payload as a no-op, so the outbound fetch + retry loop never starts.
  // Archive takedowns of pending-brief mirrors are exempt — those cards may
  // exist on Hire without categories and still need the hide signal.
  const categoryIds = Array.isArray(contentSource.squadhire_category_ids)
    ? (contentSource.squadhire_category_ids as string[])
    : [];
  if (categoryIds.length === 0 && !isArchiveTakedown) {
    // Without this log, a forgotten-checkbox publish is invisible: no fetch,
    // no error, no audit trail. Surface it so it's at least diagnosable in
    // pm2 logs after the fact.
    console.warn(
      '[squadhire] skipping delivery — card has no SquadHire categories',
      { cardId, state: card.state },
    );
    return null;
  }

  // Tier-required gate (belt-and-suspenders to the publish-time check). If
  // a card slips through publish without target_tiers (legacy rows, direct
  // DB edits), refuse to broadcast it. SquadHire's matcher would otherwise
  // skip its tier filter and deliver to every category-matching talent.
  // Archive takedowns skip this too — same reason as the category gate.
  const cardPublishTargets = Array.isArray((card as any).publish_targets)
    ? ((card as any).publish_targets as string[])
    : ['partner', 'talent'];
  const cardTargetTiers = Array.isArray(contentSource.target_tiers)
    ? ((contentSource.target_tiers as string[]).filter(Boolean))
    : [];
  if (
    !isArchiveTakedown &&
    cardPublishTargets.includes('talent') &&
    cardTargetTiers.length === 0
  ) {
    console.warn(
      '[squadhire] skipping delivery — card targets talent but has no tiers',
      { cardId, state: card.state },
    );
    return null;
  }

  // Product line. Assignment cards reuse the whole payload shape; they just
  // skip the subscription-only plan/hours/price labels (their plan_name is
  // null, so those resolutions naturally no-op) and carry project budget +
  // timeline in `content` instead. Always sent so the consumer can store it.
  const cardType: 'subscription' | 'assignment' | 'hiring' =
    ((card as any).card_type as 'subscription' | 'assignment' | 'hiring') ?? 'subscription';

  // Map SquadHub state → SquadHire status. archived_at dominates: if
  // an admin explicitly archived the card it's hidden everywhere on
  // SquadHire regardless of underlying state (a published card archived
  // by an admin would otherwise leak through as 'active').
  const isArchived = !!(card as any).archived_at;
  const status: 'active' | 'assigned' | 'archived' =
    isArchived ? 'archived'
      : card.state === 'published' ? 'active'
        : card.state === 'assigned' ? 'assigned'
          : 'archived';

  const targetingCardId = contentSource.id as string;
  const stagedSubId = contentSource.submission_subscription_id;

  const [
    { data: countryRows },
    { data: regionRows },
    { data: staged },
  ] = await Promise.all([
    supabaseAdmin
      .from('subscription_card_target_countries')
      .select('country_id, countries!inner(name)')
      .eq('card_id', targetingCardId),
    supabaseAdmin
      .from('subscription_card_target_regions')
      .select('country_id, region, countries!inner(name)')
      .eq('card_id', targetingCardId),
    stagedSubId
      ? supabaseAdmin
          .from('client_submission_subscriptions')
          .select('subscription_id, plan_id, submission_id')
          .eq('id', stagedSubId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  let subscriptionName: string | null = null;
  let planName: string | null = null;
  let planTier: string | null = null;
  let leadCountryId: string | null = null;
  let leadEmail: string | null = null;
  let leadPhone: string | null = null;
  let leadContactName: string | null = null;
  let leadCompany: string | null = null;
  let planHoursDeliverable: { per_day: number; per_week: number; per_month: number } | null = null;
  let planItemDeliverables: Array<{ kind: string; name: string; deliverable_type_id: string | null; per_day: number; per_week: number; per_month: number }> = [];

  // For non-staged cards (request/custom/shared_form/landing_page_form), read
  // metadata from the card itself instead of from a staged subscription row.
  const cardSource = (contentSource as any).source as string | undefined;
  if (!staged && cardSource && NON_STAGED_SOURCES.has(cardSource)) {
    subscriptionName = (contentSource as any).service_type ?? null;
    planName = (contentSource as any).plan_name ?? null;
    leadEmail = (contentSource as any).customer_email ?? null;
    leadPhone = (contentSource as any).customer_phone ?? null;
    leadContactName = (contentSource as any).customer_name ?? null;
    leadCompany = (contentSource as any).customer_company ?? null;

    // Resolve the matching subscription_plan and read its deliverables so the
    // talent sees the actual configured hours/items instead of the hardcoded
    // PLAN_HOURS fallback. Falls back gracefully when no plan matches (typo'd
    // service_type, plan_name not in the catalog, etc) — the existing
    // PLAN_HOURS path further down still runs as a last resort.
    if (subscriptionName && planName) {
      // Mirror the upsquad-label → SquadHub-slug map used by the request-publish
      // path (server/src/routes/subscription-cards-admin-requests.ts). Try slug
      // first, then case-insensitive name match for hand-typed custom cards.
      const SERVICE_SLUG_MAP: Record<string, string> = {
        Designers: 'designer',
        Editors: 'video_editor',
        'Designer plus Editor': 'designer_video_editor',
      };
      const guessedSlug =
        SERVICE_SLUG_MAP[subscriptionName] ??
        subscriptionName.toLowerCase().trim().replace(/\s+/g, '_');

      const { data: subRow } = await supabaseAdmin
        .from('subscriptions')
        .select('id')
        .or(`slug.eq.${guessedSlug},name.ilike.${subscriptionName}`)
        .limit(1)
        .maybeSingle();

      if (subRow?.id) {
        // Disambiguate by tier. plan_name (Starter/Basic/Plus/Pro/Personal)
        // exists for multiple tiers (Junior/Pro/Top Talents) — without a tier
        // filter the lookup hits 3 rows and `.maybeSingle()` returns null,
        // dropping us into the PLAN_HOURS fallback. The card's target_tiers
        // controls which tier the talent will be drawn from; pick the first
        // entry. Default to 'Junior' when target_tiers is empty so we still
        // resolve to a row instead of nothing.
        const targetTiers = Array.isArray((contentSource as any).target_tiers)
          ? ((contentSource as any).target_tiers as string[]).filter(Boolean)
          : [];
        const targetTier = targetTiers[0] || 'Junior';
        const { data: planRow } = await supabaseAdmin
          .from('subscription_plans')
          .select('id, tier')
          .eq('subscription_id', subRow.id)
          .ilike('plan', planName)
          .ilike('tier', targetTier)
          .maybeSingle();

        if (planRow?.id) {
          // Surface the resolved tier on the payload so SquadHire can render
          // "Basic · Pro" alongside the plan name (parity with staged cards).
          planTier = (planRow.tier as string | null | undefined) ?? planTier;
          const [{ data: planDelivs }, { data: delivTypes }] = await Promise.all([
            supabaseAdmin
              .from('subscription_plan_deliverables')
              .select('id, kind, per_day, per_week, per_month, deliverable_type_id')
              .eq('plan_id', planRow.id),
            supabaseAdmin
              .from('subscription_deliverable_types')
              .select('id, name')
              .eq('subscription_id', subRow.id),
          ]);

          const disabledIds = new Set<string>(
            Array.isArray(contentSource.disabled_default_deliverable_ids)
              ? (contentSource.disabled_default_deliverable_ids as string[])
              : [],
          );
          const hoursRow = (planDelivs ?? []).find(
            (d: any) => d.kind === 'hours' && !disabledIds.has(d.id),
          );
          if (hoursRow) {
            planHoursDeliverable = {
              per_day: Number(hoursRow.per_day) || 0,
              per_week: Number(hoursRow.per_week) || 0,
              per_month: Number(hoursRow.per_month) || 0,
            };
          }

          const typeNameMap: Record<string, string> = {};
          (delivTypes ?? []).forEach((t: any) => { typeNameMap[t.id] = t.name; });

          planItemDeliverables = (planDelivs ?? [])
            .filter((d: any) => d.kind === 'item' && !disabledIds.has(d.id))
            .map((d: any) => ({
              kind: 'item',
              name: typeNameMap[d.deliverable_type_id] || 'Deliverable',
              deliverable_type_id: d.deliverable_type_id ?? null,
              per_day: Number(d.per_day) || 0,
              per_week: Number(d.per_week) || 0,
              per_month: Number(d.per_month) || 0,
            }));
        }
      }
    }
  } else if (staged) {
    const [{ data: sub }, { data: plan }, { data: submission }, { data: planDelivs }, { data: delivTypes }] = await Promise.all([
      supabaseAdmin.from('subscriptions').select('name').eq('id', staged.subscription_id).maybeSingle(),
      // subscription_plans has columns `plan` (Starter/Basic/Plus/Pro/Personal)
      // and `tier` (Junior/Pro/Top Talents). The earlier `select('name')` was a typo
      // — there's no `name` column, so plan_name was always null on Profiles.
      supabaseAdmin.from('subscription_plans').select('plan, tier').eq('id', staged.plan_id).maybeSingle(),
      supabaseAdmin
        .from('client_submissions')
        .select('country_id, email, contact_number, contact_person, business_name')
        .eq('id', staged.submission_id)
        .maybeSingle(),
      supabaseAdmin
        .from('subscription_plan_deliverables')
        .select('id, kind, per_day, per_week, per_month, deliverable_type_id')
        .eq('plan_id', staged.plan_id),
      supabaseAdmin
        .from('subscription_deliverable_types')
        .select('id, name')
        .eq('subscription_id', staged.subscription_id),
    ]);
    subscriptionName = sub?.name ?? null;
    planName = (plan?.plan as string | null | undefined) ?? null;
    planTier = (plan?.tier as string | null | undefined) ?? null;
    leadCountryId = (submission?.country_id as string | undefined) ?? null;
    leadEmail = (submission?.email as string | undefined)?.trim() || null;
    leadPhone = (submission?.contact_number as string | undefined)?.trim() || null;
    leadContactName = (submission?.contact_person as string | undefined)?.trim() || null;
    leadCompany = (submission?.business_name as string | undefined)?.trim() || null;
    // Respect the per-card disable flag — when the salesperson toggles off
    // the plan's hours-kind deliverable on a card, don't fold it into the
    // payload. (SquadHub's editor copy promises "the talent sees 'No hourly
    // commitment'" in that case.)
    const disabledIds = new Set<string>(
      Array.isArray(contentSource.disabled_default_deliverable_ids)
        ? (contentSource.disabled_default_deliverable_ids as string[])
        : [],
    );
    const hoursRow = (planDelivs ?? []).find(
      (d: any) => d.kind === 'hours' && !disabledIds.has(d.id),
    );
    if (hoursRow) {
      planHoursDeliverable = {
        per_day: Number(hoursRow.per_day) || 0,
        per_week: Number(hoursRow.per_week) || 0,
        per_month: Number(hoursRow.per_month) || 0,
      };
    }

    const typeNameMap: Record<string, string> = {};
    (delivTypes ?? []).forEach((t: any) => { typeNameMap[t.id] = t.name; });

    planItemDeliverables = (planDelivs ?? [])
      .filter((d: any) => d.kind === 'item' && !disabledIds.has(d.id))
      .map((d: any) => ({
        kind: 'item',
        name: typeNameMap[d.deliverable_type_id] || 'Deliverable',
        deliverable_type_id: d.deliverable_type_id ?? null,
        per_day: Number(d.per_day) || 0,
        per_week: Number(d.per_week) || 0,
        per_month: Number(d.per_month) || 0,
      }));
  }

  // Frozen plan-snapshot wins over the live reads above. Cards in any
  // non-draft state were published from a specific plan revision, and
  // later edits to that plan must not silently rewrite the values
  // partners already saw.
  if (planSnapshot) {
    if (planSnapshot.plan) {
      planName = planSnapshot.plan.plan ?? planName;
      planTier = planSnapshot.plan.tier ?? planTier;
    }
    const disabledIdsForSnapshot = new Set<string>(
      Array.isArray(contentSource.disabled_default_deliverable_ids)
        ? (contentSource.disabled_default_deliverable_ids as string[])
        : [],
    );
    const snapHours = (planSnapshot.deliverables ?? []).find(
      (d) => d.kind === 'hours' && !disabledIdsForSnapshot.has(d.id),
    );
    planHoursDeliverable = snapHours
      ? {
          per_day: Number(snapHours.per_day) || 0,
          per_week: Number(snapHours.per_week) || 0,
          per_month: Number(snapHours.per_month) || 0,
        }
      : null;
    planItemDeliverables = (planSnapshot.deliverables ?? [])
      .filter((d) => d.kind === 'item' && !disabledIdsForSnapshot.has(d.id))
      .map((d) => ({
        kind: 'item',
        name: d.deliverable_type_name ?? 'Deliverable',
        deliverable_type_id: d.deliverable_type_id ?? null,
        per_day: Number(d.per_day) || 0,
        per_week: Number(d.per_week) || 0,
        per_month: Number(d.per_month) || 0,
      }));
  }

  // Hours resolution: a card's custom_deliverables can carry an hours entry
  // that overrides the plan default (same pattern as partner price). Prefer
  // the card-level override, fall back to the plan deliverable.
  const cardHoursOverride = Array.isArray(contentSource.custom_deliverables)
    ? (contentSource.custom_deliverables as any[]).find((d) => d?.kind === 'hours')
    : null;
  const hoursSource = cardHoursOverride
    ? {
        per_day: Number(cardHoursOverride.per_day) || 0,
        per_week: Number(cardHoursOverride.per_week) || 0,
        per_month: Number(cardHoursOverride.per_month) || 0,
      }
    : planHoursDeliverable;
  let hoursLabel: string | null = null;
  if (hoursSource && (hoursSource.per_day || hoursSource.per_week || hoursSource.per_month)) {
    // The Subscriptions admin editor only exposes per_day and per_week, so
    // per_month is almost always 0 in the DB. Without derivation the talent
    // sees "X hrs/day · Y hrs/week · 0 hrs/month", which reads as "no monthly
    // commitment". Fill in the missing values so all three numbers reflect
    // the same cadence: per_week from per_day × working_days, per_month from
    // per_week × 4.
    const workingDays = Array.isArray(contentSource.working_days)
      ? ((contentSource.working_days as string[]).length || 5)
      : 5;
    const perDay = hoursSource.per_day || 0;
    const perWeek = hoursSource.per_week || perDay * workingDays;
    const perMonth = hoursSource.per_month || perWeek * 4;
    hoursLabel = formatDeliverableCadence(perDay, perWeek, perMonth, 'hrs');
  }

  // Fallback for non-staged cards: derive hours from the standard plan
  // name (Starter/Basic/Plus/Pro/Personal) since these cards aren't linked
  // to a subscription_plan and the admin typically doesn't add a manual
  // hours deliverable. Without this, the talent's "Work commitment" panel
  // is hidden entirely on freshly published-from-request cards.
  if (
    !hoursLabel &&
    !staged &&
    cardSource &&
    NON_STAGED_SOURCES.has(cardSource) &&
    typeof planName === 'string'
  ) {
    const hpd = PLAN_HOURS[planName.toLowerCase().trim()];
    if (hpd) {
      const workingDays = Array.isArray(contentSource.working_days)
        ? (contentSource.working_days as string[])
        : [];
      const days = workingDays.length || 5;
      const perWeek = hpd * days;
      const perMonth = perWeek * 4;
      hoursLabel = `${hpd} hrs/day · ${perWeek} hrs/week · ${perMonth} hrs/month`;
    }
  }

  // Resolve partner price for the card's country.
  //
  // Country resolution: cards can target multiple countries via
  // subscription_card_target_countries, but the per-card override is a single
  // scalar so we need exactly one country to read the plan default against.
  // Preference order: the single target-country (if the card has exactly one),
  // else fall back to the lead's country. Zero or multiple target countries
  // without a lead country → skip the Payment section on Profiles.
  const targetCountryIdList = (countryRows ?? []).map((r: any) => r.country_id as string);
  const pricingCountryId =
    targetCountryIdList.length === 1 ? targetCountryIdList[0] : leadCountryId;

  let resolvedMonthlyPrice: number | null = null;
  let resolvedCustomerMonthlyPrice: number | null = null;
  let resolvedCurrency: string | null = null;
  // Margin row for this country — used both for listed partner pay and for
  // the bid-floor / percent-ceil rules sent to SquadHire.
  let stagedMarginRow: PlanMarginFields | null = null;

  // Assignment cards have no plan snapshot: eagerly load the margin from
  // the assignment catalog so downstream price derivation (partner price =
  // finalized − margin) applies the correct cut instead of defaulting to zero.
  if ((contentSource as any).card_type === 'assignment' && pricingCountryId) {
    const tiers = Array.isArray((contentSource as any).target_tiers)
      ? ((contentSource as any).target_tiers as string[]).filter(Boolean)
      : [];
    stagedMarginRow = await loadAssignmentMargin({
      serviceType: (contentSource as any).service_type as string | null,
      tier: tiers[0] ?? null,
      countryId: pricingCountryId,
    });
  }

  if (planSnapshot && pricingCountryId) {
    // Frozen pricing path: use the snapshot captured at publish time.
    const customerRow = (planSnapshot.pricing ?? []).find(
      (p) => p.country_id === pricingCountryId,
    );
    const partnerRow = (planSnapshot.partner_pricing ?? []).find(
      (p) => p.country_id === pricingCountryId,
    );
    const { data: country } = await supabaseAdmin
      .from('countries')
      .select('currency')
      .eq('id', pricingCountryId)
      .maybeSingle();
    if (customerRow) {
      stagedMarginRow = {
        price: Number(customerRow.price) || 0,
        margin_value: Number(customerRow.margin_value) || 0,
        margin_type: customerRow.margin_type ?? 'fixed',
      };
      resolvedCustomerMonthlyPrice = Number(customerRow.price);
      if (country?.currency) resolvedCurrency = country.currency as string;
    }
    // Prefer margin-derived partner (override → finalize − margin → legacy
    // partner_pricing row) so fixed/% catalog rules stay the source of truth.
    const override = card.partner_price_override as number | null | undefined;
    const cardFields = {
      markup: (contentSource as any).markup as number | null,
      partner_price_override: override ?? null,
      subscription_price: (contentSource as any).subscription_price as number | null,
      proposed_price: (contentSource as any).proposed_price as number | null,
    };
    const derivedPartner =
      override ??
      (resolvedCustomerMonthlyPrice != null
        ? partnerPriceFromCustomer(resolvedCustomerMonthlyPrice, cardFields, stagedMarginRow)
        : null) ??
      (partnerRow ? Number(partnerRow.price) : null);
    if (derivedPartner != null && country?.currency) {
      resolvedMonthlyPrice = derivedPartner;
      resolvedCurrency = country.currency as string;
    }
  } else if (pricingCountryId && staged?.plan_id) {
    const [{ data: planPartner }, { data: planCustomer }, { data: country }] = await Promise.all([
      supabaseAdmin
        .from('subscription_plan_partner_pricing')
        .select('price')
        .eq('plan_id', staged.plan_id)
        .eq('country_id', pricingCountryId)
        .maybeSingle(),
      supabaseAdmin
        .from('subscription_plan_pricing')
        .select('price, margin_value, margin_type')
        .eq('plan_id', staged.plan_id)
        .eq('country_id', pricingCountryId)
        .maybeSingle(),
      supabaseAdmin
        .from('countries')
        .select('currency')
        .eq('id', pricingCountryId)
        .maybeSingle(),
    ]);
    const customer = (planCustomer?.price as number | undefined) ?? null;
    if (customer != null) {
      stagedMarginRow = {
        price: customer,
        margin_value: Number(planCustomer?.margin_value) || 0,
        margin_type: ((planCustomer?.margin_type as 'fixed' | 'percent') ?? 'fixed'),
      };
      resolvedCustomerMonthlyPrice = customer;
      if (country?.currency) resolvedCurrency = country.currency as string;
    }
    const override = card.partner_price_override as number | null | undefined;
    const cardFields = {
      markup: (contentSource as any).markup as number | null,
      partner_price_override: override ?? null,
      subscription_price: (contentSource as any).subscription_price as number | null,
      proposed_price: (contentSource as any).proposed_price as number | null,
    };
    const derivedPartner =
      override ??
      (resolvedCustomerMonthlyPrice != null
        ? partnerPriceFromCustomer(resolvedCustomerMonthlyPrice, cardFields, stagedMarginRow)
        : null) ??
      ((planPartner?.price as number | undefined) ?? null);
    if (derivedPartner != null && country?.currency) {
      resolvedMonthlyPrice = derivedPartner;
      resolvedCurrency = country.currency as string;
    }
  }

  // A finalized subscription price set on the card is the source of truth for
  // what the client pays — it overrides the catalog customer price on staged
  // cards. Re-derive partner from margin so the talent side tracks Final.
  {
    const finalized = (contentSource as any).subscription_price as number | null;
    if (finalized != null && finalized > 0) {
      resolvedCustomerMonthlyPrice = finalized;
      if (!resolvedCurrency) resolvedCurrency = 'INR';
      const override = card.partner_price_override as number | null | undefined;
      if (override == null) {
        const cardFields = {
          markup: (contentSource as any).markup as number | null,
          partner_price_override: null,
          subscription_price: finalized,
          proposed_price: (contentSource as any).proposed_price as number | null,
        };
        resolvedMonthlyPrice = partnerPriceFromCustomer(
          finalized,
          cardFields,
          stagedMarginRow,
        );
      }
    }
  }

  // For non-staged cards: the finalized subscription price (or proposed price)
  // is what the customer pays/sees, and the talent earns the partner price
  // (finalized - final margin, or the partner override). Prefer plan_snapshot
  // margin when present; otherwise null markup → zero margin (full pay).
  if (!staged && cardSource && NON_STAGED_SOURCES.has(cardSource)) {
    let nonStagedMargin = stagedMarginRow;
    if (!nonStagedMargin && planSnapshot?.pricing?.length) {
      const row =
        (pricingCountryId &&
          planSnapshot.pricing.find((p) => p.country_id === pricingCountryId)) ||
        (planSnapshot.pricing.length === 1 ? planSnapshot.pricing[0] : null);
      if (row) {
        nonStagedMargin = {
          price: Number(row.price) || 0,
          margin_value: Number(row.margin_value) || 0,
          margin_type: row.margin_type ?? 'fixed',
        };
      }
    }
    // Assignment cards have no plan snapshot: load the margin from the
    // assignment catalog (service + tier + country) so the talent sees the
    // partner price (finalized − margin) instead of the full customer price.
    if (!nonStagedMargin && (contentSource as any).card_type === 'assignment') {
      const tiers = Array.isArray((contentSource as any).target_tiers)
        ? ((contentSource as any).target_tiers as string[]).filter(Boolean)
        : [];
      nonStagedMargin = await loadAssignmentMargin({
        serviceType: (contentSource as any).service_type as string | null,
        tier: tiers[0] ?? null,
        countryId: pricingCountryId,
      });
    }
    const finalized = resolveFinalizedPrice(contentSource as any);
    const partner = resolvePartnerPrice(contentSource as any, nonStagedMargin);
    if (finalized != null) {
      resolvedMonthlyPrice = partner ?? finalized;
      resolvedCustomerMonthlyPrice = finalized;
      resolvedCurrency = 'INR';
    }
  }

  const brand = ((contentSource as any).customer_company || contentSource.brand_name || '').trim();
  const titleParts = [brand, subscriptionName, planName].filter(Boolean) as string[];
  const title = titleParts.length > 0 ? titleParts.join(' — ') : 'New subscription opportunity';

  // SquadHire's renderer shows business_nature and working_days as their own
  // labelled fields, so don't echo them here. `description` is just the
  // free-form notes the customer typed; if there's no note, send empty so the
  // renderer skips the section entirely instead of showing a duplicate.
  const description = (contentSource.notes ?? '').toString();

  // match_rules: `category_ids` is the primary axis SquadHire's matcher
  // currently honours. Everything else is pass-through — SquadHire logs-and-
  // skips unknown keys today, so forwarding tier/experience/language/country
  // gives future matcher growth a free upgrade with no SquadHub change.
  const match_rules: Record<string, unknown> = {
    category_ids: categoryIds,
  };
  const targetTiers: string[] = Array.isArray(contentSource.target_tiers) ? contentSource.target_tiers : [];
  if (targetTiers.length > 0) match_rules.target_tiers = targetTiers;
  if ((contentSource.min_experience_years ?? 0) > 0) {
    match_rules.min_experience_years = contentSource.min_experience_years;
  }
  if (Array.isArray(contentSource.target_languages) && contentSource.target_languages.length > 0) {
    match_rules.target_languages = contentSource.target_languages;
  }
  const targetCountryIds = (countryRows ?? []).map((r: any) => r.country_id as string);
  if (targetCountryIds.length > 0) match_rules.target_country_ids = targetCountryIds;
  const targetCountryNames = (countryRows ?? [])
    .map((r: any) => (r.countries?.name as string) ?? '')
    .filter(Boolean);
  if (targetCountryNames.length > 0) match_rules.target_country_names = targetCountryNames;
  const targetRegions = (regionRows ?? []).map((r: any) => ({
    country_id: r.country_id as string,
    country_name: (r.countries?.name as string) ?? '',
    region: r.region as string,
  }));
  if (targetRegions.length > 0) match_rules.target_regions = targetRegions;

  // Normalise to the Z-suffix form of ISO-8601. Postgres / the Supabase
  // client return `...+00:00`, which some consumers' ISO validators reject
  // by default (zod's `.datetime()` is one). Sending Z form keeps the
  // contract canonical regardless of how lenient the other side is.
  const publishedAtRaw = (card.published_at as string | null) ?? new Date().toISOString();
  const publishedAt = new Date(publishedAtRaw).toISOString();

  // Client-brief "Short Note About the Requirement" — surfaces on the talent
  // card as Deliverables. Keep as its own field too so consumers can use it
  // without overloading deliverables_label.
  const requirementNote = String((contentSource as any).requirement_note ?? '').trim();

  const mergedCustomDeliverables = (() => {
    const cardDelivs: any[] = Array.isArray(contentSource.custom_deliverables)
      ? (contentSource.custom_deliverables as any[])
      : [];
    if (planItemDeliverables.length === 0) return cardDelivs;
    const cardItemTypeIds = new Set(
      cardDelivs
        .filter((d) => d?.kind === 'item' && d?.deliverable_type_id)
        .map((d) => d.deliverable_type_id),
    );
    const planOnly = planItemDeliverables.filter(
      (d) => !d.deliverable_type_id || !cardItemTypeIds.has(d.deliverable_type_id),
    );
    return [...cardDelivs, ...planOnly];
  })();
  const hasItemDeliverables = mergedCustomDeliverables.some((d: any) => d?.kind === 'item');

  const content: Record<string, unknown> = {
    title,
    description,
    brand_name: contentSource.brand_name ?? null,
    // About-the-client fields — keep nature vs location separate so SquadHire
    // never labels a place name as "Nature of business".
    business_nature: contentSource.business_nature ?? null,
    customer_location: (contentSource as any).customer_location ?? null,
    working_days: contentSource.working_days ?? [],
    notes: contentSource.notes ?? null,
    requirement_note: requirementNote || null,
    // Client's recorded requirement voice note (public R2 URL). Talent can
    // listen to it in SquadHire before accepting.
    requirement_voice_url: ((contentSource as any).requirement_voice_url ?? null) || null,
    // Optional skills/tools the business requested. Descriptive only — rendered
    // on the talent card and presence-matched on the business review list.
    // Deliberately kept OUT of match_rules so it never affects broadcast.
    additional_requirements: (contentSource as any).additional_requirements ?? null,
    subscription_name: subscriptionName,
    plan_name: planName,
    // Tier is the partner-skill bracket (Junior/Pro/Top Talents). Sent as a
    // separate field so SquadHire can show it next to plan_name on the
    // business dashboard ("Pro · Top Talents") without parsing a combined string.
    plan_tier: planTier,
    custom_deliverables: mergedCustomDeliverables,
    // Customer-facing context the talent finds useful before accepting:
    customer_company: leadCompany,
  };
  // Attach the resolved partner price only when we have both amount and
  // currency — Profiles' renderer hides the Payment section on missing data.
  if (resolvedMonthlyPrice != null && resolvedCurrency) {
    content.monthly_price = resolvedMonthlyPrice;
    content.currency = resolvedCurrency;
  }
  // Customer-facing monthly price — what the client (e.g. Motorola) actually
  // pays SquadHub each month. Profiles' business dashboard renders this on
  // the card row; partners/talents only ever see `monthly_price` (their pay).
  // Send currency too in case partner pricing was missing — keeps the chip
  // renderable when only customer price exists.
  if (resolvedCustomerMonthlyPrice != null && resolvedCurrency) {
    content.customer_monthly_price = resolvedCustomerMonthlyPrice;
    if (content.currency == null) content.currency = resolvedCurrency;
  }

  // Bidding rules for SquadHire: keep the same margin across counters, and
  // enforce catalog min floors (business + talent). Percent cuts ceil to ₹100.
  // Fixed margins are auto-derived to percent when bidding so talent price
  // never goes below zero proportionally: pct = fixed / listingPrice.
  {
    const cardFields = {
      markup: (contentSource as any).markup as number | null,
      partner_price_override: (card as any).partner_price_override as number | null,
      subscription_price: (contentSource as any).subscription_price as number | null,
      proposed_price: (contentSource as any).proposed_price as number | null,
    };
    let marginRow: PlanMarginFields | null = null;
    if (planSnapshot && pricingCountryId) {
      const row = (planSnapshot.pricing ?? []).find((p) => p.country_id === pricingCountryId);
      if (row) {
        marginRow = {
          price: Number(row.price) || 0,
          margin_value: Number(row.margin_value) || 0,
          margin_type: row.margin_type ?? 'fixed',
        };
      }
    }
    const minCustomer = resolveMinCustomerPrice(marginRow);
    const minPartner = resolveMinPartnerPrice(cardFields, marginRow);
    if (minCustomer != null) content.min_customer_price = minCustomer;
    if (minPartner != null) content.min_partner_price = minPartner;

    // Effective margin rule: card markup freezes to fixed absolute; else plan.
    // For bidding safety, fixed margins are converted to percent derived from
    // the listing price so counters scale proportionally and talent never hits zero.
    let effectiveMarginType: 'fixed' | 'percent' | null = null;
    let effectiveMarginValue: number | null = null;
    if (cardFields.markup != null) {
      effectiveMarginType = 'fixed';
      effectiveMarginValue = cardFields.markup;
    } else if (marginRow && marginRow.margin_value != null) {
      effectiveMarginType = marginRow.margin_type ?? 'fixed';
      effectiveMarginValue = marginRow.margin_value;
    }
    // Auto-derive percent from fixed when we have a listing price — this keeps
    // the initial partner price identical (e.g. 5000/25000=20% → 5000 cut) but
    // makes subsequent counters proportional (6000 → 4800 talent, not 1000).
    const listingPrice = resolveFinalizedPrice(cardFields) ?? resolvedCustomerMonthlyPrice ?? null;
    if (effectiveMarginType === 'fixed' && effectiveMarginValue != null && listingPrice != null && listingPrice > 0) {
      // Detect if bidding has started by checking SquadHire offers snapshot.
      // We do a best-effort check; if it fails we keep fixed to avoid blocking delivery.
      let biddingStarted = false;
      try {
        const snap = await fetchBiddingStateForWebhook(card.id as string);
        biddingStarted = snap.hasOffers;
      } catch {}
      if (biddingStarted) {
        const pct = Math.round((effectiveMarginValue / listingPrice) * 1000) / 10;
        if (pct > 0 && pct < 100) {
          effectiveMarginType = 'percent';
          effectiveMarginValue = pct;
        }
      }
    }
    if (effectiveMarginType != null) {
      content.margin_type = effectiveMarginType;
      content.margin_value = effectiveMarginValue;
    }
    // Absolute cut at the current finalized price (for display / first bid).
    // Use the effective (possibly percent-derived) margin row so margin_amount matches.
    const effectiveMarginRowForAbs: PlanMarginFields | null =
      effectiveMarginType === 'percent' && effectiveMarginValue != null
        ? { price: listingPrice ?? 0, margin_value: effectiveMarginValue, margin_type: 'percent' }
        : marginRow;
    const base = resolveFinalizedPrice(cardFields);
    const absMargin =
      effectiveMarginType === 'percent'
        ? resolveFinalMargin({ markup: null, partner_price_override: null } as any, effectiveMarginRowForAbs, base)
        : resolveFinalMargin(cardFields, marginRow, base);
    if (absMargin != null) content.margin_amount = absMargin;

    // When we already have a customer price but partner was missing, derive it
    // with the live margin rule so the talent card still shows pay.
    if (
      resolvedMonthlyPrice == null &&
      resolvedCustomerMonthlyPrice != null &&
      cardFields.partner_price_override == null
    ) {
      const derived = partnerPriceFromCustomer(resolvedCustomerMonthlyPrice, cardFields, marginRow);
      if (resolvedCurrency) {
        content.monthly_price = derived;
        content.currency = resolvedCurrency;
      }
    }
  }
  // Attach a single-line hours label ("1 hrs/day · 6 hrs/week · 30 hrs/month")
  // when the plan (or a card override) defines an hours-kind deliverable.
  // Profiles' renderer promotes this to the HOURS section above description.
  if (hoursLabel) {
    content.hours_label = hoursLabel;
  }

  // Deliverables priority for the talent Work Commitment panel:
  //   1. Client-brief requirement_note (assignment + subscription)
  //   2. Structured custom/plan item deliverables (rendered as a list)
  //   3. "No specific deliverables" fallback so the panel still renders
  //      for non-staged cards with nothing else to show.
  if (requirementNote) {
    content.deliverables_label = requirementNote;
  } else if (
    !hasItemDeliverables &&
    !staged &&
    cardSource &&
    NON_STAGED_SOURCES.has(cardSource)
  ) {
    content.deliverables_label = 'No specific deliverables';
  }

  // Assignment cards: stamp the type + project timeline into content so the
  // talent clients can tag the card and render the timeline, and the business
  // portal can list it under Assignments. The budget already rides in
  // monthly_price / customer_monthly_price (the talent's pay / the client's
  // project budget); the consumer relabels those for assignments. plan_name /
  // hours_label are absent on these cards, so the subscription-only sections
  // self-hide.
  if (cardType !== 'subscription') {
    content.card_type = cardType;
    const ad = (card as any).assignment_details;
    if (ad && typeof ad === 'object') {
      content.assignment_details = ad;
    }
    // Unpriced assignments: the client budget is an INTERNAL ceiling the talent
    // must never see (they submit their own offer). Strip the price fields from
    // the payload so nothing leaks to the talent card / business portal.
    if (cardType === 'assignment' && ad?.pricing_mode === 'unpriced') {
      delete content.monthly_price;
      delete content.customer_monthly_price;
    }
  }
  // Subscription "request quote" tiers: no fixed price (both proposed and
  // subscription_price are empty). Strip prices so SquadHire shows
  // "Request quote" and talent is invited to quote — same as unpriced
  // assignments. Delivered normally, just without a price.
  {
    const isSubscriptionRequestQuote =
      cardType === 'subscription' &&
      (contentSource as any).subscription_price == null &&
      ((contentSource as any).proposed_price == null ||
        (contentSource as any).proposed_price === 0);
    if (isSubscriptionRequestQuote) {
      delete content.monthly_price;
      delete content.customer_monthly_price;
      delete content.min_customer_price;
      delete content.min_partner_price;
    }
  }

  const distribution: 'broadcast' | 'manual' =
    card.distribution === 'manual' ? 'manual' : 'broadcast';

  // Skip the field if it's clearly not an email — SquadHire's validator
  // would 400 on `.email()` and we'd rather lose the dashboard linkage
  // than the whole delivery.
  const businessEmail =
    leadEmail && leadEmail.includes('@') ? leadEmail.toLowerCase() : undefined;

  const recalledAt = card.recalled_at as string | null | undefined;
  const archivedAt = (card as any).archived_at as string | null | undefined;
  const pausedAt = (card as any).paused_at as string | null | undefined;
  const cancelledAt = (card as any).cancelled_at as string | null | undefined;

  const businessPhone = leadPhone && leadPhone.length >= 6 ? leadPhone : undefined;
  const businessContactName = leadContactName && leadContactName.length > 0 ? leadContactName : undefined;
  const businessCompany = leadCompany && leadCompany.length > 0 ? leadCompany : undefined;

  // Cross-app identity: prefer activated Hire user (email+phone soft-match)
  // over a stale invite-shell stamp so the business portal sees the card.
  const submissionIdForHire =
    ((card as any).lead_submission_id as string | null | undefined) ||
    (staged?.submission_id as string | null | undefined) ||
    null;
  let businessUserId: string | undefined;
  try {
    const resolved = await resolveHireBusinessUserIdForCardDelivery({
      submissionId: submissionIdForHire,
      email: businessEmail ?? leadEmail,
      phone: businessPhone ?? leadPhone,
    });
    if (resolved) businessUserId = resolved;
  } catch (err: any) {
    console.warn(
      '[squadhire] hire business_user_id resolve failed (continuing with email/phone only)',
      { cardId, error: err?.message },
    );
  }

  return {
    external_id: card.id as string,
    content,
    match_rules,
    published_at: publishedAt,
    status,
    distribution,
    is_secondary: card.parent_card_id != null,
    group_id: ((card as any).brief_group_id as string | null) ?? null,
    card_type: cardType,
    ...(businessUserId ? { business_user_id: businessUserId } : {}),
    ...(businessEmail ? { business_email: businessEmail } : {}),
    ...(businessPhone ? { business_phone: businessPhone } : {}),
    ...(businessContactName ? { business_contact_name: businessContactName } : {}),
    ...(businessCompany ? { business_company: businessCompany } : {}),
    ...(recalledAt ? { recalled_at: new Date(recalledAt).toISOString() } : {}),
    archived_at: archivedAt ? new Date(archivedAt).toISOString() : null,
    paused_at: pausedAt ? new Date(pausedAt).toISOString() : null,
    cancelled_at: cancelledAt ? new Date(cancelledAt).toISOString() : null,
  };
}

// ------------------------------------------------------------
// Single delivery attempt
// ------------------------------------------------------------

async function postOnce(payload: SquadhireCardPayload): Promise<AttemptOutcome> {
  const url = config.squadhireWebhookUrl;
  if (!url) {
    return { delivered: false, error: 'squadhire_webhook_url_not_configured' };
  }
  if (!config.squadhireWebhookSecret) {
    return { delivered: false, error: 'squadhire_webhook_secret_not_configured' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-SquadHub-Signature': config.squadhireWebhookSecret,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) return { delivered: false, error: `http_${res.status}` };
    const body = (await res.json().catch(() => ({}))) as any;
    return {
      delivered: true,
      recipientCount:
        typeof body?.recipient_count === 'number' ? body.recipient_count : undefined,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { delivered: false, error: msg.slice(0, 500) };
  } finally {
    clearTimeout(timer);
  }
}

// ------------------------------------------------------------
// Persist attempt state onto the card row
// ------------------------------------------------------------

async function persistResult(
  cardId: string,
  outcome: AttemptOutcome,
  attemptsDelta: number,
): Promise<void> {
  const { data: current, error: readErr } = await supabaseAdmin
    .from('subscription_cards')
    .select('squadhire_sync_attempts')
    .eq('id', cardId)
    .maybeSingle();
  if (readErr) {
    console.error('[squadhire-webhook] failed to read sync attempts', readErr);
    return;
  }

  const patch: Record<string, unknown> = {
    squadhire_sync_attempts: (current?.squadhire_sync_attempts ?? 0) + attemptsDelta,
    squadhire_sync_last_error: outcome.delivered
      ? null
      : outcome.error ?? 'unknown_error',
  };
  if (outcome.delivered) {
    patch.squadhire_synced_at = new Date().toISOString();
    if (typeof outcome.recipientCount === 'number') {
      patch.squadhire_recipient_count = outcome.recipientCount;
    }
  }

  const { error } = await supabaseAdmin
    .from('subscription_cards')
    .update(patch)
    .eq('id', cardId);
  if (error) {
    console.error('[squadhire-webhook] failed to persist sync state', error);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ------------------------------------------------------------
// Public: inline delivery (called from the publish handler).
// Never throws; never blocks longer than the retry budget.
// ------------------------------------------------------------

export async function deliverCardToSquadhire(
  cardId: string,
  payload: SquadhireCardPayload,
): Promise<void> {
  let lastOutcome: AttemptOutcome = { delivered: false, error: 'not_attempted' };
  for (let i = 0; i < INLINE_ATTEMPTS; i++) {
    if (INLINE_BACKOFF_MS[i] > 0) await sleep(INLINE_BACKOFF_MS[i]);
    lastOutcome = await postOnce(payload);
    if (lastOutcome.delivered) break;
  }
  await persistResult(cardId, lastOutcome, INLINE_ATTEMPTS);
}

// ------------------------------------------------------------
// Public: fetch the talent recipient list SquadHire holds for a card.
// SquadHire matches talents to a card by category on ingest and exposes them
// via /cards/recipients — including matched candidates who haven't responded
// (or been broadcast to) yet. Soft-failing: returns [] when the integration
// is unconfigured or SquadHire is unreachable, so callers degrade gracefully.
// ------------------------------------------------------------

export interface SquadhireRecipient {
  talent_user_id: string;
  talent_name: string | null;
  status: 'pending' | 'accepted' | 'rejected';
  responded_at: string | null;
  created_at: string | null;
  email: string | null;
  // Business-review funnel state, sourced from Profiles'
  // subscription_card_recipients. Lets the admin recipients view mirror the
  // business portal's Shortlisted / Selected buckets. Older Profiles builds
  // omit these — treat as null (the field just won't populate those tabs).
  business_review_status?: 'shortlisted' | 'rejected' | null;
  selected_at?: string | null;
  passed_over_at?: string | null;
}

export async function fetchSquadhireRecipients(cardId: string): Promise<SquadhireRecipient[]> {
  const baseUrl = config.squadhireWebhookUrl;
  if (!baseUrl || !config.squadhireWebhookSecret) return [];

  // The webhook URL points to /api/webhooks/squadhub/cards — derive recipients URL.
  const recipientsUrl = baseUrl.replace(/\/cards\/?$/, '/cards/recipients');
  try {
    const response = await fetch(recipientsUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-SquadHub-Signature': config.squadhireWebhookSecret,
      },
      body: JSON.stringify({ external_id: cardId }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      console.error(`[squadhire-webhook] recipients fetch failed: ${response.status} ${text}`);
      return [];
    }
    const result = (await response.json()) as { data?: SquadhireRecipient[] };
    return result.data || [];
  } catch (err: any) {
    console.error('[squadhire-webhook] recipients fetch errored', err?.message || err);
    return [];
  }
}

// ------------------------------------------------------------
// Public: read-only preview of the talents a card WOULD match on SquadHire,
// without ingesting the card, writing recipients, or notifying anyone. Powers
// the "Matches" audience preview shown on a published (not-yet-broadcast) card.
// Builds the same match_rules broadcast delivery uses and asks SquadHire's
// matcher to run them live. Soft-failing: returns an empty preview when the
// integration is unconfigured or SquadHire is unreachable.
// ------------------------------------------------------------

export interface SquadhireMatchPreview {
  count: number;
  talents: Array<{ talent_user_id: string; talent_name: string }>;
}

export async function previewSquadhireMatches(cardId: string): Promise<SquadhireMatchPreview> {
  const baseUrl = config.squadhireWebhookUrl;
  if (!baseUrl || !config.squadhireWebhookSecret) return { count: 0, talents: [] };

  // Reuse the delivery payload builder so the preview honours the exact same
  // match_rules (category / tier / language / country) a real broadcast would.
  let matchRules: Record<string, unknown> = {};
  try {
    const payload = await buildSquadhirePayloadForCard(cardId);
    matchRules = (payload?.match_rules as Record<string, unknown>) ?? {};
  } catch (err: any) {
    console.error('[squadhire-webhook] preview payload build failed', err?.message || err);
    return { count: 0, talents: [] };
  }

  const previewUrl = baseUrl.replace(/\/cards\/?$/, '/cards/recipients/preview');
  try {
    const response = await fetch(previewUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-SquadHub-Signature': config.squadhireWebhookSecret,
      },
      body: JSON.stringify({ match_rules: matchRules }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      console.error(`[squadhire-webhook] preview fetch failed: ${response.status} ${text}`);
      return { count: 0, talents: [] };
    }
    const result = (await response.json()) as {
      data?: Array<{ talent_user_id: string; talent_name: string }>;
      count?: number;
    };
    const talents = result.data || [];
    return { count: result.count ?? talents.length, talents };
  } catch (err: any) {
    console.error('[squadhire-webhook] preview fetch errored', err?.message || err);
    return { count: 0, talents: [] };
  }
}

// ------------------------------------------------------------
// Public: background sweeper — retries published cards that never synced.
// Bounded by SWEEPER_BATCH_SIZE per tick and MAX_SYNC_ATTEMPTS per card.
// ------------------------------------------------------------

export function startSquadhireSyncSweeper(): NodeJS.Timeout {
  const tick = async () => {
    try {
      // Only broadcast cards are swept. Manual/soft-published cards
      // intentionally stay out of SquadHire until an admin manually
      // assigns a talent (handled inline in the assign-talent endpoint).
      // Recall and Close on broadcast cards reset squadhire_synced_at to
      // NULL and bump sync_attempts back to 0, so their archived
      // deliveries are retried here too.
      const { data: cards, error } = await supabaseAdmin
        .from('subscription_cards')
        .select('id, state, squadhire_sync_attempts, recalled_at, archived_at')
        .eq('distribution', 'broadcast')
        .not('squadhire_category_ids', 'eq', '{}')
        .is('squadhire_synced_at', null)
        .is('deleted_at', null)
        .lt('squadhire_sync_attempts', MAX_SYNC_ATTEMPTS)
        .order('updated_at', { ascending: true })
        .limit(SWEEPER_BATCH_SIZE);

      if (error) {
        console.error('[squadhire-webhook] sweeper query failed', error);
        return;
      }
      if (!cards || cards.length === 0) return;

      // This is a RETRY net for deliveries that already fired inline — it must
      // never INITIATE a card's first delivery, or a brief that was only
      // published / soft-published (or not even that) gets broadcast to talents,
      // and its matches WhatsApped, behind the admin's back. Deliver only:
      //   • recalled / archived / closed cards — (re)push their archival status
      //     so SquadHire takes the card down (recall/close reset synced_at +
      //     attempts, then fire inline; this retries a failed inline).
      //   • published cards whose inline BROADCAST failed (attempts > 0). A card
      //     published in broadcast mode sits at attempts=0 until an admin clicks
      //     "Broadcast to talents" (publish stages, broadcast sends), so a
      //     non-zero count is the "was actually broadcast" signal.
      // A 'new' / 'draft' card with no recall/archive stamp is never delivered —
      // it was never broadcast, whatever its attempt count (the old sweeper may
      // have churned some up to a non-zero count before this guard existed).
      const deliverable = (cards as Array<{
        id: string;
        state: string;
        squadhire_sync_attempts: number | null;
        recalled_at: string | null;
        archived_at: string | null;
      }>).filter((c) => {
        if (c.recalled_at || c.archived_at || c.state === 'closed') return true;
        if (c.state === 'published') return (c.squadhire_sync_attempts ?? 0) > 0;
        return false;
      });
      if (deliverable.length === 0) return;

      for (const card of deliverable) {
        const payload = await buildSquadhirePayloadForCard(card.id);
        if (!payload) continue;
        const outcome = await postOnce(payload);
        await persistResult(card.id, outcome, 1);
      }
    } catch (err) {
      console.error('[squadhire-webhook] sweeper tick errored', err);
    }
  };

  // First tick a few seconds after boot so startup isn't blocked.
  const handle = setInterval(tick, SWEEPER_INTERVAL_MS);
  setTimeout(tick, 15_000);
  return handle;
}

// ------------------------------------------------------------
// Manual assignment: single POST attempt
// ------------------------------------------------------------

async function postManualAssignmentOnce(
  cardId: string,
  talentId: string,
): Promise<AttemptOutcome> {
  const baseUrl = config.squadhireWebhookUrl;
  if (!baseUrl) return Promise.resolve({ delivered: false, error: 'squadhire_webhook_url_not_configured' });
  if (!config.squadhireWebhookSecret) return Promise.resolve({ delivered: false, error: 'squadhire_webhook_secret_not_configured' });

  // Direct-assign detection: when this talent is already the card's finalized
  // recipient (the change-talent swap stamps the card BEFORE notifying), tell
  // SquadHire to record them as selected/assigned immediately — not as a
  // pending offer, which on an assigned card would render in the talent's
  // Expired tab. Derived from the card (not a parameter) so the retry sweeper
  // sends the same flag as the inline attempt.
  let assigned = false;
  try {
    const { data: card } = await supabaseAdmin
      .from('subscription_cards')
      .select('selected_recipient_type, selected_recipient_id')
      .eq('id', cardId)
      .maybeSingle();
    assigned =
      (card as any)?.selected_recipient_type === 'talent' &&
      (card as any)?.selected_recipient_id === talentId;
  } catch {
    // Fall through as a plain offer — SquadHire-side idempotency keeps this safe.
  }

  const url = baseUrl.endsWith('/') ? `${baseUrl}manual-assignments` : `${baseUrl}/manual-assignments`;
  const body = {
    type: 'manual_assignment',
    card_id: cardId,
    talent_id: talentId,
    assigned_at: new Date().toISOString(),
    ...(assigned ? { assigned: true } : {}),
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  return fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-SquadHub-Signature': config.squadhireWebhookSecret,
    },
    body: JSON.stringify(body),
    signal: controller.signal,
  })
    .then(async (res) => {
      if (res.ok) return { delivered: true } as AttemptOutcome;
      // 409 = SquadHire refused on the merits (level mismatch, suspended
      // talent, archived card). Carry its own wording through so the admin
      // reads why instead of "http_409", and mark it non-retryable.
      if (res.status === 409) {
        const rejection = (await res.json().catch(() => ({}))) as { error?: string };
        return {
          delivered: false,
          rejected: true,
          error: (rejection?.error || 'SquadHire rejected this assignment').slice(0, 500),
        } as AttemptOutcome;
      }
      return { delivered: false, error: `http_${res.status}` } as AttemptOutcome;
    })
    .catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      return { delivered: false, error: msg.slice(0, 500) } as AttemptOutcome;
    })
    .finally(() => clearTimeout(timer));
}

// ------------------------------------------------------------
// Manual assignment: persist attempt state onto the recipient row
// ------------------------------------------------------------

async function persistManualAssignmentResult(
  recipientRowId: string,
  outcome: AttemptOutcome,
  attemptsDelta: number,
): Promise<void> {
  const { data: current, error: readErr } = await supabaseAdmin
    .from('subscription_card_external_recipients')
    .select('squadhire_notify_attempts')
    .eq('id', recipientRowId)
    .maybeSingle();
  if (readErr) {
    console.error('[squadhire-webhook] failed to read notify attempts', readErr);
    return;
  }

  const patch: Record<string, unknown> = {
    // A rejection is final — park the row at the attempt cap so the background
    // sweeper stops re-sending a call SquadHire will refuse every time.
    squadhire_notify_attempts: outcome.rejected
      ? MAX_SYNC_ATTEMPTS
      : (current?.squadhire_notify_attempts ?? 0) + attemptsDelta,
    squadhire_notify_error: outcome.delivered ? null : (outcome.error ?? 'unknown_error'),
  };
  if (outcome.delivered) {
    patch.squadhire_notified_at = new Date().toISOString();
  }

  const { error } = await supabaseAdmin
    .from('subscription_card_external_recipients')
    .update(patch)
    .eq('id', recipientRowId);
  if (error) {
    console.error('[squadhire-webhook] failed to persist manual-assignment state', error);
  }
}

// ------------------------------------------------------------
// Public: inline delivery with retries (called from assign-talent).
// Returns the outcome so the caller can warn the admin on failure.
// ------------------------------------------------------------

export async function notifySquadhireOfManualAssignment(
  cardId: string,
  talentId: string,
  recipientRowId?: string,
): Promise<AttemptOutcome> {
  let lastOutcome: AttemptOutcome = { delivered: false, error: 'not_attempted' };
  for (let i = 0; i < INLINE_ATTEMPTS; i++) {
    if (INLINE_BACKOFF_MS[i] > 0) await sleep(INLINE_BACKOFF_MS[i]);
    lastOutcome = await postManualAssignmentOnce(cardId, talentId);
    if (lastOutcome.delivered || lastOutcome.rejected) break;
  }
  if (recipientRowId) {
    await persistManualAssignmentResult(recipientRowId, lastOutcome, INLINE_ATTEMPTS);
  }
  return lastOutcome;
}

// ------------------------------------------------------------
// Public: background sweeper for manual assignments that never
// reached SquadHire. Mirrors startSquadhireSyncSweeper.
// ------------------------------------------------------------

export function startManualAssignmentSweeper(): NodeJS.Timeout {
  const tick = async () => {
    try {
      // Only sweep rows the admin has explicitly released. `notified_at IS
      // NULL` means a soft-publish queue entry that hasn't been broadcast yet
      // — the staged-broadcast contract is that nothing leaves SquadHub until
      // the admin clicks "Broadcast to these N users". Released rows whose
      // SquadHire HTTP call failed (squadhire_notified_at still null) are
      // still picked up here so they get retried in the background.
      // Archived rows are excluded: a talent swapped out (change-talent) or a
      // reopened round must not get a ghost retry offer for a card they were
      // just removed from.
      const { data: rows, error } = await supabaseAdmin
        .from('subscription_card_external_recipients')
        .select('id, card_id, external_user_id')
        .eq('assigned_manually', true)
        .not('notified_at', 'is', null)
        .is('squadhire_notified_at', null)
        .is('archived_at', null)
        .lt('squadhire_notify_attempts', MAX_SYNC_ATTEMPTS)
        .order('created_at', { ascending: true })
        .limit(SWEEPER_BATCH_SIZE);

      if (error) {
        console.error('[squadhire-webhook] manual-assignment sweeper query failed', error);
        return;
      }
      if (!rows || rows.length === 0) return;

      for (const row of rows as { id: string; card_id: string; external_user_id: string }[]) {
        const outcome = await postManualAssignmentOnce(row.card_id, row.external_user_id);
        await persistManualAssignmentResult(row.id, outcome, 1);
      }
    } catch (err) {
      console.error('[squadhire-webhook] manual-assignment sweeper tick errored', err);
    }
  };

  const handle = setInterval(tick, SWEEPER_INTERVAL_MS);
  setTimeout(tick, 15_000);
  return handle;
}

// ------------------------------------------------------------
// Public: outbound notification when an admin removes a previously-
// assigned talent. SquadHire retires its mirror recipient row so the
// card stops appearing in the talent's subscription tab. Inline retries
// (same backoff as manual assignment) and the outcome is returned so
// callers ending a LIVE engagement can surface a failure to the admin —
// a lost removal would leave the old talent seeing the client forever.
// Idempotent on the receiving side.
// ------------------------------------------------------------

function postManualRemovalOnce(
  cardId: string,
  talentId: string,
  notify: boolean,
): Promise<AttemptOutcome> {
  const baseUrl = config.squadhireWebhookUrl;
  if (!baseUrl) return Promise.resolve({ delivered: false, error: 'squadhire_webhook_url_not_configured' });
  if (!config.squadhireWebhookSecret) return Promise.resolve({ delivered: false, error: 'squadhire_webhook_secret_not_configured' });

  const url = baseUrl.endsWith('/')
    ? `${baseUrl}manual-assignments/remove`
    : `${baseUrl}/manual-assignments/remove`;
  const body = {
    type: 'manual_assignment_removal',
    card_id: cardId,
    talent_id: talentId,
    removed_at: new Date().toISOString(),
    ...(notify ? { notify: true } : {}),
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  return fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-SquadHub-Signature': config.squadhireWebhookSecret,
    },
    body: JSON.stringify(body),
    signal: controller.signal,
  })
    .then((res) => {
      if (!res.ok) return { delivered: false, error: `http_${res.status}` } as AttemptOutcome;
      return { delivered: true } as AttemptOutcome;
    })
    .catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      return { delivered: false, error: msg.slice(0, 500) } as AttemptOutcome;
    })
    .finally(() => clearTimeout(timer));
}

export async function notifySquadhireOfManualRemoval(
  cardId: string,
  talentId: string,
  opts?: {
    /** Push an "assignment updated" notification to the removed talent.
     *  Used by change-talent (a live engagement ending); pre-broadcast
     *  hand-pick removals stay silent as before. */
    notify?: boolean;
  },
): Promise<AttemptOutcome> {
  let lastOutcome: AttemptOutcome = { delivered: false, error: 'not_attempted' };
  for (let i = 0; i < INLINE_ATTEMPTS; i++) {
    if (INLINE_BACKOFF_MS[i] > 0) await sleep(INLINE_BACKOFF_MS[i]);
    lastOutcome = await postManualRemovalOnce(cardId, talentId, opts?.notify ?? false);
    if (lastOutcome.delivered) break;
  }
  if (!lastOutcome.delivered) {
    console.warn('[squadhire-webhook] manual-removal failed', cardId, talentId, lastOutcome.error);
  }
  return lastOutcome;
}

// ------------------------------------------------------------
// Talent acceptance: single POST attempt
// ------------------------------------------------------------

function postTalentAcceptedOnce(
  cardId: string,
  talentId: string,
): Promise<AttemptOutcome> {
  const baseUrl = config.squadhireWebhookUrl;
  if (!baseUrl) return Promise.resolve({ delivered: false, error: 'squadhire_webhook_url_not_configured' });
  if (!config.squadhireWebhookSecret) return Promise.resolve({ delivered: false, error: 'squadhire_webhook_secret_not_configured' });

  const url = baseUrl.endsWith('/')
    ? `${baseUrl}talent-accepted`
    : `${baseUrl}/talent-accepted`;
  const body = {
    type: 'talent_accepted',
    card_id: cardId,
    talent_id: talentId,
    accepted_at: new Date().toISOString(),
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  return fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-SquadHub-Signature': config.squadhireWebhookSecret,
    },
    body: JSON.stringify(body),
    signal: controller.signal,
  })
    .then(async (res) => {
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return {
          delivered: false,
          error: `http_${res.status}${text ? ` ${text.slice(0, 200)}` : ''}`,
        } as AttemptOutcome;
      }
      return { delivered: true } as AttemptOutcome;
    })
    .catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      return { delivered: false, error: msg.slice(0, 500) } as AttemptOutcome;
    })
    .finally(() => clearTimeout(timer));
}

// ------------------------------------------------------------
// Talent acceptance: persist attempt state onto the recipient row
// ------------------------------------------------------------

async function persistTalentAcceptedResult(
  recipientRowId: string,
  outcome: AttemptOutcome,
  attemptsDelta: number,
): Promise<void> {
  const { data: current, error: readErr } = await supabaseAdmin
    .from('subscription_card_external_recipients')
    .select('squadhire_acceptance_notify_attempts')
    .eq('id', recipientRowId)
    .maybeSingle();
  if (readErr) {
    console.error('[squadhire-webhook] failed to read acceptance-notify attempts', readErr);
    return;
  }

  const patch: Record<string, unknown> = {
    squadhire_acceptance_notify_attempts:
      ((current as any)?.squadhire_acceptance_notify_attempts ?? 0) + attemptsDelta,
    squadhire_acceptance_notify_error: outcome.delivered ? null : (outcome.error ?? 'unknown_error'),
  };
  if (outcome.delivered) {
    patch.squadhire_acceptance_notified_at = new Date().toISOString();
  }

  const { error } = await supabaseAdmin
    .from('subscription_card_external_recipients')
    .update(patch)
    .eq('id', recipientRowId);
  if (error) {
    console.error('[squadhire-webhook] failed to persist acceptance-notify state', error);
  }
}

// ------------------------------------------------------------
// Public: outbound notification when an admin auto-accepts a card on
// behalf of a talent (POST /admin/subscription-cards/:id/auto-accept-talent).
// SquadHire mirrors the row to status='accepted' and surfaces the talent
// in the linked business dashboard's "New talents for review" section.
//
// 3 inline retries with 0/2/10s backoff. When recipientRowId is provided,
// the outcome is persisted on the row so the sweeper can re-attempt later
// if every inline try failed. Returns the final outcome so the caller can
// surface a warning to the admin on persistent failure.
// ------------------------------------------------------------

export async function notifySquadhireOfTalentAcceptance(
  cardId: string,
  talentId: string,
  recipientRowId?: string,
): Promise<AttemptOutcome> {
  let lastOutcome: AttemptOutcome = { delivered: false, error: 'not_attempted' };
  for (let i = 0; i < INLINE_ATTEMPTS; i++) {
    if (INLINE_BACKOFF_MS[i] > 0) await sleep(INLINE_BACKOFF_MS[i]);
    lastOutcome = await postTalentAcceptedOnce(cardId, talentId);
    if (lastOutcome.delivered) break;
  }
  if (!lastOutcome.delivered) {
    console.warn('[squadhire-webhook] talent-accepted failed after retries', lastOutcome.error);
  }
  if (recipientRowId) {
    await persistTalentAcceptedResult(recipientRowId, lastOutcome, INLINE_ATTEMPTS);
  }
  return lastOutcome;
}

// ------------------------------------------------------------
// Public: background sweeper for talent acceptances that never
// reached SquadHire. Mirrors startManualAssignmentSweeper.
// ------------------------------------------------------------

export function startTalentAcceptedNotifySweeper(): NodeJS.Timeout {
  const tick = async () => {
    try {
      const { data: rows, error } = await supabaseAdmin
        .from('subscription_card_external_recipients')
        .select('id, card_id, external_user_id')
        .eq('status', 'accepted')
        .is('squadhire_acceptance_notified_at', null)
        .lt('squadhire_acceptance_notify_attempts', MAX_SYNC_ATTEMPTS)
        .order('created_at', { ascending: true })
        .limit(SWEEPER_BATCH_SIZE);

      if (error) {
        console.error('[squadhire-webhook] talent-accepted sweeper query failed', error);
        return;
      }
      if (!rows || rows.length === 0) return;

      for (const row of rows as { id: string; card_id: string; external_user_id: string }[]) {
        const outcome = await postTalentAcceptedOnce(row.card_id, row.external_user_id);
        await persistTalentAcceptedResult(row.id, outcome, 1);
      }
    } catch (err) {
      console.error('[squadhire-webhook] talent-accepted sweeper tick errored', err);
    }
  };

  const handle = setInterval(tick, SWEEPER_INTERVAL_MS);
  setTimeout(tick, 15_000);
  return handle;
}

// ------------------------------------------------------------
// Card selection: single POST attempt
// ------------------------------------------------------------

function postSelectionOnce(
  cardId: string,
  talentIds: string[],
  selectedAt: string,
): Promise<AttemptOutcome> {
  const baseUrl = config.squadhireWebhookUrl;
  if (!baseUrl) return Promise.resolve({ delivered: false, error: 'squadhire_webhook_url_not_configured' });
  if (!config.squadhireWebhookSecret) return Promise.resolve({ delivered: false, error: 'squadhire_webhook_secret_not_configured' });

  // baseUrl already ends in /squadhub/cards (matching the other webhooks like
  // /talent-accepted and /manual-assignments). The Profiles route is mounted
  // at /squadhub/cards/selection, so we append just /selection here — not
  // /cards/selection, which would 404 due to the doubled prefix.
  const url = baseUrl.endsWith('/')
    ? `${baseUrl}selection`
    : `${baseUrl}/selection`;
  const body = {
    type: 'card_selection',
    card_id: cardId,
    talent_ids: talentIds,
    card_status: 'assigned',
    selected_at: selectedAt,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  return fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-SquadHub-Signature': config.squadhireWebhookSecret,
    },
    body: JSON.stringify(body),
    signal: controller.signal,
  })
    .then((res) => {
      if (!res.ok) return { delivered: false, error: `http_${res.status}` } as AttemptOutcome;
      return { delivered: true } as AttemptOutcome;
    })
    .catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      return { delivered: false, error: msg.slice(0, 500) } as AttemptOutcome;
    })
    .finally(() => clearTimeout(timer));
}

// ------------------------------------------------------------
// Card selection: persist attempt state onto the card row
// ------------------------------------------------------------

async function persistSelectionResult(
  cardId: string,
  outcome: AttemptOutcome,
  attemptsDelta: number,
): Promise<void> {
  const { data: current, error: readErr } = await supabaseAdmin
    .from('subscription_cards')
    .select('squadhire_select_notify_attempts')
    .eq('id', cardId)
    .maybeSingle();
  if (readErr) {
    console.error('[squadhire-webhook] failed to read select-notify attempts', readErr);
    return;
  }

  const patch: Record<string, unknown> = {
    squadhire_select_notify_attempts:
      ((current as any)?.squadhire_select_notify_attempts ?? 0) + attemptsDelta,
    squadhire_select_notify_error: outcome.delivered ? null : (outcome.error ?? 'unknown_error'),
  };
  if (outcome.delivered) {
    patch.squadhire_select_notified_at = new Date().toISOString();
  }

  const { error } = await supabaseAdmin
    .from('subscription_cards')
    .update(patch)
    .eq('id', cardId);
  if (error) {
    console.error('[squadhire-webhook] failed to persist select-notify state', error);
  }
}

// ------------------------------------------------------------
// Public: inline delivery with retries (called from /assign).
// Returns the outcome so the caller can warn the admin on failure.
// If still undelivered after INLINE_ATTEMPTS, the row is left with
// squadhire_select_notified_at = NULL and the sweeper picks it up.
// ------------------------------------------------------------

export async function notifySquadhireOfSelection(
  cardId: string,
  talentIds: string[],
  selectedAt: string,
): Promise<AttemptOutcome> {
  let lastOutcome: AttemptOutcome = { delivered: false, error: 'not_attempted' };
  for (let i = 0; i < INLINE_ATTEMPTS; i++) {
    if (INLINE_BACKOFF_MS[i] > 0) await sleep(INLINE_BACKOFF_MS[i]);
    lastOutcome = await postSelectionOnce(cardId, talentIds, selectedAt);
    if (lastOutcome.delivered) break;
  }
  await persistSelectionResult(cardId, lastOutcome, INLINE_ATTEMPTS);
  return lastOutcome;
}

// ------------------------------------------------------------
// Public: background sweeper — retries cards whose selection
// webhook never reached SquadHire. Mirrors startManualAssignmentSweeper.
// ------------------------------------------------------------

export function startSelectionNotifySweeper(): NodeJS.Timeout {
  const tick = async () => {
    try {
      const { data: cards, error } = await supabaseAdmin
        .from('subscription_cards')
        .select('id, assigned_at')
        .eq('state', 'assigned')
        .is('squadhire_select_notified_at', null)
        .lt('squadhire_select_notify_attempts', MAX_SYNC_ATTEMPTS)
        .order('assigned_at', { ascending: true })
        .limit(SWEEPER_BATCH_SIZE);

      if (error) {
        console.error('[squadhire-webhook] selection sweeper query failed', error);
        return;
      }
      if (!cards || cards.length === 0) return;

      for (const card of cards as { id: string; assigned_at: string | null }[]) {
        const { data: selectedRows, error: rowsErr } = await supabaseAdmin
          .from('subscription_card_external_recipients')
          .select('external_user_id')
          .eq('card_id', card.id)
          .not('selected_at', 'is', null);
        if (rowsErr) {
          console.error('[squadhire-webhook] selection sweeper recipients query failed', rowsErr);
          continue;
        }
        const talentIds = (selectedRows ?? [])
          .map((r: any) => r.external_user_id as string | null)
          .filter((id: string | null): id is string => !!id);

        const selectedAt = card.assigned_at ?? new Date().toISOString();
        const outcome = await postSelectionOnce(card.id, talentIds, selectedAt);
        await persistSelectionResult(card.id, outcome, 1);
      }
    } catch (err) {
      console.error('[squadhire-webhook] selection sweeper tick errored', err);
    }
  };

  const handle = setInterval(tick, SWEEPER_INTERVAL_MS);
  setTimeout(tick, 15_000);
  return handle;
}

// ============================================================
// Card activation: admin clicked "Finalize" on a selected card,
// moving it to the Assigned bucket (selected_recipient_id set).
// SquadHire stamps subscription_activated_at on its mirror card
// so My Clients flips from Selected → Assigned, then calls back here to
// provision an external talent's partner account and client access.
// ============================================================

async function postActivationOnce(cardId: string): Promise<AttemptOutcome> {
  const baseUrl = config.squadhireWebhookUrl;
  if (!baseUrl) return { delivered: false, error: 'squadhire_webhook_url_not_configured' };
  if (!config.squadhireWebhookSecret) return { delivered: false, error: 'squadhire_webhook_secret_not_configured' };

  const { data: card, error: cardError } = await supabaseAdmin
    .from('subscription_cards')
    .select('selected_recipient_type, selected_recipient_id')
    .eq('id', cardId)
    .maybeSingle();
  if (cardError) return { delivered: false, error: cardError.message.slice(0, 500) };
  if (!card) return { delivered: true };

  // baseUrl already ends in /squadhub/cards (same as selection / talent-accepted).
  const url = baseUrl.endsWith('/')
    ? `${baseUrl}activation`
    : `${baseUrl}/activation`;
  const body = {
    type: 'card_activation',
    card_id: cardId,
    // Explicitly distinguish an external SquadHire talent from a native
    // SquadHub partner. Profiles only provisions accounts for the former.
    talent_user_id:
      card.selected_recipient_type === 'talent' ? card.selected_recipient_id : undefined,
    activated_at: new Date().toISOString(),
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ACTIVATION_REQUEST_TIMEOUT_MS);
  return fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-SquadHub-Signature': config.squadhireWebhookSecret,
    },
    body: JSON.stringify(body),
    signal: controller.signal,
  })
    .then((res) => {
      if (!res.ok) return { delivered: false, error: `http_${res.status}` } as AttemptOutcome;
      return { delivered: true } as AttemptOutcome;
    })
    .catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      return { delivered: false, error: msg.slice(0, 500) } as AttemptOutcome;
    })
    .finally(() => clearTimeout(timer));
}

async function persistActivationResult(
  cardId: string,
  outcome: AttemptOutcome,
  attemptsDelta: number,
): Promise<void> {
  const { data: current, error: readErr } = await supabaseAdmin
    .from('subscription_cards')
    .select('squadhire_activation_notify_attempts')
    .eq('id', cardId)
    .maybeSingle();
  if (readErr) {
    console.error('[squadhire-webhook] failed to read activation-notify attempts', readErr);
    return;
  }

  const patch: Record<string, unknown> = {
    squadhire_activation_notify_attempts:
      ((current as any)?.squadhire_activation_notify_attempts ?? 0) + attemptsDelta,
    squadhire_activation_notify_error: outcome.delivered ? null : (outcome.error ?? 'unknown_error'),
  };
  if (outcome.delivered) {
    patch.squadhire_activation_notified_at = new Date().toISOString();
  }

  const { error } = await supabaseAdmin
    .from('subscription_cards')
    .update(patch)
    .eq('id', cardId);
  if (error) {
    console.error('[squadhire-webhook] failed to persist activation-notify state', error);
  }
}

export async function notifySquadhireOfActivation(cardId: string): Promise<AttemptOutcome> {
  let lastOutcome: AttemptOutcome = { delivered: false, error: 'not_attempted' };
  for (let i = 0; i < INLINE_ATTEMPTS; i++) {
    if (INLINE_BACKOFF_MS[i] > 0) await sleep(INLINE_BACKOFF_MS[i]);
    lastOutcome = await postActivationOnce(cardId);
    if (lastOutcome.delivered) break;
  }
  await persistActivationResult(cardId, lastOutcome, INLINE_ATTEMPTS);
  return lastOutcome;
}

export function startActivationNotifySweeper(): NodeJS.Timeout {
  const tick = async () => {
    try {
      const { data: cards, error } = await supabaseAdmin
        .from('subscription_cards')
        .select('id')
        .not('selected_recipient_id', 'is', null)
        .is('squadhire_activation_notified_at', null)
        .lt('squadhire_activation_notify_attempts', MAX_SYNC_ATTEMPTS)
        .order('updated_at', { ascending: true })
        .limit(SWEEPER_BATCH_SIZE);

      if (error) {
        console.error('[squadhire-webhook] activation sweeper query failed', error);
        return;
      }
      if (!cards || cards.length === 0) return;

      for (const card of cards as { id: string }[]) {
        const outcome = await postActivationOnce(card.id);
        await persistActivationResult(card.id, outcome, 1);
      }
    } catch (err) {
      console.error('[squadhire-webhook] activation sweeper tick errored', err);
    }
  };

  const handle = setInterval(tick, SWEEPER_INTERVAL_MS);
  setTimeout(tick, 15_000);
  return handle;
}

// ------------------------------------------------------------
// Public: outbound notification when an admin undoes a selection.
// SquadHire clears its local selection fields and the card
// becomes active again. Best-effort, single attempt.
// ------------------------------------------------------------

export async function notifySquadhireOfSelectionUndo(
  cardId: string,
): Promise<void> {
  const baseUrl = config.squadhireWebhookUrl;
  if (!baseUrl || !config.squadhireWebhookSecret) {
    console.warn('[squadhire-webhook] selection-undo skipped: not configured');
    return;
  }

  const url = baseUrl.endsWith('/')
    ? `${baseUrl}undo-selection`
    : `${baseUrl}/undo-selection`;
  const body = {
    type: 'card_selection_undo',
    card_id: cardId,
    undone_at: new Date().toISOString(),
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-SquadHub-Signature': config.squadhireWebhookSecret,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.warn(`[squadhire-webhook] selection-undo http_${res.status}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[squadhire-webhook] selection-undo failed', msg);
  } finally {
    clearTimeout(timer);
  }
}

// Tell SquadHire to do a FRESH broadcast: wipe the prior round's recipients and
// re-fan-out to the full matching pool. Fired by the admin's "Broadcast to
// talents" after a reopen. Fire-and-forget.
export async function notifySquadhireOfFreshBroadcast(
  cardId: string,
): Promise<void> {
  const baseUrl = config.squadhireWebhookUrl;
  if (!baseUrl || !config.squadhireWebhookSecret) {
    console.warn('[squadhire-webhook] fresh-broadcast skipped: not configured');
    return;
  }

  const url = baseUrl.endsWith('/')
    ? `${baseUrl}fresh-broadcast`
    : `${baseUrl}/fresh-broadcast`;
  const body = {
    type: 'card_fresh_broadcast',
    card_id: cardId,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-SquadHub-Signature': config.squadhireWebhookSecret,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.warn(`[squadhire-webhook] fresh-broadcast http_${res.status}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[squadhire-webhook] fresh-broadcast failed', msg);
  } finally {
    clearTimeout(timer);
  }
}

// ------------------------------------------------------------
// Public: take a card off SquadHire (recall / reunify / trash).
//
// Re-delivers via the main cards webhook with status='archived'.
// Profiles' ingest treats active|assigned → archived as a recall:
// it stamps cancelled_at on every still-active recipient row so
// talents stop seeing the offer (and accepted ones keep a tag).
//
// MUST be called while the card still passes the never-published
// guard (published_at set, or state is published/assigned/closed).
// Callers that convert a primary card back to draft MUST invoke
// this BEFORE clearing published_at — otherwise build returns null
// and the SquadHire mirror stays live (the bug that made assignment
// + subscription recalls look like no-ops on the talent side).
//
// Also MUST skip when the card was never synced to SquadHire.
// Admin publish only stages recipients; Broadcast is what sets
// squadhire_synced_at. Recalling an unsynced published card used to
// CREATE the mirror on Profiles (first ingest), which fan-out /
// WhatsApp'd matches — the opposite of a takedown.
//
// Historically this POSTed to a /cards/recall side-channel that
// Profiles never implemented; the archived re-delivery is the real
// contract (same path archive/cancel already use).
// ------------------------------------------------------------

export async function notifySquadhireOfCardRecall(cardId: string): Promise<void> {
  try {
    const { data: syncState } = await supabaseAdmin
      .from('subscription_cards')
      .select('squadhire_synced_at')
      .eq('id', cardId)
      .maybeSingle();
    if (!syncState?.squadhire_synced_at) {
      console.warn('[squadhire-webhook] card-recall skipped: no mirror', { cardId });
      return;
    }

    const payload = await buildSquadhirePayloadForCard(cardId);
    if (!payload) {
      // No mirror to take down (never published, no categories, no tiers).
      console.warn('[squadhire-webhook] card-recall skipped: no payload', { cardId });
      return;
    }
    // Force archived even if the local row is still state='published' —
    // we deliberately call this *before* the draft conversion so the
    // never-published guard still allows the build. Forcing status is
    // what makes isRecall fire on Profiles regardless of local state.
    payload.status = 'archived';
    await deliverCardToSquadhire(cardId, payload);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[squadhire-webhook] card-recall failed', msg);
  }
}
