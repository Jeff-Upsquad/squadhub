import { randomUUID } from 'crypto';
import { supabaseAdmin } from '../supabase';
import { buildPlanSnapshotForCard } from './cardPlanSnapshot';
import {
  coerceProposedPrice,
  tierHasPublishablePrice,
} from './subscriptionFormPricing';
import { notifySquadhireOfCardRecall } from './squadhireWebhook';

/**
 * Hydrate a subscription_cards row into the shape the UI expects:
 *   - target_country_ids: string[]
 *   - target_regions: { country_id, region }[]
 *   - recipient_counts: {
 *       partners: { pending, accepted, rejected },
 *       talents:  { accepted, rejected }     // external table only stores responses
 *     }
 *
 * Accepts a single card row (raw DB shape). Call-sites usually have the row
 * already; this helper pulls the joined relations in a single round-trip.
 */
export async function hydrateCard(card: any, parentCardId?: string): Promise<any> {
  if (!card) return card;
  const targetingId = parentCardId ?? card.parent_card_id ?? card.id;
  const [
    { data: countries },
    { data: regions },
    { data: partnerRecipients },
    { data: talentRecipients },
  ] = await Promise.all([
    supabaseAdmin
      .from('subscription_card_target_countries')
      .select('country_id')
      .eq('card_id', targetingId),
    supabaseAdmin
      .from('subscription_card_target_regions')
      .select('country_id, region')
      .eq('card_id', targetingId),
    supabaseAdmin
      .from('subscription_card_recipients')
      .select('status, broadcast_at')
      .eq('card_id', card.id)
      .is('archived_at', null),
    supabaseAdmin
      .from('subscription_card_external_recipients')
      .select('status, notified_at')
      .eq('card_id', card.id)
      .is('archived_at', null),
  ]);

  const partners = { pending: 0, accepted: 0, rejected: 0 };
  let partnersStaged = 0;
  (partnerRecipients || []).forEach((r: any) => {
    if (r.status in partners) (partners as any)[r.status]++;
    if (r.status === 'pending' && !r.broadcast_at) partnersStaged++;
  });

  const talents = { accepted: 0, rejected: 0 };
  let talentsQueued = 0;
  (talentRecipients || []).forEach((r: any) => {
    if (r.status in talents) (talents as any)[r.status]++;
    if (r.status === 'pending' && !r.notified_at) talentsQueued++;
  });

  // "Needs broadcast" — a published card still holding recipients that haven't
  // been sent: staged partners (broadcast_at NULL), queued hand-picked talents
  // (notified_at NULL), or a broadcast-mode card with talent targeting that was
  // never delivered to SquadHire (publish now defers delivery to Broadcast).
  const isLivePublished = card.state === 'published' && !card.archived_at;
  const broadcastTalentPending =
    card.distribution === 'broadcast' &&
    Array.isArray(card.publish_targets) && card.publish_targets.includes('talent') &&
    Array.isArray(card.squadhire_category_ids) && card.squadhire_category_ids.length > 0 &&
    !card.squadhire_synced_at;
  const needs_broadcast =
    isLivePublished && (partnersStaged > 0 || talentsQueued > 0 || broadcastTalentPending);

  return {
    ...card,
    target_country_ids: (countries || []).map((r: any) => r.country_id),
    target_regions: (regions || []).map((r: any) => ({
      country_id: r.country_id,
      region: r.region,
    })),
    recipient_counts: {
      partners: { ...partners, staged: partnersStaged },
      talents: { ...talents, queued: talentsQueued },
    },
    needs_broadcast,
  };
}

/**
 * Batch variant of {@link hydrateCard} for the admin list endpoint. Hydrating a
 * list one card at a time fired 4 queries PER card (target countries/regions +
 * partner/talent recipients) — an N+1 that made Subscription Cards crawl as the org
 * grew. This pulls the same four relations for the WHOLE list in 4 queries total
 * and aggregates per card in memory.
 *
 * Equivalent to calling {@link hydrateCard} on each card, including the parent
 * targeting rule: target countries/regions resolve via parent_card_id ?? id, so
 * secondary cards (which inherit targeting from their parent) hydrate correctly
 * too. Recipient counts always key off the card's own id.
 *
 * Returns a Map keyed by card id holding ONLY the derived fields — callers spread
 * it over the raw card row (mirrors `{ ...card, ...derived }`).
 */
