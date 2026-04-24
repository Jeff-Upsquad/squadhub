import { formatDeliverableCadence } from '@squadhub/shared';
import { config } from '../config';
import { supabaseAdmin } from '../supabase';

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
const INLINE_ATTEMPTS = 3;
const INLINE_BACKOFF_MS = [0, 2_000, 10_000];
const MAX_SYNC_ATTEMPTS = 10;
const SWEEPER_INTERVAL_MS = 5 * 60 * 1_000;
const SWEEPER_BATCH_SIZE = 20;

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
  status: 'active' | 'archived';
}

interface AttemptOutcome {
  delivered: boolean;
  error?: string;
  recipientCount?: number;
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
      'id, state, submission_subscription_id, working_days, brand_name, business_nature, notes, custom_deliverables, target_tiers, min_experience_years, target_languages, squadhire_category_ids, published_at, partner_price_override',
    )
    .eq('id', cardId)
    .maybeSingle();
  if (!card) return null;

  // Skip-if-empty gate: an admin who didn't pick any SquadHire categories
  // doesn't want this card on SquadHire. The publish handler treats a null
  // payload as a no-op, so the outbound fetch + retry loop never starts.
  const categoryIds = Array.isArray(card.squadhire_category_ids)
    ? (card.squadhire_category_ids as string[])
    : [];
  if (categoryIds.length === 0) return null;

  // Map SquadHub state → SquadHire status. Published = visible to talents;
  // anything else (draft after recall, closed) = archived and hidden.
  const status: 'active' | 'archived' =
    card.state === 'published' ? 'active' : 'archived';

  const [
    { data: countryRows },
    { data: regionRows },
    { data: staged },
  ] = await Promise.all([
    supabaseAdmin
      .from('subscription_card_target_countries')
      .select('country_id')
      .eq('card_id', cardId),
    supabaseAdmin
      .from('subscription_card_target_regions')
      .select('country_id, region')
      .eq('card_id', cardId),
    supabaseAdmin
      .from('client_submission_subscriptions')
      .select('subscription_id, plan_id, submission_id')
      .eq('id', card.submission_subscription_id)
      .maybeSingle(),
  ]);

  let subscriptionName: string | null = null;
  let planName: string | null = null;
  let leadCountryId: string | null = null;
  let planHoursDeliverable: { per_day: number; per_week: number; per_month: number } | null = null;
  if (staged) {
    const [{ data: sub }, { data: plan }, { data: submission }, { data: planDelivs }] = await Promise.all([
      supabaseAdmin.from('subscriptions').select('name').eq('id', staged.subscription_id).maybeSingle(),
      supabaseAdmin.from('subscription_plans').select('name').eq('id', staged.plan_id).maybeSingle(),
      supabaseAdmin.from('client_submissions').select('country_id').eq('id', staged.submission_id).maybeSingle(),
      supabaseAdmin
        .from('subscription_plan_deliverables')
        .select('kind, per_day, per_week, per_month')
        .eq('plan_id', staged.plan_id),
    ]);
    subscriptionName = sub?.name ?? null;
    planName = plan?.name ?? null;
    leadCountryId = (submission?.country_id as string | undefined) ?? null;
    const hoursRow = (planDelivs ?? []).find((d: any) => d.kind === 'hours');
    if (hoursRow) {
      planHoursDeliverable = {
        per_day: Number(hoursRow.per_day) || 0,
        per_week: Number(hoursRow.per_week) || 0,
        per_month: Number(hoursRow.per_month) || 0,
      };
    }
  }

  // Hours resolution: a card's custom_deliverables can carry an hours entry
  // that overrides the plan default (same pattern as partner price). Prefer
  // the card-level override, fall back to the plan deliverable.
  const cardHoursOverride = Array.isArray(card.custom_deliverables)
    ? (card.custom_deliverables as any[]).find((d) => d?.kind === 'hours')
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
    hoursLabel = formatDeliverableCadence(
      hoursSource.per_day,
      hoursSource.per_week,
      hoursSource.per_month,
      'hrs',
    );
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
  let resolvedCurrency: string | null = null;
  if (pricingCountryId && staged?.plan_id) {
    const [{ data: planPartner }, { data: country }] = await Promise.all([
      supabaseAdmin
        .from('subscription_plan_partner_pricing')
        .select('price')
        .eq('plan_id', staged.plan_id)
        .eq('country_id', pricingCountryId)
        .maybeSingle(),
      supabaseAdmin
        .from('countries')
        .select('currency')
        .eq('id', pricingCountryId)
        .maybeSingle(),
    ]);
    const defaultPartnerPrice = (planPartner?.price as number | undefined) ?? null;
    const override = card.partner_price_override as number | null | undefined;
    const resolved = override ?? defaultPartnerPrice;
    if (resolved != null && country?.currency) {
      resolvedMonthlyPrice = resolved;
      resolvedCurrency = country.currency as string;
    }
  }

  const brand = (card.brand_name ?? '').trim();
  const titleParts = [brand, subscriptionName, planName].filter(Boolean) as string[];
  const title = titleParts.length > 0 ? titleParts.join(' — ') : 'New subscription opportunity';

  const descriptionLines: string[] = [];
  if (card.business_nature) descriptionLines.push(`About: ${card.business_nature}`);
  if (Array.isArray(card.working_days) && card.working_days.length > 0) {
    descriptionLines.push(`Working days: ${card.working_days.join(', ')}`);
  }
  if (card.notes) descriptionLines.push(card.notes);
  const description = descriptionLines.join('\n\n');

  // match_rules: `category_ids` is the primary axis SquadHire's matcher
  // currently honours. Everything else is pass-through — SquadHire logs-and-
  // skips unknown keys today, so forwarding tier/experience/language/country
  // gives future matcher growth a free upgrade with no SquadHub change.
  const match_rules: Record<string, unknown> = {
    category_ids: categoryIds,
  };
  const targetTiers: string[] = Array.isArray(card.target_tiers) ? card.target_tiers : [];
  if (targetTiers.length > 0) match_rules.target_tiers = targetTiers;
  if ((card.min_experience_years ?? 0) > 0) {
    match_rules.min_experience_years = card.min_experience_years;
  }
  if (Array.isArray(card.target_languages) && card.target_languages.length > 0) {
    match_rules.target_languages = card.target_languages;
  }
  const targetCountryIds = (countryRows ?? []).map((r: any) => r.country_id as string);
  if (targetCountryIds.length > 0) match_rules.target_country_ids = targetCountryIds;
  const targetRegions = (regionRows ?? []).map((r: any) => ({
    country_id: r.country_id as string,
    region: r.region as string,
  }));
  if (targetRegions.length > 0) match_rules.target_regions = targetRegions;

  // Normalise to the Z-suffix form of ISO-8601. Postgres / the Supabase
  // client return `...+00:00`, which some consumers' ISO validators reject
  // by default (zod's `.datetime()` is one). Sending Z form keeps the
  // contract canonical regardless of how lenient the other side is.
  const publishedAtRaw = (card.published_at as string | null) ?? new Date().toISOString();
  const publishedAt = new Date(publishedAtRaw).toISOString();

  const content: Record<string, unknown> = {
    title,
    description,
    brand_name: card.brand_name ?? null,
    business_nature: card.business_nature ?? null,
    working_days: card.working_days ?? [],
    notes: card.notes ?? null,
    subscription_name: subscriptionName,
    plan_name: planName,
    custom_deliverables: card.custom_deliverables ?? [],
  };
  // Attach the resolved partner price only when we have both amount and
  // currency — Profiles' renderer hides the Payment section on missing data.
  if (resolvedMonthlyPrice != null && resolvedCurrency) {
    content.monthly_price = resolvedMonthlyPrice;
    content.currency = resolvedCurrency;
  }
  // Attach a single-line hours label ("1 hrs/day · 6 hrs/week · 30 hrs/month")
  // when the plan (or a card override) defines an hours-kind deliverable.
  // Profiles' renderer promotes this to the HOURS section above description.
  if (hoursLabel) {
    content.hours_label = hoursLabel;
  }

  return {
    external_id: card.id as string,
    content,
    match_rules,
    published_at: publishedAt,
    status,
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
// Public: background sweeper — retries published cards that never synced.
// Bounded by SWEEPER_BATCH_SIZE per tick and MAX_SYNC_ATTEMPTS per card.
// ------------------------------------------------------------

export function startSquadhireSyncSweeper(): NodeJS.Timeout {
  const tick = async () => {
    try {
      // Any card with SquadHire categories that hasn't been successfully
      // synced yet is fair game — not just state=published. Recall and
      // Close both reset squadhire_synced_at to NULL and bump sync_attempts
      // back to 0, so their archived deliveries are retried here too.
      const { data: cards, error } = await supabaseAdmin
        .from('subscription_cards')
        .select('id')
        .not('squadhire_category_ids', 'eq', '{}')
        .is('squadhire_synced_at', null)
        .lt('squadhire_sync_attempts', MAX_SYNC_ATTEMPTS)
        .order('updated_at', { ascending: true })
        .limit(SWEEPER_BATCH_SIZE);

      if (error) {
        console.error('[squadhire-webhook] sweeper query failed', error);
        return;
      }
      if (!cards || cards.length === 0) return;

      for (const card of cards as { id: string }[]) {
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
