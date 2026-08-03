import type { JobMatchRules, JobRuleOverrides } from '@squadhub/shared';
import { config } from '../config';
import { supabaseAdmin } from '../supabase';
import { resolveHireBusinessUserIdForCardDelivery } from './clientExternalLinks';
import { mergeJobRules } from './jobRules';

/**
 * Outbound delivery of a published JOB card to SquadHire's webhook.
 *
 * Deliberately mirrors utils/squadhireWebhook.ts (the subscription-card
 * pipeline): inline delivery with 3 attempts and 0/2/10s backoff at the
 * mutation site, sync bookkeeping on the row (squadhire_synced_at /
 * _attempts / _last_error), and a 5-min retry sweeper capped at
 * MAX_SYNC_ATTEMPTS. The sweeper here queries job_cards ONLY — job cards are
 * a separate table precisely so the subscription sweeper can never pick one
 * up (and vice versa), which is what makes the documented sweeper-leak bug
 * class structurally impossible for hiring.
 *
 * Wire contract: Profiles reuses its subscription-card ingest for hiring
 * (card_type='hiring' is the discriminator), so the payload shape matches
 * SquadhireCardPayload. Hiring-specific content: `content.job_profile`
 * (REQUIRED — Profiles 400s without job_profile.external_id, contract §4),
 * `content.business_profile`, `content.brand_profile` (self-contained
 * snapshots a candidate can understand without asking questions) + top-level
 * `title` / `brand_name` summary for push + WhatsApp interpolation.
 */

const REQUEST_TIMEOUT_MS = 3_000;
const INLINE_ATTEMPTS = 3;
const INLINE_BACKOFF_MS = [0, 2_000, 10_000];
const MAX_SYNC_ATTEMPTS = 10;
const SWEEPER_INTERVAL_MS = 5 * 60 * 1_000;
const SWEEPER_BATCH_SIZE = 20;

// Base path of the jobs admin-mirror webhooks on Profiles. The configured
// SQUADHIRE_WEBHOOK_URL points at /api/webhooks/squadhub/cards; jobs-specific
// endpoints live beside it under /api/webhooks/squadhub/jobs/*.
const JOBS_UPSTREAM_BASE_PATH = '/api/webhooks/squadhub/jobs';

export interface SquadhireJobCardPayload {
  external_id: string;
  content: Record<string, unknown>;
  match_rules: Record<string, unknown>;
  published_at: string;
  expires_at?: string;
  // `active` while the card is live (state='published' and not archived);
  // `archived` after recall / close / cancel / archive so Profiles takes the
  // card out of talent-facing queries. Always sent — idempotent re-sends.
  status: 'active' | 'archived';
  distribution: 'broadcast' | 'manual';
  business_email?: string;
  business_phone?: string;
  business_contact_name?: string;
  business_company?: string;
  // Canonical SquadHire business_users.id (Hub identity link). Same contract
  // as subscription-card delivery — Profiles attaches the card to this id.
  business_user_id?: string;
  recalled_at?: string;
  archived_at?: string | null;
  paused_at?: string | null;
  cancelled_at?: string | null;
  // Job cards never fan out into tier siblings — always primary/ungrouped.
  is_secondary: boolean;
  group_id: string | null;
  card_type: 'hiring';
}

interface AttemptOutcome {
  delivered: boolean;
  error?: string;
  recipientCount?: number;
}

// ------------------------------------------------------------
// Effective match rules (shared by payload builder + preview)
// ------------------------------------------------------------

interface JobCardRuleContext {
  card: any;
  profile: any;
  matchRules: JobMatchRules;
}

/**
 * Load a card + its job profile and compute the effective match_rules:
 * profile columns seed the base, preference_rules refines it, and the card's
 * rule_overrides win key-by-key (explicit null = clear). category_ids come
 * from job_profiles.squadhire_category_ids. Returns null (with a warn) when
 * the card / profile is missing — callers treat null as "nothing to send".
 */
