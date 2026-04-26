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
export async function hydrateCard(card: any): Promise<any> {
  if (!card) return card;
  const [
    { data: countries },
    { data: regions },
    { data: partnerRecipients },
    { data: talentRecipients },
  ] = await Promise.all([
    supabaseAdmin
      .from('subscription_card_target_countries')
      .select('country_id')
      .eq('card_id', card.id),
    supabaseAdmin
      .from('subscription_card_target_regions')
      .select('country_id, region')
      .eq('card_id', card.id),
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
export async function matchPartnersForCard(cardId: string): Promise<string[]> {
  const { data: cardRow, error: cardErr } = await supabaseAdmin
    .from('subscription_cards')
    .select('target_tiers, min_experience_years, target_languages')
    .eq('id', cardId)
    .single();
  if (cardErr) throw cardErr;

  const [{ data: countryRows }, { data: regionRows }] = await Promise.all([
    supabaseAdmin
      .from('subscription_card_target_countries')
      .select('country_id')
      .eq('card_id', cardId),
    supabaseAdmin
      .from('subscription_card_target_regions')
      .select('country_id, region')
      .eq('card_id', cardId),
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