export async function hydrateCardsBatch(
  cards: any[],
): Promise<Map<string, {
  target_country_ids: string[];
  target_regions: { country_id: string; region: string }[];
  recipient_counts: {
    partners: { pending: number; accepted: number; rejected: number; staged: number };
    talents: { accepted: number; rejected: number; queued: number };
  };
  needs_broadcast: boolean;
}>> {
  const sentinel = ['00000000-0000-0000-0000-000000000000'];
  // Recipient counts key off the card's own id; targeting rows key off
  // parent_card_id ?? id (secondaries inherit their parent's targeting).
  const ownIds = cards.map((c) => c.id).filter(Boolean);
  const targetingIdByCard = new Map<string, string>();
  cards.forEach((c) => { if (c.id) targetingIdByCard.set(c.id, c.parent_card_id ?? c.id); });
  const targetingIds = Array.from(new Set(targetingIdByCard.values()));
  const inOwn = ownIds.length ? ownIds : sentinel;
  const inTargeting = targetingIds.length ? targetingIds : sentinel;

  const [
    { data: countries },
    { data: regions },
    { data: partnerRecipients },
    { data: talentRecipients },
  ] = await Promise.all([
    supabaseAdmin
      .from('subscription_card_target_countries')
      .select('card_id, country_id')
      .in('card_id', inTargeting),
    supabaseAdmin
      .from('subscription_card_target_regions')
      .select('card_id, country_id, region')
      .in('card_id', inTargeting),
    supabaseAdmin
      .from('subscription_card_recipients')
      .select('card_id, status, broadcast_at')
      .in('card_id', inOwn)
      .is('archived_at', null),
    supabaseAdmin
      .from('subscription_card_external_recipients')
      .select('card_id, status, notified_at')
      .in('card_id', inOwn)
      .is('archived_at', null),
  ]);

  const countriesByCard = new Map<string, string[]>();
  (countries || []).forEach((r: any) => {
    const arr = countriesByCard.get(r.card_id) || [];
    arr.push(r.country_id);
    countriesByCard.set(r.card_id, arr);
  });
  const regionsByCard = new Map<string, { country_id: string; region: string }[]>();
  (regions || []).forEach((r: any) => {
    const arr = regionsByCard.get(r.card_id) || [];
    arr.push({ country_id: r.country_id, region: r.region });
    regionsByCard.set(r.card_id, arr);
  });
  type PCount = { pending: number; accepted: number; rejected: number; staged: number };
  const partnersByCard = new Map<string, PCount>();
  (partnerRecipients || []).forEach((r: any) => {
    const p = partnersByCard.get(r.card_id) || { pending: 0, accepted: 0, rejected: 0, staged: 0 };
    if (r.status in p) (p as any)[r.status]++;
    if (r.status === 'pending' && !r.broadcast_at) p.staged++;
    partnersByCard.set(r.card_id, p);
  });
  type TCount = { accepted: number; rejected: number; queued: number };
  const talentsByCard = new Map<string, TCount>();
  (talentRecipients || []).forEach((r: any) => {
    const t = talentsByCard.get(r.card_id) || { accepted: 0, rejected: 0, queued: 0 };
    if (r.status in t) (t as any)[r.status]++;
    if (r.status === 'pending' && !r.notified_at) t.queued++;
    talentsByCard.set(r.card_id, t);
  });

  const out = new Map<string, any>();
  for (const card of cards) {
    const partners = partnersByCard.get(card.id) || { pending: 0, accepted: 0, rejected: 0, staged: 0 };
    const talents = talentsByCard.get(card.id) || { accepted: 0, rejected: 0, queued: 0 };

    const isLivePublished = card.state === 'published' && !card.archived_at;
    const broadcastTalentPending =
      card.distribution === 'broadcast' &&
      Array.isArray(card.publish_targets) && card.publish_targets.includes('talent') &&
      Array.isArray(card.squadhire_category_ids) && card.squadhire_category_ids.length > 0 &&
      !card.squadhire_synced_at;
    const needs_broadcast =
      isLivePublished && (partners.staged > 0 || talents.queued > 0 || broadcastTalentPending);

    const targetingId = targetingIdByCard.get(card.id) ?? card.id;
    out.set(card.id, {
      target_country_ids: countriesByCard.get(targetingId) || [],
      target_regions: regionsByCard.get(targetingId) || [],
      recipient_counts: {
        partners: { pending: partners.pending, accepted: partners.accepted, rejected: partners.rejected, staged: partners.staged },
        talents: { accepted: talents.accepted, rejected: talents.rejected, queued: talents.queued },
      },
      needs_broadcast,
    });
  }
  return out;
}