async function loadJobCardRuleContext(cardId: string): Promise<JobCardRuleContext | null> {
  const { data: card } = await supabaseAdmin
    .from('job_cards')
    .select('*')
    .eq('id', cardId)
    .maybeSingle();
  if (!card) return null;

  if (!card.job_profile_id) {
    console.warn('[squadhire-jobs] card has no job profile attached', { cardId, state: card.state });
    return null;
  }
  const { data: profile } = await supabaseAdmin
    .from('job_profiles')
    .select('*')
    .eq('id', card.job_profile_id)
    .maybeSingle();
  if (!profile || profile.deleted_at) {
    console.warn('[squadhire-jobs] job profile missing or deleted', {
      cardId,
      jobProfileId: card.job_profile_id,
    });
    return null;
  }

  // Base rules: the profile's experience columns seed the axis when the
  // JSONB doesn't carry it explicitly; preference_rules wins over columns.
  const base: JobMatchRules = {
    ...(profile.min_experience_years != null && profile.min_experience_years > 0
      ? { min_experience_years: profile.min_experience_years as number }
      : {}),
    ...(profile.max_experience_years != null && profile.max_experience_years > 0
      ? { max_experience_years: profile.max_experience_years as number }
      : {}),
    ...((profile.preference_rules ?? {}) as JobMatchRules),
  };
  const matchRules = mergeJobRules(base, (card.rule_overrides ?? {}) as JobRuleOverrides);

  const categoryIds = Array.isArray(profile.squadhire_category_ids)
    ? (profile.squadhire_category_ids as string[])
    : [];
  if (categoryIds.length > 0) matchRules.category_ids = categoryIds;

  return { card, profile, matchRules };
}

// ------------------------------------------------------------
// Payload construction
// ------------------------------------------------------------

