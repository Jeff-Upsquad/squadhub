import { supabaseAdmin } from '../supabase';

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
      .select('status')
      .eq('card_id', card.id),
    supabaseAdmin
      .from('subscription_card_external_recipients')
      .select('status')
      .eq('card_id', card.id),
  ]);

  const partners = { pending: 0, accepted: 0, rejected: 0 };
  (partnerRecipients || []).forEach((r: any) => {
    if (r.status in partners) (partners as any)[r.status]++;
  });

  const talents = { accepted: 0, rejected: 0 };
  (talentRecipients || []).forEach((r: any) => {
    if (r.status in talents) (talents as any)[r.status]++;
  });

  return {
    ...card,
    target_country_ids: (countries || []).map((r: any) => r.country_id),
    target_regions: (regions || []).map((r: any) => ({
      country_id: r.country_id,
      region: r.region,
    })),
    recipient_counts: { partners, talents },
  };
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
export async function matchPartnersForCard(cardId: string, targetingCardId?: string): Promise<string[]> {
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
    const rows = matchingIds.map((pid) => ({ card_id: cardId, partner_id: pid }));
    const { error: insErr } = await supabaseAdmin
      .from('subscription_card_recipients')
      .upsert(rows, { onConflict: 'card_id,partner_id', ignoreDuplicates: true });
    if (insErr) throw insErr;
  }

  return matchingIds;
}

/**
 * Fan a multi-tier draft card out to N independent published cards, one per
 * selected tier. Children are NOT linked via parent_card_id — they're fully
 * independent so SquadHire surfaces all of them on the business dashboard
 * (the webhook hides cards with `is_secondary=true`) and so closing one
 * tier doesn't cascade to its siblings.
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
  const tierPricing: Record<string, { proposed_price?: number; markup?: number }> =
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
      if (entry && entry.proposed_price && entry.proposed_price > 0) {
        updates.proposed_price = entry.proposed_price;
        updates.markup = entry.markup ?? 0;
      }
    }
    const { error: updErr } = await supabaseAdmin
      .from('subscription_cards')
      .update(updates)
      .eq('id', originalCardId)
      .eq('state', 'draft');
    if (updErr) throw updErr;
    return [originalCardId];
  }

  // Multi-tier: validate every selected tier has a non-zero price.
  for (const tier of targetTiers) {
    const entry = tierPricing[tier];
    if (!entry || !entry.proposed_price || entry.proposed_price <= 0) {
      throw new Error(`Missing pricing for tier "${tier}"`);
    }
  }

  // Repurpose the original row as the first tier's card.
  const firstTier = targetTiers[0];
  const firstEntry = tierPricing[firstTier];
  const { error: updErr } = await supabaseAdmin
    .from('subscription_cards')
    .update({
      state: 'published',
      distribution,
      published_at: now,
      published_by: publishedBy,
      target_tiers: [firstTier],
      proposed_price: firstEntry.proposed_price ?? null,
      markup: firstEntry.markup ?? 0,
      tier_pricing: {},
    })
    .eq('id', originalCardId)
    .eq('state', 'draft');
  if (updErr) throw updErr;

  // Fields copied verbatim onto each sibling. Deliberate omissions:
  //   - id (auto)
  //   - state, distribution, published_at, published_by (set fresh)
  //   - target_tiers, proposed_price, markup (overridden per sibling)
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
    'service_type',
    'plan_name',
    'working_days',
    'brand_name',
    'business_nature',
    'notes',
    'requirement_note',
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
      proposed_price: entry.proposed_price ?? null,
      markup: entry.markup ?? 0,
      tier_pricing: {},
    };
    for (const field of COPY_FIELDS) {
      const val = (original as any)[field];
      if (val !== undefined) insertRow[field] = val;
    }
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