/**
 * Fetch (and create if missing) the draft subscription_card for a staged
 * subscription row. Returns the hydrated card. Called from
 * GET /subscription-cards/by-submission-sub/:id.
 */
export async function getOrCreateDraftCard(submissionSubscriptionId: string) {
  const { data: existing, error: selErr } = await supabaseAdmin
    .from('subscription_cards')
    .select('*')
    .eq('submission_subscription_id', submissionSubscriptionId)
    .maybeSingle();
  if (selErr) throw selErr;
  if (existing) return hydrateCard(existing);

  // Pre-fill squadhire_category_ids from the canonical subscription's mapping
  // (subscription_squadhire_profiles). Sales can still override per card.
  const { data: stagedRow } = await supabaseAdmin
    .from('client_submission_subscriptions')
    .select('subscription_id')
    .eq('id', submissionSubscriptionId)
    .maybeSingle();

  let prefillCategoryIds: string[] = [];
  if (stagedRow?.subscription_id) {
    const { data: mappings } = await supabaseAdmin
      .from('subscription_squadhire_profiles')
      .select('squadhire_category_id')
      .eq('subscription_id', stagedRow.subscription_id);
    prefillCategoryIds = (mappings || []).map((m: any) => m.squadhire_category_id);
  }

  const { data: created, error: insErr } = await supabaseAdmin
    .from('subscription_cards')
    .insert({
      submission_subscription_id: submissionSubscriptionId,
      squadhire_category_ids: prefillCategoryIds,
    })
    .select('*')
    .single();
  if (insErr) throw insErr;
  return hydrateCard(created);
}

/**
 * Run the targeting query inside a transaction's first step: insert matching
 * partner IDs into subscription_card_recipients for a given card. Called from
 * POST /subscription-cards/:id/publish.
 *
 * Implementation note: supabase-js does not expose transactions; we instead
 * call a plpgsql function (defined inline via `rpc`) — but the simpler approach
 * used elsewhere in this codebase (e.g. hydrateStagedSubscriptions) is to run
 * the match query with parameterised SQL via supabaseAdmin.rpc once we have a
 * stored function. To keep this migration-free we run the match manually in JS
 * using supabaseAdmin queries. Rows are inserted with ON CONFLICT DO NOTHING.
 */