export async function buildSquadhireJobPayload(
  cardId: string,
): Promise<SquadhireJobCardPayload | null> {
  const ctx = await loadJobCardRuleContext(cardId);
  if (!ctx) return null;
  const { card, profile, matchRules } = ctx;

  // Never-published guard — the single chokepoint for EVERY delivery path
  // (publish / recall / pause / cancel / close / archive / sweeper). A card
  // that was never published has no mirror on SquadHire, so "delivering" it
  // would CREATE the card there and trigger a fresh talent broadcast on first
  // ingest — the exact leak the subscription pipeline was bitten by. Job
  // cards are fresh tables, so published_at is authoritative (no legacy-state
  // fallback needed): no published_at, no delivery, archived or not.
  if (!card.published_at) {
    console.warn('[squadhire-jobs] skipping delivery — card was never published', {
      cardId,
      state: card.state,
      archived: !!card.archived_at,
    });
    return null;
  }

  // Skip-if-empty gate: without SquadHire categories the matcher has no
  // audience axis — refuse to broadcast rather than fan out to everyone.
  const categoryIds = Array.isArray(matchRules.category_ids) ? matchRules.category_ids : [];
  if (categoryIds.length === 0) {
    console.warn('[squadhire-jobs] skipping delivery — job profile has no SquadHire categories', {
      cardId,
      jobProfileId: profile.id,
    });
    return null;
  }

  const [{ data: business }, { data: brand }, { data: location }] = await Promise.all([
    supabaseAdmin
      .from('business_profiles')
      .select('*')
      .eq('id', profile.business_profile_id)
      .maybeSingle(),
    profile.brand_profile_id
      ? supabaseAdmin
          .from('brand_profiles')
          .select('*')
          .eq('id', profile.brand_profile_id)
          .maybeSingle()
      : Promise.resolve({ data: null } as { data: any }),
    profile.location_id
      ? supabaseAdmin
          .from('business_locations')
          .select('*')
          .eq('id', profile.location_id)
          .maybeSingle()
      : Promise.resolve({ data: null } as { data: any }),
  ]);
  if (!business) {
    console.warn('[squadhire-jobs] skipping delivery — business profile missing', {
      cardId,
      businessProfileId: profile.business_profile_id,
    });
    return null;
  }

  // status: archived_at dominates (an explicitly archived card is hidden on
  // SquadHire regardless of state), then live published, else archived
  // (recalled-back-to-onboarding / closed / cancelled).
  const status: 'active' | 'archived' =
    card.archived_at ? 'archived' : card.state === 'published' ? 'active' : 'archived';

  const brandName: string = (brand?.name as string | undefined) || (business.name as string);

  // Self-contained snapshots — the candidate should understand the business
  // and the job without asking questions (requirement B).
  const content: Record<string, unknown> = {
    // Top-level summary reused verbatim by push + WhatsApp interpolation.
    title: profile.title,
    brand_name: brandName,
    description: profile.description ?? null,
    card_type: 'hiring',
    job_profile: {
      // REQUIRED (contract §4): Profiles keys its canonical job_profiles
      // mirror on this — it 400s hiring cards without it.
      external_id: profile.id,
      title: profile.title,
      description: profile.description ?? null,
      responsibilities: profile.responsibilities ?? [],
      requirements: profile.requirements ?? [],
      skills: profile.skills ?? [],
      min_experience_years: profile.min_experience_years ?? null,
      max_experience_years: profile.max_experience_years ?? null,
      education: profile.education ?? null,
      employment_type: profile.employment_type,
      work_mode: profile.work_mode,
      working_days: profile.working_days ?? [],
      working_hours: profile.working_hours ?? null,
      salary_min: profile.salary_min ?? null,
      salary_max: profile.salary_max ?? null,
      salary_currency: profile.salary_currency ?? 'INR',
      salary_period: profile.salary_period ?? 'monthly',
      benefits: profile.benefits ?? [],
      growth_path: profile.growth_path ?? null,
      location: location
        ? {
            label: location.label,
            address: location.address,
            city: location.city ?? null,
            region: location.region ?? null,
            google_maps_url: location.google_maps_url ?? null,
          }
        : null,
    },
    business_profile: {
      external_id: business.id,
      name: business.name,
      about: business.about ?? null,
      industry: business.industry ?? null,
      company_size: business.company_size ?? null,
      website: business.website ?? null,
      socials: business.socials ?? {},
      logo_url: business.logo_url ?? null,
      photos: business.photos ?? [],
      culture: business.culture ?? null,
      perks: business.perks ?? [],
      founded_year: business.founded_year ?? null,
    },
    brand_profile: brand
      ? {
          external_id: brand.id,
          name: brand.name,
          about: brand.about ?? null,
          industry: brand.industry ?? null,
          website: brand.website ?? null,
          socials: brand.socials ?? {},
          logo_url: brand.logo_url ?? null,
          photos: brand.photos ?? [],
        }
      : null,
    // Card-level offer terms (can differ from the profile's advertised range).
    package_min: card.package_min ?? null,
    package_max: card.package_max ?? null,
    package_currency: card.package_currency ?? 'INR',
    package_period: card.package_period ?? 'monthly',
    package_notes: card.package_notes ?? null,
    openings_count: card.openings_count ?? 1,
    expected_joining_date: card.expected_joining_date ?? null,
  };

  // Business contact for SquadHire's business-user resolution (find by email
  // → phone, else pending invitation). Card brief snapshot wins; the business
  // profile's contact fields are the fallback.
  const leadEmail: string | null =
    (card.customer_email as string | null)?.trim() || (business.contact_email as string | null)?.trim() || null;
  const leadPhone: string | null =
    (card.customer_phone as string | null)?.trim() || (business.contact_phone as string | null)?.trim() || null;
  const leadContactName: string | null =
    (card.customer_name as string | null)?.trim() || (business.contact_name as string | null)?.trim() || null;
  const leadCompany: string | null =
    (card.customer_company as string | null)?.trim() || (business.name as string | null) || null;

  const businessEmail = leadEmail && leadEmail.includes('@') ? leadEmail.toLowerCase() : undefined;
  const businessPhone = leadPhone && leadPhone.length >= 6 ? leadPhone : undefined;

  const publishedAt = new Date(card.published_at as string).toISOString();

  let businessUserId: string | undefined;
  try {
    const resolved = await resolveHireBusinessUserIdForCardDelivery({
      submissionId: (card.lead_submission_id as string | null | undefined) ?? null,
      email: businessEmail ?? leadEmail,
      phone: businessPhone ?? leadPhone,
    });
    if (resolved) businessUserId = resolved;
  } catch (err: any) {
    console.warn(
      '[squadhire-jobs] hire business_user_id resolve failed (continuing with email/phone only)',
      { cardId, error: err?.message },
    );
  }

  return {
    external_id: card.id as string,
    content,
    match_rules: matchRules as Record<string, unknown>,
    published_at: publishedAt,
    ...(card.expires_at ? { expires_at: new Date(card.expires_at as string).toISOString() } : {}),
    status,
    distribution: card.distribution === 'manual' ? 'manual' : 'broadcast',
    is_secondary: false,
    group_id: null,
    card_type: 'hiring',
    ...(businessUserId ? { business_user_id: businessUserId } : {}),
    ...(businessEmail ? { business_email: businessEmail } : {}),
    ...(businessPhone ? { business_phone: businessPhone } : {}),
    ...(leadContactName ? { business_contact_name: leadContactName } : {}),
    ...(leadCompany ? { business_company: leadCompany } : {}),
    ...(card.recalled_at ? { recalled_at: new Date(card.recalled_at as string).toISOString() } : {}),
    archived_at: card.archived_at ? new Date(card.archived_at as string).toISOString() : null,
    paused_at: card.paused_at ? new Date(card.paused_at as string).toISOString() : null,
    cancelled_at: card.cancelled_at ? new Date(card.cancelled_at as string).toISOString() : null,
  };
}

