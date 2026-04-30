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
  // ISO timestamp set when an admin recalled a card that already had
  // acceptances. SquadHire renders a "Recalled" tag on the talent's
  // accepted view but otherwise keeps the card visible. Absent on
  // never-recalled cards and on clean recalls (which become drafts).
  recalled_at?: string;
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
      'id, state, distribution, submission_subscription_id, working_days, brand_name, business_nature, notes, custom_deliverables, disabled_default_deliverable_ids, target_tiers, min_experience_years, target_languages, squadhire_category_ids, published_at, partner_price_override, parent_card_id, recalled_at',
    )
    .eq('id', cardId)
    .maybeSingle();
  if (!card) return null;

  // For secondary cards, resolve content fields from the parent.
  let contentSource = card;
  if (card.parent_card_id) {
    const { data: parent } = await supabaseAdmin
      .from('subscription_cards')
      .select(
        'id, submission_subscription_id, working_days, brand_name, business_nature, notes, custom_deliverables, disabled_default_deliverable_ids, target_tiers, min_experience_years, target_languages, squadhire_category_ids',
      )
      .eq('id', card.parent_card_id)
      .maybeSingle();
    if (!parent) return null;
    contentSource = parent as any;
  }

  // Skip-if-empty gate: an admin who didn't pick any SquadHire categories
  // doesn't want this card on SquadHire. The publish handler treats a null
  // payload as a no-op, so the outbound fetch + retry loop never starts.
  const categoryIds = Array.isArray(contentSource.squadhire_category_ids)
    ? (contentSource.squadhire_category_ids as string[])
    : [];
  if (categoryIds.length === 0) {
    // Without this log, a forgotten-checkbox publish is invisible: no fetch,
    // no error, no audit trail. Surface it so it's at least diagnosable in
    // pm2 logs after the fact.
    console.warn(
      '[squadhire] skipping delivery — card has no SquadHire categories',
      { cardId, state: card.state },
    );
    return null;
  }

  // Map SquadHub state → SquadHire status. Published = visible to talents;
  // anything else (draft after recall, closed) = archived and hidden.
  const status: 'active' | 'archived' =
    card.state === 'published' ? 'active' : 'archived';

  const targetingCardId = contentSource.id as string;
  const stagedSubId = contentSource.submission_subscription_id;

  const [
    { data: countryRows },
    { data: regionRows },
    { data: staged },
  ] = await Promise.all([
    supabaseAdmin
      .from('subscription_card_target_countries')
      .select('country_id')
      .eq('card_id', targetingCardId),
    supabaseAdmin
      .from('subscription_card_target_regions')
      .select('country_id, region')
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
  let leadCountryId: string | null = null;
  let leadEmail: string | null = null;
  let planHoursDeliverable: { per_day: number; per_week: number; per_month: number } | null = null;
  if (staged) {
    const [{ data: sub }, { data: plan }, { data: submission }, { data: planDelivs }] = await Promise.all([
      supabaseAdmin.from('subscriptions').select('name').eq('id', staged.subscription_id).maybeSingle(),
      supabaseAdmin.from('subscription_plans').select('name').eq('id', staged.plan_id).maybeSingle(),
      supabaseAdmin.from('client_submissions').select('country_id, email').eq('id', staged.submission_id).maybeSingle(),
      supabaseAdmin
        .from('subscription_plan_deliverables')
        .select('id, kind, per_day, per_week, per_month')
        .eq('plan_id', staged.plan_id),
    ]);
    subscriptionName = sub?.name ?? null;
    planName = plan?.name ?? null;
    leadCountryId = (submission?.country_id as string | undefined) ?? null;
    leadEmail = (submission?.email as string | undefined)?.trim() || null;
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
  let resolvedCustomerMonthlyPrice: number | null = null;
  let resolvedCurrency: string | null = null;
  if (pricingCountryId && staged?.plan_id) {
    const [{ data: planPartner }, { data: planCustomer }, { data: country }] = await Promise.all([
      supabaseAdmin
        .from('subscription_plan_partner_pricing')
        .select('price')
        .eq('plan_id', staged.plan_id)
        .eq('country_id', pricingCountryId)
        .maybeSingle(),
      // Customer pricing comes from the canonical plan-pricing table — what
      // the client actually pays. No per-card override exists for this side
      // (only partner price is override-able), so we read the plan default.
      supabaseAdmin
        .from('subscription_plan_pricing')
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
    const customer = (planCustomer?.price as number | undefined) ?? null;
    if (customer != null) {
      resolvedCustomerMonthlyPrice = customer;
      // Defensive: if partner pricing was missing but customer is present we
      // still need a currency to render. Reuse the same country's currency.
      if (!resolvedCurrency && country?.currency) resolvedCurrency = country.currency as string;
    }
  }

  const brand = (contentSource.brand_name ?? '').trim();
  const titleParts = [brand, subscriptionName, planName].filter(Boolean) as string[];
  const title = titleParts.length > 0 ? titleParts.join(' — ') : 'New subscription opportunity';

  const descriptionLines: string[] = [];
  if (contentSource.business_nature) descriptionLines.push(`About: ${contentSource.business_nature}`);
  if (Array.isArray(contentSource.working_days) && contentSource.working_days.length > 0) {
    descriptionLines.push(`Working days: ${contentSource.working_days.join(', ')}`);
  }
  if (contentSource.notes) descriptionLines.push(contentSource.notes);
  const description = descriptionLines.join('\n\n');

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
    brand_name: contentSource.brand_name ?? null,
    business_nature: contentSource.business_nature ?? null,
    working_days: contentSource.working_days ?? [],
    notes: contentSource.notes ?? null,
    subscription_name: subscriptionName,
    plan_name: planName,
    custom_deliverables: contentSource.custom_deliverables ?? [],
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
  // Attach a single-line hours label ("1 hrs/day · 6 hrs/week · 30 hrs/month")
  // when the plan (or a card override) defines an hours-kind deliverable.
  // Profiles' renderer promotes this to the HOURS section above description.
  if (hoursLabel) {
    content.hours_label = hoursLabel;
  }

  const distribution: 'broadcast' | 'manual' =
    card.distribution === 'manual' ? 'manual' : 'broadcast';

  // Skip the field if it's clearly not an email — SquadHire's validator
  // would 400 on `.email()` and we'd rather lose the dashboard linkage
  // than the whole delivery.
  const businessEmail =
    leadEmail && leadEmail.includes('@') ? leadEmail.toLowerCase() : undefined;

  const recalledAt = card.recalled_at as string | null | undefined;

  return {
    external_id: card.id as string,
    content,
    match_rules,
    published_at: publishedAt,
    status,
    distribution,
    ...(businessEmail ? { business_email: businessEmail } : {}),
    ...(recalledAt ? { recalled_at: new Date(recalledAt).toISOString() } : {}),
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

// ------------------------------------------------------------
// Manual assignment: single POST attempt
// ------------------------------------------------------------

function postManualAssignmentOnce(
  cardId: string,
  talentId: string,
): Promise<AttemptOutcome> {
  const baseUrl = config.squadhireWebhookUrl;
  if (!baseUrl) return Promise.resolve({ delivered: false, error: 'squadhire_webhook_url_not_configured' });
  if (!config.squadhireWebhookSecret) return Promise.resolve({ delivered: false, error: 'squadhire_webhook_secret_not_configured' });

  const url = baseUrl.endsWith('/') ? `${baseUrl}manual-assignments` : `${baseUrl}/manual-assignments`;
  const body = {
    type: 'manual_assignment',
    card_id: cardId,
    talent_id: talentId,
    assigned_at: new Date().toISOString(),
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
    squadhire_notify_attempts: (current?.squadhire_notify_attempts ?? 0) + attemptsDelta,
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
    if (lastOutcome.delivered) break;
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
      const { data: rows, error } = await supabaseAdmin
        .from('subscription_card_external_recipients')
        .select('id, card_id, external_user_id')
        .eq('assigned_manually', true)
        .is('squadhire_notified_at', null)
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
// assigned talent. SquadHire deletes its mirror recipient row so the
// card stops appearing in the talent's subscription tab. Best-effort,
// single attempt. Idempotent on the receiving side.
// ------------------------------------------------------------

export async function notifySquadhireOfManualRemoval(
  cardId: string,
  talentId: string,
): Promise<void> {
  const baseUrl = config.squadhireWebhookUrl;
  if (!baseUrl) {
    console.warn('[squadhire-webhook] manual-removal skipped: url not configured');
    return;
  }
  if (!config.squadhireWebhookSecret) {
    console.warn('[squadhire-webhook] manual-removal skipped: secret not configured');
    return;
  }

  const url = baseUrl.endsWith('/')
    ? `${baseUrl}manual-assignments/remove`
    : `${baseUrl}/manual-assignments/remove`;
  const body = {
    type: 'manual_assignment_removal',
    card_id: cardId,
    talent_id: talentId,
    removed_at: new Date().toISOString(),
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
      console.warn(`[squadhire-webhook] manual-removal http_${res.status}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[squadhire-webhook] manual-removal failed', msg);
  } finally {
    clearTimeout(timer);
  }
}

// ------------------------------------------------------------
// Public: outbound notification when an admin selects a talent
// for a card. If talentId is null, the card was closed by
// selecting a partner (SquadHub-native) — SquadHire just needs
// to know the card is archived. Best-effort, single attempt.
// ------------------------------------------------------------

export async function notifySquadhireOfSelection(
  cardId: string,
  talentId: string | null,
  selectedAt: string,
): Promise<void> {
  const baseUrl = config.squadhireWebhookUrl;
  if (!baseUrl || !config.squadhireWebhookSecret) {
    console.warn('[squadhire-webhook] selection skipped: not configured');
    return;
  }

  const url = baseUrl.endsWith('/')
    ? `${baseUrl}cards/selection`
    : `${baseUrl}/cards/selection`;
  const body = {
    type: 'card_selection',
    card_id: cardId,
    talent_id: talentId,
    selected_at: selectedAt,
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
      console.warn(`[squadhire-webhook] selection http_${res.status}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[squadhire-webhook] selection failed', msg);
  } finally {
    clearTimeout(timer);
  }
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
    ? `${baseUrl}cards/undo-selection`
    : `${baseUrl}/cards/undo-selection`;
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

// ------------------------------------------------------------
// Public: outbound notification when a card is recalled. The
// archived-status re-delivery already hides the card from talent
// queries on SquadHire, but mirror recipient rows on SquadHire's
// side persist and would re-surface on the next publish. This
// asks SquadHire to drop those mirror rows in one shot. Best-
// effort, single attempt; idempotent on the receiving side.
// ------------------------------------------------------------

export async function notifySquadhireOfCardRecall(cardId: string): Promise<void> {
  const baseUrl = config.squadhireWebhookUrl;
  if (!baseUrl) {
    console.warn('[squadhire-webhook] card-recall skipped: url not configured');
    return;
  }
  if (!config.squadhireWebhookSecret) {
    console.warn('[squadhire-webhook] card-recall skipped: secret not configured');
    return;
  }

  const url = baseUrl.endsWith('/')
    ? `${baseUrl}cards/recall`
    : `${baseUrl}/cards/recall`;
  const body = {
    type: 'card_recall',
    card_id: cardId,
    recalled_at: new Date().toISOString(),
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
      console.warn(`[squadhire-webhook] card-recall http_${res.status}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[squadhire-webhook] card-recall failed', msg);
  } finally {
    clearTimeout(timer);
  }
}