export async function matchPartnersForCard(
  cardId: string,
  opts: { targetingCardId?: string; staged?: boolean } = {},
): Promise<string[]> {
  const { targetingCardId, staged = false } = opts;
  const srcId = targetingCardId ?? cardId;
  const { data: cardRow, error: cardErr } = await supabaseAdmin
    .from('subscription_cards')
    .select('target_tiers, min_experience_years, target_languages')
    .eq('id', srcId)
    .single();
  if (cardErr) throw cardErr;

  const [{ data: countryRows }, { data: regionRows }] = await Promise.all([
    supabaseAdmin
      .from('subscription_card_target_countries')
      .select('country_id')
      .eq('card_id', srcId),
    supabaseAdmin
      .from('subscription_card_target_regions')
      .select('country_id, region')
      .eq('card_id', srcId),
  ]);

  const targetCountryIds = (countryRows || []).map((r: any) => r.country_id);
  const regionsByCountry: Record<string, string[]> = {};
  (regionRows || []).forEach((r: any) => {
    const list = (regionsByCountry[r.country_id] = regionsByCountry[r.country_id] || []);
    list.push(String(r.region).toLowerCase());
  });

  let query = supabaseAdmin
    .from('users')
    .select('id, country_id, state_region, languages, tier, min_experience_years')
    .in('user_type', ['partner', 'partner_employee'])
    .eq('status', 'active')
    .not('tier', 'is', null);

  const targetTiers: string[] = Array.isArray(cardRow.target_tiers)
    ? cardRow.target_tiers
    : [];
  if (targetTiers.length > 0) query = query.in('tier', targetTiers);
  if (cardRow.min_experience_years > 0) {
    query = query.gte('min_experience_years', cardRow.min_experience_years);
  }
  if (targetCountryIds.length > 0) query = query.in('country_id', targetCountryIds);

  const { data: partners, error: partErr } = await query;
  if (partErr) throw partErr;

  const targetLangs: string[] = Array.isArray(cardRow.target_languages)
    ? cardRow.target_languages
    : [];

  const matchingIds = (partners || [])
    .filter((u: any) => {
      // Region filter: if the card has regions for a country, the partner must
      // match one of them (case-insensitive). If no regions for the country,
      // country match alone is enough.
      const regions = regionsByCountry[u.country_id];
      if (regions && regions.length > 0) {
        if (!u.state_region) return false;
        if (!regions.includes(String(u.state_region).toLowerCase())) return false;
      }
      // Language filter: if card has languages, at least one must overlap.
      if (targetLangs.length > 0) {
        const pLangs: string[] = Array.isArray(u.languages) ? u.languages : [];
        if (!pLangs.some((l) => targetLangs.includes(l))) return false;
      }
      return true;
    })
    .map((u: any) => u.id);

  if (matchingIds.length > 0) {
    // Staged matches land with broadcast_at = NULL — matched but invisible to
    // the partner until the "Broadcast" action releases them. Immediate matches
    // (sales publish, manual→broadcast upgrade) stamp broadcast_at now so they
    // surface in the partner opportunities feed right away.
    const broadcastAt = staged ? null : new Date().toISOString();
    const rows = matchingIds.map((pid) => ({
      card_id: cardId,
      partner_id: pid,
      broadcast_at: broadcastAt,
    }));
    const { error: insErr } = await supabaseAdmin
      .from('subscription_card_recipients')
      .upsert(rows, { onConflict: 'card_id,partner_id', ignoreDuplicates: true });
    if (insErr) throw insErr;
  }

  return matchingIds;
}

/**
 * Fan a multi-tier draft card out to N published cards, one per selected
 * tier. The siblings are NOT linked via parent_card_id — each keeps its own
 * independent state machine so closing/assigning one tier doesn't cascade to
 * its siblings. They ARE, however, tagged with a shared `brief_group_id` so
 * the admin Published view (and, via the webhook, SquadHire) can collapse the
 * tier siblings back into a single card with per-tier tabs.
 *
 * Returns ALL resulting card ids, original first. Caller fans out
 * matchPartnersForCard + SquadHire delivery per id.
 *
 * If the draft has 0–1 tiers, no fan-out happens — the original is just
 * flipped to published with its existing proposed_price/markup (single-tier
 * drafts can also have a tier_pricing entry, in which case we copy that
 * tier's values onto the row before flipping state).
 *
 * Caller is responsible for: validating state='draft' and that publish_targets
 * is non-empty. This helper just does the row work.
 */