// ------------------------------------------------------------
// Single delivery attempt + sync bookkeeping
// ------------------------------------------------------------

async function postOnce(payload: SquadhireJobCardPayload): Promise<AttemptOutcome> {
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

async function persistResult(
  cardId: string,
  outcome: AttemptOutcome,
  attemptsDelta: number,
): Promise<void> {
  const { data: current, error: readErr } = await supabaseAdmin
    .from('job_cards')
    .select('squadhire_sync_attempts')
    .eq('id', cardId)
    .maybeSingle();
  if (readErr) {
    console.error('[squadhire-jobs] failed to read sync attempts', readErr);
    return;
  }

  const patch: Record<string, unknown> = {
    squadhire_sync_attempts: (current?.squadhire_sync_attempts ?? 0) + attemptsDelta,
    squadhire_sync_last_error: outcome.delivered ? null : outcome.error ?? 'unknown_error',
  };
  if (outcome.delivered) {
    patch.squadhire_synced_at = new Date().toISOString();
  }

  const { error } = await supabaseAdmin.from('job_cards').update(patch).eq('id', cardId);
  if (error) {
    console.error('[squadhire-jobs] failed to persist sync state', error);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ------------------------------------------------------------
// Public: inline delivery (called from publish / lifecycle handlers).
// Never throws; never blocks longer than the retry budget.
// ------------------------------------------------------------

export async function deliverJobCardToSquadhire(
  cardId: string,
  payload: SquadhireJobCardPayload,
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
// Public: background sweeper — retries job cards that never synced.
// Queries job_cards ONLY. The never-published guard is enforced twice:
// in the query itself (published_at NOT NULL) and again inside
// buildSquadhireJobPayload (belt and suspenders — this sweeper must never
// INITIATE a card's first contact with SquadHire).
// ------------------------------------------------------------

export function startJobSyncSweeper(): NodeJS.Timeout {
  const tick = async () => {
    try {
      const { data: cards, error } = await supabaseAdmin
        .from('job_cards')
        .select('id, state, squadhire_sync_attempts, recalled_at, archived_at, cancelled_at')
        .not('published_at', 'is', null)
        .is('squadhire_synced_at', null)
        .is('deleted_at', null)
        .lt('squadhire_sync_attempts', MAX_SYNC_ATTEMPTS)
        .order('updated_at', { ascending: true })
        .limit(SWEEPER_BATCH_SIZE);

      if (error) {
        console.error('[squadhire-jobs] sweeper query failed', error);
        return;
      }
      if (!cards || cards.length === 0) return;

      // Retry net only — deliveries always fire inline at the mutation site
      // first. Takedowns (recall/archive/cancel/close) are always retried;
      // live published cards only when an inline attempt already ran
      // (attempts > 0), mirroring the subscription sweeper's guard.
      const deliverable = (cards as Array<{
        id: string;
        state: string;
        squadhire_sync_attempts: number | null;
        recalled_at: string | null;
        archived_at: string | null;
        cancelled_at: string | null;
      }>).filter((c) => {
        if (c.recalled_at || c.archived_at || c.cancelled_at || c.state === 'closed') return true;
        if (c.state === 'published') return (c.squadhire_sync_attempts ?? 0) > 0;
        return false;
      });
      if (deliverable.length === 0) return;

      for (const card of deliverable) {
        const payload = await buildSquadhireJobPayload(card.id);
        if (!payload) continue;
        const outcome = await postOnce(payload);
        await persistResult(card.id, outcome, 1);
      }
    } catch (err) {
      console.error('[squadhire-jobs] sweeper tick errored', err);
    }
  };

  // First tick a few seconds after boot so startup isn't blocked.
  const handle = setInterval(tick, SWEEPER_INTERVAL_MS);
  setTimeout(tick, 15_000);
  return handle;
}

// ------------------------------------------------------------
// Public: soft-failing POST to a Profiles jobs admin-mirror webhook
// (/api/webhooks/squadhub/jobs/*). Used for mutation-site side deliveries
// (e.g. close/cancel takedown semantics, Q&A moderation delete) where the
// action must not fail because SquadHire is briefly unreachable. The
// admin-proxy routes have their own breaker-guarded plumbing — this helper is
// for best-effort fire-and-forget calls only.
// ------------------------------------------------------------

export async function postJobsWebhook(
  suffix: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; status?: number; body?: any; error?: string }> {
  if (!config.squadhireWebhookUrl || !config.squadhireWebhookSecret) {
    return { ok: false, error: 'squadhire_not_configured' };
  }
  try {
    const url = new URL(config.squadhireWebhookUrl);
    url.pathname = `${JOBS_UPSTREAM_BASE_PATH}${suffix}`;
    url.search = '';
    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-SquadHub-Signature': config.squadhireWebhookSecret,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    const parsed = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error(`[squadhire-jobs] webhook POST ${suffix} failed: ${res.status}`);
      return { ok: false, status: res.status, body: parsed };
    }
    return { ok: true, status: res.status, body: parsed };
  } catch (err: any) {
    console.error(`[squadhire-jobs] webhook POST ${suffix} errored`, err?.message || err);
    return { ok: false, error: err?.message || 'request_failed' };
  }
}

// ------------------------------------------------------------
// Public: read-only preview of the talents a job card WOULD match on
// SquadHire, without ingesting the card, writing recipients, or notifying
// anyone. Unlike the payload builder this runs BEFORE publish (that's the
// point of a preview), so it computes the effective rules directly instead
// of going through the never-published guard. Soft-failing.
// ------------------------------------------------------------

export interface SquadhireJobMatchPreview {
  count: number;
  talents: Array<{ talent_user_id: string; talent_name: string }>;
}

export async function previewJobMatches(cardId: string): Promise<SquadhireJobMatchPreview> {
  const baseUrl = config.squadhireWebhookUrl;
  if (!baseUrl || !config.squadhireWebhookSecret) return { count: 0, talents: [] };

  const ctx = await loadJobCardRuleContext(cardId);
  if (!ctx) return { count: 0, talents: [] };

  const previewUrl = baseUrl.replace(/\/cards\/?$/, '/cards/recipients/preview');
  try {
    const response = await fetch(previewUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-SquadHub-Signature': config.squadhireWebhookSecret,
      },
      // card_type tells the matcher to apply the hiring-only axes (jobs
      // opt-in gate, age, gender, districts).
      body: JSON.stringify({ match_rules: ctx.matchRules, card_type: 'hiring' }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      console.error(`[squadhire-jobs] preview fetch failed: ${response.status} ${text}`);
      return { count: 0, talents: [] };
    }
    const result = (await response.json()) as {
      data?: Array<{ talent_user_id: string; talent_name: string }>;
      count?: number;
    };
    const talents = result.data || [];
    return { count: result.count ?? talents.length, talents };
  } catch (err: any) {
    console.error('[squadhire-jobs] preview fetch errored', err?.message || err);
    return { count: 0, talents: [] };
  }
}