export async function fanOutTierCards(
  originalCardId: string,
  publishedBy: string,
  distribution: 'broadcast' | 'manual',
): Promise<string[]> {
  const { data: original, error: loadErr } = await supabaseAdmin
    .from('subscription_cards')
    .select('*')
    .eq('id', originalCardId)
    .single();
  if (loadErr || !original) throw loadErr ?? new Error('Card not found');

  const targetTiers: string[] = Array.isArray(original.target_tiers)
    ? (original.target_tiers as string[]).filter(Boolean)
    : [];
  const tierPricing: Record<string, { proposed_price?: number; markup?: number | null; subscription_price?: number | null }> =
    original.tier_pricing && typeof original.tier_pricing === 'object'
      ? original.tier_pricing
      : {};

  const now = new Date().toISOString();

  if (targetTiers.length <= 1) {
    // Single-tier (or untargeted) path. If tier_pricing has the tier's
    // entry, prefer it over the legacy proposed_price/markup on the row
    // (form may have written both during transition).
    const updates: Record<string, unknown> = {
      state: 'published',
      distribution,
      published_at: now,
      published_by: publishedBy,
      tier_pricing: {},
    };
    if (targetTiers.length === 1) {
      const entry = tierPricing[targetTiers[0]];
      // Accept either a proposed price or a finalized subscription price
      // (catalog-seeded briefs often have Final set with Proposed = 0).
      if (tierHasPublishablePrice(entry)) {
        updates.proposed_price = coerceProposedPrice(entry.proposed_price);
        // null markup = inherit the plan catalog margin (don't coerce to 0).
        updates.markup = entry.markup ?? null;
        updates.subscription_price = entry.subscription_price ?? null;
      }
    }
    // Freeze the plan-side data this card displays so subsequent plan
    // edits don't silently rewrite a card partners already saw.
    updates.plan_snapshot = await buildPlanSnapshotForCard(original);
    const { error: updErr } = await supabaseAdmin
      .from('subscription_cards')
      .update(updates)
      .eq('id', originalCardId)
      .eq('state', 'draft');
    if (updErr) throw updErr;
    return [originalCardId];
  }

  // Multi-tier: every selected tier needs a client-facing price (proposed
  // OR finalized subscription price — catalog seeds often leave proposed at 0).
  for (const tier of targetTiers) {
    const entry = tierPricing[tier];
    if (!tierHasPublishablePrice(entry)) {
      throw new Error(`Missing pricing for tier "${tier}"`);
    }
  }

  // One shared id across every tier sibling so the admin Published view and
  // SquadHire can group them into a single card with per-tier tabs.
  const groupId = randomUUID();

  // Repurpose the original row as the first tier's card.
  const firstTier = targetTiers[0];
  const firstEntry = tierPricing[firstTier];
  // Each tier card resolves to its own plan_id (plans are keyed by
  // subscription+plan+tier), so snapshot per card. Build the originals
  // snapshot with target_tiers narrowed to [firstTier] for the resolver.
  const originalSnapshot = await buildPlanSnapshotForCard({
    ...original,
    target_tiers: [firstTier],
  });
  const { error: updErr } = await supabaseAdmin
    .from('subscription_cards')
    .update({
      state: 'published',
      distribution,
      published_at: now,
      published_by: publishedBy,
      target_tiers: [firstTier],
      proposed_price: coerceProposedPrice(firstEntry.proposed_price),
      markup: firstEntry.markup ?? null,
      subscription_price: firstEntry.subscription_price ?? null,
      tier_pricing: {},
      plan_snapshot: originalSnapshot,
      brief_group_id: groupId,
    })
    .eq('id', originalCardId)
    .eq('state', 'draft');
  if (updErr) throw updErr;

  // Fields copied verbatim onto each sibling. Deliberate omissions:
  //   - id (auto)
  //   - state, distribution, published_at, published_by (set fresh)
  //   - target_tiers, proposed_price, markup, subscription_price (overridden per sibling)
  //   - tier_pricing (cleared)
  //   - parent_card_id (NULL — siblings stay independent so SquadHire
  //     surfaces them all on the business dashboard)
  //   - subscription_request_id (kept on original only — upsquad notify
  //     fires once)
  //   - submission_subscription_id (kept on original only — staged path
  //     uses .maybeSingle() on this column to find drafts; siblings would
  //     break that lookup)
  //   - state-machine columns that should reset per sibling (closed_at,
  //     recalled_at, archived_at, squadhire_synced_at, etc.)
  const COPY_FIELDS = [
    'source',
    'card_type',
    'assignment_details',
    'service_type',
    'plan_name',
    'working_days',
    'brand_name',
    'business_nature',
    'notes',
    'requirement_note',
    'requirement_voice_url',
    'hours_note',
    'min_experience_years',
    'target_languages',
    'custom_deliverables',
    'publish_targets',
    'customer_company',
    'customer_name',
    'customer_email',
    'customer_phone',
    'customer_location',
    'squadhire_category_ids',
    'partner_price_override',
    'disabled_default_deliverable_ids',
    'client_budget',
  ] as const;

  const siblingIds: string[] = [];
  for (let i = 1; i < targetTiers.length; i++) {
    const tier = targetTiers[i];
    const entry = tierPricing[tier];
    const insertRow: Record<string, unknown> = {
      state: 'published',
      distribution,
      published_at: now,
      published_by: publishedBy,
      target_tiers: [tier],
      proposed_price: coerceProposedPrice(entry.proposed_price),
      markup: entry.markup ?? null,
      subscription_price: entry.subscription_price ?? null,
      tier_pricing: {},
      brief_group_id: groupId,
    };
    for (const field of COPY_FIELDS) {
      const val = (original as any)[field];
      if (val !== undefined) insertRow[field] = val;
    }
    // Per-tier snapshot — plans are keyed by (subscription, plan, tier) so
    // the resolver picks up this sibling's distinct plan_id.
    insertRow.plan_snapshot = await buildPlanSnapshotForCard({
      ...original,
      ...insertRow,
    });
    const { data: inserted, error: insErr } = await supabaseAdmin
      .from('subscription_cards')
      .insert(insertRow)
      .select('id')
      .single();
    if (insErr || !inserted) throw insErr ?? new Error('Insert failed');
    siblingIds.push(inserted.id as string);
  }

  // Copy targeting join rows (countries / regions) from the original to
  // each sibling so each tier card gets the same geo targeting. Categories
  // live on the row itself and are already covered by COPY_FIELDS.
  if (siblingIds.length > 0) {
    const [{ data: countryRows }, { data: regionRows }] = await Promise.all([
      supabaseAdmin
        .from('subscription_card_target_countries')
        .select('country_id')
        .eq('card_id', originalCardId),
      supabaseAdmin
        .from('subscription_card_target_regions')
        .select('country_id, region')
        .eq('card_id', originalCardId),
    ]);
    const countryInserts: Array<{ card_id: string; country_id: string }> = [];
    const regionInserts: Array<{ card_id: string; country_id: string; region: string }> = [];
    for (const sid of siblingIds) {
      (countryRows ?? []).forEach((r: any) => {
        countryInserts.push({ card_id: sid, country_id: r.country_id });
      });
      (regionRows ?? []).forEach((r: any) => {
        regionInserts.push({ card_id: sid, country_id: r.country_id, region: r.region });
      });
    }
    if (countryInserts.length > 0) {
      await supabaseAdmin
        .from('subscription_card_target_countries')
        .insert(countryInserts);
    }
    if (regionInserts.length > 0) {
      await supabaseAdmin
        .from('subscription_card_target_regions')
        .insert(regionInserts);
    }
  }

  return [originalCardId, ...siblingIds];
}

/**
 * Inverse of fanOutTierCards. Collapse a published multi-tier brief group back
 * into a single editable draft, so a recall → edit → re-publish cycle
 * reproduces the original grouped card instead of stranding tier siblings.
 *
 * A multi-tier brief is fanned out into one published card per tier, all
 * sharing a `brief_group_id` and shown to the admin as a SINGLE card. Recall,
 * however, is card-scoped — it only ever pulled back the one tier the admin's
 * active tab was on, leaving the other tier siblings published. The next
 * publish then minted a fresh group, so the untouched siblings lingered as an
 * orphaned duplicate card in Broadcasted. This helper is what makes recall act
 * on the whole group:
 *   - picks the group's ORIGINAL row (the one still carrying
 *     submission_subscription_id — fan-out keeps it only on the first tier) as
 *     the anchor draft, falling back to the earliest-created member;
 *   - rebuilds the anchor's target_tiers + tier_pricing from every member so
 *     the re-publish fans the same tiers out again;
 *   - returns the anchor to `draft` (recipients dropped, SquadHire mirror
 *     pulled, brief_group_id cleared — a fresh group id is minted on republish);
 *   - retires the other tier rows: recipients dropped, SquadHire mirror pulled,
 *     soft-deleted into Trash (state=closed) so they leave every feed and the
 *     sync sweeper skips them.
 *
 * Returns the anchor draft id, or null when the group has ≤1 live member (the
 * caller should fall back to a plain single-card recall).
 */
export async function reunifyTierGroupToDraft(
  briefGroupId: string,
  actorId: string | null,
): Promise<string | null> {
  const { data: members, error } = await supabaseAdmin
    .from('subscription_cards')
    .select(
      'id, target_tiers, proposed_price, markup, subscription_price, submission_subscription_id, created_at',
    )
    .eq('brief_group_id', briefGroupId)
    .eq('state', 'published')
    .is('deleted_at', null)
    .order('created_at', { ascending: true });
  if (error) throw error;
  if (!members || members.length <= 1) return null;

  // Anchor = the original fan-out row (keeps the submission/upsquad wiring that
  // fan-out leaves only on the first tier); fall back to the earliest member.
  const anchor = members.find((m) => m.submission_subscription_id) ?? members[0];
  const siblings = members.filter((m) => m.id !== anchor.id);

  // Rebuild the multi-tier draft shape: ordered tier union (anchor first) plus a
  // tier_pricing map keyed by tier, reconstructed from each member's row.
  const orderedTiers: string[] = [];
  const tierPricing: Record<
    string,
    { proposed_price: number | null; markup: number | null; subscription_price: number | null }
  > = {};
  for (const m of [anchor, ...siblings]) {
    const tier =
      Array.isArray(m.target_tiers) && m.target_tiers.length ? String(m.target_tiers[0]) : null;
    if (!tier || tierPricing[tier]) continue;
    orderedTiers.push(tier);
    tierPricing[tier] = {
      proposed_price: m.proposed_price ?? null,
      markup: m.markup ?? null,
      subscription_price: m.subscription_price ?? null,
    };
  }

  const now = new Date().toISOString();

  // Retire the sibling tier rows. Take the SquadHire mirror down WHILE each
  // sibling is still published — after the draft/closed wipe, the never-
  // published guard would skip delivery and leave talents seeing the card.
  // state=closed + deleted_at then moves them to Trash and keeps the sweeper away.
  for (const s of siblings) {
    try {
      await notifySquadhireOfCardRecall(s.id);
    } catch (err) {
      console.error('[reunify-tier-group] squadhire mirror drop error (sibling)', err);
    }
    await supabaseAdmin.from('subscription_card_recipients').delete().eq('card_id', s.id);
    await supabaseAdmin.from('subscription_card_external_recipients').delete().eq('card_id', s.id);
    await supabaseAdmin
      .from('subscription_cards')
      .update({
        state: 'closed',
        closed_at: now,
        squadhire_synced_at: null,
        squadhire_sync_attempts: 0,
        squadhire_sync_last_error: null,
        deleted_at: now,
        deleted_by: actorId,
      })
      .eq('id', s.id);
  }

  // Return the anchor to an editable multi-tier draft. Takedown first (while
  // still published), then pull recipients and clear the frozen plan snapshot
  // + group id. A post-draft notify would no-op on the never-published guard.
  try {
    await notifySquadhireOfCardRecall(anchor.id);
  } catch (err) {
    console.error('[reunify-tier-group] squadhire mirror drop error (anchor)', err);
  }
  await supabaseAdmin.from('subscription_card_recipients').delete().eq('card_id', anchor.id);
  await supabaseAdmin.from('subscription_card_external_recipients').delete().eq('card_id', anchor.id);
  await supabaseAdmin
    .from('subscription_cards')
    .update({
      state: 'draft',
      published_at: null,
      published_by: null,
      squadhire_synced_at: null,
      squadhire_sync_attempts: 0,
      squadhire_sync_last_error: null,
      plan_snapshot: null,
      brief_group_id: null,
      target_tiers: orderedTiers,
      tier_pricing: tierPricing,
    })
    .eq('id', anchor.id);

  return anchor.id;
}

/**
 * Inverse of matchPartnersForCard: given a partner, find all active published
 * cards they qualify for and upsert them as recipients. Idempotent.
 */
export async function matchCardsForPartner(userId: string): Promise<string[]> {
  const { data: user, error: userErr } = await supabaseAdmin
    .from('users')
    .select('id, user_type, status, tier, min_experience_years, country_id, state_region, languages')
    .eq('id', userId)
    .single();
  if (userErr) throw userErr;
  if (!user || !['partner', 'partner_employee'].includes(user.user_type)) return [];
  if (user.status !== 'active' || !user.tier) return [];

  const { data: cards, error: cardsErr } = await supabaseAdmin
    .from('subscription_cards')
    .select('id, target_tiers, min_experience_years, target_languages')
    .eq('state', 'published');
  if (cardsErr) throw cardsErr;
  if (!cards || cards.length === 0) return [];

  const cardIds = cards.map((c: any) => c.id);
  const [{ data: countryRows }, { data: regionRows }] = await Promise.all([
    supabaseAdmin
      .from('subscription_card_target_countries')
      .select('card_id, country_id')
      .in('card_id', cardIds),
    supabaseAdmin
      .from('subscription_card_target_regions')
      .select('card_id, country_id, region')
      .in('card_id', cardIds),
  ]);

  const countriesByCard: Record<string, string[]> = {};
  (countryRows || []).forEach((r: any) => {
    (countriesByCard[r.card_id] = countriesByCard[r.card_id] || []).push(r.country_id);
  });

  const regionsByCard: Record<string, Record<string, string[]>> = {};
  (regionRows || []).forEach((r: any) => {
    const byCountry = (regionsByCard[r.card_id] = regionsByCard[r.card_id] || {});
    (byCountry[r.country_id] = byCountry[r.country_id] || []).push(String(r.region).toLowerCase());
  });

  const matchedCardIds: string[] = [];
  for (const card of cards) {
    const tiers: string[] = Array.isArray(card.target_tiers) ? card.target_tiers : [];
    if (tiers.length > 0 && !tiers.includes(user.tier)) continue;

    if (card.min_experience_years > 0) {
      if ((user.min_experience_years || 0) < card.min_experience_years) continue;
    }

    const cIds = countriesByCard[card.id] || [];
    if (cIds.length > 0 && !cIds.includes(user.country_id)) continue;

    const regMap = regionsByCard[card.id] || {};
    const regions = user.country_id ? regMap[user.country_id] : undefined;
    if (regions && regions.length > 0) {
      if (!user.state_region) continue;
      if (!regions.includes(String(user.state_region).toLowerCase())) continue;
    }

    const langs: string[] = Array.isArray(card.target_languages) ? card.target_languages : [];
    if (langs.length > 0) {
      const pLangs: string[] = Array.isArray(user.languages) ? user.languages : [];
      if (!pLangs.some((l: string) => langs.includes(l))) continue;
    }

    matchedCardIds.push(card.id);
  }

  if (matchedCardIds.length > 0) {
    const rows = matchedCardIds.map((cid) => ({ card_id: cid, partner_id: userId }));
    const { error: insErr } = await supabaseAdmin
      .from('subscription_card_recipients')
      .upsert(rows, { onConflict: 'card_id,partner_id', ignoreDuplicates: true });
    if (insErr) throw insErr;
  }

  return matchedCardIds;
}
